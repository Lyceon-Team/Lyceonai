-- ============================================================================
-- Destructive-cascade rehearsal for 05D §10 execute_account_deletion_cascade
-- ============================================================================
-- @spec [Doc-05D_V1, §10 Account-Deletion Cascade & One-Way Anonymization]
-- Proves, against a THROWAWAY Postgres (no prod creds), that the cascade
-- function correctly deletes all derived + event data for the TARGET profile
-- while leaving the CONTROL profile byte-identical, and that a second run
-- is a clean idempotent no-op.
--
-- Asserts:
--   (A) Pre-cascade: both TARGET and CONTROL have rows in all in-scope tables
--   (B) Cascade returns 'completed' status with rows_affected > 0
--   (C) Post-cascade: TARGET has 0 rows in ALL in-scope tables
--   (D) Post-cascade: CONTROL row counts are UNCHANGED
--   (E) Idempotent re-run: returns 'no_op' with no side effects
--   (F) Status guard: cascade without a completed request RAISEs
--   (G) Unknown-mode guard: bogus p_privacy_mode RAISEs with correct message
--   (I) Operator-FK preflight guard: config references block cascade fail-closed
--
-- Runs AFTER deletion-cascade-rehearsal.seed.sql, which commits every fixture row
-- in its own transaction first (F-47, owner ruling 2026-10-01): production never
-- erases a row in the transaction that wrote it, and PostgreSQL's unchanged-key FK
-- re-check behaves differently when it does. Any assertion failure here RAISEs and
-- rolls back this block; the runner drops the throwaway DB either way.
-- ============================================================================

DO $$
DECLARE
  v_target  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_control uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_result  jsonb;
  v_count   bigint;
  v_control_snapshot jsonb;
  v_control_post     jsonb;
  v_blocked boolean;
