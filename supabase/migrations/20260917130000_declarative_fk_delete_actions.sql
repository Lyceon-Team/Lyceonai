-- ===========================================================================
-- DELETION — DECLARATIVE FK DELETE ACTIONS
-- ===========================================================================
-- @spec [Doc 03 §14.2 (LISA tables cascade on hard delete); Doc 03B §29.1 (the
--        per-table list at account hard delete — the only place `tutor_injection_log`
--        is named for cascade; §14.2's matrix row gives injection logs a 180-day
--        archival trigger and does not mention account deletion); Doc 05E §3 Rule 4 +
--        §5 (one-way severance of the identity link, grouping retained under
--        actor_id); Doc 01 V8 §40.5; owner brief 2026-09-17 "Declarative FK
--        Actions, Not an Enumerated Cascade"] | @implemented [2026-09-17]
--
-- plain English: the account-deletion cascade enumerated table names by hand and
-- nine foreign keys into `profiles` were never added to it — the seven tutor
-- tables plus two crisis tables, all ON DELETE RESTRICT. The result is that
-- `DELETE FROM profiles` raises for any account that has used the tutor, the
-- request rolls back to 'pending', and the nightly cron retries forever with no
-- terminal state and no alert.
--
-- THIS DOES NOT UNBLOCK THE TWO LIVE PROFILES, and saying otherwise would be
-- false. Read from production 2026-09-17: exactly 2 of 117 profiles cannot be
-- hard-deleted, and they are the SAME two on both counts — each has tutor
-- conversations AND a crisis review case. The tutor CASCADE below clears the
-- first blocker; `crisis_review_cases.student_id` (RESTRICT, NOT NULL) still
-- holds them, and it is one of the four edges held for an owner ruling. What
-- this migration buys today is that no FUTURE account joins them, and that the
-- guard catches the next forgotten edge. The two existing ones need the crisis
-- ruling (SCL-094).
--
-- THE FIX IS TO STOP ENUMERATING. A foreign key can already say what happens to
-- the child row when the parent goes. Declaring it on the reference means
-- Postgres enforces it, a new table cannot be forgotten, and the function keeps
-- only what a foreign key cannot express.
--
-- WHY `SET NULL` IS THE ANONYMIZATION PRIMITIVE. Doc 05E's whole design is that
-- activity survives under `actor_id` once the identity link is severed. `SET
-- NULL` on the reference IS that severance, declared at the column instead of
-- re-derived in a procedure. The row survives, `actor_id` is untouched, and the
-- two-universe rule is unchanged — severing the link is precisely what it exists
-- to do.
--
-- WHAT THIS DOES NOT TOUCH. The evidence bundle, the three-transaction path,
-- suppression, the retention sweeps. All live and verified in prod.
--
-- 49 EDGES ALTERED on this repo's pipeline (51 on production, see below):
--    7  tutor  student_id            RESTRICT  -> CASCADE    (Doc 03 §14.2)
--   36  operator attribution         NO ACTION -> SET NULL   (all already nullable)
--    5  activity identity            NO ACTION -> SET NULL   (was procedural)
--    1  review_schedule.student_id   NO ACTION -> CASCADE    (was procedural; NOT NULL)
--
-- The operator bucket is read FROM THE CATALOG, not listed. Production has 38
-- such edges to this pipeline's 36 — `calendar_runtime_config` and its history
-- table exist there and not here — so a hand-written list would have left two
-- prod edges NO ACTION. Prod's other extra identity edges (six `calendar_*`
-- tables and `student_study_profile`) are already CASCADE and need nothing.
--
-- HELD FOR AN OWNER RULING, deliberately NOT altered here — see the PR body:
--   crisis_review_cases.student_id        RESTRICT, NOT NULL
--   crisis_review_cases.conversation_id   RESTRICT, NOT NULL (blocks tutor CASCADE)
--   crisis_review_audit_log.case_id       RESTRICT
--   crisis_review_audit_log.reviewer_id   RESTRICT, NOT NULL (admin-side, not student)
--
-- KEPT RESTRICT / NO ACTION ON PURPOSE, with a handler and an allowlist entry:
--   entitlements.profile_id                     Stripe teardown reads it first (PS-1)
--   guardian_links.{guardian,student}_profile_id another identity's rows (T1.5 pre-clear)
--   guardian_links.{accepted,revoked}_by_profile_id   ditto — see the note below
--   guardian_consent_requests.*                 ditto
--   account_deletion_requests.profile_id        the evidence bundle is written from it
--   account_deletion_requests.actor_profile_id  reassigned, not nulled (NOT NULL)
--   profiles.id -> auth.users                   ordered two-step delete, asserted by CI
--
-- WHY THE GUARDIAN EDGES ARE NOT `SET NULL`, against the brief's proposal: those
-- rows belong to ANOTHER person. `preclear_account_deletion_links` exists so they
-- are modified in their own transaction (T1.5) rather than inside the subject's
-- cascade. A declarative SET NULL would fire inside the cascade transaction and
-- put another identity's row in the deleted person's transaction — reintroducing
-- exactly what T1.5 was built to prevent.
--
-- trade-offs: the 36 operator edges previously BLOCKED deletion with
-- `PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES` until an operator reassigned the
-- attribution. That was a deliberate choice, and this reverses it: an admin who
-- changed a config value can now be deleted and the attribution becomes NULL
-- rather than being reassigned. The governance record keeps its value, its
-- timestamp and its history row; it loses the name. Blocking erasure to preserve
-- a name is not a trade this platform can make, and "blocks forever with no
-- terminal state" is the defect class this migration exists to end.
--
-- Cascade function body: 24,938 -> 20,304 characters (-4,634, 18.6%), measured
-- as `length(pg_proc.prosrc)` on two genesis fresh-apply databases, one built
-- with this migration and one without.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Re-declare the delete action on each edge, driven by the catalog
-- ---------------------------------------------------------------------------
-- The constraint NAME is read from pg_constraint rather than reconstructed,
-- because Postgres truncates identifiers at 63 bytes and at least one of these
-- is already truncated (`account_deletion_runtime_config_hist_changed_by_...`).
-- Rebuilding the name by hand would DROP nothing and then collide on ADD.
-- Idempotent: an edge already carrying the wanted action is skipped.
DO $fk$
DECLARE
  r          record;
  v_conname  text;
  v_current  "char";
  v_onupd    "char";
  v_deferrable boolean;
  v_match    "char";
  v_changed  integer := 0;
  v_skipped  integer := 0;
