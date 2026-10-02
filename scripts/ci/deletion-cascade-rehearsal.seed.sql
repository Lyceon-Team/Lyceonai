-- ============================================================================
-- Seed for the destructive-cascade rehearsal (deletion-cascade-rehearsal.sql)
-- ============================================================================
-- @spec [Doc-05D_V1, §10 Account-Deletion Cascade & One-Way Anonymization;
--        student-ui register F-47 (owner ruling 2026-10-01: "the rehearsal commits
--        its seed data in a separate transaction before running the cascade,
--        matching production's shape")] | @implemented [2026-10-01]
--
-- plain English: every row the rehearsal deletes or anonymizes is written HERE,
-- in its own transaction, which COMMITS before deletion-cascade-rehearsal.sql runs
-- the cascade. That is production's shape: a student's rows were always written by
-- an earlier transaction than the one that erases them.
--
-- Why it matters (F-47): PostgreSQL re-checks a referencing row's UNCHANGED foreign
-- key only when that row version was written by the current transaction
-- (RI_FKey_fk_upd_check_required). One profile delete both cascades a
-- review_schedule entry and sets a review_session_items row's student_id NULL; with
-- the seed in the same transaction the re-check sees the deleted entry and raises
-- review_session_items_queue_entry_id_fkey, a failure production cannot have. The
-- rehearsal was red for that reason alone from 2026-09-22 until this split.
--
-- Edges: these rows are now COMMITTED, so they outlive a failed run until the next
-- setup_deletion_rehearsal_db, which drops and recreates the throwaway DB, or the
-- runner's own drop on success. The loopback host guard in lib/deletion-rehearsal-db.sh
-- is what keeps them off any hosted database. The harness in
-- review-queue-gates.self-test.sh runs this file against its own throwaway DB too.
-- Run order: deletion-cascade-rehearsal.seed.sql, then deletion-cascade-rehearsal.sql.
-- ============================================================================

DO $$
DECLARE
  v_target  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_control uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_question_id text := 'SATM1A00001';
  v_rollback uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_anon        uuid := '33333333-3333-3333-3333-333333333333';
  v_anon_actor  uuid;
  v_anon_ps_id  uuid := '44444444-4444-4444-4444-444444444444';
  v_anon_rs_id  uuid := '55555555-5555-5555-5555-555555555555';
  v_anon_rsi_id uuid := '66666666-6666-6666-6666-666666666666';
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
    'Test question stem', '[{"key":"A","text":"opt A"},{"key":"B","text":"opt B"},{"key":"C","text":"opt C"},{"key":"D","text":"opt D"}]'::jsonb,
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
  -- R2: the SM-2 shape is gone. An entry is now a miss or skip with provenance
  -- (ruled plan ruling 14). source_item_id must differ per row: the writer's
  -- idempotency key is UNIQUE (source_engine, source_item_id).
  INSERT INTO public.review_schedule (
    id, student_id, question_id, queued_at,
    source_engine, source_session_id, source_item_id, source_outcome
  ) VALUES
    ('0b000001-0000-4000-8000-000000000001',
     v_target,  v_question_id, now(), 'practice',
     'cccccccc-cccc-cccc-cccc-cccccccccccc',
     '0a000001-0000-4000-8000-000000000001', 'incorrect'),
    ('0b000001-0000-4000-8000-000000000002',
     v_control, v_question_id, now(), 'practice',
     'dddddddd-dddd-dddd-dddd-dddddddddddd',
     '0a000001-0000-4000-8000-000000000002', 'incorrect');

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
  -- R2: source_origin is gone; the envelope now mirrors practice_sessions
  -- (mode/filters/target_count/platform).
  INSERT INTO public.review_sessions (id, student_id, status, mode, filters, target_count, platform, client_instance_id, actor_id)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', v_target,  'completed', 'queue', '{}'::jsonb, 1, 'web', 'inst-target', (SELECT actor_id FROM public.profiles WHERE id = v_target)),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', v_control, 'completed', 'queue', '{}'::jsonb, 1, 'web', 'inst-control', (SELECT actor_id FROM public.profiles WHERE id = v_control));

  INSERT INTO public.review_session_items (
    id, session_id, student_id, ordinal, question_id,
    question_stem, question_options, question_correct_answer, question_explanation,
    question_domain, question_skill, question_difficulty, question_section,
    status, occurred_at, queue_entry_id, actor_id
  ) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', v_target, 1, v_question_id,
    'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
    'Algebra', 'ALG.01', 2, 'M', 'answered', now(),
    '0b000001-0000-4000-8000-000000000001',
    (SELECT actor_id FROM public.profiles WHERE id = v_target)
  ), (
    '22222222-2222-2222-2222-222222222222',
    'ffffffff-ffff-ffff-ffff-ffffffffffff', v_control, 1, v_question_id,
    'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
    'Algebra', 'ALG.01', 2, 'M', 'answered', now(),
    '0b000001-0000-4000-8000-000000000002',
    (SELECT actor_id FROM public.profiles WHERE id = v_control)
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
  -- SEED: (I) operator attribution, LEFT IN PLACE for the cascade to sever
  -- ==================================================================
  UPDATE public.mastery_constants SET updated_by_profile_id = v_target
   WHERE key = 'POSITION_HALF_LIFE';

  -- ==================================================================
  -- SEED: (H) D18 rollback profile
  -- ==================================================================
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

  -- ==================================================================
  -- SEED: (J) anonymize-mode profile
  -- ==================================================================
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

    INSERT INTO public.review_schedule (
      id, student_id, question_id, queued_at,
      source_engine, source_session_id, source_item_id, source_outcome
    ) VALUES (
      '0b000001-0000-4000-8000-000000000003',
      v_anon, v_question_id, now(), 'practice',
      v_anon_ps_id, '0a000001-0000-4000-8000-000000000003', 'incorrect');

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

    INSERT INTO public.review_sessions (id, student_id, status, mode, filters, target_count, platform, client_instance_id, actor_id)
    VALUES (v_anon_rs_id, v_anon, 'completed', 'queue', '{}'::jsonb, 1, 'web', 'inst-anon', v_anon_actor);

    INSERT INTO public.review_session_items (
      id, session_id, student_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, occurred_at, queue_entry_id, actor_id
    ) VALUES (
      v_anon_rsi_id, v_anon_rs_id, v_anon, 1, v_question_id,
      'Test stem', '[{"key":"A","text":"opt A"}]'::jsonb, 'A', 'Explanation',
      'Algebra', 'ALG.01', 2, 'M', 'answered', now(),
      '0b000001-0000-4000-8000-000000000003', v_anon_actor
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

  RAISE NOTICE '==> CASCADE REHEARSAL SEED committed (target, control, rollback, anon)';
END $$;
