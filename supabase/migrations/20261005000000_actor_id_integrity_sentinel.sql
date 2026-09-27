-- ===========================================================================
-- THE SENTINEL LEARNS TO READ VALUES, NOT JUST NULLS
-- ===========================================================================
-- @spec [Doc 05E §3 Rule 4, §5, §6 INV-05E-06 / INV-05E-07; Doc 06D §6.3 (the scan that
--        found this); SCL-151 (PROPOSED); owner brief 2026-09-25 R2] | @implemented [2026-09-25]
--
-- plain English: `actor_id` is the SYNTHETIC grouping identifier that survives anonymization
-- while the identity link dies. Two write paths set it to the profile's own primary key
-- instead — `diagnostic-routes.ts` always, `review-canonical.ts` as a `?? studentId` fallback
-- that never fired. For those rows the grouping identifier IS the identity key, so
-- anonymization had nothing to sever: the retained row still carried the uuid that was the
-- person, and `anonymized_actors` recorded an actor that NO row grouped under.
--
-- WHY EVERY GATE MISSED IT. INV-05E-07's sentinel asked `actor_id IS NULL`. A wrong non-null
-- value is invisible to a nullity check. The CI fixture writes `SELECT p.id, p.actor_id FROM
-- profiles`, so the seeded value is correct by construction and the bug is unreproducible from
-- the fixtures. Nothing in the schema constrained the VALUE. It took a real deletion and the
-- Doc 06D §6.3 catalog sweep to surface it — on 2026-09-23, five days after the rows were
-- written.
--
-- WHAT THIS ADDS
--   1. public.actor_id_integrity_violations() — catalog-driven, whole-schema, one row per
--      violation class per table. Zero rows = pass. Wired as a CI gate, so the next instance
--      is caught by a pull request instead of by a deletion.
--   2. The cascade's sentinel, rewritten: every retained row of the profile being deleted must
--      carry THAT PROFILE'S actor_id. Fail-closed, before identity is severed, as before.
--
-- Both discover their own column set from `pg_attribute`: any table that has an `actor_id`
-- column and an identity column is covered the day it is created, with nobody editing a list.
-- That is the same discipline as `scripts/ci/fk-delete-action-guard.sql` and for the same
-- reason — the FK guard's predecessor was an enumerated list, and it went stale.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The whole-schema integrity check
-- ---------------------------------------------------------------------------
-- Column names are deliberately NOT `table_name` / `column_name`: a RETURNS TABLE OUT
-- parameter that collides with a catalog column name resolves ambiguously at RUNTIME, not at
-- creation, and the failure looks like a logic bug rather than a naming one.
CREATE OR REPLACE FUNCTION public.actor_id_integrity_violations()
RETURNS TABLE (viol_table text, viol_identity_column text, viol_kind text, viol_rows bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r       record;
  v_idcol text;
  v_n     bigint;
BEGIN
  -- (0) profiles itself: actor_id must never BE the primary key it is meant to replace.
  SELECT count(*) INTO v_n FROM public.profiles p WHERE p.actor_id = p.id;
  IF v_n > 0 THEN
    viol_table := 'profiles'; viol_identity_column := 'id';
    viol_kind  := 'actor_id equals the profile''s own id — the grouping identifier IS the identity key';
    viol_rows  := v_n; RETURN NEXT;
  END IF;

  FOR r IN
    SELECT c.relname AS tbl,
           (SELECT a2.attname
              FROM pg_attribute a2
             WHERE a2.attrelid = c.oid AND a2.attnum > 0 AND NOT a2.attisdropped
               AND a2.attname IN ('user_id', 'student_id')
             ORDER BY a2.attname LIMIT 1) AS idcol
      FROM pg_attribute a
      JOIN pg_class     c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT c.relispartition
       AND a.attname = 'actor_id'
       AND a.attnum > 0 AND NOT a.attisdropped
       AND c.relname NOT IN ('profiles', 'anonymized_actors')
     ORDER BY c.relname
  LOOP
    CONTINUE WHEN r.idcol IS NULL;   -- no identity column: nothing to compare against
    v_idcol := r.idcol;

    -- (a) the original nullity check, kept: a retained row with identity present and no
    --     grouping identifier cannot be anonymized at all (INV-05E-07 as it always was).
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL AND actor_id IS NULL',
                   r.tbl, v_idcol) INTO v_n;
    IF v_n > 0 THEN
      viol_table := r.tbl; viol_identity_column := v_idcol;
      viol_kind  := 'identity present but actor_id IS NULL';
      viol_rows  := v_n; RETURN NEXT;
    END IF;

    -- (b) THE DEFECT: actor_id equals the row's own identity value.
    -- all-positional: format() refuses a mix of %I and %1$I in one string
    EXECUTE format('SELECT count(*) FROM public.%1$I WHERE %2$I IS NOT NULL AND actor_id = %2$I',
                   r.tbl, v_idcol) INTO v_n;
    IF v_n > 0 THEN
      viol_table := r.tbl; viol_identity_column := v_idcol;
      viol_kind  := 'actor_id equals the row''s own identity value';
      viol_rows  := v_n; RETURN NEXT;
    END IF;

    -- (c) the general form of (b): actor_id is SOME profile's primary key. Catches a row
    --     pointing at a third party's identity key, which (b) cannot see.
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE EXISTS '
                   '(SELECT 1 FROM public.profiles p WHERE p.id = t.actor_id)', r.tbl) INTO v_n;
    IF v_n > 0 THEN
      viol_table := r.tbl; viol_identity_column := v_idcol;
      viol_kind  := 'actor_id is a profiles.id — an identity key used as a grouping identifier';
      viol_rows  := v_n; RETURN NEXT;
    END IF;

    -- (d) actor_id resolves to no known actor. A live row's actor must exist in `profiles`; an
    --     orphaned row's actor must appear in `anonymized_actors`, which is the only surviving
    --     statement that the actor was anonymized. Neither means the value was invented.
    EXECUTE format(
      'SELECT count(*) FROM public.%I t WHERE t.actor_id IS NOT NULL '
      'AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.actor_id = t.actor_id) '
      'AND NOT EXISTS (SELECT 1 FROM public.anonymized_actors l WHERE l.actor_id = t.actor_id)',
      r.tbl) INTO v_n;
    IF v_n > 0 THEN
      viol_table := r.tbl; viol_identity_column := v_idcol;
      viol_kind  := 'actor_id matches no profiles.actor_id and no anonymized_actors row';
      viol_rows  := v_n; RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.actor_id_integrity_violations() IS
  'Doc 05E §6 INV-05E-07, strengthened per owner brief 2026-09-25 R2 and SCL-151. Catalog-driven: covers every public base table carrying an actor_id column plus an identity column, including tables added after this migration, with no list to edit. Four violation classes: NULL actor_id with identity present; actor_id equal to the row''s own identity; actor_id equal to any profiles.id; actor_id resolving to neither a live profile nor an anonymized_actors row. Zero rows = pass. The predecessor checked only nullity, which is why two write paths set actor_id to the profile id undetected until the Doc 06D §6.3 scan found it on a real deletion.';

