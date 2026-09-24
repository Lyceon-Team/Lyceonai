-- ============================================================================
-- Shared CI fixture: a whole exam walked through the E6 runtime functions
-- ============================================================================
-- @spec [Doc-04A_V2.2, §7.3, §8.5, §11.2, §12] | @implemented [2026-09-24]
--
-- plain English: the helpers the E6 gate used to define inline, moved here
--   verbatim so the E6b deletion gate walks exams the same way (one copy):
--     pg_temp.ok(id, msg)                     -> NOTICE 'ok   [id] msg'
--     pg_temp.expect_status(id, res, status, code)
--     pg_temp.answer_module(student, session, section, module, correct)
--     pg_temp.complete_session(student, form, mode, rw_correct, m_correct)
--       -> the completion outbox id (the session is NOT scored here).
--   Requires lib/exam-form-fixture.sql to be included first.
-- ============================================================================

CREATE FUNCTION pg_temp.ok(p_id text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE NOTICE 'ok   [%] %', p_id, p_msg; END $f$;

CREATE FUNCTION pg_temp.expect_status(p_id text, p_res jsonb, p_status int, p_code text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF (p_res->>'status')::int IS DISTINCT FROM p_status
     OR (p_code IS NOT NULL AND p_res->'error'->>'code' IS DISTINCT FROM p_code) THEN
    RAISE EXCEPTION 'E6G FAIL [%]: wanted % %, got %', p_id, p_status, COALESCE(p_code, ''), p_res;
  END IF;
END $f$;

-- Answer every item of the ACTIVE module: 'A'/'1' (correct) or 'B'/'2' (wrong).
CREATE FUNCTION pg_temp.answer_module(p_student uuid, p_session uuid, p_section text,
                                      p_module text, p_correct boolean) RETURNS int
LANGUAGE plpgsql AS $f$
DECLARE it record; v jsonb; n int := 0; v_phys text;
BEGIN
  v_phys := public.exam_physical_module(p_session, p_section, p_module);
  -- what the server does on first serve: persist a shuffle per item (grid-in: none)
  v := public.exam_record_item_options(p_student, p_session, p_section, p_module, (
         SELECT jsonb_agg(jsonb_build_object(
                  'ordinal', fi.ordinal, 'question_id', fi.question_id,
                  'option_order', CASE WHEN q.item_type = 'mcq' THEN '["D","C","B","A"]'::jsonb END,
                  'option_token_map', CASE WHEN q.item_type = 'mcq' THEN jsonb_build_object(
                      'opt_' || fi.ordinal || 'd', 'D', 'opt_' || fi.ordinal || 'c', 'C',
                      'opt_' || fi.ordinal || 'b', 'B', 'opt_' || fi.ordinal || 'a', 'A') END))
           FROM public.test_sessions s
           JOIN public.test_form_items fi ON fi.test_form_id = s.test_form_id
           JOIN public.questions q ON q.id = fi.question_id
          WHERE s.id = p_session AND fi.section = p_section AND fi.module = v_phys));
  IF (v->>'status')::int <> 200 THEN RAISE EXCEPTION 'E6G FAIL [fixture]: record options %', v; END IF;
  FOR it IN
    SELECT fi.ordinal, fi.question_id, q.item_type
      FROM public.test_sessions s
      JOIN public.test_form_items fi ON fi.test_form_id = s.test_form_id
      JOIN public.questions q ON q.id = fi.question_id
     WHERE s.id = p_session AND fi.section = p_section AND fi.module = v_phys
     ORDER BY fi.ordinal
  LOOP
    v := public.exam_submit_answer(p_student, p_session, p_section, p_module, it.ordinal, it.question_id,
           CASE WHEN it.item_type = 'grid_in' THEN (CASE WHEN p_correct THEN '1' ELSE '2' END)
                ELSE (CASE WHEN p_correct THEN 'A' ELSE 'B' END) END,
           'display', 1000, p_session::text || ':' || p_section || ':' || v_phys || ':' || it.ordinal);
    IF (v->>'status')::int <> 200 THEN RAISE EXCEPTION 'E6G FAIL [fixture]: answer refused %', v; END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $f$;

-- A whole exam through the runtime functions. Returns the completion outbox id.
CREATE FUNCTION pg_temp.complete_session(p_student uuid, p_form uuid, p_mode text,
                                         p_rw_correct boolean, p_m_correct boolean) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v jsonb; v_sid uuid;
BEGIN
  v := public.exam_create_session(p_student, p_form, p_mode);
  v_sid := (v->'body'->>'session_id')::uuid;
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p_student, v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.answer_module(p_student, v_sid, 'RW', '1', p_rw_correct);
  PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p_student, v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p_student, v_sid, 'RW', '2'), 200);
  PERFORM pg_temp.answer_module(p_student, v_sid, 'RW', '2', p_rw_correct);
  PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p_student, v_sid, 'RW', '2'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p_student, v_sid, 'M', '1'), 200);
  PERFORM pg_temp.answer_module(p_student, v_sid, 'M', '1', p_m_correct);
  PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p_student, v_sid, 'M', '1'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p_student, v_sid, 'M', '2'), 200);
  PERFORM pg_temp.answer_module(p_student, v_sid, 'M', '2', p_m_correct);
  v := public.exam_submit_module(p_student, v_sid, 'M', '2');
  PERFORM pg_temp.expect_status('fixture', v, 200);
  RETURN (v->'outbox_ids'->>0)::uuid;
END $f$;
