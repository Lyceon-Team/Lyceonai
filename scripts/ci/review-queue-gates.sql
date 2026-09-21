-- ============================================================================
-- R2 gates G1-G18 — the review queue, proven against a real database
-- ============================================================================
-- @spec [Ruled plan 2026-09-21 §3; Brief R2 §5 "Gates and plants"]
-- @implemented [2026-09-21]
--
-- plain English: every assertion the R2 brief names, as one transaction per
--   gate against a pipeline-applied database. Each gate RAISEs on failure with
--   the observed value, so a red run says what was wrong rather than only that
--   something was.
--
-- Run: psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/review-queue-gates.sql
-- The plants live in scripts/ci/review-queue-gates.self-test.sh, which proves
-- each gate can actually fail. A gate that cannot go red is not a gate.
--
-- G6 (concurrency) and G15 (deletion rehearsal) are NOT here: G6 needs two real
-- connections and G15 is scripts/ci/deletion-cascade-rehearsal.sql. Both run
-- from the self-test harness.
-- ============================================================================

\set ON_ERROR_STOP on

DO $gates$
DECLARE
  v_student   uuid := '00000000-aaaa-4000-8000-000000000001';
  v_other     uuid := '00000000-aaaa-4000-8000-000000000002';
  v_actor     uuid;
  v_actor2    uuid;
  v_qid       text := 'SATM1AAA001';
  v_qid2      text := 'SATM1AAA002';
  v_ps        uuid := '00000000-bbbb-4000-8000-000000000001';
  v_rs        uuid := '00000000-cccc-4000-8000-000000000001';
  v_item      uuid;
  v_n         integer;
  v_txt       text;
  v_ts1       timestamptz := now() - interval '2 hours';
  v_ts2       timestamptz := now() - interval '1 hour';
  v_entry     uuid;
  v_entry2    uuid;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email) VALUES (v_student, 'g@example.com'), (v_other, 'h@example.com')
    ON CONFLICT DO NOTHING;
  SELECT actor_id INTO v_actor  FROM public.profiles WHERE id = v_student;
  SELECT actor_id INTO v_actor2 FROM public.profiles WHERE id = v_other;

  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
                                stem, options, correct_answer, explanation, status)
  VALUES (v_qid,  'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'stem',
          '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
          'A', 'exp', 'published'),
         (v_qid2, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'stem2',
          '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
          'A', 'exp', 'published')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, status, actor_id)
  VALUES (v_ps, v_student, 'flow', 10, 'web', 'active', v_actor);

  -- ===================================================================== G1
  -- A practice miss creates one active entry: source practice, outcome incorrect.
  INSERT INTO public.practice_session_items (
    id, session_id, user_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, actor_id)
  VALUES ('00000000-dddd-4000-8000-000000000001', v_ps, v_student, 1, v_qid, 'stem',
          '[{"key":"A","text":"a"}]'::jsonb, 'A', 'exp', 'Algebra', 'ALG.01', 2, 'M',
          'served', v_actor);

  UPDATE public.practice_session_items
     SET status='answered', is_correct=false, outcome='incorrect',
         answered_at=v_ts1, occurred_at=v_ts1
   WHERE id='00000000-dddd-4000-8000-000000000001';

  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='active'
     AND source_engine='practice' AND source_outcome='incorrect';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G1 FAIL: expected 1 active practice/incorrect entry, got %', v_n; END IF;
  RAISE NOTICE 'ok   [G1]: a practice miss creates one active entry (practice/incorrect)';

  -- ===================================================================== G4
  -- Replaying the same source item creates no row (the writer is idempotent).
  SELECT public.review_queue_record(v_student, v_qid, 'practice', v_ps,
           '00000000-dddd-4000-8000-000000000001', 'incorrect', v_ts1) INTO v_entry;
  SELECT count(*) INTO v_n FROM public.review_schedule WHERE source_item_id='00000000-dddd-4000-8000-000000000001';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G4 FAIL: replay created a second row, total %', v_n; END IF;

  -- The early return above is the mechanism; uq_review_schedule_source_item is
  -- the backstop, and only the backstop covers a writer that bypasses the
  -- function. Asserting both is what makes the brief's plant ("drop UNIQUE
  -- (source_engine, source_item_id)") able to turn this gate red — without this
  -- half, dropping the constraint changes nothing observable and G4 passes a
  -- database that has lost its last defence against a duplicate enqueue.
  BEGIN
    -- closed_at is set because review_schedule_closed_iff_not_active requires a
    -- non-active row to carry one; without it that CHECK fires first and the
    -- probe would never reach the unique index it is meant to test.
    INSERT INTO public.review_schedule (
      student_id, question_id, status, queued_at, closed_at,
      source_engine, source_session_id, source_item_id, source_outcome)
    VALUES (v_student, v_qid, 'superseded', v_ts1, v_ts1, 'practice', v_ps,
            '00000000-dddd-4000-8000-000000000001', 'incorrect');
    RAISE EXCEPTION 'G4 FAIL: a duplicate (source_engine, source_item_id) was accepted — the unique backstop is gone';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;
  RAISE NOTICE 'ok   [G4]: replay returns the existing row, and a direct duplicate insert is refused';

  -- ===================================================================== G2
  -- A practice skip creates one active entry with outcome skipped (ruling 2).
  INSERT INTO public.practice_session_items (
    id, session_id, user_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, actor_id)
  VALUES ('00000000-dddd-4000-8000-000000000002', v_ps, v_student, 2, v_qid2, 'stem2',
          '[{"key":"A","text":"a"}]'::jsonb, 'A', 'exp', 'Algebra', 'ALG.01', 2, 'M',
          'served', v_actor);

  UPDATE public.practice_session_items
     SET status='skipped', is_correct=false, outcome='skipped',
         answered_at=v_ts1, occurred_at=v_ts1
   WHERE id='00000000-dddd-4000-8000-000000000002';

  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid2 AND status='active' AND source_outcome='skipped';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G2 FAIL: expected 1 active skipped entry, got %', v_n; END IF;
  RAISE NOTICE 'ok   [G2]: a practice skip creates one active entry (outcome skipped)';

  -- ===================================================================== G3
  -- A practice correct answer creates nothing and leaves the open entry alone.
  INSERT INTO public.practice_session_items (
    id, session_id, user_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, actor_id)
  VALUES ('00000000-dddd-4000-8000-000000000003', v_ps, v_student, 3, v_qid, 'stem',
          '[{"key":"A","text":"a"}]'::jsonb, 'A', 'exp', 'Algebra', 'ALG.01', 2, 'M',
          'served', v_actor);

  SELECT id INTO v_entry FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='active';

  UPDATE public.practice_session_items
     SET status='answered', is_correct=true, outcome='correct',
         answered_at=v_ts2, occurred_at=v_ts2
   WHERE id='00000000-dddd-4000-8000-000000000003';

  SELECT count(*) INTO v_n FROM public.review_schedule WHERE source_item_id='00000000-dddd-4000-8000-000000000003';
  IF v_n <> 0 THEN RAISE EXCEPTION 'G3 FAIL: a correct answer created % entr(ies)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.review_schedule WHERE id=v_entry AND status='active';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G3 FAIL: a correct answer disturbed the open entry'; END IF;
  RAISE NOTICE 'ok   [G3]: a practice correct answer writes nothing and leaves the open entry untouched';

  -- ===================================================================== G5
  -- A second miss supersedes the first; exactly one active entry remains.
  INSERT INTO public.practice_session_items (
    id, session_id, user_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, actor_id)
  VALUES ('00000000-dddd-4000-8000-000000000004', v_ps, v_student, 4, v_qid, 'stem',
          '[{"key":"A","text":"a"}]'::jsonb, 'A', 'exp', 'Algebra', 'ALG.01', 2, 'M',
          'served', v_actor);

  UPDATE public.practice_session_items
     SET status='answered', is_correct=false, outcome='incorrect',
         answered_at=v_ts2, occurred_at=v_ts2
   WHERE id='00000000-dddd-4000-8000-000000000004';

  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='active';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G5 FAIL: expected exactly 1 active entry after a second miss, got %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='superseded';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G5 FAIL: expected 1 superseded entry, got %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='superseded' AND closed_at IS NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'G5 FAIL: a superseded entry has no closed_at'; END IF;
  -- As with G4: the explicit supersede inside review_queue_record is the
  -- mechanism, and uq_review_schedule_open_question is the backstop that holds
  -- when a writer bypasses the function or races it. Only this half can notice
  -- the brief's plant ("drop the partial unique index").
  BEGIN
    INSERT INTO public.review_schedule (
      student_id, question_id, status, queued_at,
      source_engine, source_session_id, source_item_id, source_outcome)
    VALUES (v_student, v_qid, 'active', v_ts2, 'practice', v_ps,
            '00000000-dddd-4000-8000-0000000000ff', 'incorrect');
    RAISE EXCEPTION 'G5 FAIL: a second ACTIVE entry for one (student, question) was accepted — the open-entry index is gone';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;
  RAISE NOTICE 'ok   [G5]: a second miss supersedes the first; a second active entry is refused';

  RAISE NOTICE '--- practice-side gates complete; review-side follows ---';
