-- ===========================================================================
-- DELETION PHASE 6 — CRISIS SEVERANCE + THE DELETION VERIFICATION RECORD
-- ===========================================================================
-- @spec [Doc 03 §21 / §14.2 via owner ruling A6 2026-09-17 (crisis records survive
--        pseudonymously, treated as mastery and activity data are); Doc 06D §6.2 / §6.3 /
--        §6.5 INV-06-08, as amended by owner rulings A2 / A4 / B2 / B3 2026-09-17;
--        Doc 05E §3 Rule 4 + §5; owner brief 2026-09-17 "Deletion Vertical — Owner
--        Rulings + Phase 6 Brief"] | @implemented [2026-09-18]
--
-- plain English: two unrelated things that both had to land before deletion is finished.
--
-- PART A — THE LAST BLOCKER. A student whose tutor conversation was ever flagged for crisis
-- review cannot be deleted today. The declarative-FK pass made `tutor_conversations` CASCADE
-- from `profiles`, but three crisis edges are still ON DELETE RESTRICT, so the delete raises
-- at `crisis_review_cases.student_id` and, one level up, at `.conversation_id`. Two of 117
-- production profiles are in exactly that state, and they are the two that Phase 5 could not
-- free. A6 rules that a crisis record is treated the way mastery and activity data are: the
-- row survives, the identity link is severed.
--
-- PART B — THE PROOF. Doc 06D §6.2 asks for a deletion verification record and nothing in the
-- repository had one, so INV-06-08 ("every irreversible deletion has an executable proof")
-- was unprovable by construction. It exists now, keyed on `log_id` per A4.
--
-- WHY THE THREE `DROP NOT NULL`s ARE NOT COSMETIC. `ON DELETE SET NULL` on a NOT NULL column
-- does not fail at migration time — it fails at DELETE time, with a not-null violation
-- instead of a foreign-key violation. Altering the action without the nullability would have
-- converted this defect into a different one and looked like a fix.
--
-- WHY `crisis_review_audit_log.case_id` STAYS RESTRICT. The case survives the deletion, so
-- nothing should be able to take its audit trail away with it. It is the one crisis edge A6
-- deliberately leaves alone.
--
-- WHAT THIS DOES NOT TOUCH. The evidence bundle, the three-transaction path, suppression, the
-- retention sweeps. All live and verified.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Nullability first — SET NULL needs somewhere to put the NULL
-- ---------------------------------------------------------------------------
ALTER TABLE public.crisis_review_cases     ALTER COLUMN student_id      DROP NOT NULL;
ALTER TABLE public.crisis_review_cases     ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE public.crisis_review_audit_log ALTER COLUMN reviewer_id     DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The three delete actions, driven by the catalog
-- ---------------------------------------------------------------------------
-- Same discipline as 20260917130000: the constraint NAME is read from pg_constraint rather
-- than reconstructed (Postgres truncates at 63 bytes), the block is idempotent, and it
-- REFUSES rather than silently flattening a constraint that carries non-default properties.
-- `crisis_review_cases.conversation_id` references `tutor_conversations`, not `profiles`, so
-- the referenced table is read from the catalog too instead of being assumed.
DO $crisis$
DECLARE
  r            record;
  v_conname    text;
  v_current    "char";
  v_onupd      "char";
  v_deferrable boolean;
  v_match      "char";
  v_reftbl     text;
  v_refcol     text;
  v_changed    integer := 0;
  v_skipped    integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('crisis_review_cases',     'student_id'),
      ('crisis_review_cases',     'conversation_id'),
      ('crisis_review_audit_log', 'reviewer_id')
    ) AS t(tbl, col)
  LOOP
    SELECT c.conname, c.confdeltype, c.confupdtype, c.condeferrable, c.confmatchtype,
           tgt.relname, ta.attname
      INTO v_conname, v_current, v_onupd, v_deferrable, v_match, v_reftbl, v_refcol
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      JOIN pg_class tgt ON tgt.oid = c.confrelid
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
      JOIN unnest(c.confkey) AS fk(attnum) ON true
      JOIN pg_attribute ta ON ta.attrelid = tgt.oid AND ta.attnum = fk.attnum
     WHERE c.contype = 'f'
       AND n.nspname = 'public'
       AND src.relname = r.tbl
       AND a.attname = r.col
     LIMIT 1;

    IF v_conname IS NULL THEN
      RAISE EXCEPTION 'CRISIS_FK: no foreign key found on %.% — the edge list is stale', r.tbl, r.col;
    END IF;

    IF v_onupd <> 'a' OR v_deferrable OR v_match <> 's' THEN
      RAISE EXCEPTION 'CRISIS_FK: %.% (%) carries non-default FK properties (ON UPDATE %, deferrable %, match %); re-adding it would silently drop them. Alter it by hand.',
        r.tbl, r.col, v_conname, v_onupd, v_deferrable, v_match;
    END IF;

    IF v_current = 'n' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, v_conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE SET NULL',
      r.tbl, v_conname, r.col, v_reftbl, v_refcol
    );
    v_changed := v_changed + 1;
  END LOOP;

  RAISE NOTICE 'CRISIS_FK: % edge(s) altered, % already correct', v_changed, v_skipped;
