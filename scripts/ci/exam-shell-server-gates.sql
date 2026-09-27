-- ============================================================================
-- E7a gate — exam shell server: workspace, resume position, forms list, report
-- ============================================================================
-- @spec [Doc-04A_V2.2, §8.3 + §15.1 (SCL-146), §16 (SCL-145, SCL-147)]
--       [Doc-04C_V1.0, §5.3, §15.2, §16.6] [Doc-04B_V4.3 §17.1] [Doc-05E INV-05E-04]
-- @implemented [2026-09-25]
--
-- plain English: drives the E7a SQL functions the API calls, as the server would,
--   on a fresh apply. Workspace: a round trip of served tokens, and every refusal
--   (a canonical letter, another item's token, a repeat, a grid-in elimination, a
--   highlight outside the passage, an unserved item, a submitted module, someone
--   else's session). Resume position: written by the heartbeat, read back only in
--   the module it names. Forms list: published + selectable, drafts never, no
--   thresholds. Report source: 403 for missing and foreign alike; failure stand-in;
--   disclosure bound to the score's version and seeded with 04B §17.1 verbatim.
--
-- Output contract (read by exam-shell-server-gates.sh): one "ok   [ID] ..." per
--   passing check; a failure raises "E7A FAIL [ID] ...".
-- ============================================================================
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

\ir lib/exam-form-fixture.sql
\ir lib/exam-walk-fixture.sql

-- ---------------------------------------------------------------------------
-- Fixtures: a published form, a draft form, students A and B.
--   A: RW Module 1 active (items served) — the workspace / resume subject.
--   B: a whole scored exam — the forms-list / report subject.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e7a01', 'e7a-a@example.com'),
  ('00000000-0000-0000-0000-0000000e7b02', 'e7a-b@example.com');
SELECT pg_temp.exam_fixture_make_form('e7af0000-0000-4000-8000-000000000001', 'S1', 20, 15);
UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'Practice Test 1'
 WHERE id = 'e7af0000-0000-4000-8000-000000000001';
SELECT pg_temp.exam_fixture_make_form('e7af0000-0000-4000-8000-000000000002', 'S2', 20, 15);  -- stays draft

CREATE TEMP TABLE _a (session_id uuid);
DO $$
DECLARE v jsonb; v_sid uuid; a uuid := '00000000-0000-0000-0000-0000000e7a01';
BEGIN
  v := public.exam_create_session(a, 'e7af0000-0000-4000-8000-000000000001', 'lenient');
  v_sid := (v->'body'->>'session_id')::uuid;
  INSERT INTO _a VALUES (v_sid);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(a, v_sid, 'RW', '1'), 200);
  -- serve the module (persist the shuffle) exactly as answer_module does, without answering
  v := public.exam_record_item_options(a, v_sid, 'RW', '1', (
         SELECT jsonb_agg(jsonb_build_object(
                  'ordinal', fi.ordinal, 'question_id', fi.question_id,
                  'option_order', '["D","C","B","A"]'::jsonb,
                  'option_token_map', jsonb_build_object(
                      'opt_' || fi.ordinal || 'd', 'D', 'opt_' || fi.ordinal || 'c', 'C',
                      'opt_' || fi.ordinal || 'b', 'B', 'opt_' || fi.ordinal || 'a', 'A')))
           FROM public.test_form_items fi
          WHERE fi.test_form_id = 'e7af0000-0000-4000-8000-000000000001'
            AND fi.section = 'RW' AND fi.module = '1' AND fi.ordinal < 10));
  PERFORM pg_temp.expect_status('fixture', v, 200);
  -- item 0 gets a passage to highlight (10 code points, one of them astral)
  UPDATE public.questions q SET passage = 'Kelp 𝑥 grows'
    FROM public.test_form_items fi
   WHERE fi.question_id = q.id AND fi.test_form_id = 'e7af0000-0000-4000-8000-000000000001'
     AND fi.section = 'RW' AND fi.module = '1' AND fi.ordinal = 0;
  UPDATE public.questions q SET passage = NULL
    FROM public.test_form_items fi
   WHERE fi.question_id = q.id AND fi.test_form_id = 'e7af0000-0000-4000-8000-000000000001'
     AND fi.section = 'RW' AND fi.module = '1' AND fi.ordinal = 1;

  v := to_jsonb(pg_temp.complete_session('00000000-0000-0000-0000-0000000e7b02',
            'e7af0000-0000-4000-8000-000000000001', 'strict', true, true));
  IF NOT (public.exam_score_outbox_event((v #>> '{}')::uuid)->>'ok')::boolean THEN
    RAISE EXCEPTION 'E7A FAIL [fixture]: scoring B';
  END IF;
END $$;

\set A '''00000000-0000-0000-0000-0000000e7a01'''
\set B '''00000000-0000-0000-0000-0000000e7b02'''

CREATE FUNCTION pg_temp.ws(p_student uuid, p_ordinal int, p_marked boolean, p_elim text[], p_hl jsonb,
                           p_section text DEFAULT 'RW', p_module text DEFAULT '1') RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT public.exam_save_item_workspace(p_student, (SELECT session_id FROM _a), p_section, p_module,
                                         p_ordinal, p_marked, p_elim, p_hl)
$f$;

-- ---------------------------------------------------------------------------
-- W1 — round trip: served tokens saved and read back; a full PUT replaces
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; r jsonb;
BEGIN
  v := pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, true, ARRAY['opt_0b', 'opt_0d'],
                  '[{"start":0,"end":4},{"start":5,"end":6}]');
  PERFORM pg_temp.expect_status('W1', v, 200);
  v := pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 2, false, ARRAY['opt_2a'], '[]');
  PERFORM pg_temp.expect_status('W1', v, 200);
  v := pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 2, false, ARRAY['opt_2c'], '[]');  -- replaces
  r := public.exam_module_workspace('00000000-0000-0000-0000-0000000e7a01', (SELECT session_id FROM _a), 'RW', '1');
  IF r->'body'->'items' IS DISTINCT FROM '[{"ordinal":0,"highlights":[{"end":4,"start":0},{"end":6,"start":5}],"marked_for_review":true,"eliminated_option_ids":["opt_0b","opt_0d"]},{"ordinal":2,"highlights":[],"marked_for_review":false,"eliminated_option_ids":["opt_2c"]}]'::jsonb THEN
    RAISE EXCEPTION 'E7A FAIL [W1]: read back %', r->'body'->'items';
  END IF;
  IF (SELECT count(*) FROM public.test_session_item_workspace) IS DISTINCT FROM 2 + (SELECT count(*) FROM public.test_session_item_workspace w JOIN public.test_sessions s ON s.id = w.test_session_id WHERE s.student_id = '00000000-0000-0000-0000-0000000e7b02') THEN
    RAISE EXCEPTION 'E7A FAIL [W1]: a replay added a row';
  END IF;
  PERFORM pg_temp.ok('W1', 'tokens + highlights saved and read back; a second PUT replaced the row (2 rows for A)');
