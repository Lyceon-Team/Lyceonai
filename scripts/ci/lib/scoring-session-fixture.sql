-- ============================================================================
-- Shared CI fixture: a scored-ready exam session with a chosen answer pattern.
-- ============================================================================
-- @spec [Doc-04A_V2.2, §5.3-§5.7; Doc-04B_V4.3, §11.2 (LEFT JOIN from
--        test_form_items), §14.4 (presented-item filter), §15.2, §19.2]
--       | @implemented [2026-09-24]
--
-- plain English: defines
--   pg_temp.scoring_fixture_session(session, student, form, rw jsonb, m jsonb)
--     -> uuid (the exam_runtime_outbox event id to score)
--   Each section argument is NULL (section not submitted: state
--   'module1_active') or {"path":"A|B","r1":n,"ne":n,"nm":n,"nh":n}: Module 1
--   gets exactly r1 correct items; the routed Module 2 gets exactly ne easy,
--   nm medium and nh hard wrong items (difficulty 1/2/3), the rest correct.
--   Both sections given -> session 'completed', event test_session_completed;
--   one -> 'partial_scored_abandoned', event test_session_partial_scored_abandoned.
--   Optional "b1"/"b2": the first b1 (M1) / b2 (M2) wrong items are blank and
--   the module's other wrong items are answered wrong (the §28.8 shape); when
--   absent, wrong items rotate through the four shapes below.
--
-- Wrong items rotate through four shapes so every scoring path sees each:
--   0 no answer row at all (blank)            1 a row with answer NULL
--   2 a row with a wrong value ('B' / '2')    3 a row with the CORRECT value but
--                                               a different question_id (the §11.2
--                                               join ignores it -> blank -> wrong)
-- Presented-item noise, added to every submitted section: a CORRECT answer for
--   every item of the NON-routed Module 2, and a correct-looking answer at an
--   ordinal the form does not have (ordinal 90). Neither may count (§14.4/§19.2).
-- Relies on the facts documented in scripts/ci/lib/exam-form-fixture.sql
--   (correct mcq 'A', correct grid_in '1').
-- ============================================================================

