-- ============================================================================
-- Fixture for the gap-detector noise gate.
-- ============================================================================
-- Reproduces production's 2026-08-17 shape at 1/10 scale, keeping the RATIO that
-- matters rather than the raw counts: items rebuilt by the Step 8 backfill vastly
-- outnumber items with live audit rows.
--
--   7 items  live      — a mastery_event_audit_log row exists (real emission)
--   84 items backfill  — no audit row; a backfill_recompute audit row covers
--                        their (student, section, domain) and postdates them
--   0 items  genuine   — until the second seed block adds one
--
-- The 84 are the whole point: before this fix they ARE the detector's output.
-- ============================================================================

\set ON_ERROR_STOP on

\if :{?seed}

DO $seed$
DECLARE
  v_live     uuid := 'f1f1f1f1-0000-4000-8000-000000000001';
  v_backfill uuid := 'f2f2f2f2-0000-4000-8000-000000000002';
  v_qid      text := 'SATM1A00001';
  v_sess     uuid;
  v_actor_l  uuid;
  v_actor_b  uuid;
  v_item     uuid;
  i          integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_live, 'gap-live@example.com');
  INSERT INTO auth.users (id, email) VALUES (v_backfill, 'gap-backfill@example.com');
  SELECT actor_id INTO v_actor_l FROM public.profiles WHERE id = v_live;
  SELECT actor_id INTO v_actor_b FROM public.profiles WHERE id = v_backfill;

  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
                                stem, options, correct_answer, explanation)
  VALUES (v_qid, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'E')
  ON CONFLICT (id) DO NOTHING;

  -- ---- student A: 7 answered items WITH live audit rows
  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, completed_at, last_activity_at)
  VALUES (v_live, 'balanced', 10, 'web', 'completed', v_actor_l, now(), now())
  RETURNING id INTO v_sess;

  FOR i IN 1..7 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id, question_stem, question_options,
      question_correct_answer, question_explanation, question_domain, question_skill,
      question_difficulty, question_section, status, selected_answer, is_correct,
      outcome, answered_at, occurred_at, actor_id)
    VALUES (v_sess, v_live, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb,
      'A', 'E', 'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct',
      now() - interval '1 hour', now() - interval '1 hour', v_actor_l)
    RETURNING id INTO v_item;

    INSERT INTO public.mastery_event_audit_log
      (student_id, section, domain, skill, source_family, event_source_kind,
       event_id, question_id, occurred_at, event_count_after,
       constants_snapshot_hash, mastery_model_version, actor_id)
    VALUES (v_live, 'M', 'Algebra', 'ALG.01', 'practice', 'practice_attempt',
            v_item, v_qid, now() - interval '1 hour', i,
            'fixture-hash', 'v1.0', v_actor_l);
  END LOOP;

  -- ---- student B: 84 answered items with NO audit row, covered by a backfill
  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, completed_at, last_activity_at)
  VALUES (v_backfill, 'balanced', 100, 'web', 'completed', v_actor_b, now(), now())
  RETURNING id INTO v_sess;

  FOR i IN 1..84 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id, question_stem, question_options,
      question_correct_answer, question_explanation, question_domain, question_skill,
      question_difficulty, question_section, status, selected_answer, is_correct,
      outcome, answered_at, occurred_at, actor_id)
    VALUES (v_sess, v_backfill, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb,
      'A', 'E', 'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct',
      now() - interval '3 days', now() - interval '3 days', v_actor_b);
  END LOOP;

  -- the backfill that rebuilt them: AFTER the items, same (student, section, domain)
  INSERT INTO public.mastery_domain_refresh_audit_log
    (student_id, section, domain, mastery_score_after, mastery_level_after,
     event_count_after, constants_snapshot_hash, mastery_model_version,
     triggered_by, applied_at, actor_id)
  VALUES (v_backfill, 'M', 'Algebra', 0.5, 2, 84, 'fixture-hash', 'v1.0',
          'backfill_recompute', now() - interval '1 day', v_actor_b);
END $seed$;

\endif

-- ---------------------------------------------------------------------------
-- A genuinely un-emitted answer: no audit row, and answered AFTER the backfill
-- ran. This is the event the detector exists to catch, and the reason the
-- exclusion carries a time bound — without one, this item is hidden too.
-- ---------------------------------------------------------------------------
\if :{?seed_genuine}

DO $genuine$
DECLARE
  v_backfill uuid := 'f2f2f2f2-0000-4000-8000-000000000002';
  v_qid      text := 'SATM1A00001';
  v_sess     uuid;
  v_actor_b  uuid;
BEGIN
  SELECT actor_id INTO v_actor_b FROM public.profiles WHERE id = v_backfill;

  INSERT INTO public.practice_sessions
    (user_id, mode, target_count, platform, status, actor_id, completed_at, last_activity_at)
  VALUES (v_backfill, 'balanced', 10, 'web', 'completed', v_actor_b, now(), now())
  RETURNING id INTO v_sess;

  INSERT INTO public.practice_session_items (
    session_id, user_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, selected_answer, is_correct,
    outcome, answered_at, occurred_at, actor_id)
  VALUES (v_sess, v_backfill, 1, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb,
    'A', 'E', 'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct',
    now(), now(), v_actor_b);
END $genuine$;

\endif