END $$;

-- ---------------------------------------------------------------------------
-- W2 — elimination stays on the shuffle: letters, foreign tokens, repeats and
--      grid-in eliminations are refused 400 invalid_workspace
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_grid int;
BEGIN
  PERFORM pg_temp.expect_status('W2', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, ARRAY['A'], '[]'), 400, 'invalid_workspace');
  PERFORM pg_temp.expect_status('W2', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, ARRAY['opt_3a'], '[]'), 400, 'invalid_workspace');
  PERFORM pg_temp.expect_status('W2', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, ARRAY['opt_0a', 'opt_0a'], '[]'), 400, 'invalid_workspace');
  -- a grid-in item of Math M1 is not active; prove the grid-in rule on a served RW
  -- item turned grid-in in place
  UPDATE public.questions q SET item_type = 'grid_in', correct_variants = ARRAY['1'], options = '[]'::jsonb
    FROM public.test_form_items fi
   WHERE fi.question_id = q.id AND fi.test_form_id = 'e7af0000-0000-4000-8000-000000000001'
     AND fi.section = 'RW' AND fi.module = '1' AND fi.ordinal = 9;
  PERFORM pg_temp.expect_status('W2', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 9, false, ARRAY['opt_9a'], '[]'), 400, 'invalid_workspace');
  PERFORM pg_temp.ok('W2', 'canonical letter, another item''s token, a repeat, a grid-in elimination -> all 400 invalid_workspace');
