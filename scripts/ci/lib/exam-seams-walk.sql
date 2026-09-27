-- ============================================================================
-- Shared fixture: sit a whole exam through the E6 runtime functions, then drain
-- the outbox exactly as the API does (scoring, then the seams it enqueues).
--
-- @spec [SCL-154 .. SCL-170] | @implemented [2026-09-25]
--
-- plain English: defines pg_temp.answer_mixed, pg_temp.walk and pg_temp.drain.
--   Extracted verbatim from scripts/ci/exam-seams-gates.sql (E9) when the E9b
--   calendar gate needed the same exam, so the walk exists once. Requires
--   lib/exam-form-fixture.sql and lib/exam-walk-fixture.sql (\ir'd first).
--
-- Answer pattern per module, by ordinal % 4:
--   0 correct · 1 wrong · 2 never answered (no row) · 3 explicit omit (NULL).
-- ============================================================================

-- Serve the ACTIVE module (as answer_module does) and answer it by pattern.
CREATE FUNCTION pg_temp.answer_mixed(p_student uuid, p_session uuid, p_section text, p_module text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE it record; v jsonb; v_phys text;
BEGIN
  v_phys := public.exam_physical_module(p_session, p_section, p_module);
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
  IF (v->>'status')::int <> 200 THEN RAISE EXCEPTION 'E9G FAIL [fixture]: record options %', v; END IF;
  FOR it IN
    SELECT fi.ordinal, fi.question_id, q.item_type
      FROM public.test_sessions s
      JOIN public.test_form_items fi ON fi.test_form_id = s.test_form_id
      JOIN public.questions q ON q.id = fi.question_id
     WHERE s.id = p_session AND fi.section = p_section AND fi.module = v_phys
     ORDER BY fi.ordinal
  LOOP
    CONTINUE WHEN it.ordinal % 4 = 2;                          -- never answered
    v := public.exam_submit_answer(p_student, p_session, p_section, p_module, it.ordinal, it.question_id,
           CASE it.ordinal % 4
             WHEN 0 THEN CASE WHEN it.item_type = 'grid_in' THEN '1' ELSE 'A' END   -- correct
             WHEN 1 THEN CASE WHEN it.item_type = 'grid_in' THEN '2' ELSE 'B' END   -- wrong
             ELSE NULL END,                                                          -- explicit omit
           'display', 1000, 'mix:' || p_session::text || ':' || p_section || ':' || v_phys || ':' || it.ordinal);
    IF (v->>'status')::int <> 200 THEN RAISE EXCEPTION 'E9G FAIL [fixture]: answer refused %', v; END IF;
  END LOOP;
END $f$;

CREATE FUNCTION pg_temp.walk(p_student uuid, p_form uuid, p_mode text, p_sections text[])
RETURNS uuid LANGUAGE plpgsql AS $f$
-- Walks the named sections (both modules each, mixed answers). Returns the
-- session id; a walk of both sections completes the session.
DECLARE v jsonb; v_sid uuid; sec text; m text;
BEGIN
  v := public.exam_create_session(p_student, p_form, p_mode);
  v_sid := (v->'body'->>'session_id')::uuid;
  FOREACH sec IN ARRAY p_sections LOOP
    FOREACH m IN ARRAY ARRAY['1', '2'] LOOP
      PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p_student, v_sid, sec, m), 200);
      PERFORM pg_temp.answer_mixed(p_student, v_sid, sec, m);
      PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p_student, v_sid, sec, m), 200);
    END LOOP;
  END LOOP;
  RETURN v_sid;
END $f$;

-- Consume every pending outbox event (scoring, then the seams it enqueues),
-- exactly as the API does: each event its own call.
CREATE FUNCTION pg_temp.drain() RETURNS int LANGUAGE plpgsql AS $f$
DECLARE e record; n int := 0; v jsonb;
BEGIN
  LOOP
    SELECT id INTO e FROM public.exam_runtime_outbox WHERE status = 'pending' ORDER BY created_at, id LIMIT 1;
    EXIT WHEN NOT FOUND;
    v := public.exam_score_outbox_event(e.id);
    IF NOT (v->>'ok')::boolean THEN RETURN -1; END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $f$;

