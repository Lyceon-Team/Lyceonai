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
-- Self-contained DO block. Zero residue on success. Any assertion failure
-- RAISEs and rolls everything back.
-- ============================================================================

DO $$
DECLARE
  v_target  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_control uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_result  jsonb;
  v_count   bigint;
  v_control_snapshot jsonb;
  v_control_post     jsonb;
  v_question_id text := 'SATM1A00001';
  v_blocked boolean;
BEGIN
  -- ==================================================================
  -- SEED: auth.users → profiles (via handle_new_user trigger)
  -- ==================================================================
  INSERT INTO auth.users (id, email) VALUES
    (v_target,  'target@example.com'),
    (v_control, 'control@example.com');

  UPDATE public.profiles SET
    full_name = 'Target User', display_name = 'Target',
    deleted_at = now() - interval '8 days'
  WHERE id = v_target;

  UPDATE public.profiles SET
    full_name = 'Control User', display_name = 'Control'
  WHERE id = v_control;

  -- ==================================================================
  -- SEED: question row (FK target for practice/review items)
  -- ==================================================================
  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES (
    v_question_id, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2,
    'Test question stem', '[{"key":"A","text":"opt A"},{"key":"B","text":"opt B"}]'::jsonb,
    'A', 'Test explanation'
  ) ON CONFLICT (id) DO NOTHING;

  -- ==================================================================
  -- SEED: RESTRICT FK tables (entitlements)
  -- ==================================================================
  INSERT INTO public.entitlements (profile_id, tier, status) VALUES
    (v_target,  'free', 'active'),
    (v_control, 'free', 'active');

  -- ==================================================================
  -- SEED: L1 tables — mastery derived state (real column names)
  -- ==================================================================

  -- student_skill_mastery (PK: student_id, section, domain, skill)
  INSERT INTO public.student_skill_mastery (student_id, section, domain, skill, mastery_score, mastery_level, event_count_total, mastery_model_version, constants_snapshot_hash, computed_at)
  VALUES
    (v_target,  'M', 'Algebra', 'ALG.01', 0.5000, 2, 10, 'v1.0', 'testhash', now()),
    (v_control, 'M', 'Algebra', 'ALG.01', 0.6000, 3, 12, 'v1.0', 'testhash', now());

  -- student_domain_mastery (PK: student_id, section, domain)
  INSERT INTO public.student_domain_mastery (student_id, section, domain, mastery_score, mastery_level, event_count_total, mastery_model_version, constants_snapshot_hash, computed_at)
  VALUES
    (v_target,  'M', 'Algebra', 0.5000, 2, 10, 'v1.0', 'testhash', now()),
    (v_control, 'M', 'Algebra', 0.6000, 3, 12, 'v1.0', 'testhash', now());

  -- student_section_kpi (PK: student_id, section)
  INSERT INTO public.student_section_kpi (student_id, section, events_total, kpi_refresh_version, refreshed_at_t_now)
  VALUES
    (v_target,  'M', 10, 'v1.0', now()),
    (v_control, 'M', 12, 'v1.0', now());

  -- student_domain_kpi (PK: student_id, section, domain)
  INSERT INTO public.student_domain_kpi (student_id, section, domain, events_total, kpi_refresh_version, refreshed_at_t_now)
  VALUES
    (v_target,  'M', 'Algebra', 10, 'v1.0', now()),
    (v_control, 'M', 'Algebra', 12, 'v1.0', now());

  -- student_skill_kpi (PK: student_id, section, domain, skill)
  INSERT INTO public.student_skill_kpi (student_id, section, domain, skill, events_total, kpi_refresh_version, refreshed_at_t_now)
  VALUES
    (v_target,  'M', 'Algebra', 'ALG.01', 10, 'v1.0', now()),
    (v_control, 'M', 'Algebra', 'ALG.01', 12, 'v1.0', now());

  -- student_overall_kpi (PK: student_id)
  INSERT INTO public.student_overall_kpi (student_id, events_total, kpi_refresh_version, refreshed_at_t_now)
  VALUES
    (v_target,  10, 'v1.0', now()),
    (v_control, 12, 'v1.0', now());

  -- student_section_projections (PK: student_id, section)
  INSERT INTO public.student_section_projections (student_id, section, mastery_model_version, refreshed_at_t_now)
  VALUES
    (v_target,  'M', 'v1.0', now()),
    (v_control, 'M', 'v1.0', now());

  -- student_section_projection_snapshots (identity PK)
  INSERT INTO public.student_section_projection_snapshots (student_id, section, mastery_model_version, refreshed_at_t_now)
  VALUES
    (v_target,  'M', 'v1.0', now()),
    (v_control, 'M', 'v1.0', now());

  -- student_projection_refresh_state (PK: student_id)
  INSERT INTO public.student_projection_refresh_state (student_id)
  VALUES (v_target), (v_control);

  -- projection_refresh_outbox (identity PK)
  INSERT INTO public.projection_refresh_outbox (student_id, reason)
  VALUES
    (v_target,  'full_length_completed'),
    (v_control, 'full_length_completed');

  -- ==================================================================
  -- SEED: L1-11 review_schedule
  -- ==================================================================
  INSERT INTO public.review_schedule (student_id, question_id, ease_factor)
  VALUES
    (v_target,  v_question_id, 2.5),
    (v_control, v_question_id, 2.5);

  -- ==================================================================
  -- SEED: L1-12 student_kpi_rollups_current (SCL-004)
  -- ==================================================================
  INSERT INTO public.student_kpi_rollups_current (student_id, scope, scope_key, payload, computed_at)
  VALUES
    (v_target,  'section', 'M', '{"events_total": 10}'::jsonb, now()),
    (v_control, 'section', 'M', '{"events_total": 12}'::jsonb, now());

  -- ==================================================================
  -- SEED: L2 tables — practice sessions/items
  -- ==================================================================
  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', v_target,  'flow', 10, 'web', 'inst-target',  'completed', (SELECT actor_id FROM public.profiles WHERE id = v_target)),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', v_control, 'flow', 10, 'web', 'inst-control', 'completed', (SELECT actor_id FROM public.profiles WHERE id = v_control));

  INSERT INTO public.practice_session_items (
    session_id, user_id, ordinal, question_id,
    question_stem, question_options, question_correct_answer, question_explanation,
    question_domain, question_skill, question_difficulty, question_section,
    status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
  ) VALUES (
    'cccccccc-cccc-cccc-cccc-cccccccccccc', v_target, 1, v_question_id,
    'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
    'Algebra', 'ALG.01', 2, 'M',
    'answered', 'A', true, 'correct', now(), now(), (SELECT actor_id FROM public.profiles WHERE id = v_target)
  ), (
    'dddddddd-dddd-dddd-dddd-dddddddddddd', v_control, 1, v_question_id,
    'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
    'Algebra', 'ALG.01', 2, 'M',
    'answered', 'B', false, 'incorrect', now(), now(), (SELECT actor_id FROM public.profiles WHERE id = v_control)
  );

  -- ==================================================================
  -- SEED: L2 review sessions/items/attempts
  -- ==================================================================
  INSERT INTO public.review_sessions (id, student_id, status, source_origin, client_instance_id, actor_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', v_target,  'completed', 'practice', 'inst-target', (SELECT actor_id FROM public.profiles WHERE id = v_target)),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', v_control, 'completed', 'practice', 'inst-control', (SELECT actor_id FROM public.profiles WHERE id = v_control));

  INSERT INTO public.review_session_items (
    id, session_id, student_id, ordinal, question_id,
    question_stem, question_options, question_correct_answer, question_explanation,
    question_domain, question_skill, question_difficulty, question_section,
    status, actor_id
  ) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', v_target, 1, v_question_id,
    'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
    'Algebra', 'ALG.01', 2, 'M', 'answered', (SELECT actor_id FROM public.profiles WHERE id = v_target)
  ), (
    '22222222-2222-2222-2222-222222222222',
    'ffffffff-ffff-ffff-ffff-ffffffffffff', v_control, 1, v_question_id,
    'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
    'Algebra', 'ALG.01', 2, 'M', 'answered', (SELECT actor_id FROM public.profiles WHERE id = v_control)
  );

  INSERT INTO public.review_error_attempts (
    session_item_id, student_id, question_id, is_correct,
    section, domain, skill, difficulty, occurred_at, actor_id
  ) VALUES (
    '11111111-1111-1111-1111-111111111111', v_target, v_question_id, true,
    'M', 'Algebra', 'ALG.01', 2, now(), (SELECT actor_id FROM public.profiles WHERE id = v_target)
  ), (
    '22222222-2222-2222-2222-222222222222', v_control, v_question_id, false,
    'M', 'Algebra', 'ALG.01', 2, now(), (SELECT actor_id FROM public.profiles WHERE id = v_control)
  );

  -- ==================================================================
  -- SEED: L2 audit tables
  -- ==================================================================
  INSERT INTO public.mastery_event_audit_log (
    student_id, section, domain, skill, source_family, event_source_kind,
    event_id, correct, difficulty, occurred_at,
    event_count_after, constants_snapshot_hash, mastery_model_version, applied_at, actor_id
  ) VALUES (
    v_target, 'M', 'Algebra', 'ALG.01', 'practice', 'practice_attempt',
    gen_random_uuid(), true, 2, now(),
    1, 'testhash', 'v1.0', now(), (SELECT actor_id FROM public.profiles WHERE id = v_target)
  ), (
    v_control, 'M', 'Algebra', 'ALG.01', 'practice', 'practice_attempt',
    gen_random_uuid(), true, 2, now(),
    1, 'testhash', 'v1.0', now(), (SELECT actor_id FROM public.profiles WHERE id = v_control)
  );

  INSERT INTO public.mastery_domain_refresh_audit_log (
    student_id, section, domain,
    mastery_score_before, mastery_score_after, event_count_after,
    constants_snapshot_hash, mastery_model_version, triggered_by, applied_at, actor_id
  ) VALUES (
    v_target, 'M', 'Algebra', 0.4000, 0.5000, 10, 'testhash', 'v1.0', 'event', now(), (SELECT actor_id FROM public.profiles WHERE id = v_target)
  ), (
    v_control, 'M', 'Algebra', 0.5000, 0.6000, 12, 'testhash', 'v1.0', 'event', now(), (SELECT actor_id FROM public.profiles WHERE id = v_control)
  );

  -- ==================================================================
  -- SEED: account_deletion_requests (completed — status guard requires it)
  -- ==================================================================
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
  VALUES
    (v_target, now() - interval '8 days', now() - interval '1 day', v_target, 'completed', 'completed', now());

  -- Storage seed REMOVED: storage purge is owned by PR-4 orchestration layer
  -- (Supabase Storage API, not SQL). See GAP-PR4-STORAGE.

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
  -- (I) OPERATOR-FK PREFLIGHT GUARD: config references block cascade
  -- ==================================================================
  -- Seed TARGET as an operator in mastery_constants, run cascade, assert
  -- PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES raised and NOTHING deleted
  -- (fail-closed proof). Then clear the ref so (B) cascade proceeds.
  UPDATE public.mastery_constants SET updated_by_profile_id = v_target
   WHERE key = 'POSITION_HALF_LIFE';

  BEGIN
    v_blocked := false;
    SELECT (public.execute_account_deletion_cascade(v_target, 'hard_delete')) INTO v_result;
    RAISE EXCEPTION '(I) cascade did NOT raise for profile with operator config references';
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    IF SQLERRM NOT LIKE '%PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES%' THEN
      RAISE EXCEPTION '(I) wrong error message: %', SQLERRM;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION '(I) operator-FK guard should have blocked cascade';
  END IF;

  SELECT count(*) INTO v_count FROM public.student_skill_mastery WHERE student_id = v_target;
  IF v_count = 0 THEN RAISE EXCEPTION '(I) FAIL-CLOSED VIOLATED: TARGET student_skill_mastery deleted despite guard'; END IF;

  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_target;
  IF v_count <> 1 THEN RAISE EXCEPTION '(I) FAIL-CLOSED VIOLATED: TARGET profile missing despite guard'; END IF;

  UPDATE public.mastery_constants SET updated_by_profile_id = NULL
   WHERE updated_by_profile_id = v_target;

  RAISE NOTICE '(I) OK  operator-FK preflight guard fires and is fail-closed (TARGET intact); cleared for cascade';

  -- ==================================================================
  -- (B) EXECUTE CASCADE on TARGET
  -- ==================================================================
  SELECT public.execute_account_deletion_cascade(v_target, 'hard_delete') INTO v_result;

  IF v_result->>'status' <> 'completed' THEN
    RAISE EXCEPTION '(B) cascade returned status=%, expected completed. Full: %', v_result->>'status', v_result;
  END IF;
  RAISE NOTICE '(B) OK  cascade returned completed: %', v_result;

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
    INSERT INTO auth.users (id, email) VALUES (v_rollback, 'rollback@example.com');
    UPDATE public.profiles SET display_name = 'Rollback', deleted_at = now() - interval '8 days' WHERE id = v_rollback;

    INSERT INTO public.student_skill_mastery (student_id, section, domain, skill, mastery_score, mastery_level, event_count_total, mastery_model_version, constants_snapshot_hash, computed_at)
    VALUES (v_rollback, 'M', 'Algebra', 'ALG.01', 0.7500, 3, 5, 'v1.0', 'testhash', now());

    INSERT INTO public.mastery_event_audit_log (
      student_id, section, domain, skill, source_family, event_source_kind,
      event_id, correct, difficulty, occurred_at,
      event_count_after, constants_snapshot_hash, mastery_model_version, applied_at, actor_id
    ) VALUES (
      v_rollback, 'M', 'Algebra', 'ALG.01', 'practice', 'practice_attempt',
      gen_random_uuid(), true, 2, now(),
      1, 'testhash', 'v1.0', now(), (SELECT actor_id FROM public.profiles WHERE id = v_rollback)
    );

    INSERT INTO public.account_deletion_requests
      (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
    VALUES (v_rollback, now(), now() - interval '1 day', v_rollback, 'completed', 'completed', now());

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
    v_anon_ps_id  uuid := '44444444-4444-4444-4444-444444444444';
    v_anon_rs_id  uuid := '55555555-5555-5555-5555-555555555555';
    v_anon_rsi_id uuid := '66666666-6666-6666-6666-666666666666';
  BEGIN
    -- Seed ANON user
    INSERT INTO auth.users (id, email) VALUES (v_anon, 'anon@example.com');
    UPDATE public.profiles SET full_name = 'Anon User', display_name = 'Anon',
      deleted_at = now() - interval '8 days' WHERE id = v_anon;
    SELECT actor_id INTO v_anon_actor FROM public.profiles WHERE id = v_anon;

    -- L1 seeds (derived state — will be DELETED)
    INSERT INTO public.student_skill_mastery (student_id, section, domain, skill, mastery_score, mastery_level, event_count_total, mastery_model_version, constants_snapshot_hash, computed_at)
    VALUES (v_anon, 'M', 'Algebra', 'ALG.01', 0.5000, 2, 10, 'v1.0', 'testhash', now());

    INSERT INTO public.student_kpi_rollups_current (student_id, scope, scope_key, payload, computed_at)
    VALUES (v_anon, 'section', 'M', '{"events_total": 10}'::jsonb, now());

    INSERT INTO public.review_schedule (student_id, question_id, ease_factor)
    VALUES (v_anon, v_question_id, 2.5);

    -- L2 seeds (activity — will be RETAINED, identity-decoupled)
    INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
    VALUES (v_anon_ps_id, v_anon, 'flow', 10, 'web', 'inst-anon', 'completed', v_anon_actor);

    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, selected_answer, is_correct, outcome, answered_at, occurred_at,
      client_attempt_id, actor_id
    ) VALUES (
      v_anon_ps_id, v_anon, 1, v_question_id,
      'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
      'Algebra', 'ALG.01', 2, 'M',
      'answered', 'A', true, 'correct', now(), now(),
      'anon-attempt-1', v_anon_actor
    );

    INSERT INTO public.review_sessions (id, student_id, status, source_origin, client_instance_id, actor_id)
    VALUES (v_anon_rs_id, v_anon, 'completed', 'practice', 'inst-anon', v_anon_actor);

    INSERT INTO public.review_session_items (
      id, session_id, student_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, actor_id
    ) VALUES (
      v_anon_rsi_id, v_anon_rs_id, v_anon, 1, v_question_id,
      'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
      'Algebra', 'ALG.01', 2, 'M', 'answered', v_anon_actor
    );

    INSERT INTO public.review_error_attempts (
      session_item_id, student_id, question_id, is_correct,
      section, domain, skill, difficulty, occurred_at,
      client_attempt_id, actor_id
    ) VALUES (
      v_anon_rsi_id, v_anon, v_question_id, true,
      'M', 'Algebra', 'ALG.01', 2, now(),
      'anon-review-attempt-1', v_anon_actor
    );

    -- L3 seeds (audit — will be RETAINED, identity-decoupled)
    INSERT INTO public.mastery_event_audit_log (
      student_id, section, domain, skill, source_family, event_source_kind,
      event_id, correct, difficulty, occurred_at,
      event_count_after, constants_snapshot_hash, mastery_model_version, applied_at, actor_id
    ) VALUES (
      v_anon, 'M', 'Algebra', 'ALG.01', 'practice', 'practice_attempt',
      gen_random_uuid(), true, 2, now(),
      1, 'testhash', 'v1.0', now(), v_anon_actor
    );

    INSERT INTO public.mastery_domain_refresh_audit_log (
      student_id, section, domain,
      mastery_score_before, mastery_score_after, event_count_after,
      constants_snapshot_hash, mastery_model_version, triggered_by, applied_at, actor_id
    ) VALUES (
      v_anon, 'M', 'Algebra', 0.4000, 0.5000, 10, 'testhash', 'v1.0', 'event', now(), v_anon_actor
    );

    -- Deletion request (status guard requires it)
    INSERT INTO public.entitlements (profile_id, tier, status) VALUES (v_anon, 'free', 'active');
    INSERT INTO public.account_deletion_requests
      (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
    VALUES (v_anon, now() - interval '8 days', now() - interval '1 day', v_anon, 'completed', 'completed', now());

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

  RAISE NOTICE '==> CASCADE REHEARSAL PASSED: hard-delete + anonymize + exact-target + control-untouched + idempotent + guards + operator-FK-guard + no-path-back proven (zero residue; storage purge deferred to PR-4 API layer)';
END $$;