REVOKE ALL ON FUNCTION public.actor_id_integrity_violations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actor_id_integrity_violations() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The cascade's own sentinel, replaced
-- ---------------------------------------------------------------------------
-- Replaced wholesale from 20260930090000_exam_shell_server.sql — the CURRENT owner of this
-- body, not 20260917130000 where the sentinel was originally written. The first draft of this
-- migration extracted from the older file and would have silently DELETED the exam cascade
-- steps (v_exam_sessions and the six test_session_* deletes) that landed on `cleanup` in the
-- meantime. Caught by re-checking the owner before merging, which is the same discipline the
-- mutation harness enforces for M2/M9/M17/M31/M96.
--
-- The ONLY change here is the sentinel DECLARE...END block. M94 reverts it to the nullity-only
-- check and reddens C3.11, reproducing the defect exactly.

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
  v_exam_sessions uuid[];   -- E6b: the profile's test_sessions, collected before hard_delete removes them
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

    -- ====================================================================
    -- LAYER 2 (hard_delete): exam runtime (Doc 04A §5, Doc 04B §9; E6b, SCL-143)
    -- ====================================================================
    -- test_sessions.student_id and score_runs.student_id are ON DELETE SET NULL
    -- (E6b), as practice and review are: the profile delete below would SEVER
    -- these rows, not remove them. hard_delete removes them here, explicitly.
    -- The sessions are collected first — the outbox carries only aggregate_id
    -- (no FK, no identity) and is reachable only through them.
    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_exam_sessions
      FROM public.test_sessions WHERE student_id = p_profile_id;

    -- L2-08 .. L2-11. The four runtime children, children before parents.
    -- Answers before submissions: test_session_answers.last_submission_id
    -- references test_answer_submissions (NO ACTION).
    DELETE FROM public.test_session_answers WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_answers', v_count);

    DELETE FROM public.test_answer_submissions WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_answer_submissions', v_count);

    -- E7a (SCL-145): the workspace rows hang off test_session_items (CASCADE),
    -- so they go first, by name and counted, like every other exam child.
    DELETE FROM public.test_session_item_workspace WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_item_workspace', v_count);

    DELETE FROM public.test_session_items WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_items', v_count);

    DELETE FROM public.test_session_sections WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_sections', v_count);

    -- L2-12 / L2-13. score_run_event_ledger and score_runs. Neither is deleted by
    -- name: score_runs is insert-once (Doc 04B §9.4) and its trigger refuses a
    -- DELETE while the parent session exists. Both leave with the session through
    -- test_session_id / score_run_id ON DELETE CASCADE, which the trigger admits
    -- (the parent is gone). Counted first, because that removal is invisible to
    -- GET DIAGNOSTICS.
    SELECT count(*) INTO v_count
      FROM public.score_run_event_ledger l
      JOIN public.score_runs r ON r.id = l.score_run_id
     WHERE r.test_session_id = ANY (v_exam_sessions);
    v_result := v_result || jsonb_build_object('score_run_event_ledger', v_count);

    SELECT count(*) INTO v_count FROM public.score_runs WHERE test_session_id = ANY (v_exam_sessions);
    v_result := v_result || jsonb_build_object('score_runs', v_count);

    -- L2-14. test_sessions (takes its score_runs and their ledger rows with it)
    DELETE FROM public.test_sessions WHERE id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_sessions', v_count);

    -- L2-15. exam_runtime_outbox — identity-free queue state, deleted in
    -- hard_delete like legal_acceptance_outbox (L1-13). After the sessions:
    -- score_runs and the ledger reference it (NO ACTION) and are gone now.
    DELETE FROM public.exam_runtime_outbox WHERE aggregate_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('exam_runtime_outbox', v_count);

  ELSIF p_privacy_mode = 'anonymize' THEN
    -- ====================================================================
    -- FAIL-CLOSED SENTINEL (INV-05E-07): before severing identity, verify
    -- every retained row for this user has its grouping identifier.
    -- ====================================================================
    -- Defense-in-depth: actor_id is DB-enforced NOT NULL (PR-5c seal), so
    -- this cannot fire under normal operation. But INV-05E-07 requires
    -- explicit verification before the identity ↔ actor_id linkage is
    -- destroyed. Runs BEFORE SET NULL so identity col is still queryable.
    -- @spec [Doc 05E §6 INV-05E-07, strengthened; SCL-151 (PROPOSED); owner brief 2026-09-25 R2]
    -- | @implemented [2026-09-25]
    --
    -- WAS: an enumerated seven-table list asking only `actor_id IS NULL`. Both halves failed.
    -- The list could not cover a table added later, and the nullity question cannot see a
    -- WRONG value — which is exactly what `diagnostic-routes.ts` wrote for five production
    -- sessions and 200 items, undetected until the Doc 06D §6.3 scan ran on a real deletion.
    --
    -- IS: catalog-driven, and it checks the VALUE. Every retained row keyed to this profile
    -- must carry THIS PROFILE'S actor_id — the one already read into v_actor_id above, from
    -- `profiles`, before the identity link is destroyed. That single equality subsumes the old
    -- check (NULL <> v_actor_id) and forbids the identity key (p_profile_id <> v_actor_id,
    -- guaranteed because no profile may have id = actor_id, which
    -- public.actor_id_integrity_violations() asserts schema-wide).
    --
    -- Still fail-closed and still HERE, before the SET NULLs: after identity is severed there
    -- is no column left to key the check on.
    DECLARE
      v_sentinel_rec record;
      v_sentinel_col text;
      v_sentinel_cnt bigint;
      v_sentinel_tbls integer := 0;
    BEGIN
      FOR v_sentinel_rec IN
        SELECT c.relname AS tbl,
               (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.oid AND a2.attnum > 0 AND NOT a2.attisdropped
                   AND a2.attname IN ('user_id', 'student_id')
                 ORDER BY a2.attname LIMIT 1) AS idcol
          FROM pg_attribute a
          JOIN pg_class     c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND NOT c.relispartition
           AND a.attname = 'actor_id'
           AND a.attnum > 0 AND NOT a.attisdropped
           AND c.relname NOT IN ('profiles', 'anonymized_actors')
         ORDER BY c.relname
      LOOP
        CONTINUE WHEN v_sentinel_rec.idcol IS NULL;
        v_sentinel_col  := v_sentinel_rec.idcol;
        v_sentinel_tbls := v_sentinel_tbls + 1;

        EXECUTE format(
          'SELECT count(*) FROM public.%1$I WHERE %2$I = $1 '
          'AND (actor_id IS NULL OR actor_id <> $2)',
          v_sentinel_rec.tbl, v_sentinel_col
        ) INTO v_sentinel_cnt USING p_profile_id, v_actor_id;

        IF v_sentinel_cnt > 0 THEN
          RAISE EXCEPTION '05E-5d SENTINEL (INV-05E-07): % row(s) in public.% carry an actor_id that is not this profile''s (expected %) — refusing to sever identity from a row whose grouping identifier is wrong or absent. See public.actor_id_integrity_violations().',
            v_sentinel_cnt, v_sentinel_rec.tbl, v_actor_id;
        END IF;
      END LOOP;

      -- A sentinel that inspected nothing would pass silently, which is how a vacuous gate
      -- reads green. The seven tables the old list named are the floor.
      IF v_sentinel_tbls < 7 THEN
        RAISE EXCEPTION '05E-5d SENTINEL: discovered only % actor_id table(s); the catalog query is wrong and the check would pass vacuously', v_sentinel_tbls;
      END IF;
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
    -- LAYER 2 (anonymize): exam runtime (Doc 04A §5, Doc 04B §9; E6b, SCL-143)
    -- ====================================================================
    -- RETAINED under actor_id. The identity link is severed by
    -- test_sessions.student_id and score_runs.student_id ON DELETE SET NULL when
    -- the profile row goes below — the same mechanism as practice and review.
    -- score_runs is insert-once; its trigger admits exactly that FK action (the
    -- student_id -> NULL change with every other column equal, the profile gone).
    -- Nothing else to remove: test_sessions has no client/device fingerprint
    -- (Doc 04A omits client_instance_id); the children (E7a's workspace rows
    -- included: flags, eliminated opaque tokens, highlight offsets — no text) and
    -- the ledger carry no identity; the outbox carries none either and score_runs references it,
    -- so it stays. Counted HERE, before the profile delete, because a severance
    -- done by an FK action is invisible to GET DIAGNOSTICS.
    SELECT count(*) INTO v_count FROM public.test_sessions WHERE student_id = p_profile_id;
    v_result := v_result || jsonb_build_object('test_sessions', v_count);

    SELECT count(*) INTO v_count FROM public.score_runs WHERE student_id = p_profile_id;
    v_result := v_result || jsonb_build_object('score_runs', v_count);

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
  -- test_sessions.student_id and score_runs.student_id SET NULL fire here in
  -- anonymize mode (E6b); in hard_delete no exam row is left for them to reach.
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

REVOKE ALL ON FUNCTION public.execute_account_deletion_cascade(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_account_deletion_cascade(uuid, text) TO service_role;

COMMIT;