BEGIN
  -- Every row below was seeded and COMMITTED by deletion-cascade-rehearsal.seed.sql,
  -- in an earlier transaction, as production's rows always are (F-47).

  -- ==================================================================
  -- (A) PRE-CASCADE: verify both TARGET and CONTROL have rows
  -- ==================================================================
  SELECT count(*) INTO v_count FROM public.student_skill_mastery WHERE student_id = v_target;
  IF v_count = 0 THEN RAISE EXCEPTION '(A) TARGET has no student_skill_mastery rows'; END IF;

  SELECT count(*) INTO v_count FROM public.practice_session_items WHERE user_id = v_target;
  IF v_count = 0 THEN RAISE EXCEPTION '(A) TARGET has no practice_session_items rows'; END IF;

  SELECT count(*) INTO v_count FROM public.student_skill_mastery WHERE student_id = v_control;
  IF v_count = 0 THEN RAISE EXCEPTION '(A) CONTROL has no student_skill_mastery rows'; END IF;

  RAISE NOTICE '(A) OK  TARGET + CONTROL seeded in all in-scope tables';

  -- ==================================================================
  -- SNAPSHOT CONTROL (row counts per table, pre-cascade)
  -- ==================================================================
  SELECT jsonb_build_object(
    'ssm',   (SELECT count(*) FROM public.student_skill_mastery WHERE student_id = v_control),
    'sdm',   (SELECT count(*) FROM public.student_domain_mastery WHERE student_id = v_control),
    'ssk',   (SELECT count(*) FROM public.student_section_kpi WHERE student_id = v_control),
    'sdk',   (SELECT count(*) FROM public.student_domain_kpi WHERE student_id = v_control),
    'skk',   (SELECT count(*) FROM public.student_skill_kpi WHERE student_id = v_control),
    'sok',   (SELECT count(*) FROM public.student_overall_kpi WHERE student_id = v_control),
    'sp',    (SELECT count(*) FROM public.student_section_projections WHERE student_id = v_control),
    'sps',   (SELECT count(*) FROM public.student_section_projection_snapshots WHERE student_id = v_control),
    'sprs',  (SELECT count(*) FROM public.student_projection_refresh_state WHERE student_id = v_control),
    'pro',   (SELECT count(*) FROM public.projection_refresh_outbox WHERE student_id = v_control),
    'rs',    (SELECT count(*) FROM public.review_schedule WHERE student_id = v_control),
    'skrc',  (SELECT count(*) FROM public.student_kpi_rollups_current WHERE student_id = v_control),
    'ps',    (SELECT count(*) FROM public.practice_sessions WHERE user_id = v_control),
    'psi',   (SELECT count(*) FROM public.practice_session_items WHERE user_id = v_control),
    'rvs',   (SELECT count(*) FROM public.review_sessions WHERE student_id = v_control),
    'rsi',   (SELECT count(*) FROM public.review_session_items WHERE student_id = v_control),
    'rea',   (SELECT count(*) FROM public.review_error_attempts WHERE student_id = v_control),
    'meal',  (SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id = v_control),
    'mdral', (SELECT count(*) FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_control),
    'ent',   (SELECT count(*) FROM public.entitlements WHERE profile_id = v_control),
    'prof',  (SELECT count(*) FROM public.profiles WHERE id = v_control)
  ) INTO v_control_snapshot;

  -- ==================================================================
  -- (F) STATUS GUARD: cascade without completed request must RAISE
  -- ==================================================================
  BEGIN
    v_blocked := false;
    SELECT (public.execute_account_deletion_cascade(v_control, 'hard_delete')) INTO v_result;
    RAISE EXCEPTION '(F) cascade did NOT raise for profile without completed deletion request';
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    IF SQLERRM NOT LIKE '%no completed deletion request%' THEN
      RAISE EXCEPTION '(F) wrong error message: %', SQLERRM;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION '(F) cascade should have been blocked';
  END IF;
  RAISE NOTICE '(F) OK  status guard rejects profile without completed deletion request';

  -- ==================================================================
  -- (G) PRIVACY MODE GUARD: unknown mode must RAISE
  -- ==================================================================
  BEGIN
    v_blocked := false;
    SELECT (public.execute_account_deletion_cascade(v_target, 'bogus_mode')) INTO v_result;
    RAISE EXCEPTION '(G) cascade did NOT raise for unknown mode';
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    IF SQLERRM NOT LIKE '%unknown p_privacy_mode%' THEN
      RAISE EXCEPTION '(G) wrong error message: %', SQLERRM;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION '(G) unknown mode guard should have been blocked';
  END IF;
  RAISE NOTICE '(G) OK  unknown privacy mode raises correctly';

  -- ==================================================================
  -- (I) OPERATOR ATTRIBUTION: config references no longer BLOCK the cascade
  -- ==================================================================
  -- REVERSED 2026-09-17 ("Declarative FK Actions, Not an Enumerated Cascade").
  -- This section used to assert that an operator-config reference RAISED
  -- PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES and deleted nothing. The 36
  -- operator-attribution edges are now ON DELETE SET NULL, the preflight loop is
  -- gone, and the row keeps its value, its timestamp and its history entry while
  -- losing the name. Blocking erasure to preserve an attributor's name is not a
  -- trade this platform can make; "blocks forever with no terminal state" was the
  -- defect the redesign exists to end.
  --
  -- So the attribution is seeded here and deliberately LEFT IN PLACE: the cascade
  -- in (B) must now succeed with it present, and (I2) below asserts the severance
  -- rather than the block.
  -- The attribution itself is seeded and COMMITTED by deletion-cascade-rehearsal.seed.sql.

  SELECT count(*) INTO v_count FROM public.mastery_constants
   WHERE updated_by_profile_id = v_target;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '(I) seed failed: expected 1 mastery_constants row attributed to TARGET, saw %', v_count;
  END IF;
  RAISE NOTICE '(I) OK  operator attribution seeded and LEFT IN PLACE; the cascade must now proceed';

  -- ==================================================================
  -- (B) EXECUTE CASCADE on TARGET
  -- ==================================================================
  SELECT public.execute_account_deletion_cascade(v_target, 'hard_delete') INTO v_result;

  IF v_result->>'status' <> 'completed' THEN
    RAISE EXCEPTION '(B) cascade returned status=%, expected completed. Full: %', v_result->>'status', v_result;
  END IF;
  RAISE NOTICE '(B) OK  cascade returned completed: %', v_result;

  -- ==================================================================
  -- (I2) POST-CASCADE: the governance row SURVIVES with a NULL attributor
  -- ==================================================================
  -- The other half of the reversal. SET NULL is the anonymization primitive
  -- (Doc 05E §3 Rule 4 / §5): the record stays, the identity link is severed.
  SELECT count(*) INTO v_count FROM public.mastery_constants
   WHERE key = 'POSITION_HALF_LIFE';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '(I2) mastery_constants row was DELETED by the cascade; SET NULL must keep it (saw %)', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.mastery_constants
   WHERE updated_by_profile_id = v_target;
  IF v_count <> 0 THEN
    RAISE EXCEPTION '(I2) attribution to the deleted profile survived the cascade: % row(s)', v_count;
  END IF;
  RAISE NOTICE '(I2) OK  governance row survives with a NULL attributor';

  -- ==================================================================
  -- (C) POST-CASCADE: TARGET has 0 rows in ALL in-scope tables
  -- ==================================================================
  -- L1 tables
  SELECT count(*) INTO v_count FROM public.student_section_projection_snapshots WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_section_projection_snapshots not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_section_projections WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_section_projections not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_projection_refresh_state WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_projection_refresh_state not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.projection_refresh_outbox WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 projection_refresh_outbox not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_section_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_section_kpi not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_domain_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_domain_kpi not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_skill_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_skill_kpi not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_overall_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_overall_kpi not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_domain_mastery WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_domain_mastery not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_skill_mastery WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_skill_mastery not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.review_schedule WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 review_schedule not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.student_kpi_rollups_current WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L1 student_kpi_rollups_current not empty: %', v_count; END IF;

  -- L2 tables
  SELECT count(*) INTO v_count FROM public.practice_session_items WHERE user_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L2 practice_session_items not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.practice_sessions WHERE user_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L2 practice_sessions not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.review_error_attempts WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L2 review_error_attempts not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.review_session_items WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L2 review_session_items not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.review_sessions WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L2 review_sessions not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.mastery_event_audit_log WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L2 mastery_event_audit_log not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) L2 mastery_domain_refresh_audit_log not empty: %', v_count; END IF;

  -- Pre-clear tables
  SELECT count(*) INTO v_count FROM public.entitlements WHERE profile_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) entitlements not empty: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.account_deletion_requests WHERE profile_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) account_deletion_requests not empty: %', v_count; END IF;

  -- Profile + auth
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) profile not deleted: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM auth.users WHERE id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION '(C) auth.users not deleted: %', v_count; END IF;

  -- Storage purge is NOT tested here — owned by PR-4 orchestration layer (GAP-PR4-STORAGE).

  RAISE NOTICE '(C) OK  TARGET has 0 rows in ALL in-scope tables (L1 + L2 + pre-clear + profile + auth)';

  -- ==================================================================
  -- (D) POST-CASCADE: CONTROL row counts UNCHANGED
  -- ==================================================================
  SELECT jsonb_build_object(
    'ssm',   (SELECT count(*) FROM public.student_skill_mastery WHERE student_id = v_control),
    'sdm',   (SELECT count(*) FROM public.student_domain_mastery WHERE student_id = v_control),
    'ssk',   (SELECT count(*) FROM public.student_section_kpi WHERE student_id = v_control),
    'sdk',   (SELECT count(*) FROM public.student_domain_kpi WHERE student_id = v_control),
    'skk',   (SELECT count(*) FROM public.student_skill_kpi WHERE student_id = v_control),
    'sok',   (SELECT count(*) FROM public.student_overall_kpi WHERE student_id = v_control),
    'sp',    (SELECT count(*) FROM public.student_section_projections WHERE student_id = v_control),
    'sps',   (SELECT count(*) FROM public.student_section_projection_snapshots WHERE student_id = v_control),
    'sprs',  (SELECT count(*) FROM public.student_projection_refresh_state WHERE student_id = v_control),
    'pro',   (SELECT count(*) FROM public.projection_refresh_outbox WHERE student_id = v_control),
    'rs',    (SELECT count(*) FROM public.review_schedule WHERE student_id = v_control),
    'skrc',  (SELECT count(*) FROM public.student_kpi_rollups_current WHERE student_id = v_control),
    'ps',    (SELECT count(*) FROM public.practice_sessions WHERE user_id = v_control),
    'psi',   (SELECT count(*) FROM public.practice_session_items WHERE user_id = v_control),
    'rvs',   (SELECT count(*) FROM public.review_sessions WHERE student_id = v_control),
    'rsi',   (SELECT count(*) FROM public.review_session_items WHERE student_id = v_control),
    'rea',   (SELECT count(*) FROM public.review_error_attempts WHERE student_id = v_control),
    'meal',  (SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id = v_control),
    'mdral', (SELECT count(*) FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_control),
    'ent',   (SELECT count(*) FROM public.entitlements WHERE profile_id = v_control),
    'prof',  (SELECT count(*) FROM public.profiles WHERE id = v_control)
  ) INTO v_control_post;

  IF v_control_snapshot <> v_control_post THEN
    RAISE EXCEPTION '(D) CONTROL row counts changed! before=%, after=%', v_control_snapshot, v_control_post;
  END IF;
  RAISE NOTICE '(D) OK  CONTROL row counts unchanged';

  -- ==================================================================
  -- (E) IDEMPOTENT RE-RUN: returns no_op
  -- ==================================================================
  SELECT public.execute_account_deletion_cascade(v_target, 'hard_delete') INTO v_result;

  IF v_result->>'status' <> 'no_op' THEN
    RAISE EXCEPTION '(E) idempotent re-run returned %, expected no_op', v_result->>'status';
  END IF;

  -- Verify CONTROL still unchanged after idempotent re-run
  SELECT jsonb_build_object(
    'ssm',  (SELECT count(*) FROM public.student_skill_mastery WHERE student_id = v_control),
    'prof', (SELECT count(*) FROM public.profiles WHERE id = v_control)
  ) INTO v_control_post;

  IF (v_control_post->>'ssm')::int <> (v_control_snapshot->>'ssm')::int
     OR (v_control_post->>'prof')::int <> (v_control_snapshot->>'prof')::int THEN
    RAISE EXCEPTION '(E) CONTROL mutated during idempotent re-run';
  END IF;
  RAISE NOTICE '(E) OK  idempotent re-run returned no_op; CONTROL still unchanged';

  -- ==================================================================
  -- (H) D18 ROLLBACK PROOF: mid-cascade failure rolls back ALL changes
  -- ==================================================================
  -- INV-05D-16/D18: cascade is atomic — partial completion is not possible.
  -- Inject a BEFORE DELETE trigger on a late L2 table that forces failure,
  -- then verify L1 rows survive (proving the transaction rolled back).
  DECLARE
    v_rollback uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    v_l1_pre   bigint;
    v_l1_post  bigint;
  BEGIN
    -- Seeded and COMMITTED by deletion-cascade-rehearsal.seed.sql (F-47).

    SELECT count(*) INTO v_l1_pre FROM public.student_skill_mastery WHERE student_id = v_rollback;

    CREATE OR REPLACE FUNCTION public._test_block_audit_delete() RETURNS trigger LANGUAGE plpgsql AS $t$
    BEGIN RAISE EXCEPTION 'D18 injected failure'; END; $t$;
    CREATE TRIGGER _trg_d18_block BEFORE DELETE ON public.mastery_event_audit_log FOR EACH ROW EXECUTE FUNCTION public._test_block_audit_delete();

    BEGIN
      BEGIN
        SELECT public.execute_account_deletion_cascade(v_rollback, 'hard_delete') INTO v_result;
        RAISE EXCEPTION '(H) cascade should have failed due to injected trigger';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%D18 injected failure%' THEN
          RAISE EXCEPTION '(H) unexpected error: %', SQLERRM;
        END IF;
      END;
    EXCEPTION WHEN OTHERS THEN
      DROP TRIGGER IF EXISTS _trg_d18_block ON public.mastery_event_audit_log;
      DROP FUNCTION IF EXISTS public._test_block_audit_delete();
      RAISE;
    END;

    DROP TRIGGER IF EXISTS _trg_d18_block ON public.mastery_event_audit_log;
    DROP FUNCTION IF EXISTS public._test_block_audit_delete();

    SELECT count(*) INTO v_l1_post FROM public.student_skill_mastery WHERE student_id = v_rollback;
    IF v_l1_post <> v_l1_pre THEN
      RAISE EXCEPTION '(H) D18 VIOLATED: L1 rows changed after mid-cascade failure (pre=%, post=%)', v_l1_pre, v_l1_post;
    END IF;

    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rollback;
    IF v_count <> 1 THEN
      RAISE EXCEPTION '(H) D18: profile should survive rollback (count=%)', v_count;
    END IF;

    DELETE FROM public.mastery_event_audit_log WHERE student_id = v_rollback;
    DELETE FROM public.student_skill_mastery WHERE student_id = v_rollback;
    DELETE FROM public.account_deletion_requests WHERE profile_id = v_rollback;
    DELETE FROM public.profiles WHERE id = v_rollback;
    DELETE FROM auth.users WHERE id = v_rollback;

    RAISE NOTICE '(H) OK  D18 rollback proof: mid-cascade failure preserved all L1 rows + profile';
  END;

  -- ==================================================================
  -- (J) ANONYMIZE MODE: full target+control test for anonymize disposition
  -- ==================================================================
  -- Proves §5 disposition: L1 deleted, L2/L3 retained with identity
  -- decoupled, fingerprints removed, actor_id preserved, profile+auth
  -- destroyed, anonymized_actors ledger updated, idempotent re-run no_op.
  DECLARE
    v_anon        uuid := '33333333-3333-3333-3333-333333333333';
    v_anon_actor  uuid;
    v_anon_result jsonb;
  BEGIN
    -- Seeded and COMMITTED by deletion-cascade-rehearsal.seed.sql (F-47).
    SELECT actor_id INTO v_anon_actor FROM public.profiles WHERE id = v_anon;
    IF v_anon_actor IS NULL THEN RAISE EXCEPTION '(J) seed missing: run deletion-cascade-rehearsal.seed.sql first'; END IF;

    -- Execute anonymize cascade
    SELECT public.execute_account_deletion_cascade(v_anon, 'anonymize') INTO v_anon_result;

    IF v_anon_result->>'status' <> 'completed' THEN
      RAISE EXCEPTION '(J) anonymize cascade returned %, expected completed. Full: %', v_anon_result->>'status', v_anon_result;
    END IF;

    -- L1: derived state DELETED
    SELECT count(*) INTO v_count FROM public.student_skill_mastery WHERE student_id = v_anon;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L1 student_skill_mastery not deleted'; END IF;

    SELECT count(*) INTO v_count FROM public.student_kpi_rollups_current WHERE student_id = v_anon;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L1 student_kpi_rollups_current not deleted'; END IF;

    SELECT count(*) INTO v_count FROM public.review_schedule WHERE student_id = v_anon;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L1 review_schedule not deleted'; END IF;

    -- L2: activity rows RETAINED with identity + fingerprints NULL
    -- practice_sessions: retained, user_id NULL, client_instance_id NULL
    SELECT count(*) INTO v_count FROM public.practice_sessions WHERE actor_id = v_anon_actor;
    IF v_count = 0 THEN RAISE EXCEPTION '(J) L2 practice_sessions rows not retained (actor_id gone)'; END IF;
    SELECT count(*) INTO v_count FROM public.practice_sessions WHERE actor_id = v_anon_actor AND user_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 practice_sessions.user_id not nulled'; END IF;
    SELECT count(*) INTO v_count FROM public.practice_sessions WHERE actor_id = v_anon_actor AND client_instance_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 practice_sessions.client_instance_id not nulled'; END IF;

    -- practice_session_items: retained, user_id NULL, client_attempt_id NULL
    SELECT count(*) INTO v_count FROM public.practice_session_items WHERE actor_id = v_anon_actor;
    IF v_count = 0 THEN RAISE EXCEPTION '(J) L2 practice_session_items rows not retained'; END IF;
    SELECT count(*) INTO v_count FROM public.practice_session_items WHERE actor_id = v_anon_actor AND user_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 practice_session_items.user_id not nulled'; END IF;
    SELECT count(*) INTO v_count FROM public.practice_session_items WHERE actor_id = v_anon_actor AND client_attempt_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 practice_session_items.client_attempt_id not nulled'; END IF;

    -- review_sessions: retained, student_id NULL, client_instance_id NULL
    SELECT count(*) INTO v_count FROM public.review_sessions WHERE actor_id = v_anon_actor;
    IF v_count = 0 THEN RAISE EXCEPTION '(J) L2 review_sessions rows not retained'; END IF;
    SELECT count(*) INTO v_count FROM public.review_sessions WHERE actor_id = v_anon_actor AND student_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 review_sessions.student_id not nulled'; END IF;
    SELECT count(*) INTO v_count FROM public.review_sessions WHERE actor_id = v_anon_actor AND client_instance_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 review_sessions.client_instance_id not nulled'; END IF;

    -- review_session_items: retained, student_id NULL (no fingerprint columns)
    SELECT count(*) INTO v_count FROM public.review_session_items WHERE actor_id = v_anon_actor;
    IF v_count = 0 THEN RAISE EXCEPTION '(J) L2 review_session_items rows not retained'; END IF;
    SELECT count(*) INTO v_count FROM public.review_session_items WHERE actor_id = v_anon_actor AND student_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 review_session_items.student_id not nulled'; END IF;

    -- review_error_attempts: retained, student_id NULL, client_attempt_id NULL
    SELECT count(*) INTO v_count FROM public.review_error_attempts WHERE actor_id = v_anon_actor;
    IF v_count = 0 THEN RAISE EXCEPTION '(J) L2 review_error_attempts rows not retained'; END IF;
    SELECT count(*) INTO v_count FROM public.review_error_attempts WHERE actor_id = v_anon_actor AND student_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 review_error_attempts.student_id not nulled'; END IF;
    SELECT count(*) INTO v_count FROM public.review_error_attempts WHERE actor_id = v_anon_actor AND client_attempt_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L2 review_error_attempts.client_attempt_id not nulled'; END IF;

    -- L3: audit rows RETAINED with student_id NULL
    SELECT count(*) INTO v_count FROM public.mastery_event_audit_log WHERE actor_id = v_anon_actor;
    IF v_count = 0 THEN RAISE EXCEPTION '(J) L3 mastery_event_audit_log rows not retained'; END IF;
    SELECT count(*) INTO v_count FROM public.mastery_event_audit_log WHERE actor_id = v_anon_actor AND student_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L3 mastery_event_audit_log.student_id not nulled'; END IF;

    SELECT count(*) INTO v_count FROM public.mastery_domain_refresh_audit_log WHERE actor_id = v_anon_actor;
    IF v_count = 0 THEN RAISE EXCEPTION '(J) L3 mastery_domain_refresh_audit_log rows not retained'; END IF;
    SELECT count(*) INTO v_count FROM public.mastery_domain_refresh_audit_log WHERE actor_id = v_anon_actor AND student_id IS NOT NULL;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) L3 mastery_domain_refresh_audit_log.student_id not nulled'; END IF;

    -- Profile + auth DELETED (mapping destroyed — §3 Rule 4)
    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_anon;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) profile not deleted after anonymize'; END IF;
    SELECT count(*) INTO v_count FROM auth.users WHERE id = v_anon;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) auth.users not deleted after anonymize'; END IF;

    -- Anonymized_actors ledger updated
    SELECT count(*) INTO v_count FROM public.anonymized_actors WHERE actor_id = v_anon_actor;
    IF v_count <> 1 THEN RAISE EXCEPTION '(J) anonymized_actors ledger missing for actor %', v_anon_actor; END IF;

    -- "No path back" proof: no join from actor_id back to any identity
    SELECT count(*) INTO v_count FROM public.profiles WHERE actor_id = v_anon_actor;
    IF v_count > 0 THEN RAISE EXCEPTION '(J) NO-PATH-BACK VIOLATED: profile with actor_id still exists'; END IF;

    -- CONTROL still unchanged after anonymize
    SELECT jsonb_build_object(
      'ssm',  (SELECT count(*) FROM public.student_skill_mastery WHERE student_id = v_control),
      'prof', (SELECT count(*) FROM public.profiles WHERE id = v_control)
    ) INTO v_control_post;
    IF (v_control_post->>'ssm')::int <> (v_control_snapshot->>'ssm')::int
       OR (v_control_post->>'prof')::int <> (v_control_snapshot->>'prof')::int THEN
      RAISE EXCEPTION '(J) CONTROL mutated during anonymize cascade';
    END IF;

    -- Idempotent re-run (profile absent → no_op)
    SELECT public.execute_account_deletion_cascade(v_anon, 'anonymize') INTO v_anon_result;
    IF v_anon_result->>'status' <> 'no_op' THEN
      RAISE EXCEPTION '(J) anonymize idempotent re-run returned %, expected no_op', v_anon_result->>'status';
    END IF;

    -- Self-clean ANON residue (L2/L3 rows retained by anonymize + ledger)
    DELETE FROM public.practice_session_items WHERE actor_id = v_anon_actor;
    DELETE FROM public.practice_sessions WHERE actor_id = v_anon_actor;
    DELETE FROM public.review_error_attempts WHERE actor_id = v_anon_actor;
    DELETE FROM public.review_session_items WHERE actor_id = v_anon_actor;
    DELETE FROM public.review_sessions WHERE actor_id = v_anon_actor;
    DELETE FROM public.mastery_event_audit_log WHERE actor_id = v_anon_actor;
    DELETE FROM public.mastery_domain_refresh_audit_log WHERE actor_id = v_anon_actor;
    DELETE FROM public.anonymized_actors WHERE actor_id = v_anon_actor;

    RAISE NOTICE '(J) OK  anonymize mode: L1 deleted, L2/L3 retained identity-decoupled, fingerprints removed, profile+auth gone, ledger updated, idempotent re-run no_op, no-path-back proven, CONTROL unchanged';
  END;

  -- ==================================================================
  -- SELF-CLEAN: remove CONTROL seed (TARGET already gone from cascade)
  -- ==================================================================
  DELETE FROM public.review_error_attempts WHERE student_id = v_control;
  DELETE FROM public.review_session_items WHERE student_id = v_control;
  DELETE FROM public.review_sessions WHERE student_id = v_control;
  DELETE FROM public.practice_session_items WHERE user_id = v_control;
  DELETE FROM public.practice_sessions WHERE user_id = v_control;
  DELETE FROM public.review_schedule WHERE student_id = v_control;
  DELETE FROM public.mastery_event_audit_log WHERE student_id = v_control;
  DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_control;
  DELETE FROM public.student_section_projection_snapshots WHERE student_id = v_control;
  DELETE FROM public.student_section_projections WHERE student_id = v_control;
  DELETE FROM public.student_projection_refresh_state WHERE student_id = v_control;
  DELETE FROM public.projection_refresh_outbox WHERE student_id = v_control;
  DELETE FROM public.student_section_kpi WHERE student_id = v_control;
  DELETE FROM public.student_domain_kpi WHERE student_id = v_control;
  DELETE FROM public.student_skill_kpi WHERE student_id = v_control;
  DELETE FROM public.student_overall_kpi WHERE student_id = v_control;
  DELETE FROM public.student_kpi_rollups_current WHERE student_id = v_control;
  DELETE FROM public.student_domain_mastery WHERE student_id = v_control;
  DELETE FROM public.student_skill_mastery WHERE student_id = v_control;
  DELETE FROM public.entitlements WHERE profile_id = v_control;
  DELETE FROM public.profiles WHERE id = v_control;
  DELETE FROM auth.users WHERE id = v_control;

  RAISE NOTICE '==> CASCADE REHEARSAL PASSED: hard-delete + anonymize + exact-target + control-untouched + idempotent + guards + operator-attribution-severance + no-path-back proven (zero residue; storage purge deferred to PR-4 API layer)';
END $$;