CREATE FUNCTION pg_temp.scoring_fixture_answer(p_session uuid, p_section text, p_module text,
                                               p_ordinal int, p_question text, p_answer text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_sub uuid;
BEGIN
  INSERT INTO public.test_answer_submissions (test_session_id, idempotency_key, section, module, ordinal,
      question_id, answer, response_json, response_schema_version, was_canonical_update)
  VALUES (p_session, p_section || ':' || p_module || ':' || p_ordinal, p_section, p_module, p_ordinal,
          p_question, p_answer, '{}'::jsonb, 'tests-answer-v1', true)
  RETURNING id INTO v_sub;
  INSERT INTO public.test_session_answers (test_session_id, section, module, ordinal, question_id,
                                           answer, last_submission_id)
  VALUES (p_session, p_section, p_module, p_ordinal, p_question, p_answer, v_sub);
END $f$;

-- One section: state row + answers per the pattern + presented-item noise.
CREATE FUNCTION pg_temp.scoring_fixture_section(p_session uuid, p_form uuid, p_section text, p_spec jsonb)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_path text; v_m2 text; v_other text;
  v_r1 int; v_want int[]; v_left int[]; v_blanks int[];
  it record; v_wrong boolean; v_kind int := 0; v_right text; v_bad text; v_decoy text;
BEGIN
  IF p_spec IS NULL THEN
    INSERT INTO public.test_session_sections (test_session_id, section, state, module1_started_at)
    VALUES (p_session, p_section, 'module1_active', now());
    RETURN;
  END IF;

  v_path  := p_spec->>'path';
  v_m2    := '2' || v_path;
  v_other := CASE v_path WHEN 'A' THEN '2B' ELSE '2A' END;
  v_r1    := (p_spec->>'r1')::int;
  v_want  := ARRAY[(p_spec->>'ne')::int, (p_spec->>'nm')::int, (p_spec->>'nh')::int];
  v_left  := v_want;
  v_blanks := ARRAY[COALESCE((p_spec->>'b1')::int, 0), COALESCE((p_spec->>'b2')::int, 0)];

  INSERT INTO public.test_session_sections (test_session_id, section, state, module2_path,
      module1_started_at, module1_submitted_at, module1_submitted_by,
      module2_started_at, module2_submitted_at, module2_submitted_by)
  VALUES (p_session, p_section, 'submitted', v_path,
          now(), now(), 'student', now(), now(), 'student');

  -- a question id from the non-routed module, used as the mismatched-id decoy
  SELECT question_id INTO v_decoy FROM public.test_form_items
   WHERE test_form_id = p_form AND section = p_section AND module = v_other ORDER BY ordinal LIMIT 1;

  FOR it IN
    SELECT i.module, i.ordinal, i.question_id, q.difficulty, q.item_type
      FROM public.test_form_items i JOIN public.questions q ON q.id = i.question_id
     WHERE i.test_form_id = p_form AND i.section = p_section AND i.module IN ('1', v_m2)
     ORDER BY CASE i.module WHEN '1' THEN 0 ELSE 1 END, i.ordinal
  LOOP
    v_right := CASE it.item_type WHEN 'grid_in' THEN '1' ELSE 'A' END;
    v_bad   := CASE it.item_type WHEN 'grid_in' THEN '2' ELSE 'B' END;
    IF it.module = '1' THEN
      v_wrong := it.ordinal >= v_r1;
    ELSE
      v_wrong := v_left[it.difficulty] > 0;
      IF v_wrong THEN v_left[it.difficulty] := v_left[it.difficulty] - 1; END IF;
    END IF;

    IF NOT v_wrong THEN
      PERFORM pg_temp.scoring_fixture_answer(p_session, p_section, it.module, it.ordinal, it.question_id, v_right);
    ELSIF p_spec ? ('b' || CASE it.module WHEN '1' THEN '1' ELSE '2' END) THEN
      -- explicit blank budget (§28.8): the first b wrongs of the module are
      -- blank (no row), the remaining wrongs are answered wrong.
      IF v_blanks[CASE it.module WHEN '1' THEN 1 ELSE 2 END] > 0 THEN
        v_blanks[CASE it.module WHEN '1' THEN 1 ELSE 2 END] := v_blanks[CASE it.module WHEN '1' THEN 1 ELSE 2 END] - 1;
      ELSE
        PERFORM pg_temp.scoring_fixture_answer(p_session, p_section, it.module, it.ordinal, it.question_id, v_bad);
      END IF;
    ELSE
      CASE v_kind % 4
        WHEN 0 THEN NULL;  -- blank: no row
        WHEN 1 THEN PERFORM pg_temp.scoring_fixture_answer(p_session, p_section, it.module, it.ordinal, it.question_id, NULL);
        WHEN 2 THEN PERFORM pg_temp.scoring_fixture_answer(p_session, p_section, it.module, it.ordinal, it.question_id, v_bad);
        ELSE        PERFORM pg_temp.scoring_fixture_answer(p_session, p_section, it.module, it.ordinal, v_decoy, v_right);
      END CASE;
      v_kind := v_kind + 1;
    END IF;
  END LOOP;

  IF v_r1 > (SELECT count(*) FROM public.test_form_items
              WHERE test_form_id = p_form AND section = p_section AND module = '1')
     OR v_left[1] <> 0 OR v_left[2] <> 0 OR v_left[3] <> 0 THEN
    RAISE EXCEPTION 'scoring_fixture_section: pattern % does not fit the form (unplaced wrongs %)', p_spec, v_left;
  END IF;

  -- Presented-item noise: none of these may count.
  FOR it IN
    SELECT i.ordinal, i.question_id, q.item_type
      FROM public.test_form_items i JOIN public.questions q ON q.id = i.question_id
     WHERE i.test_form_id = p_form AND i.section = p_section AND i.module = v_other
  LOOP
    PERFORM pg_temp.scoring_fixture_answer(p_session, p_section, v_other, it.ordinal, it.question_id,
                                           CASE it.item_type WHEN 'grid_in' THEN '1' ELSE 'A' END);
  END LOOP;
  PERFORM pg_temp.scoring_fixture_answer(p_session, p_section, '1', 90, v_decoy, 'A');
END $f$;

CREATE FUNCTION pg_temp.scoring_fixture_session(p_session uuid, p_student uuid, p_form uuid,
                                                p_rw jsonb, p_m jsonb)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_both boolean := p_rw IS NOT NULL AND p_m IS NOT NULL; v_event uuid;
BEGIN
  -- actor_id: the student's grouping id, as exam_create_session stamps it (E6b)
  INSERT INTO public.test_sessions (id, student_id, actor_id, test_form_id, state, mode, started_at,
      completed_at, abandoned_at, grace_expires_at, attempt_number_for_form, is_first_seen_form_attempt)
  VALUES (p_session, p_student, (SELECT actor_id FROM public.profiles WHERE id = p_student), p_form,
          CASE WHEN v_both THEN 'completed' ELSE 'partial_scored_abandoned' END, 'strict', now(),
          CASE WHEN v_both THEN now() END, CASE WHEN v_both THEN NULL ELSE now() END,
          now(), 1, true);
  PERFORM pg_temp.scoring_fixture_section(p_session, p_form, 'RW', p_rw);
  PERFORM pg_temp.scoring_fixture_section(p_session, p_form, 'M',  p_m);
  INSERT INTO public.exam_runtime_outbox (event_type, aggregate_id, payload)
  VALUES (CASE WHEN v_both THEN 'test_session_completed' ELSE 'test_session_partial_scored_abandoned' END,
          p_session, jsonb_build_object('test_session_id', p_session))
  RETURNING id INTO v_event;
  RETURN v_event;
END $f$;
