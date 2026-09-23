-- ===========================================================================
-- THE VERIFICATION RECORD, WIRED TO THE PATH THAT SHOULD PRODUCE IT
-- ===========================================================================
-- @spec [Doc 06D §6.2 / §6.3 / §6.4 / §6.5, INV-06-08, as amended by SCL-091, SCL-100
--        and SCL-119 (PROPOSED); Doc 01 V6 §19 (identity layer); Doc 05D §10 (mastery
--        cascade); Doc 03 Main §14.2 (LISA); Doc 07 FWD-06-01 (analytics, out of scope);
--        owner brief 2026-09-23 "Verification Record Is Not Wired Into the Executor"]
--        | @implemented [2026-09-23]
--
-- plain English: migration 20260918000000 built `deletion_verification_records` and its
-- single writer `record_deletion_verification`, and Phase 6's tests called that writer
-- directly. NOTHING ON THE DELETION PATH EVER CALLED IT. The real account deletion of
-- 2026-09-23 (log 52e18e62-fcf6-4636-99f9-4aefe33db8a2) completed correctly in every other
-- respect and produced zero verification rows, so INV-06-08's "executable proof" did not
-- exist for it. A test that exercises a function is not a test that the function is
-- reachable from production; this migration supplies the reachability, and the suite that
-- proves it drives the real executor rather than the function.
--
-- WHAT CHANGES
--   1. NEW  public.verify_deletion_layers(uuid)  — the scan. Catalog-driven: it asks
--      pg_attribute for EVERY uuid column of EVERY base table in `public` and tests each
--      for the dead profile's uuid. A table added tomorrow is swept tomorrow, with nobody
--      remembering to add it to a list. Returns the §6.3 four-layer shape.
--   2. public.complete_deletion_log — T3 now scans and records, per completed deletion,
--      in the SAME transaction as the `status = 'completed'` UPDATE.
--   3. public.reconcile_deletion_log — a row completed by the reconciler records an
--      honest `fail`: T3 never ran for it, the request row is gone, and the profile uuid
--      is therefore unrecoverable, so its deletion cannot be proven. A missing row and a
--      `fail` row both page under §6.5, but only one of them says why.
--   4. public.record_deletion_verification — §6.4 step 2 ("validates p_layers_verified
--      structure against the §6.3 schema") was never implemented. It is now: a `pass`
--      whose in-scope layers are not all verified is rejected at the write, which makes
--      §6.5 failure-condition (d) unreachable instead of merely alarmed.
--
-- WHY T3 AND NOT T2. The evidence side and the actor_id side must not share a transaction
-- id: any row written in the cascade's transaction is joinable to the `anonymized_actors`
-- row written in the same one (plan v4 §1 rule 3, SCL-088). A verification record written
-- in T2 would hand the pseudonymous ledger a dated evidence row to join against — the
-- same reasoning that put the audit half of the deletion in T3 rather than in the cascade.
-- `tests/ci/deletion-evidence-bundle.pg.ci.test.ts` C3.2 asserts the separation over every
-- evidence table, this one included.
--
-- WHAT THE SCAN DOES NOT COVER, SAID PLAINLY. Only the `public` schema, plus an explicit
-- check of `auth.users`. Other `auth` tables (`auth.sessions`, `auth.identities`, …) hang
-- off `auth.users` by ON DELETE CASCADE and are not swept column-by-column; a Supabase
-- upgrade that added an un-cascaded auth table would not be caught here. `public` is the
-- schema the carve-out argument rests on and the one P6.6 sweeps, so the claim this record
-- makes is exactly the claim that is tested.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The scan (Doc 06D §6.3)
-- ---------------------------------------------------------------------------
-- Returns the four documented layers. `identity` is the catalog-complete one: it is
-- verified only if the profile row is gone, the auth user is gone, AND no uuid column
-- anywhere in `public` still carries the uuid. `mastery` and `lisa` attribute a hit to the
-- layer it landed in, by the repo's table-naming conventions (coding standards §15) rather
-- than by an enumerated list — but they are ATTRIBUTION, not detection. Detection is
-- `identity`'s whole-schema sweep, so a residue in a table no pattern classifies still
-- fails the record. That ordering is deliberate: the narrow lists may go stale, the sweep
-- cannot, and the stale one is not the one the outcome depends on.
--
-- `deletion_verification_records.deleted_profile_id` is excluded, and it is the only
-- exclusion. It exists to hold precisely this uuid so the conformance job can re-run this
-- scan later and re-derive the answer; including it would make every record fail itself.
CREATE OR REPLACE FUNCTION public.verify_deletion_layers(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r                record;
  v_hit            boolean;
  v_cols_total     integer := 0;
  v_cols_mastery   integer := 0;
  v_cols_lisa      integer := 0;
  v_residual       text[]  := ARRAY[]::text[];
  v_res_mastery    text[]  := ARRAY[]::text[];
  v_res_lisa       text[]  := ARRAY[]::text[];
  v_profile_rows   bigint;
  v_auth_rows      bigint;
  v_layer          text;
  v_sweep_sql      constant text :=
    'SELECT EXISTS (SELECT 1 FROM public.<table> WHERE <uuid column> = <deleted_profile_id>) '
    'for every uuid column of every base table in schema public '
    '(pg_attribute JOIN pg_class, relkind IN (''r'',''p''), NOT relispartition), '
    'excluding deletion_verification_records.deleted_profile_id';
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'verify_deletion_layers: p_profile_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_profile_rows FROM public.profiles WHERE id = p_profile_id;
  SELECT count(*) INTO v_auth_rows    FROM auth.users     WHERE id = p_profile_id;

  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col
      FROM pg_attribute a
      JOIN pg_class     c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.atttypid = 'uuid'::regtype
       AND NOT (c.relname = 'deletion_verification_records' AND a.attname = 'deleted_profile_id')
     ORDER BY c.relname, a.attname
  LOOP
    v_layer := CASE
      WHEN r.tbl LIKE 'tutor\_%' OR r.tbl LIKE 'lisa\_%' OR r.tbl LIKE 'crisis\_%'
        THEN 'lisa'
      WHEN r.tbl LIKE 'student\_%' OR r.tbl LIKE 'mastery\_%' OR r.tbl LIKE 'practice\_%'
        OR r.tbl LIKE 'review\_%' OR r.tbl LIKE 'projection\_%'
        THEN 'mastery'
      ELSE 'identity'
    END;

    v_cols_total := v_cols_total + 1;
    IF v_layer = 'mastery' THEN v_cols_mastery := v_cols_mastery + 1; END IF;
    IF v_layer = 'lisa'    THEN v_cols_lisa    := v_cols_lisa    + 1; END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I = $1)', r.tbl, r.col)
      INTO v_hit USING p_profile_id;
    CONTINUE WHEN NOT v_hit;

    v_residual := v_residual || (r.tbl || '.' || r.col);
    IF v_layer = 'mastery' THEN v_res_mastery := v_res_mastery || (r.tbl || '.' || r.col); END IF;
    IF v_layer = 'lisa'    THEN v_res_lisa    := v_res_lisa    || (r.tbl || '.' || r.col); END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'identity', jsonb_build_object(
      'verified', (v_profile_rows = 0 AND v_auth_rows = 0 AND cardinality(v_residual) = 0),
      'canonical_owner', 'Doc 01 V6 §19',
      'evidence_query',
        'SELECT count(*) FROM public.profiles WHERE id = <deleted_profile_id>; '
        'SELECT count(*) FROM auth.users WHERE id = <deleted_profile_id>; ' || v_sweep_sql,
      'result', format('profiles=%s; auth.users=%s; uuid_columns_scanned=%s; residual=%s',
                       v_profile_rows, v_auth_rows, v_cols_total, cardinality(v_residual)),
      'residual_columns', to_jsonb(v_residual),
      'out_of_scope', false
    ),
    'mastery', jsonb_build_object(
      'verified', cardinality(v_res_mastery) = 0,
      'canonical_owner', 'Doc 05D §10 (cited per project handoff record)',
      'evidence_query', v_sweep_sql ||
        ', restricted to tables matching student_%, mastery_%, practice_%, review_%, projection_%',
      'result', format('uuid_columns_scanned=%s; residual=%s',
                       v_cols_mastery, cardinality(v_res_mastery)),
      'residual_columns', to_jsonb(v_res_mastery),
      'out_of_scope', false
    ),
    'lisa', jsonb_build_object(
      'verified', cardinality(v_res_lisa) = 0,
      'canonical_owner', 'Doc 03 Main §14.2 (cited per project handoff record)',
      'evidence_query', v_sweep_sql ||
        ', restricted to tables matching tutor_%, lisa_%, crisis_%',
      'result', format('uuid_columns_scanned=%s; residual=%s',
                       v_cols_lisa, cardinality(v_res_lisa)),
      'residual_columns', to_jsonb(v_res_lisa),
      'out_of_scope', false
    ),
    'analytics', jsonb_build_object(
      'verified', false,
      'canonical_owner', 'Doc 07 (FWD-06-01)',
      'out_of_scope', true,
      'out_of_scope_reason',
        'analytics retention surface pending Doc 07 — bounded forward-ref per Parent §3'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.verify_deletion_layers(uuid) IS
  'Doc 06D §6.3 layer-coverage scan for a deleted profile. Catalog-driven: every uuid column of every base table in schema public is tested for the uuid, so detection does not depend on a maintained table list. The mastery and lisa layers ATTRIBUTE a hit by table-name convention; the identity layer is the whole-schema sweep and is what the outcome rests on. Only deletion_verification_records.deleted_profile_id is excluded — it exists to hold this uuid so the scan can be re-derived later.';

REVOKE ALL ON FUNCTION public.verify_deletion_layers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_deletion_layers(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The write path finally validates the shape it was always specified to (§6.4 step 2)
-- ---------------------------------------------------------------------------
-- 20260918000000 checked only that `layers_verified` was a JSON object. §6.4 step 2 asks for
-- validation "against the §6.3 schema", and §6.5 failure-condition (d) pages on a `pass` row
-- whose in-scope layers are not all verified. A condition the write path can make impossible
-- should not be left to a reconciliation job to notice hours later — the same argument that
-- removed `in_progress` in the first place. Everything else about the function is unchanged,
-- including the canonical form the hash is taken over, so already-written records keep
-- re-deriving the same `proof_manifest_ref`.
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
  v_layer     text;
  v_node      jsonb;
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

  -- §6.3: all four documented layers, always. A record that silently omits a layer is the
  -- shape audit P21 exists to catch, and it is cheaper to refuse it than to reconcile it.
  FOREACH v_layer IN ARRAY ARRAY['identity', 'mastery', 'lisa', 'analytics'] LOOP
    IF jsonb_typeof(p_layers_verified -> v_layer) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'record_deletion_verification: layers_verified has no % layer object — Doc 06D §6.3 requires all four (identity, mastery, lisa, analytics)', v_layer
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- §6.5 condition (d), enforced at the write instead of paged on later.
  IF p_outcome = 'pass' THEN
    FOREACH v_layer IN ARRAY ARRAY['identity', 'mastery', 'lisa'] LOOP
      v_node := p_layers_verified -> v_layer;
      CONTINUE WHEN (v_node ->> 'verified') = 'true';
      CONTINUE WHEN (v_node ->> 'out_of_scope') = 'true'
                AND coalesce(btrim(v_node ->> 'out_of_scope_reason'), '') <> '';
      RAISE EXCEPTION 'record_deletion_verification: outcome pass requires the % layer to be verified, or out_of_scope with a reason (Doc 06D §6.3)', v_layer
        USING ERRCODE = '22023';
    END LOOP;
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
  'Doc 06D §6.4 validated write path, keyed on log_id per owner ruling A4. Writes the record TERMINAL (pass|fail) — there is no in_progress state because verification runs inside T3. Validates the §6.3 four-layer shape and refuses a pass whose in-scope layers are not verified, which makes §6.5 failure-condition (d) unreachable rather than merely alarmed. proof_manifest_ref is a SHA-256 over the canonical record per owner ruling B3; the manifest IS the record. Called by public.complete_deletion_log (T3) and public.reconcile_deletion_log; direct writes from application code are a defect.';

REVOKE ALL ON FUNCTION public.record_deletion_verification(uuid, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_deletion_verification(uuid, jsonb, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. T3 — the call that did not exist
-- ---------------------------------------------------------------------------
-- Replaced wholesale from 20260917100000 so the body has one home rather than two; the only
-- changes are the four new DECLAREs, the verification loop, and `verification_records` in the
-- return object. The mutation that removes that loop is M82 in
-- `scripts/ci/deletion-evidence-gate.mutations.sh`, and it reproduces the defect this
-- migration fixes: with the loop gone, a real executor run completes a deletion and writes no
-- verification record, exactly as production did on 2026-09-23.

CREATE OR REPLACE FUNCTION public.complete_deletion_log(p_completions text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'utc')::date;
  v_json      jsonb;
  v_ids       uuid[];
  v_completed bigint;
  v_billing   bigint;
  v_profile   uuid;
  v_stripped  bigint := 0;
  v_strip     jsonb;
  v_verified  bigint := 0;
  v_comp      record;
  v_layers    jsonb;
  v_outcome   text;
BEGIN
  v_json := p_completions::jsonb;
  IF v_json IS NULL OR jsonb_typeof(v_json) <> 'array' THEN
    RAISE EXCEPTION 'complete_deletion_log: p_completions must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE _completions ON COMMIT DROP AS
    SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id,
           c.stripe_subscription_item_id, c.final_status, c.profile_id
      FROM jsonb_to_recordset(v_json)
        AS c(log_id uuid, stripe_customer_id text, stripe_subscription_id text,
             stripe_subscription_item_id text, final_status text, profile_id uuid);

  SELECT array_agg(c.log_id ORDER BY c.log_id) INTO v_ids FROM _completions c;

  UPDATE public.deletion_request_log
     SET status = 'completed', responded_on = v_today
   WHERE log_id = ANY (v_ids)
     AND status = 'executing';
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  INSERT INTO public.deletion_billing_record
    (log_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_item_id, cancelled_on, final_status)
  SELECT c.log_id, c.stripe_customer_id, c.stripe_subscription_id, c.stripe_subscription_item_id, v_today, c.final_status
    FROM _completions c
    JOIN public.deletion_request_log l ON l.log_id = c.log_id
   WHERE c.final_status IS NOT NULL
     AND (c.stripe_customer_id IS NOT NULL OR c.stripe_subscription_id IS NOT NULL)
   ORDER BY c.log_id
  ON CONFLICT (log_id) DO NOTHING;
  GET DIAGNOSTICS v_billing = ROW_COUNT;

  -- @spec [Doc-01_V8 §5 (profile_hard_deleted), §5.1 (ids become NULL at hard delete);
  -- SCL-087 PROPOSED; owner brief 2026-09-17 §3.1/§3.3] | @implemented [2026-09-17]
  --
  -- THE AUDIT HALF OF T3. This is the evidence-side transaction, so neither of the two writes
  -- below can share an xmin with an actor_id-side row — that isolation is the whole reason they
  -- are here and not in the cascade (see this migration's header).
  --
  -- p_completions carries profile_id for exactly this: the profile row is already gone, so the
  -- uuid is a dead key used to FIND audit rows and then erased from them. It is never stored on
  -- the evidence side — the PG suite asserts structurally that no evidence table has a uuid
  -- column other than log_id.
  FOR v_profile IN SELECT c.profile_id FROM _completions c WHERE c.profile_id IS NOT NULL ORDER BY c.profile_id
  LOOP
    v_strip := public.apply_audit_logs_retention('strip_identity', v_profile);
    v_stripped := v_stripped + COALESCE((v_strip ->> 'rows')::bigint, 0);
  END LOOP;

  -- @spec [Doc 06D §6.2 / §6.3 / §6.5 INV-06-08; SCL-091, SCL-100, SCL-119 (PROPOSED);
  -- owner brief 2026-09-23] | @implemented [2026-09-23]
  --
  -- THE EXECUTABLE PROOF. One verification record per deletion completed by THIS call, written
  -- in THIS transaction — the same one that just set `status = 'completed'` above. That is the
  -- whole point of its being here: T3 is the evidence-side transaction, so the record shares an
  -- xmin with the log row it proves and with nothing on the actor_id side.
  --
  -- It runs AFTER the audit strip immediately above, not before: the strip is the last write
  -- that removes the uuid from a retained row, so scanning first would find residue the
  -- deletion had in fact already dealt with, and record a fail for a clean deletion.
  --
  -- The outcome is DERIVED from the scan, never asserted. `pass` requires all three in-scope
  -- layers verified; anything else is a `fail` row, which §6.5 (b) pages on. A deletion that
  -- did not fully take is a fail RECORD, not a missing one — an absent row and a failed one
  -- are not the same claim, and only one of them can be investigated.
  FOR v_comp IN
    SELECT c.log_id, c.profile_id
      FROM _completions c
      JOIN public.deletion_request_log l ON l.log_id = c.log_id
     WHERE l.status = 'completed'
       AND c.profile_id IS NOT NULL
     ORDER BY c.log_id
  LOOP
    v_layers := public.verify_deletion_layers(v_comp.profile_id);
    v_outcome := CASE
      WHEN (v_layers -> 'identity' ->> 'verified') = 'true'
       AND (v_layers -> 'mastery'  ->> 'verified') = 'true'
       AND (v_layers -> 'lisa'     ->> 'verified') = 'true'
      THEN 'pass' ELSE 'fail'
    END;
    PERFORM public.record_deletion_verification(
      v_comp.log_id, v_layers, v_outcome, v_comp.profile_id
    );
    v_verified := v_verified + 1;
  END LOOP;

  -- One row per completed deletion, with NO ids from the start: §5.1 retains "action type,
  -- timestamp, status code" and nothing else once a profile is hard-deleted. Written NULL rather
  -- than written-then-stripped, so this row never needs the exemption at all.
  INSERT INTO public.audit_logs (actor_profile_id, target_profile_id, action, changes, context)
  SELECT NULL, NULL, 'profile_hard_deleted', NULL,
         jsonb_build_object('source', 'complete_deletion_log', 'status', 'completed')
    FROM _completions c
    JOIN public.deletion_request_log l ON l.log_id = c.log_id
   WHERE l.status = 'completed';

  RETURN jsonb_build_object(
    'completed', v_completed,
    'billing_records', v_billing,
    'audit_rows_stripped', v_stripped,
    'verification_records', v_verified
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_deletion_log(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_deletion_log(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The one completion path that cannot produce a proof says so
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_deletion_log()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today         date := (now() AT TIME ZONE 'utc')::date;
  v_reverted      bigint;
  v_completed     bigint;
  v_cancelled     bigint;
  v_ids           uuid[];
  v_id            uuid;
  v_unverifiable  jsonb;
BEGIN
  UPDATE public.deletion_request_log l
     SET status = 'pending'
   WHERE l.status = 'executing'
     AND EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                  WHERE adr.log_id = l.log_id AND adr.status = 'pending');
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  UPDATE public.deletion_request_log l
     SET status = 'cancelled', responded_on = coalesce(l.responded_on, v_today)
   WHERE l.status = 'executing'
     AND EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                  WHERE adr.log_id = l.log_id AND adr.status = 'cancelled');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  WITH done AS (
    UPDATE public.deletion_request_log l
       SET status = 'completed', responded_on = coalesce(l.responded_on, v_today)
     WHERE l.status = 'executing'
       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests adr
                        WHERE adr.log_id = l.log_id)
    RETURNING l.log_id
  )
  SELECT coalesce(array_agg(d.log_id ORDER BY d.log_id), ARRAY[]::uuid[]), count(*)
    INTO v_ids, v_completed
    FROM done d;

  -- @spec [Doc 06D §6.2 / §6.5 INV-06-08; SCL-119 (PROPOSED); owner brief 2026-09-23]
  --
  -- A row the reconciler completes is one whose cascade COMMITTED but whose T3 never ran, so
  -- the scan in `complete_deletion_log` never happened for it. It cannot be run now: PS-5 of
  -- the cascade consumed the `account_deletion_requests` row in the cascade's own transaction,
  -- and with it the only surviving copy of the deleted profile's uuid. The deletion is real
  -- and the erasure is done; what is missing is the proof, permanently.
  --
  -- So the record says that, rather than not existing. §6.5 pages either way — (a) on a
  -- completed log row with no record, (b) on a `fail` — but a `fail` row carries the reason,
  -- the log id and a re-readable statement that the scan was impossible, and an absent row
  -- carries nothing. `deleted_profile_id` is NULL because there is genuinely nothing to put
  -- there; inventing one would be worse than admitting it.
  IF cardinality(v_ids) > 0 THEN
    v_unverifiable := jsonb_build_object(
      'identity', jsonb_build_object(
        'verified', false, 'canonical_owner', 'Doc 01 V6 §19',
        'evidence_query', 'none — T3 did not run for this log row and the deleted profile uuid is unrecoverable (consumed with the account_deletion_requests row by PS-5 of execute_account_deletion_cascade), so public.verify_deletion_layers cannot be run for it',
        'result', 'not verifiable', 'out_of_scope', false),
      'mastery', jsonb_build_object(
        'verified', false, 'canonical_owner', 'Doc 05D §10 (cited per project handoff record)',
        'evidence_query', 'none — see the identity layer', 'result', 'not verifiable',
        'out_of_scope', false),
      'lisa', jsonb_build_object(
        'verified', false, 'canonical_owner', 'Doc 03 Main §14.2 (cited per project handoff record)',
        'evidence_query', 'none — see the identity layer', 'result', 'not verifiable',
        'out_of_scope', false),
      'analytics', jsonb_build_object(
        'verified', false, 'canonical_owner', 'Doc 07 (FWD-06-01)', 'out_of_scope', true,
        'out_of_scope_reason', 'analytics retention surface pending Doc 07 — bounded forward-ref per Parent §3')
    );
    FOREACH v_id IN ARRAY v_ids LOOP
      -- never over a record that already exists: T3 leaves the row 'completed', so this branch
      -- cannot reach one it wrote — but a guard is cheaper than a pass silently becoming a fail.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.deletion_verification_records v WHERE v.log_id = v_id
      );
      PERFORM public.record_deletion_verification(v_id, v_unverifiable, 'fail', NULL);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('reverted_to_pending', v_reverted, 'completed', v_completed, 'cancelled', v_cancelled);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_deletion_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_deletion_log() TO service_role;

COMMIT;