BEGIN
  FOR r IN
    -- The operator-attribution bucket is NOT enumerated. Every foreign key into
    -- `profiles` from an `updated_by_profile_id` / `changed_by_profile_id` column
    -- is attribution on a governance row by construction, so it is read from the
    -- catalog. Production carries 38 such edges where this repo's pipeline builds
    -- 36 (`calendar_runtime_config` and its history table exist in prod and not
    -- here), and a hand-written list of 36 would have left those two NO ACTION —
    -- the same forgetting this migration exists to end, one level up.
    SELECT src.relname::text AS tbl, a.attname::text AS col, 'n'::text AS want
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace sn ON sn.oid = src.relnamespace
      JOIN pg_class tgt ON tgt.oid = c.confrelid
      JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND sn.nspname = 'public'
       AND tn.nspname = 'public' AND tgt.relname = 'profiles'
       AND a.attname IN ('updated_by_profile_id', 'changed_by_profile_id')
    UNION ALL
    -- The rest ARE named, because no column-name rule identifies them: these are
    -- decisions about what a row IS, not about what a column means.
    SELECT * FROM (VALUES
      ('tutor_conversations','student_id','c'),
      ('tutor_messages','student_id','c'),
      ('tutor_question_links','student_id','c'),
      ('tutor_memory_summaries','student_id','c'),
      ('tutor_instruction_assignments','student_id','c'),
      ('tutor_instruction_exposures','student_id','c'),
      ('tutor_injection_log','student_id','c'),
      ('practice_session_items','user_id','n'),
      ('practice_sessions','user_id','n'),
      ('review_error_attempts','student_id','n'),
      ('review_session_items','student_id','n'),
      ('review_sessions','student_id','n'),
      ('review_schedule','student_id','c')
    ) AS t(tbl, col, want)
  LOOP
    SELECT c.conname, c.confdeltype, c.confupdtype, c.condeferrable, c.confmatchtype
      INTO v_conname, v_current, v_onupd, v_deferrable, v_match
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND n.nspname = 'public'
       AND src.relname = r.tbl
       AND a.attname = r.col
     LIMIT 1;

    IF v_conname IS NULL THEN
      RAISE EXCEPTION 'DECLARATIVE_FK: no foreign key found on %.% — the edge list is stale', r.tbl, r.col;
    END IF;

    -- The re-add below writes a DEFAULT foreign key: ON UPDATE NO ACTION, not
    -- deferrable, MATCH SIMPLE. Every one of the 77 profile-referencing FKs in
    -- production carries exactly those today (read 2026-09-17), so nothing is
    -- flattened. Refuse rather than flatten if that ever stops being true — a
    -- silently dropped DEFERRABLE is a far worse defect than a failed migration.
    IF v_onupd <> 'a' OR v_deferrable OR v_match <> 's' THEN
      RAISE EXCEPTION 'DECLARATIVE_FK: %.% (%) carries non-default FK properties (ON UPDATE %, deferrable %, match %); re-adding it would silently drop them. Alter it by hand.',
        r.tbl, r.col, v_conname, v_onupd, v_deferrable, v_match;
    END IF;

    IF v_current = r.want::"char" THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, v_conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE %s',
      r.tbl, v_conname, r.col,
      CASE r.want WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' END
    );
    v_changed := v_changed + 1;
  END LOOP;

  RAISE NOTICE 'DECLARATIVE_FK: % edge(s) altered, % already correct', v_changed, v_skipped;