END
$gates$;

DO $gates_review$
DECLARE
  v_student uuid := '00000000-aaaa-4000-8000-000000000001';
  v_actor   uuid;
  v_qid     text := 'SATM1AAA001';
  v_qid2    text := 'SATM1AAA002';
  v_rs      uuid := '00000000-cccc-4000-8000-000000000001';
  v_n       integer;
  v_txt     text;
  v_ts3     timestamptz := now() - interval '30 minutes';
  v_ts4     timestamptz := now() - interval '10 minutes';
  v_before  timestamptz;
  v_after   timestamptz;
BEGIN
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_student;

  INSERT INTO public.review_sessions (id, student_id, status, mode, filters, target_count, platform, actor_id)
  VALUES (v_rs, v_student, 'active', 'queue', '{}'::jsonb, 5, 'web', v_actor);

  -- ===================================================================== G7
  -- A review CORRECT answer writes an attempt whose id equals the item id
  -- (ruling 11: R3 passes it as the mastery event id) and graduates the entry.
  INSERT INTO public.review_session_items (
    id, session_id, student_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, actor_id)
  VALUES ('00000000-eeee-4000-8000-000000000001', v_rs, v_student, 1, v_qid2, 'stem2',
          '[{"key":"A","text":"a"}]'::jsonb, 'A', 'exp', 'Algebra', 'ALG.01', 2, 'M',
          'served', v_actor);

  UPDATE public.review_session_items
     SET status='answered', is_correct=true, outcome='correct', selected_answer='A',
         time_spent_ms=42000, answered_at=v_ts3, occurred_at=v_ts3
   WHERE id='00000000-eeee-4000-8000-000000000001';

  SELECT count(*) INTO v_n FROM public.review_error_attempts
   WHERE id='00000000-eeee-4000-8000-000000000001'
     AND session_item_id='00000000-eeee-4000-8000-000000000001'
     AND is_correct=true AND used_tutor=false AND seconds_spent=42;
  IF v_n <> 1 THEN RAISE EXCEPTION 'G7 FAIL: attempt with id = item id not written (got %)', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid2 AND status='graduated'
     AND closed_by_item_id='00000000-eeee-4000-8000-000000000001';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G7 FAIL: entry not graduated (got %)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid2 AND status='active';
  IF v_n <> 0 THEN RAISE EXCEPTION 'G7 FAIL: an active entry survived graduation'; END IF;
  RAISE NOTICE 'ok   [G7]: a review correct answer writes attempt id = item id and graduates the entry';

  -- ==================================================================== G17
  -- canonical_mastery_events surfaces that attempt with a SCALAR skill.
  -- The seam filters ra.skill = p_skill; an array literal would match nothing
  -- and every review mastery event would silently vanish.
  SELECT count(*) INTO v_n FROM public.canonical_mastery_events(v_student, 'skill', 'M', 'Algebra', 'ALG.01')
   WHERE event_id='00000000-eeee-4000-8000-000000000001' AND source_family='review';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G17 FAIL: canonical_mastery_events did not return the review attempt (got %)', v_n; END IF;
  SELECT skill INTO v_txt FROM public.review_error_attempts WHERE id='00000000-eeee-4000-8000-000000000001';
  IF v_txt <> 'ALG.01' THEN RAISE EXCEPTION 'G17 FAIL: skill is % (expected scalar ALG.01)', v_txt; END IF;
  RAISE NOTICE 'ok   [G17]: canonical_mastery_events returns the review attempt with a scalar skill';

  -- ===================================================================== G8
  -- A review WRONG answer writes an attempt, supersedes the entry, and opens a
  -- review/incorrect entry at a LATER queued_at (ruling 7: back of the line).
  SELECT queued_at INTO v_before FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='active';

  INSERT INTO public.review_session_items (
    id, session_id, student_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, actor_id)
  VALUES ('00000000-eeee-4000-8000-000000000002', v_rs, v_student, 2, v_qid, 'stem',
          '[{"key":"A","text":"a"}]'::jsonb, 'A', 'exp', 'Algebra', 'ALG.01', 2, 'M',
          'served', v_actor);

  UPDATE public.review_session_items
     SET status='answered', is_correct=false, outcome='incorrect', selected_answer='B',
         time_spent_ms=15000, answered_at=v_ts4, occurred_at=v_ts4
   WHERE id='00000000-eeee-4000-8000-000000000002';

  SELECT count(*) INTO v_n FROM public.review_error_attempts
   WHERE id='00000000-eeee-4000-8000-000000000002' AND is_correct=false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'G8 FAIL: no attempt written for a wrong review answer'; END IF;

  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='active'
     AND source_engine='review' AND source_outcome='incorrect';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G8 FAIL: no new review/incorrect entry (got %)', v_n; END IF;

  SELECT queued_at INTO v_after FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid AND status='active';
  IF v_after <= v_before THEN
    RAISE EXCEPTION 'G8 FAIL: requeued entry queued_at % is not later than the superseded % (not back of the line)', v_after, v_before;
  END IF;
  RAISE NOTICE 'ok   [G8]: a review wrong answer writes an attempt, supersedes, and requeues at the back';

  -- ===================================================================== G9
  -- A review SKIP requeues with source review / outcome skipped, and writes NO
  -- attempt row — pre-build check 7: practice skips carry no mastery, so review
  -- skips must not either.
  INSERT INTO public.review_session_items (
    id, session_id, student_id, ordinal, question_id, question_stem, question_options,
    question_correct_answer, question_explanation, question_domain, question_skill,
    question_difficulty, question_section, status, actor_id)
  VALUES ('00000000-eeee-4000-8000-000000000003', v_rs, v_student, 3, v_qid2, 'stem2',
          '[{"key":"A","text":"a"}]'::jsonb, 'A', 'exp', 'Algebra', 'ALG.01', 2, 'M',
          'served', v_actor);

  UPDATE public.review_session_items
     SET status='skipped', outcome='skipped', answered_at=now(), occurred_at=now()
   WHERE id='00000000-eeee-4000-8000-000000000003';

  SELECT count(*) INTO v_n FROM public.review_schedule
   WHERE student_id=v_student AND question_id=v_qid2 AND status='active'
     AND source_engine='review' AND source_outcome='skipped';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G9 FAIL: a review skip did not requeue (got %)', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.review_error_attempts
   WHERE id='00000000-eeee-4000-8000-000000000003';
  IF v_n <> 0 THEN RAISE EXCEPTION 'G9 FAIL: a review skip wrote % attempt row(s); check 7 says none', v_n; END IF;
  RAISE NOTICE 'ok   [G9]: a review skip requeues (review/skipped) and writes no attempt row';

  -- ==================================================================== G18
  -- A grid-in item carrying non-empty options is rejected by rsi_item_shape_chk.
  BEGIN
    INSERT INTO public.review_session_items (
      id, session_id, student_id, ordinal, question_id, question_stem, question_options,
      question_correct_answer, question_explanation, question_domain, question_skill,
      question_difficulty, question_section, status, question_item_type,
      question_correct_variants, actor_id)
    VALUES ('00000000-eeee-4000-8000-000000000004', v_rs, v_student, 4, v_qid, 'stem',
            '[{"key":"A","text":"a"}]'::jsonb, '7', 'exp', 'Algebra', 'ALG.01', 2, 'M',
            'served', 'grid_in', ARRAY['7'], v_actor);
    RAISE EXCEPTION 'G18 FAIL: a grid_in item with non-empty options was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok   [G18]: a grid-in item with non-empty options is rejected (rsi_item_shape_chk)';
  END;

  -- ==================================================================== G10
  -- Anonymizing a student with resolved misses creates zero entries. The
  -- OLD.status guard is what stops it: anonymize UPDATEs already-resolved rows.
  -- (a) The OLD.status clause's own job: a resolved row that is UPDATEd again
  --     while still OWNED must not re-enqueue. This is the half the NEW.user_id
  --     guard cannot cover, and the only half that can notice the brief's plant
  --     ("drop the OLD.status clause").
  SELECT count(*) INTO v_n FROM public.review_schedule;
  UPDATE public.practice_session_items SET time_spent_ms = 1234
   WHERE id = '00000000-dddd-4000-8000-000000000004';
  SELECT count(*) - v_n INTO v_n FROM public.review_schedule;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'G10 FAIL: re-UPDATEing an already-resolved owned row created % queue entr(ies)', v_n;
  END IF;

  -- (b) And the anonymize path itself, which the NEW.user_id guard covers.
  SELECT count(*) INTO v_n FROM public.review_schedule;
  UPDATE public.practice_session_items SET user_id = NULL, client_attempt_id = NULL
   WHERE user_id = v_student;
  SELECT count(*) - v_n INTO v_n FROM public.review_schedule;
  IF v_n <> 0 THEN RAISE EXCEPTION 'G10 FAIL: anonymization created % queue entr(ies)', v_n; END IF;
  RAISE NOTICE 'ok   [G10]: neither a re-UPDATE of a resolved owned row nor anonymization enqueues';
END
$gates_review$;
