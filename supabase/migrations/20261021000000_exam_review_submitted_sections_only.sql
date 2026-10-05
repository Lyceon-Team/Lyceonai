-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Exam -> review: only a fully submitted section feeds the review queue.
--
-- @spec [SCL-205 (owner ruling 2026-10-03; amends SCL-158's "Module 1 once
--        `module1_submitted`"); Doc-04C §13.3 and §4.3 ("Sections in `module1_submitted`
--        state are NOT review-eligible even though Module 1 answers exist"); Doc-05 Parent
--        §11.4 ("Module-1-only partials do not feed mastery")]
-- | @implemented [2026-10-03]
--
-- plain English: `exam_apply_scored_seams` (20260930110000 §7) queued the misses and
-- blanks of Module 1 as soon as a section reached `module1_submitted`. An abandoned exam
-- whose second section stopped after Module 1 therefore put that half-section into the
-- student's review queue. The owner ruled: a section's questions go to review only once
-- every module of it was submitted. The review loop's predicate becomes
-- `sec.state = 'submitted'` for both modules. Nothing else in the function changes:
--   - a completed exam: both sections are `submitted`, so it queues exactly what it did;
--   - `partial_scored_abandoned`: only the submitted section(s) queue — the same sections
--     that are scored, reviewable (04C §13.3) and feed mastery (full_length_answer_events
--     already filters `sec.state = 'submitted'`), so all three seams now agree;
--   - `abandoned_final` never reaches the seams (no outbox row), unchanged.
-- No percentage or answered-count threshold exists or is added (owner ruling: none).
-- Rows already queued in production from Module-1-only sections are NOT touched here;
-- removing them is a data change the owner decides separately (SCL-205 owner action).
-- CREATE OR REPLACE keeps the function's ACL (service_role only, 20260930110000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exam_apply_scored_seams(p_outbox_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_ev      exam_runtime_outbox%ROWTYPE;
  v_run     score_runs%ROWTYPE;
  v_s       test_sessions%ROWTYPE;
  v_at      timestamptz;
  v_review  int := 0;
  v_mastery int := 0;
  v_proj    int := 0;
  it        record;
BEGIN
  SELECT * INTO v_ev FROM exam_runtime_outbox
   WHERE id = p_outbox_event_id AND event_type = 'test_session_scored';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXAM_SEAMS_EVENT_NOT_FOUND: %', p_outbox_event_id;
  END IF;

  SELECT * INTO v_run FROM score_runs WHERE id = (v_ev.payload ->> 'score_run_id')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXAM_SEAMS_SCORE_RUN_NOT_FOUND: %', v_ev.payload ->> 'score_run_id';
  END IF;
  SELECT * INTO v_s FROM test_sessions WHERE id = v_run.test_session_id;

  -- E6b: identity is read when the seams run, never carried in the payload.
  IF v_s.student_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_s.student_id) THEN
    RETURN jsonb_build_object('outcome', 'skipped_no_student',
                              'review_enqueued', 0, 'mastery_applied', 0, 'projection_outbox', 0);
  END IF;

  v_at := COALESCE(v_s.completed_at, v_s.abandoned_at, v_run.computed_at);

  -- R4 — review: served items of SUBMITTED SECTIONS (SCL-205), wrong or blank.
  FOR it IN
    SELECT i.section, i.module, i.ordinal, i.question_id, a.answer
      FROM test_session_items i
      JOIN test_session_sections sec
        ON sec.test_session_id = i.test_session_id AND sec.section = i.section
      LEFT JOIN test_session_answers a
        ON a.test_session_id = i.test_session_id AND a.section = i.section
       AND a.module = i.module AND a.ordinal = i.ordinal
     WHERE i.test_session_id = v_s.id
       AND sec.state = 'submitted'   -- SCL-205: both modules submitted, or nothing
       AND NOT is_answer_correct(a.answer, i.question_id)
     ORDER BY CASE i.section WHEN 'RW' THEN 1 ELSE 2 END, i.module, i.ordinal
  LOOP
    PERFORM review_queue_record(
      v_s.student_id, it.question_id, 'full_length', v_s.id,
      md5('full_length:' || v_s.id::text || ':' || it.section || ':' || it.module || ':' || it.ordinal::text)::uuid,
      CASE WHEN it.answer IS NULL OR btrim(it.answer) = '' THEN 'skipped' ELSE 'incorrect' END,
      v_at);
    v_review := v_review + 1;
  END LOOP;

  -- R3 — mastery: the answered items of submitted sections.
  FOR it IN
    SELECT * FROM full_length_answer_events fe
     WHERE fe.test_session_id = v_s.id
     ORDER BY fe.occurred_at, fe.event_id
  LOOP
    PERFORM apply_mastery_event(
      v_s.student_id, it.section, it.domain, it.skill, it.difficulty,
      it.source_family, it.event_source_kind, it.correct, it.occurred_at,
      it.event_id, it.question_id, 'submitted');
    v_mastery := v_mastery + 1;
  END LOOP;

  -- R2 — projection refresh request: a COMPLETED session only.
  IF v_s.state = 'completed' THEN
    INSERT INTO projection_refresh_outbox (student_id, reason, test_session_id)
    VALUES (v_s.student_id, 'full_length_completed', v_s.id)
    ON CONFLICT (test_session_id) WHERE test_session_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_proj = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('outcome', 'applied',
                            'review_enqueued', v_review,
                            'mastery_applied', v_mastery,
                            'projection_outbox', v_proj);
END;
$$;