END $fk$;

-- ---------------------------------------------------------------------------
-- 2. The cascade keeps only what a foreign key cannot express
-- ---------------------------------------------------------------------------
-- Removed, because the schema now says it:
--   * the 36-table operator-FK preflight loop  (-4,044 chars)
--   * the review_schedule delete               (L1-11)
--   * the review_session_items severance       (L2-04, fully declarative)
--   * `user_id`/`student_id` from four L2 updates — the device fingerprint is
--     NOT a foreign key, so that half stays here
-- What remains is what no FK can do: stamping `actor_id`, the evidence bundle,
-- the T1.5 pre-clears against other identities, and the Stripe teardown.

CREATE OR REPLACE FUNCTION public.execute_account_deletion_cascade(
  p_profile_id    uuid,
  p_privacy_mode  text DEFAULT 'hard_delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result    jsonb := '{}'::jsonb;
  v_count     bigint;
  v_actor_id  uuid;
BEGIN
  -- ========================================================================
  -- PRIVACY MODE GUARD
  -- ========================================================================
  IF p_privacy_mode NOT IN ('hard_delete', 'anonymize') THEN
    RAISE EXCEPTION 'unknown p_privacy_mode: %. Valid: hard_delete, anonymize', p_privacy_mode;
  END IF;

  -- ========================================================================
  -- IDEMPOTENCY: profile already gone → clean no-op (§10.5)
  -- ========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'profile does not exist (already cascaded)');
  END IF;

  -- ========================================================================
  -- STATUS GUARD: require a completed deletion request
  -- ========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id = p_profile_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'no completed deletion request for profile %. '
      'The cron driver must mark the request completed (after deidentify_user) before calling cascade.',
      p_profile_id;
  END IF;

  -- ========================================================================
  -- CAPTURE actor_id (anonymize mode: needed for sentinel + ledger;
  -- must be read BEFORE profile deletion destroys the mapping — §3 Rule 4)
  -- ========================================================================
  IF p_privacy_mode = 'anonymize' THEN
    SELECT actor_id INTO v_actor_id FROM public.profiles WHERE id = p_profile_id;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION '05E-5d: profiles.actor_id IS NULL for profile % — cannot anonymize without grouping identifier (INV-05E-06)',
        p_profile_id;
    END IF;
  END IF;

  -- ========================================================================
  -- PRE-CLEAR: RESTRICT + NO ACTION FKs that block profile deletion
  -- ========================================================================

  -- PS-1. entitlements (profile_id → profiles ON DELETE RESTRICT)
  DELETE FROM public.entitlements WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('entitlements', v_count);

  -- PS-2 .. PS-4: the pre-clears that touch rows belonging to OTHER identities
  -- (a student's consent request when a guardian deletes; another person's deletion
  -- request that named this profile as actor; the guardian_links rows on either side).
  --
  -- ANONYMIZE MODE (the user-facing path): these MUST already have run in their own
  -- transaction — public.preclear_account_deletion_links, T1.5 of the executor. A row
  -- of a LIVE identity written in THIS transaction would share its xmin with the
  -- anonymized_actors row written below, which is a deterministic join from actor_id
  -- to that live person and, through profiles.guardian_email, to the deleted one
  -- (evidence invariant rule 3, SCL-088; plan v4 §1). So this mode does not clear:
  -- it verifies, and fails closed (INV-05E-05: explicit, gated, nothing implicit).
  --
  -- HARD_DELETE MODE (service_role-only internal tool, Doc 05E §1): self-clears, as
  -- before. Nothing pseudonymous is retained by that mode, so the join has nothing
  -- to reach.
  IF p_privacy_mode = 'anonymize' THEN
    IF EXISTS (SELECT 1 FROM public.guardian_links
                WHERE accepted_by_profile_id = p_profile_id
                   OR revoked_by_profile_id  = p_profile_id
                   OR student_profile_id     = p_profile_id
                   OR guardian_profile_id    = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.guardian_consent_requests
                   WHERE guardian_profile_id = p_profile_id
                      OR student_profile_id  = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.account_deletion_requests
                   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id)
    THEN
      RAISE EXCEPTION 'PRECLEAR_REQUIRED: profile % still has guardian_links / guardian_consent_requests / actor_profile_id references — run public.preclear_account_deletion_links(profile) in its own transaction first (evidence invariant rule 3)',
        p_profile_id;
    END IF;
  ELSE
    -- PS-2. guardian_links — nullable NO ACTION refs first, then RESTRICT
    UPDATE public.guardian_links SET accepted_by_profile_id = NULL
     WHERE accepted_by_profile_id = p_profile_id;
    UPDATE public.guardian_links SET revoked_by_profile_id = NULL
     WHERE revoked_by_profile_id = p_profile_id;
    DELETE FROM public.guardian_links WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_student', v_count);
    DELETE FROM public.guardian_links WHERE guardian_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_guardian', v_count);

    -- PS-3. guardian_consent_requests — nullable NO ACTION ref first, then RESTRICT
    UPDATE public.guardian_consent_requests SET guardian_profile_id = NULL
     WHERE guardian_profile_id = p_profile_id;
    DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_consent_requests', v_count);

    -- PS-4. account_deletion_requests — actor_profile_id edge case
    UPDATE public.account_deletion_requests
       SET actor_profile_id = profile_id
     WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;
  END IF;

  -- PS-5. account_deletion_requests — delete THIS profile's request rows
  DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests', v_count);

  -- ========================================================================
  -- LAYER 1: DELETE derived state (SHARED — both modes; INV-05E-09 proven safe)
  -- ========================================================================
  -- All derived state: mastery, KPI, projections, scheduling. Recomputable from
  -- retained activity if ever needed (§5). No FK to profiles (convention only).
  -- Zero triggers on any L1 table. Zero FKs from L1 to L2.

  -- L1-01. student_section_projection_snapshots (05C)
  DELETE FROM public.student_section_projection_snapshots WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projection_snapshots', v_count);

  -- L1-02. student_section_projections (05C)
  DELETE FROM public.student_section_projections WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projections', v_count);

  -- L1-03. student_projection_refresh_state (05C)
  DELETE FROM public.student_projection_refresh_state WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_projection_refresh_state', v_count);

  -- L1-04. projection_refresh_outbox (05C)
  DELETE FROM public.projection_refresh_outbox WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('projection_refresh_outbox', v_count);

  -- L1-05. student_section_kpi (05B)
  DELETE FROM public.student_section_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_kpi', v_count);

  -- L1-06. student_domain_kpi (05B)
  DELETE FROM public.student_domain_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_kpi', v_count);

  -- L1-07. student_skill_kpi (05B)
  DELETE FROM public.student_skill_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_kpi', v_count);

  -- L1-08. student_overall_kpi (05B)
  DELETE FROM public.student_overall_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_overall_kpi', v_count);

  -- L1-09. student_domain_mastery (05B)
  DELETE FROM public.student_domain_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_mastery', v_count);

  -- L1-10. student_skill_mastery (05A)
  DELETE FROM public.student_skill_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_mastery', v_count);


  -- L1-12. student_kpi_rollups_current (SCL-004: was missing from L1 in both modes)
  DELETE FROM public.student_kpi_rollups_current WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_kpi_rollups_current', v_count);

  -- L1-13. legal_acceptance_outbox (2026-09-16 evidence audit, plan v4 Phase 1). The
  -- outbox has NO profiles FK (20260619000300 dropped it so consent intent survives a
  -- late profile insert), sat in no cascade list, and is invisible to the FK-driven
  -- preflight above — so its rows, keyed by the auth uuid (= profile id), survived a
  -- deletion in signup order. Classified here as identity-keyed queue state: DELETED in
  -- both modes. The consent EVIDENCE lives in deletion_consent_evidence, copied from
  -- legal_acceptances by mark_deletion_log_executing before this transaction; an
  -- undrained outbox row at T+7 is intent that never became an acceptance and is not
  -- evidence of one.
  DELETE FROM public.legal_acceptance_outbox WHERE user_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('legal_acceptance_outbox', v_count);

  -- ========================================================================
  -- MODE BRANCH: hard_delete vs anonymize diverge at L2
  -- ========================================================================

  IF p_privacy_mode = 'hard_delete' THEN
    -- ====================================================================
    -- LAYER 2 (hard_delete): Hard-delete event/audit sources
    -- ====================================================================
    -- Children-before-parent FK-safe order. All event + session + audit rows removed.

    -- L2-01. practice_session_items (child of practice_sessions via ON DELETE CASCADE)
    DELETE FROM public.practice_session_items WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions
    DELETE FROM public.practice_sessions WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (child of review_session_items via ON DELETE CASCADE)
    DELETE FROM public.review_error_attempts WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (child of review_sessions via ON DELETE CASCADE)
    DELETE FROM public.review_session_items WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions
    DELETE FROM public.review_sessions WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- L2-06. mastery_event_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_event_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L2-07. mastery_domain_refresh_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

  ELSIF p_privacy_mode = 'anonymize' THEN
    -- ====================================================================
    -- FAIL-CLOSED SENTINEL (INV-05E-07): before severing identity, verify
    -- every retained row for this user has its grouping identifier.
    -- ====================================================================
    -- Defense-in-depth: actor_id is DB-enforced NOT NULL (PR-5c seal), so
    -- this cannot fire under normal operation. But INV-05E-07 requires
    -- explicit verification before the identity ↔ actor_id linkage is
    -- destroyed. Runs BEFORE SET NULL so identity col is still queryable.
    DECLARE
      v_sentinel_tbl text;
      v_sentinel_col text;
      v_sentinel_cnt bigint;
    BEGIN
      FOR v_sentinel_tbl, v_sentinel_col IN VALUES
        ('practice_sessions',                'user_id'),
        ('practice_session_items',           'user_id'),
        ('review_sessions',                  'student_id'),
        ('review_session_items',             'student_id'),
        ('review_error_attempts',            'student_id'),
        ('mastery_event_audit_log',          'student_id'),
        ('mastery_domain_refresh_audit_log', 'student_id')
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM public.%I WHERE %I = $1 AND actor_id IS NULL',
          v_sentinel_tbl, v_sentinel_col
        ) INTO v_sentinel_cnt USING p_profile_id;
        IF v_sentinel_cnt > 0 THEN
          RAISE EXCEPTION '05E-5d SENTINEL (INV-05E-07): % row(s) in public.% have identity present but actor_id IS NULL — refusing to sever identity from ungrouped row',
            v_sentinel_cnt, v_sentinel_tbl;
        END IF;
      END LOOP;
    END;

    -- ====================================================================
    -- LAYER 2 (anonymize): Sever identity + remove fingerprints on
    -- activity tables — rows RETAINED for world-model training (§5)
    -- ====================================================================
    -- §5.1: "Removed: the identity link and any client/device/session
    --   fingerprint that could enable re-identification."
    -- §5.1: "Retained: the learning interaction — item answered, response
    --   chosen, correctness, difficulty/domain/skill/section, ordering,
    --   timing, and shared question-bank content."
    -- actor_id (NOT NULL, PR-5c) is the surviving synthetic grouping id.
    -- Children before parents (convention match with hard-delete ordering).
    --
    -- Partial unique indexes (uq_practice_items_idem, uq_review_attempts_idem)
    -- are on (identity, client_attempt_id) WHERE client_attempt_id IS NOT NULL.
    -- Setting client_attempt_id = NULL removes rows from the partial index;
    -- no uniqueness violation. Live write path unaffected (non-anonymized
    -- users retain non-NULL identity and client_attempt_id).

    -- L2-01. practice_session_items (identity + fingerprint)
    UPDATE public.practice_session_items
       SET client_attempt_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions (identity + fingerprint)
    UPDATE public.practice_sessions
       SET client_instance_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (identity + fingerprint)
    UPDATE public.review_error_attempts
       SET client_attempt_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-05. review_sessions (identity + fingerprint)
    UPDATE public.review_sessions
       SET client_instance_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- ====================================================================
    -- LAYER 3 (anonymize): Sever identity on audit tables
    -- ====================================================================
    -- §5: "Audit layer: one-way anonymized per Doc 05D §10, idempotency
    --   guarantees untouched."
    -- mastery_event_audit_log_dedup_uq is UNIQUE on (event_source_kind,
    -- event_id) — does NOT include student_id. SET NULL is safe; the
    -- idempotency anchor (INV-05A-10) is preserved.
    -- No FK to profiles (denormalized, convention only).

    -- L3-01. mastery_event_audit_log
    UPDATE public.mastery_event_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L3-02. mastery_domain_refresh_audit_log
    UPDATE public.mastery_domain_refresh_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

    -- ====================================================================
    -- ANONYMIZED_ACTORS LEDGER — Doc 05E §3 Rule 4 / INV-05E-01 / INV-05E-02
    -- (build-derived ledger; no spec anchor — SCL-088. The earlier citation of section 3.1 ("Industry precedent")
    -- was wrong.)
    -- ====================================================================
    -- Records that this actor_id is anonymized, BEFORE the profile deletion below
    -- destroys the one linkage surface. actor_id ONLY: no timestamp (SCL-088 — a
    -- deletion time on the pseudonymous side joins a dated evidence record at this
    -- volume), and public.rewrite_anonymized_actors() strips insertion order after
    -- every executor pass so xmin/ctid carry no sequence either.
    INSERT INTO public.anonymized_actors (actor_id)
    VALUES (v_actor_id)
    ON CONFLICT (actor_id) DO NOTHING;
    v_result := v_result || jsonb_build_object('anonymized_actors', 1);

  END IF;

  -- ========================================================================
  -- PROFILE + AUTH DELETE (shared — both modes destroy the profile row)
  -- ========================================================================
  -- §3 Rule 4: "Linkage destroyed at anonymization." The profile row
  -- contains profiles.actor_id — the ONLY surface linking identity to the
  -- synthetic identifier. Deleting the row makes the link irreversible.
  -- auto-CASCADE FKs fire: rate_limit_ledger, abuse_score_incidents,
  -- abuse_scores, notification_events, notification_messages, legal_acceptances.
  -- profiles.guardian_profile_id SET NULL self-FK fires for other profiles.
  -- Operator-FK edges (36 config/history) are ON DELETE SET NULL — Postgres severs
  -- the attribution as the profile row goes; no enumeration here.
  -- In anonymize mode, L2/L3 identity columns are already NULL — no FK
  -- from those tables blocks this DELETE (FKs are NO ACTION, nullable).

  DELETE FROM public.profiles WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('profiles', v_count);

  DELETE FROM auth.users WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('auth_users', v_count);

  RETURN jsonb_build_object(
    'status', 'completed',
    'profile_id', p_profile_id,
    'privacy_mode', p_privacy_mode,
    'rows_affected', v_result
  );
END;
$$;

COMMIT;