END $$;

-- ---------------------------------------------------------------------------
-- W3 — highlights are code-point offsets inside the passage
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- 'Kelp 𝑥 grows' is 12 code points (𝑥 is one), 13 UTF-16 units
  PERFORM pg_temp.expect_status('W3', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, '{}', '[{"start":5,"end":12}]'), 200);
  PERFORM pg_temp.expect_status('W3', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, '{}', '[{"start":5,"end":13}]'), 400, 'invalid_workspace');
  PERFORM pg_temp.expect_status('W3', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, '{}', '[{"start":4,"end":4}]'), 400, 'invalid_workspace');
  PERFORM pg_temp.expect_status('W3', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, '{}', '[{"start":1,"end":2,"note":"x"}]'), 400, 'invalid_workspace');
  PERFORM pg_temp.expect_status('W3', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 1, false, '{}', '[{"start":0,"end":1}]'), 400, 'invalid_workspace');
  PERFORM pg_temp.ok('W3', 'end = char_length accepted (code points), end past it / empty range / an extra key (no notes) / no passage -> 400');
END $$;

-- ---------------------------------------------------------------------------
-- W4 — only served items, only the active module, only the owner
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect_status('W4', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 20, false, '{}', '[]'), 409, 'session_item_mapping_missing');
  PERFORM pg_temp.expect_status('W4', pg_temp.ws('00000000-0000-0000-0000-0000000e7a01', 0, false, '{}', '[]', 'M', '1'), 409, 'module_not_started');
  PERFORM pg_temp.expect_status('W4', pg_temp.ws('00000000-0000-0000-0000-0000000e7b02', 0, false, '{}', '[]'), 403, 'forbidden');
  PERFORM pg_temp.expect_status('W4', public.exam_module_workspace('00000000-0000-0000-0000-0000000e7b02', (SELECT session_id FROM _a), 'RW', '1'), 403, 'forbidden');
  PERFORM pg_temp.ok('W4', 'unserved item 409 session_item_mapping_missing; inactive module 409; another student 403 (write and read)');
END $$;

-- ---------------------------------------------------------------------------
-- H1 — the heartbeat's resume position: written, read back in its module only
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; a uuid := '00000000-0000-0000-0000-0000000e7a01'; sid uuid := (SELECT session_id FROM _a);
BEGIN
  PERFORM pg_temp.expect_status('H1', public.exam_heartbeat(a, sid, 'RW', 7), 200);
  v := public.exam_session_state(a, sid);
  IF (v->'body'->'sections'->0->>'current_ordinal')::int IS DISTINCT FROM 7
     OR v->'body'->'sections'->1->'current_ordinal' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'E7A FAIL [H1]: state sections %', v->'body'->'sections';
  END IF;
  PERFORM pg_temp.expect_status('H1', public.exam_heartbeat(a, sid, 'RW'), 200);           -- E6 shape
  v := public.exam_session_state(a, sid);
  IF (v->'body'->'sections'->0->>'current_ordinal')::int IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'E7A FAIL [H1]: a heartbeat without ordinal cleared the position';
  END IF;
  PERFORM pg_temp.expect_status('H1', public.exam_heartbeat(a, sid, 'RW', 99), 400, 'invalid_request');
  PERFORM pg_temp.expect_status('H1', public.exam_heartbeat(a, sid, 'M', 0), 400, 'invalid_request');
  IF v::text ~ '"2A"|"2B"|module2_path"' THEN RAISE EXCEPTION 'E7A FAIL [H1]: state names a path'; END IF;
  PERFORM pg_temp.ok('H1', 'heartbeat ordinal 7 -> state RW current_ordinal 7, M null; empty heartbeat keeps it; ordinal outside the active module -> 400');
