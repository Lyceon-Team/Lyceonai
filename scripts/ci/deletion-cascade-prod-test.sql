-- ============================================================================
-- TWO-ACCOUNT PROD TEST — execute_account_deletion_cascade
-- ============================================================================
-- @spec [Doc-05D_V1, §10 Account-Deletion Cascade & One-Way Anonymization]
--
-- FOR KARL ONLY. This script runs against PROD data. It is NOT auto-run by CI.
--
-- USAGE:
--   psql -v target_id="'<target-uuid>'" -v control_id="'<control-uuid>'" -f deletion-cascade-prod-test.sql
--
-- STEPS:
--   1. Pre-snapshot both profiles (row counts in all in-scope tables)
--   2. Create completed deletion request for TARGET (if not exists)
--   3. Execute cascade on TARGET
--   4. Assert: TARGET = 0 rows everywhere, CONTROL = unchanged, idempotent re-run = no_op
--
-- The CTO does read-only forensic before/after. This script handles snapshot + assert.
-- Karl triggers the destructive exec.
-- ============================================================================

-- psql variables: pass via -v target_id="'uuid'" -v control_id="'uuid'"
-- Fail fast if not provided.
\if :{?target_id}
\else
  \echo 'FATAL: -v target_id required'
  \quit
\endif
\if :{?control_id}
\else
  \echo 'FATAL: -v control_id required'
  \quit
\endif

DO $$
DECLARE
  v_target  uuid := :target_id;
  v_control uuid := :control_id;
  v_result  jsonb;
  v_count   bigint;
  v_target_snapshot  jsonb;
  v_control_snapshot jsonb;
  v_control_post     jsonb;
