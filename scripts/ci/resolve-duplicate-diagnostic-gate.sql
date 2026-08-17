-- ============================================================================
-- Fixture for the resolve-duplicate-diagnostic gate.
-- ============================================================================
-- THREE sessions. The third is the whole point.
--
--   86b0dc8f…  student A  completed  40 answered   -> must survive untouched
--   18187611…  student A  active      7 answered   -> the pinned target
--   (random)   student B  active      3 answered   -> MUST SURVIVE
--
-- Student B is what makes this fixture discriminating. The named mutation for this
-- step is "widen the predicate to WHERE mode='diagnostic' AND status='active'".
-- With only student A's two rows, that widened predicate abandons exactly the same
-- single row and the gate passes — the fixture could not tell the pinned target
-- from its superset. Student B's active diagnostic is in that superset and is not
-- the target, so the widened predicate takes their in-progress diagnostic away and
-- the gate reds.
--
-- That failure mode has appeared repeatedly in this codebase, so it is called out
-- rather than left for the next reader to rediscover.
-- ============================================================================

\set ON_ERROR_STOP on

\if :{?seed}

DO $seed$
DECLARE
  v_student_a uuid := '3f18cbe2-a999-41d4-852b-2af27e19d04e';
  v_student_b uuid := 'dddddddd-0000-4000-8000-00000000000b';
  v_keep      uuid := '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff';
  v_target    uuid := '18187611-6dd2-4947-a35e-935874f83096';
  v_other     uuid := 'eeeeeeee-0000-4000-8000-00000000000c';
  v_qid       text := 'SATM1A00001';
  v_actor_a   uuid;
  v_actor_b   uuid;
  i           integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_student_a, 'dup-a@example.com');
  INSERT INTO auth.users (id, email) VALUES (v_student_b, 'dup-b@example.com');
  SELECT actor_id INTO v_actor_a FROM public.profiles WHERE id = v_student_a;
  SELECT actor_id INTO v_actor_b FROM public.profiles WHERE id = v_student_b;
  IF v_actor_a IS NULL OR v_actor_b IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: profile actor_id not assigned';
  END IF;

  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
                                stem, options, correct_answer, explanation)
  VALUES (v_qid, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'E') ON CONFLICT (id) DO NOTHING;

  -- student A: the completed baseline (kept) and the surplus active one (target)
  INSERT INTO public.practice_sessions
    (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id,
     created_at, last_activity_at, completed_at)
  VALUES
    (v_keep, v_student_a, 'diagnostic', 40, 'web', 'inst-keep', 'completed', v_actor_a,
     '2026-08-14 10:57:53Z', '2026-08-15 21:01:27Z', '2026-08-15 21:01:27.25Z'),
    (v_target, v_student_a, 'diagnostic', 40, 'web', 'inst-target', 'active', v_actor_a,
     '2026-08-17 06:57:30Z', '2026-08-17 07:01:26Z', NULL);

  -- student B: an unrelated in-progress diagnostic that must survive
  INSERT INTO public.practice_sessions
    (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES (v_other, v_student_b, 'diagnostic', 40, 'web', 'inst-other', 'active', v_actor_b);

  -- answered items: 40 on the kept session, 7 on the target, 3 on student B's.
  -- These are the events that must not move.
  FOR i IN 1..40 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id, question_stem, question_options,
      question_correct_answer, question_explanation, question_domain, question_skill,
      question_difficulty, question_section, status, selected_answer, is_correct,
      outcome, answered_at, occurred_at, actor_id)
    VALUES (v_keep, v_student_a, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb,
      'A', 'E', 'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct',
      now() - make_interval(hours => 100 - i), now() - make_interval(hours => 100 - i),
      v_actor_a);
  END LOOP;

  FOR i IN 1..7 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id, question_stem, question_options,
      question_correct_answer, question_explanation, question_domain, question_skill,
      question_difficulty, question_section, status, selected_answer, is_correct,
      outcome, answered_at, occurred_at, actor_id)
    VALUES (v_target, v_student_a, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb,
      'A', 'E', 'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct',
      now() - make_interval(hours => 50 - i), now() - make_interval(hours => 50 - i),
      v_actor_a);
  END LOOP;

  FOR i IN 1..3 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id, question_stem, question_options,
      question_correct_answer, question_explanation, question_domain, question_skill,
      question_difficulty, question_section, status, selected_answer, is_correct,
      outcome, answered_at, occurred_at, actor_id)
    VALUES (v_other, v_student_b, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb,
      'A', 'E', 'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct',
      now() - make_interval(hours => 10 - i), now() - make_interval(hours => 10 - i),
      v_actor_b);
  END LOOP;

  RAISE NOTICE 'FIXTURE: 3 diagnostic sessions seeded (kept 40, target 7, other-student 3)';
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_post}

DO $post$
DECLARE
  v_keep    uuid := '86b0dc8f-9cdd-4a86-b9fc-48ffdbd104ff';
  v_target  uuid := '18187611-6dd2-4947-a35e-935874f83096';
  v_other   uuid := 'eeeeeeee-0000-4000-8000-00000000000c';
  v_status  text;
  v_done_at timestamptz;
  v_n       integer;
BEGIN
  SELECT status, completed_at INTO v_status, v_done_at
    FROM public.practice_sessions WHERE id = v_target;
  IF v_status <> 'abandoned' THEN
    RAISE EXCEPTION 'POST: target status is ''%'', expected abandoned', v_status;
  END IF;
  IF v_done_at IS NOT NULL THEN
    RAISE EXCEPTION
      'POST: completed_at was stamped on the abandoned target — that is BUG-4, the defect this workstream is removing';
  END IF;

  SELECT status INTO v_status FROM public.practice_sessions WHERE id = v_keep;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'POST: the KEPT diagnostic is now ''%'', expected completed', v_status;
  END IF;

  -- THE DISCRIMINATING ASSERTION. A predicate widened to
  -- (mode='diagnostic' AND status='active') abandons this row too.
  SELECT status INTO v_status FROM public.practice_sessions WHERE id = v_other;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION
      'POST: ANOTHER STUDENT''S in-progress diagnostic is now ''%'' — the write was not exact-target and took away a diagnostic that was never the target',
      v_status;
  END IF;

  -- the 47 answered events across student A's two sessions are untouched
  SELECT count(*) INTO v_n FROM public.practice_session_items
   WHERE session_id IN (v_keep, v_target) AND status = 'answered';
  IF v_n <> 47 THEN
    RAISE EXCEPTION 'POST: answered items across both sessions is %, expected 47', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.practice_sessions WHERE mode = 'diagnostic';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'POST: diagnostic session count is %, expected 3 (nothing inserted or deleted)', v_n;
  END IF;

  RAISE NOTICE 'POST ok: target abandoned with no completed_at, kept intact, other student untouched, 47 events preserved';
END $post$;

\endif