END $$;

-- ---------------------------------------------------------------------------
-- H2 — a later module never inherits the position; submitted module refuses
--      workspace writes and reads (the module cannot be re-entered)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; a uuid := '00000000-0000-0000-0000-0000000e7a01'; sid uuid := (SELECT session_id FROM _a);
BEGIN
  PERFORM pg_temp.expect_status('H2', public.exam_submit_module(a, sid, 'RW', '1'), 200);
  PERFORM pg_temp.expect_status('H2', public.exam_start_module(a, sid, 'RW', '2'), 200);
  v := public.exam_session_state(a, sid);
  IF v->'body'->'sections'->0->'current_ordinal' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'E7A FAIL [H2]: Module 2 read Module 1''s position %', v->'body'->'sections'->0;
  END IF;
  PERFORM pg_temp.expect_status('H2', pg_temp.ws(a, 0, true, '{}', '[]'), 409, 'module_submitted');
  PERFORM pg_temp.expect_status('H2', public.exam_module_workspace(a, sid, 'RW', '1'), 409, 'module_submitted');
  IF NOT EXISTS (SELECT 1 FROM public.test_session_item_workspace WHERE test_session_id = sid AND module = '1' AND ordinal = 0 AND marked_for_review = false) THEN
    RAISE EXCEPTION 'E7A FAIL [H2]: the Module 1 workspace changed after submit';
  END IF;
  PERFORM pg_temp.ok('H2', 'Module 2 starts with current_ordinal null; Module 1 workspace write + read after submit -> 409 module_submitted, row unchanged');
END $$;

-- ---------------------------------------------------------------------------
-- F1 — forms list: published + selectable, never a draft, B's latest session
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; f jsonb;
BEGIN
  v := public.exam_list_forms('00000000-0000-0000-0000-0000000e7b02');
  IF jsonb_array_length(v->'body'->'forms') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'E7A FAIL [F1]: % forms listed (want 1: the draft is never listed)', jsonb_array_length(v->'body'->'forms');
  END IF;
  f := v->'body'->'forms'->0;
  IF f->>'name' IS DISTINCT FROM 'Practice Test 1'
     OR (f->>'question_count')::int IS DISTINCT FROM 98
     OR f->'latest_session'->>'state' IS DISTINCT FROM 'completed'
     OR (f->'latest_session'->>'score_total_present')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'E7A FAIL [F1]: %', f;
  END IF;
  IF v::text ~ 'routing_threshold|score_table_version|module2_path|"2A"|"2B"|student_id' THEN
    RAISE EXCEPTION 'E7A FAIL [F1]: the listing carries an internal field';
  END IF;
  IF public.exam_list_forms('00000000-0000-0000-0000-0000000e7a01')->'body'->'forms'->0->'latest_session'->>'state' IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'E7A FAIL [F1]: A''s latest session is not the one A owns';
  END IF;
  PERFORM pg_temp.ok('F1', 'one published form listed (draft never), 98 questions, B latest session completed + scored, A sees A''s own; no thresholds / versions / paths / ids');
END $$;