END $crisis$;

-- ---------------------------------------------------------------------------
-- 3. The deletion verification record (Doc 06D §6.2, as amended)
-- ---------------------------------------------------------------------------
-- THIS IS NOT §6.2's DDL, and the difference is deliberate. §6.2 declares `id uuid PRIMARY
-- KEY`, `verification_started_at timestamptz NOT NULL` and `verification_completed_at
-- timestamptz`. Three of its seven columns violate the evidence-side structural rule this
-- bundle is built on: no timestamp-typed column (a time-of-deletion signal), and no uuid
-- column but the random `log_id` (a join key into the pseudonymous side). The record is on
-- the evidence side, so the structural rule wins and the spec is amended, not the schema.
--
-- NO `in_progress`. §6.2's enum has three values and §6.5 pages on an `in_progress` row older
-- than an hour. Verification runs INSIDE T3, in one transaction, so a row is never observable
-- mid-flight and the stuck state cannot occur. Dropping the value eliminates the hazard rather
-- than the alarm — the opposite of the unfirable controls SCL-096 is about.
--
-- `deleted_profile_id` IS THE ONE CARVE-OUT, and it earns its place: it lets the conformance
-- job re-scan for that uuid and confirm absence, which is the difference between recording a
-- pass and being able to re-derive one. It is sound only because no retained row carries that
-- uuid once the profile is gone — proven, not assumed, by P6.6, which sweeps every uuid column
-- in the schema. It carries no foreign key: the profile it names does not exist.
CREATE TABLE IF NOT EXISTS public.deletion_verification_records (
  log_id               uuid PRIMARY KEY
                       REFERENCES public.deletion_request_log(log_id) ON DELETE CASCADE,
  verification_outcome text NOT NULL CHECK (verification_outcome IN ('pass', 'fail')),
  layers_verified      jsonb NOT NULL,
  -- Stricter than §6.2, which requires the ref only for a pass. A fail is evidence too, and
  -- evidence that cannot be shown to be unaltered is not evidence.
  proof_manifest_ref   text NOT NULL,
  deleted_profile_id   uuid
);

COMMENT ON TABLE public.deletion_verification_records IS
  'Doc 06D §6.2 INV-06-08 deletion verification record, keyed on deletion_request_log.log_id per owner ruling A4 (the account_deletion_requests row it originally keyed on is deleted by the cascade at PS-5 and cannot be the correlation surface). Evidence side: no timestamp column, no uuid but log_id and the deliberate deleted_profile_id carve-out. Written terminal inside T3 by public.record_deletion_verification; direct writes are a defect.';

ALTER TABLE public.deletion_verification_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_verification_records FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The single writer, and the manifest hash (Doc 06D §6.4; owner ruling B3)
-- ---------------------------------------------------------------------------
-- B3: the manifest IS this record. §6 names a "signed manifest artifact" and never defines
-- its content, format, store or signing key — and the platform has no signing key and no
-- artifact store, so "signed" is unimplementable as written. `layers_verified` already carries
-- what §4.2 asks a manifest to cover. `proof_manifest_ref` is therefore a SHA-256 over the
-- record's canonical form: tamper-evidence with no key management, and §8.7's no-PII rule
-- satisfied by construction because the record carries none.
--
-- The canonical form is deliberately the jsonb TEXT rendering, not a re-serialisation: jsonb
-- normalises key order and whitespace, so the same logical layers produce the same digest
-- whatever order the caller wrote them in.
CREATE OR REPLACE FUNCTION public.record_deletion_verification(
  p_log_id             uuid,
  p_layers_verified    jsonb,
  p_outcome            text,
  p_deleted_profile_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_canonical text;
  v_hash      text;
BEGIN
  IF p_outcome NOT IN ('pass', 'fail') THEN
    RAISE EXCEPTION 'record_deletion_verification: outcome must be pass or fail (got %)', p_outcome
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.deletion_request_log l WHERE l.log_id = p_log_id) THEN
    RAISE EXCEPTION 'record_deletion_verification: no deletion_request_log row for %', p_log_id
      USING ERRCODE = '23503';
  END IF;

  IF jsonb_typeof(p_layers_verified) <> 'object' THEN
    RAISE EXCEPTION 'record_deletion_verification: layers_verified must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  v_canonical := p_log_id::text
              || E'\n' || p_outcome
              || E'\n' || p_layers_verified::text
              || E'\n' || COALESCE(p_deleted_profile_id::text, '');
  v_hash := 'sha256:' || encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');

  INSERT INTO public.deletion_verification_records
    (log_id, verification_outcome, layers_verified, proof_manifest_ref, deleted_profile_id)
  VALUES
    (p_log_id, p_outcome, p_layers_verified, v_hash, p_deleted_profile_id)
  ON CONFLICT (log_id) DO UPDATE
    SET verification_outcome = EXCLUDED.verification_outcome,
        layers_verified      = EXCLUDED.layers_verified,
        proof_manifest_ref   = EXCLUDED.proof_manifest_ref,
        deleted_profile_id   = EXCLUDED.deleted_profile_id;

  RETURN p_log_id;
END;
$$;

COMMENT ON FUNCTION public.record_deletion_verification(uuid, jsonb, text, uuid) IS
  'Doc 06D §6.4 validated write path, keyed on log_id per owner ruling A4. Writes the record TERMINAL (pass|fail) — there is no in_progress state because verification runs inside T3. proof_manifest_ref is a SHA-256 over the canonical record per owner ruling B3; the manifest IS the record.';

REVOKE ALL ON FUNCTION public.record_deletion_verification(uuid, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_deletion_verification(uuid, jsonb, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The one severance no foreign key can express — as a trigger, not a step
-- ---------------------------------------------------------------------------
-- `crisis_review_audit_log.conversation_id` is a denormalized uuid copy with NO foreign key
-- (added 20260814000000, "denormalized per SCL-025 requirement"). Nulling
-- `crisis_review_cases.conversation_id` is decoration while this copy survives one join away:
--     SELECT conversation_id FROM crisis_review_audit_log WHERE case_id = <case>
-- Severance is a property of every path to a value, not of the column that happens to carry a
-- constraint.
--
-- WHY A TRIGGER AND NOT A CASCADE STEP. The first cut put this UPDATE inside
-- `execute_account_deletion_cascade`, and the test caught it: a plain `DELETE FROM profiles`
-- — which the declarative FK actions now make possible, and which the crisis test does —
-- never calls the cascade, so the copy survived. A step in one function only severs on the
-- path that calls that function. This fires on the ROW, so it holds whichever route removes
-- the conversation: the cascade, a direct delete, the tutor CASCADE from `profiles`, or a
-- path nobody has written yet. That is the same argument this whole phase rests on — the
-- schema says it, so nobody has to remember it.
CREATE OR REPLACE FUNCTION public.sever_crisis_audit_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.crisis_review_audit_log
     SET conversation_id = NULL
   WHERE conversation_id = OLD.id;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.sever_crisis_audit_conversation() IS
  'Severs the denormalized crisis_review_audit_log.conversation_id when the conversation it names is deleted. That column carries no foreign key, so no ON DELETE action can reach it, and a copy that outlives the severance on crisis_review_cases.conversation_id restores the link with one join. Owner ruling A6 + the chokepoint rule in CLAUDE.md.';

DROP TRIGGER IF EXISTS tutor_conversations_sever_crisis_audit ON public.tutor_conversations;
CREATE TRIGGER tutor_conversations_sever_crisis_audit
  AFTER DELETE ON public.tutor_conversations
  FOR EACH ROW EXECUTE FUNCTION public.sever_crisis_audit_conversation();

COMMIT;