BEGIN
  -- ==================================================================
  -- SAFETY: verify both profiles exist
  -- ==================================================================
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_target) THEN
    RAISE EXCEPTION 'TARGET profile % does not exist', v_target;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_control) THEN
    RAISE EXCEPTION 'CONTROL profile % does not exist', v_control;
  END IF;

  -- ==================================================================
  -- PRE-SNAPSHOT: row counts for TARGET and CONTROL in all in-scope tables
  -- ==================================================================
  SELECT jsonb_build_object(
    'student_skill_mastery',                (SELECT count(*) FROM public.student_skill_mastery WHERE student_id = v_target),
    'student_domain_mastery',               (SELECT count(*) FROM public.student_domain_mastery WHERE student_id = v_target),
    'student_section_kpi',                  (SELECT count(*) FROM public.student_section_kpi WHERE student_id = v_target),
    'student_domain_kpi',                   (SELECT count(*) FROM public.student_domain_kpi WHERE student_id = v_target),
    'student_skill_kpi',                    (SELECT count(*) FROM public.student_skill_kpi WHERE student_id = v_target),
    'student_overall_kpi',                  (SELECT count(*) FROM public.student_overall_kpi WHERE student_id = v_target),
    'student_section_projections',          (SELECT count(*) FROM public.student_section_projections WHERE student_id = v_target),
    'student_section_projection_snapshots', (SELECT count(*) FROM public.student_section_projection_snapshots WHERE student_id = v_target),
    'student_projection_refresh_state',     (SELECT count(*) FROM public.student_projection_refresh_state WHERE student_id = v_target),
    'projection_refresh_outbox',            (SELECT count(*) FROM public.projection_refresh_outbox WHERE student_id = v_target),
    'review_schedule',                      (SELECT count(*) FROM public.review_schedule WHERE student_id = v_target),
    'practice_sessions',                    (SELECT count(*) FROM public.practice_sessions WHERE user_id = v_target),
    'practice_session_items',               (SELECT count(*) FROM public.practice_session_items WHERE user_id = v_target),
    'review_sessions',                      (SELECT count(*) FROM public.review_sessions WHERE student_id = v_target),
    'review_session_items',                 (SELECT count(*) FROM public.review_session_items WHERE student_id = v_target),
    'review_error_attempts',                (SELECT count(*) FROM public.review_error_attempts WHERE student_id = v_target),
    'mastery_event_audit_log',              (SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id = v_target),
    'mastery_domain_refresh_audit_log',     (SELECT count(*) FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_target),
    'entitlements',                         (SELECT count(*) FROM public.entitlements WHERE profile_id = v_target),
    'profiles',                             (SELECT count(*) FROM public.profiles WHERE id = v_target)
  ) INTO v_target_snapshot;

  SELECT jsonb_build_object(
    'student_skill_mastery',                (SELECT count(*) FROM public.student_skill_mastery WHERE student_id = v_control),
    'student_domain_mastery',               (SELECT count(*) FROM public.student_domain_mastery WHERE student_id = v_control),
    'student_section_kpi',                  (SELECT count(*) FROM public.student_section_kpi WHERE student_id = v_control),
    'student_domain_kpi',                   (SELECT count(*) FROM public.student_domain_kpi WHERE student_id = v_control),
    'student_skill_kpi',                    (SELECT count(*) FROM public.student_skill_kpi WHERE student_id = v_control),
    'student_overall_kpi',                  (SELECT count(*) FROM public.student_overall_kpi WHERE student_id = v_control),
    'student_section_projections',          (SELECT count(*) FROM public.student_section_projections WHERE student_id = v_control),
    'student_section_projection_snapshots', (SELECT count(*) FROM public.student_section_projection_snapshots WHERE student_id = v_control),
    'student_projection_refresh_state',     (SELECT count(*) FROM public.student_projection_refresh_state WHERE student_id = v_control),
    'projection_refresh_outbox',            (SELECT count(*) FROM public.projection_refresh_outbox WHERE student_id = v_control),
    'review_schedule',                      (SELECT count(*) FROM public.review_schedule WHERE student_id = v_control),
    'practice_sessions',                    (SELECT count(*) FROM public.practice_sessions WHERE user_id = v_control),
    'practice_session_items',               (SELECT count(*) FROM public.practice_session_items WHERE user_id = v_control),
    'review_sessions',                      (SELECT count(*) FROM public.review_sessions WHERE student_id = v_control),
    'review_session_items',                 (SELECT count(*) FROM public.review_session_items WHERE student_id = v_control),
    'review_error_attempts',                (SELECT count(*) FROM public.review_error_attempts WHERE student_id = v_control),
    'mastery_event_audit_log',              (SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id = v_control),
    'mastery_domain_refresh_audit_log',     (SELECT count(*) FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_control),
    'entitlements',                         (SELECT count(*) FROM public.entitlements WHERE profile_id = v_control),
    'profiles',                             (SELECT count(*) FROM public.profiles WHERE id = v_control)
  ) INTO v_control_snapshot;

  RAISE NOTICE 'PRE-SNAPSHOT TARGET:  %', v_target_snapshot;
  RAISE NOTICE 'PRE-SNAPSHOT CONTROL: %', v_control_snapshot;

  -- ==================================================================
  -- CREATE DELETION REQUEST (if not exists) + mark completed
  -- ==================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id = v_target AND status = 'completed'
  ) THEN
    INSERT INTO public.account_deletion_requests
      (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id,
       status, stripe_cancellation_status, completion_at)
    VALUES
      (v_target, now(), now() - interval '1 day', v_target,
       'completed', 'completed', now())
    ON CONFLICT DO NOTHING;
    RAISE NOTICE 'Created completed deletion request for TARGET';
  ELSE
    RAISE NOTICE 'Completed deletion request already exists for TARGET';
  END IF;

  -- ==================================================================
  -- EXECUTE CASCADE
  -- ==================================================================
  SELECT public.execute_account_deletion_cascade(v_target, 'hard_delete') INTO v_result;
  RAISE NOTICE 'CASCADE RESULT: %', v_result;

  IF v_result->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'Cascade did not return completed: %', v_result;
  END IF;

  -- ==================================================================
  -- ASSERT TARGET = 0 ROWS EVERYWHERE
  -- ==================================================================
  -- L1 tables
  SELECT count(*) INTO v_count FROM public.student_skill_mastery WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_skill_mastery not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_domain_mastery WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_domain_mastery not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_section_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_section_kpi not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_domain_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_domain_kpi not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_skill_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_skill_kpi not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_overall_kpi WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_overall_kpi not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_section_projections WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_section_projections not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_section_projection_snapshots WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_section_projection_snapshots not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.student_projection_refresh_state WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET student_projection_refresh_state not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.projection_refresh_outbox WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET projection_refresh_outbox not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.review_schedule WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET review_schedule not empty: %', v_count; END IF;

  -- L2 tables
  SELECT count(*) INTO v_count FROM public.practice_session_items WHERE user_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET practice_session_items not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.practice_sessions WHERE user_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET practice_sessions not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.review_error_attempts WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET review_error_attempts not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.review_session_items WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET review_session_items not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.review_sessions WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET review_sessions not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.mastery_event_audit_log WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET mastery_event_audit_log not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET mastery_domain_refresh_audit_log not empty: %', v_count; END IF;

  -- Identity tables
  SELECT count(*) INTO v_count FROM public.entitlements WHERE profile_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET entitlements not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.account_deletion_requests WHERE profile_id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET account_deletion_requests not empty: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET profile not deleted: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM auth.users WHERE id = v_target;
  IF v_count > 0 THEN RAISE EXCEPTION 'TARGET auth.users not deleted: %', v_count; END IF;

  RAISE NOTICE 'TARGET: all in-scope tables = 0 rows';

  -- ==================================================================
  -- ASSERT CONTROL UNCHANGED
  -- ==================================================================
  SELECT jsonb_build_object(
    'student_skill_mastery',                (SELECT count(*) FROM public.student_skill_mastery WHERE student_id = v_control),
    'student_domain_mastery',               (SELECT count(*) FROM public.student_domain_mastery WHERE student_id = v_control),
    'student_section_kpi',                  (SELECT count(*) FROM public.student_section_kpi WHERE student_id = v_control),
    'student_domain_kpi',                   (SELECT count(*) FROM public.student_domain_kpi WHERE student_id = v_control),
    'student_skill_kpi',                    (SELECT count(*) FROM public.student_skill_kpi WHERE student_id = v_control),
    'student_overall_kpi',                  (SELECT count(*) FROM public.student_overall_kpi WHERE student_id = v_control),
    'student_section_projections',          (SELECT count(*) FROM public.student_section_projections WHERE student_id = v_control),
    'student_section_projection_snapshots', (SELECT count(*) FROM public.student_section_projection_snapshots WHERE student_id = v_control),
    'student_projection_refresh_state',     (SELECT count(*) FROM public.student_projection_refresh_state WHERE student_id = v_control),
    'projection_refresh_outbox',            (SELECT count(*) FROM public.projection_refresh_outbox WHERE student_id = v_control),
    'review_schedule',                      (SELECT count(*) FROM public.review_schedule WHERE student_id = v_control),
    'practice_sessions',                    (SELECT count(*) FROM public.practice_sessions WHERE user_id = v_control),
    'practice_session_items',               (SELECT count(*) FROM public.practice_session_items WHERE user_id = v_control),
    'review_sessions',                      (SELECT count(*) FROM public.review_sessions WHERE student_id = v_control),
    'review_session_items',                 (SELECT count(*) FROM public.review_session_items WHERE student_id = v_control),
    'review_error_attempts',                (SELECT count(*) FROM public.review_error_attempts WHERE student_id = v_control),
    'mastery_event_audit_log',              (SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id = v_control),
    'mastery_domain_refresh_audit_log',     (SELECT count(*) FROM public.mastery_domain_refresh_audit_log WHERE student_id = v_control),
    'entitlements',                         (SELECT count(*) FROM public.entitlements WHERE profile_id = v_control),
    'profiles',                             (SELECT count(*) FROM public.profiles WHERE id = v_control)
  ) INTO v_control_post;

  IF v_control_snapshot <> v_control_post THEN
    RAISE EXCEPTION 'CONTROL changed! before=%, after=%', v_control_snapshot, v_control_post;
  END IF;
  RAISE NOTICE 'CONTROL: row counts unchanged';

  -- ==================================================================
  -- IDEMPOTENT RE-RUN
  -- ==================================================================
  SELECT public.execute_account_deletion_cascade(v_target, 'hard_delete') INTO v_result;
  IF v_result->>'status' <> 'no_op' THEN
    RAISE EXCEPTION 'Idempotent re-run returned %, expected no_op', v_result->>'status';
  END IF;
  RAISE NOTICE 'IDEMPOTENT: re-run returned no_op';

  RAISE NOTICE '==> PROD TEST PASSED: TARGET deleted, CONTROL untouched, idempotent re-run clean';

  -- NOTE: this script does NOT self-clean (TARGET is already deleted by the cascade;
  -- CONTROL must survive). On prod, the CONTROL profile remains intact as designed.
END $$;