-- ---------------------------------------------------------------------------
-- R1 — report source: 403 for missing and foreign alike (§16.6); the owner
--      reads session, score, and the v1.0 disclosure seeded from 04B §17.1
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; b_sid uuid;
BEGIN
  SELECT id INTO b_sid FROM public.test_sessions WHERE student_id = '00000000-0000-0000-0000-0000000e7b02';
  PERFORM pg_temp.expect_status('R1', public.exam_report_source('00000000-0000-0000-0000-0000000e7a01', b_sid), 403, 'forbidden');
  PERFORM pg_temp.expect_status('R1', public.exam_report_source('00000000-0000-0000-0000-0000000e7a01', gen_random_uuid()), 403, 'forbidden');
  IF public.exam_report_source('00000000-0000-0000-0000-0000000e7a01', b_sid)::text
     IS DISTINCT FROM public.exam_report_source('00000000-0000-0000-0000-0000000e7a01', gen_random_uuid())::text THEN
    RAISE EXCEPTION 'E7A FAIL [R1]: missing and foreign sessions are distinguishable';
  END IF;
  v := public.exam_report_source('00000000-0000-0000-0000-0000000e7b02', b_sid);
  IF (v->'body'->'score_run'->>'total_scaled')::int IS DISTINCT FROM 1600
     OR v->'body'->'failure' IS DISTINCT FROM 'null'::jsonb
     OR v->'body'->'disclosure'->>'summary' IS DISTINCT FROM 'Lyceon-modeled SAT score. Designed to approximate Digital SAT score ranges using Lyceon''s internal scoring model. This is not an official College Board score prediction and may differ from official SAT scores by ±20-50 points or more.' THEN
    RAISE EXCEPTION 'E7A FAIL [R1]: %', v->'body';
  END IF;
  IF v::text ~ 'module2_path|_module1_correct|_wrong|source_outbox|routing_threshold|student_id|actor_id' THEN
    RAISE EXCEPTION 'E7A FAIL [R1]: the report source carries a redacted field';
  END IF;
  PERFORM pg_temp.ok('R1', 'foreign and missing sessions -> the same 403; owner reads total 1600 with the 04B §17.1 disclosure verbatim; no decomposition, path, outbox link or identity');
END $$;

-- ---------------------------------------------------------------------------
-- R2 — the failure stand-in (D6): a dead-lettered outbox row with no score run
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE v jsonb; sid uuid;
BEGIN
  SELECT id INTO sid FROM public.test_sessions WHERE student_id = '00000000-0000-0000-0000-0000000e7b02';
  ALTER TABLE public.score_runs DISABLE TRIGGER trg_prevent_score_runs_delete;
  DELETE FROM public.score_runs WHERE test_session_id = sid;
  UPDATE public.exam_runtime_outbox SET status = 'failed', attempts = 5, last_attempt_at = now() WHERE aggregate_id = sid;
  v := public.exam_report_source('00000000-0000-0000-0000-0000000e7b02', sid);
  IF v->'body'->'failure'->>'outbox_id' IS NULL
     OR v->'body'->'score_run' IS DISTINCT FROM 'null'::jsonb
     OR v->'body'->'disclosure' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'E7A FAIL [R2]: %', v->'body';
  END IF;
  PERFORM pg_temp.ok('R2', 'dead-lettered outbox + no score run -> failure present, no score, no disclosure');
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- G1 — privileges: students never touch the new tables or functions directly
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; v_bad text := '';
BEGIN
  FOR r IN SELECT unnest(ARRAY['test_session_item_workspace', 'score_disclosure_versions']) AS t LOOP
    IF has_table_privilege('authenticated', 'public.' || r.t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || r.t, 'SELECT') THEN
      v_bad := v_bad || r.t || ' ';
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY[
      'public.exam_heartbeat(uuid, uuid, text, int)',
      'public.exam_module_workspace(uuid, uuid, text, text)',
      'public.exam_save_item_workspace(uuid, uuid, text, text, int, boolean, text[], jsonb)',
      'public.exam_list_forms(uuid)',
      'public.exam_report_source(uuid, uuid)']) AS f LOOP
    IF has_function_privilege('authenticated', r.f, 'EXECUTE') OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.f, 'EXECUTE') THEN
      v_bad := v_bad || r.f || ' ';
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.test_session_items', 'UPDATE') THEN
    v_bad := v_bad || 'test_session_items-UPDATE ';
  END IF;
  IF to_regprocedure('public.exam_heartbeat(uuid, uuid, text)') IS NOT NULL THEN
    v_bad := v_bad || 'old-3-arg-heartbeat ';
  END IF;
  IF v_bad <> '' THEN RAISE EXCEPTION 'E7A FAIL [G1]: %', v_bad; END IF;
  PERFORM pg_temp.ok('G1', 'workspace + disclosure tables unreadable by anon/authenticated; 5 functions service_role-only; the shuffle pin still has no UPDATE; the 3-arg heartbeat is gone');
END $$;
