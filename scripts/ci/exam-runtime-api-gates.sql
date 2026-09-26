-- ============================================================================
-- E6 gate — exam runtime API: RLS, timing, routing, idempotency, finalisation
-- ============================================================================
-- @spec [Doc-04A_V2.2, §4 #1 #3 #5 #6 #7 #16, §8.2-§8.4, §9.1-§9.4, §10.2,
--        §11.2-§11.3, §12, §13, §14.3-§14.4, §15.1, §16.1; E6 rulings R1-R6]
-- @implemented [2026-09-24]
--
-- plain English: drives the exam_* functions the API calls, as the server
--   would, and checks each behaviour the E6 brief names. RLS checks run AS
--   `authenticated` with a JWT subject (auth.uid() is re-pointed at
--   request.jwt.claim.sub here, the way Supabase resolves it), never as
--   postgres. "Time passes" by moving a stored deadline into the past: the
--   client never supplies a time anywhere, so every expiry below is decided
--   by clock_timestamp() on the server.
--
-- Output contract (read by exam-runtime-api-gates.sh): one "ok   [ID] ..."
--   NOTICE per passing check; any failure raises "E6G FAIL [ID] ...".
-- ============================================================================
-- Each check is its own statement: one failing check does not stop the rest,
-- so a red run names every check that broke (the runner fails on any missing ok).
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

-- Supabase resolves auth.uid() from the request JWT; do the same here.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$f$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

\ir lib/exam-form-fixture.sql

\ir lib/exam-walk-fixture.sql

-- ---------------------------------------------------------------------------
-- Fixtures: two students, one published form (thresholds RW 20, M 15)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e6a01', 'e6-a@example.com'),
  ('00000000-0000-0000-0000-0000000e6b02', 'e6-b@example.com'),
  ('00000000-0000-0000-0000-0000000e6c03', 'e6-c@example.com'),
  ('00000000-0000-0000-0000-0000000e6d04', 'e6-d@example.com'),
  ('00000000-0000-0000-0000-0000000e6e05', 'e6-e@example.com'),
  ('00000000-0000-0000-0000-0000000e6f06', 'e6-f@example.com'),
  ('00000000-0000-0000-0000-0000000e6a07', 'e6-g@example.com');
SELECT pg_temp.exam_fixture_make_form('e6f00000-0000-4000-8000-000000000001', 'G1', 20, 15);
UPDATE public.test_forms SET status = 'published', published_at = now()
 WHERE id = 'e6f00000-0000-4000-8000-000000000001';
SELECT pg_temp.exam_fixture_make_form('e6f00000-0000-4000-8000-000000000002', 'G2', 20, 15);  -- stays draft

\set A '00000000-0000-0000-0000-0000000e6a01'
\set B '00000000-0000-0000-0000-0000000e6b02'
\set F '''e6f00000-0000-4000-8000-000000000001'''

-- ---------------------------------------------------------------------------
-- W1 walk: A completes (RW all correct -> B; Math all wrong -> A); B completes
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_out uuid; v_score jsonb; r record;
BEGIN
  v_out := pg_temp.complete_session('00000000-0000-0000-0000-0000000e6a01',
             'e6f00000-0000-4000-8000-000000000001', 'lenient', true, false);
  SELECT sec_rw.module2_path AS rw, sec_m.module2_path AS m INTO r
    FROM public.test_sessions s
    JOIN public.test_session_sections sec_rw ON sec_rw.test_session_id = s.id AND sec_rw.section = 'RW'
    JOIN public.test_session_sections sec_m  ON sec_m.test_session_id  = s.id AND sec_m.section  = 'M'
   WHERE s.student_id = '00000000-0000-0000-0000-0000000e6a01';
  IF r.rw <> 'B' OR r.m <> 'A' THEN
    RAISE EXCEPTION 'E6G FAIL [W1]: routing RW=% M=% (want B / A)', r.rw, r.m;
  END IF;
  v_score := public.exam_score_outbox_event(v_out);
  IF NOT (v_score->>'ok')::boolean THEN RAISE EXCEPTION 'E6G FAIL [W1]: scoring %', v_score; END IF;
  PERFORM pg_temp.ok('W1', format('full session: RW 27/27 -> path %s, Math 0/22 -> path %s, scored, outbox published', r.rw, r.m));

  v_out := pg_temp.complete_session('00000000-0000-0000-0000-0000000e6b02',
             'e6f00000-0000-4000-8000-000000000001', 'strict', false, true);
  IF NOT (public.exam_score_outbox_event(v_out)->>'ok')::boolean THEN RAISE EXCEPTION 'E6G FAIL [W1]: scoring B'; END IF;
END $$;

-- OB1: outbox payload is a wakeup signal — no student_id inside the jsonb (R5)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.exam_runtime_outbox WHERE payload ? 'student_id') THEN
    RAISE EXCEPTION 'E6G FAIL [OB1]: an outbox payload carries student_id';
  END IF;
  -- E9: each scored completion also enqueued one 'test_session_scored' event
  -- (SCL-154), whose aggregate is the same session.
  IF (SELECT count(*) FROM public.exam_runtime_outbox o JOIN public.test_sessions s ON s.id = o.aggregate_id
       WHERE o.event_type <> 'test_session_scored') <> 2
     OR (SELECT count(*) FROM public.exam_runtime_outbox o JOIN public.test_sessions s ON s.id = o.aggregate_id
          WHERE o.event_type = 'test_session_scored') <> 2 THEN
    RAISE EXCEPTION 'E6G FAIL [OB1]: aggregate_id does not resolve to the session';
  END IF;
  PERFORM pg_temp.ok('OB1', 'completion payloads carry aggregate_id -> session, no student_id');
END $$;


-- A second published form nobody in this gate has a session on (L7).
SELECT pg_temp.exam_fixture_make_form('e6f00000-0000-4000-8000-000000000003', 'G3', 20, 15);
UPDATE public.test_forms SET status = 'published', published_at = now()
 WHERE id = 'e6f00000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- RLS — as `authenticated` with A's JWT subject, never as postgres.
--   rls_probe(id, table, session_col, probe_grant, mode)
--   mode 'own'      : A sees exactly A's rows (count equal to the postgres
--                     count), and none of B's.
--   mode 'deny_all' : A sees nothing at all.
--   probe_grant     : the table grants authenticated no column, so the policy
--                     is exercised by granting SELECT for this probe only and
--                     revoking it after; the real posture (no grant -> 42501)
--                     is checked separately in L9.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.rls_probe(p_id text, p_table text, p_col text,
                                  p_probe_grant boolean, p_mode text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  v_a uuid[]; v_b uuid[];
  v_own_pg bigint; v_other_pg bigint;
  v_own bigint; v_other bigint; v_total bigint;
BEGIN
  SELECT array_agg(id) INTO v_a FROM public.test_sessions WHERE student_id = '00000000-0000-0000-0000-0000000e6a01';
  SELECT array_agg(id) INTO v_b FROM public.test_sessions WHERE student_id = '00000000-0000-0000-0000-0000000e6b02';
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY ($1)', p_table, p_col) INTO v_own_pg USING v_a;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY ($1)', p_table, p_col) INTO v_other_pg USING v_b;
  IF v_own_pg = 0 OR v_other_pg = 0 THEN
    RAISE EXCEPTION 'E6G FAIL [%]: premise — rows A=% B=% in %', p_id, v_own_pg, v_other_pg, p_table;
  END IF;

  IF p_probe_grant THEN EXECUTE format('GRANT SELECT ON public.%I TO authenticated', p_table); END IF;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000e6a01', false);
  SET ROLE authenticated;
  EXECUTE format('SELECT count(*) FILTER (WHERE %2$I = ANY ($1)), count(*) FILTER (WHERE %2$I = ANY ($2)), count(*) FROM public.%1$I',
                 p_table, p_col) INTO v_own, v_other, v_total USING v_a, v_b;
  RESET ROLE;
  IF p_probe_grant THEN EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', p_table); END IF;

  IF p_mode = 'own' AND (v_other <> 0 OR v_own <> v_own_pg OR v_total <> v_own) THEN
    RAISE EXCEPTION 'E6G FAIL [%]: as A, % shows own %/% and B''s % (total %)', p_id, p_table, v_own, v_own_pg, v_other, v_total;
  END IF;
  IF p_mode = 'deny_all' AND v_total <> 0 THEN
    RAISE EXCEPTION 'E6G FAIL [%]: as A, % shows % rows (want none)', p_id, p_table, v_total;
  END IF;
  PERFORM pg_temp.ok(p_id, format('%s as authenticated(A): own %s/%s, B''s %s/%s visible%s', p_table, v_own, v_own_pg,
                                  v_other, v_other_pg, CASE WHEN p_probe_grant THEN ' (policy probed under a temporary grant)' ELSE '' END));
END $f$;

SELECT pg_temp.rls_probe('L1', 'test_sessions',           'id',              false, 'own');
SELECT pg_temp.rls_probe('L2', 'test_session_sections',   'test_session_id', false, 'own');
SELECT pg_temp.rls_probe('L3', 'test_session_answers',    'test_session_id', false, 'own');
SELECT pg_temp.rls_probe('L4', 'test_answer_submissions', 'test_session_id', false, 'own');
SELECT pg_temp.rls_probe('L5', 'test_session_items',      'test_session_id', true,  'own');
SELECT pg_temp.rls_probe('L6', 'score_runs',              'test_session_id', true,  'own');
SELECT pg_temp.rls_probe('L8', 'exam_runtime_outbox',     'aggregate_id',    true,  'deny_all');

-- L7: forms and form items (catalogue, no student column)
DO $$
DECLARE v_forms int; v_draft int; v_items int; v_items_other int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000e6a01', false);
  SET ROLE authenticated;
  SELECT count(*) FILTER (WHERE status = 'published'), count(*) FILTER (WHERE status <> 'published')
    INTO v_forms, v_draft FROM public.test_forms;
  RESET ROLE;
  IF v_forms <> 2 OR v_draft <> 0 THEN
    RAISE EXCEPTION 'E6G FAIL [L7]: as A, test_forms shows % published / % draft (want 2 / 0)', v_forms, v_draft;
  END IF;

  GRANT SELECT ON public.test_form_items TO authenticated;
  SET ROLE authenticated;
  SELECT count(*) FILTER (WHERE test_form_id = 'e6f00000-0000-4000-8000-000000000001'),
         count(*) FILTER (WHERE test_form_id <> 'e6f00000-0000-4000-8000-000000000001')
    INTO v_items, v_items_other FROM public.test_form_items;
  RESET ROLE;
  REVOKE SELECT ON public.test_form_items FROM authenticated;
  IF v_items <> 147 OR v_items_other <> 0 THEN
    RAISE EXCEPTION 'E6G FAIL [L7]: as A, form items own-form % other % (want 147 / 0)', v_items, v_items_other;
  END IF;
  PERFORM pg_temp.ok('L7', 'test_forms: published only (draft hidden); test_form_items policy: only forms A has a session on (147 / 0), probed under a temporary grant');
END $$;

-- L9: the real grants — what authenticated can NOT read or write at all
CREATE FUNCTION pg_temp.expect_denied(p_id text, p_sql text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_state text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000e6a01', false);
  SET ROLE authenticated;
  BEGIN
    EXECUTE p_sql;
    RESET ROLE;
    RAISE EXCEPTION 'E6G FAIL [%]: accepted: %', p_id, p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
END $f$;
DO $$
BEGIN
  PERFORM pg_temp.expect_denied('L9', 'SELECT module2_path FROM public.test_session_sections');
  PERFORM pg_temp.expect_denied('L9', 'SELECT module FROM public.test_session_answers');
  PERFORM pg_temp.expect_denied('L9', 'SELECT module, response_json FROM public.test_answer_submissions');
  PERFORM pg_temp.expect_denied('L9', 'SELECT routing_threshold_rw FROM public.test_forms');
  PERFORM pg_temp.expect_denied('L9', 'SELECT 1 FROM public.test_form_items');
  PERFORM pg_temp.expect_denied('L9', 'SELECT 1 FROM public.test_session_items');
  PERFORM pg_temp.expect_denied('L9', 'SELECT 1 FROM public.exam_runtime_outbox');
  PERFORM pg_temp.expect_denied('L9', 'SELECT 1 FROM public.score_runs');
  PERFORM pg_temp.expect_denied('L9', $q$UPDATE public.test_sessions SET mode = 'lenient'$q$);
  PERFORM pg_temp.expect_denied('L9', $q$SELECT public.exam_session_state('00000000-0000-0000-0000-0000000e6a01', gen_random_uuid())$q$);
  PERFORM pg_temp.ok('L9', 'authenticated: 42501 on module2_path, module columns, thresholds, form items, item options, outbox, score_runs, any write, any exam_* RPC');
END $$;

-- ---------------------------------------------------------------------------
-- Runtime behaviour
-- ---------------------------------------------------------------------------
\set C '00000000-0000-0000-0000-0000000e6c03'

-- CR1: create refusals; OWN1: ownership
DO $$
DECLARE v jsonb; v_sid uuid;
BEGIN
  PERFORM pg_temp.expect_status('CR1', public.exam_create_session('00000000-0000-0000-0000-0000000e6c03',
            'e6f00000-0000-4000-8000-000000000002', 'lenient'), 409, 'form_not_published');
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6c03', 'e6f00000-0000-4000-8000-000000000001', 'lenient');
  PERFORM pg_temp.expect_status('CR1', v, 201);
  v_sid := (v->'body'->>'session_id')::uuid;
  PERFORM pg_temp.expect_status('CR1', public.exam_create_session('00000000-0000-0000-0000-0000000e6c03',
            'e6f00000-0000-4000-8000-000000000001', 'strict'), 200);
  PERFORM pg_temp.expect_status('CR1', public.exam_create_session('00000000-0000-0000-0000-0000000e6c03',
            'e6f00000-0000-4000-8000-000000000003', 'lenient'), 409, 'existing_active_session');
  PERFORM pg_temp.ok('CR1', 'draft form 409 form_not_published; create 201; same form again 200 (same session); other form 409 existing_active_session');

  PERFORM pg_temp.expect_status('OWN1', public.exam_session_state('00000000-0000-0000-0000-0000000e6a01', v_sid), 403, 'forbidden');
  PERFORM pg_temp.expect_status('OWN1', public.exam_session_state('00000000-0000-0000-0000-0000000e6c03', gen_random_uuid()), 404, 'session_not_found');
  PERFORM pg_temp.ok('OWN1', 'another student''s session 403 forbidden; unknown session 404 session_not_found');
END $$;

-- ID1 (§11.2 step 2, §11.3) and AL1 (§10.2, SQL half)
DO $$
DECLARE
  v_sid uuid; v jsonb; v_q text; v_q1 text; v_items jsonb; v_keys text[];
  v_forbidden text[] := ARRAY['correct_answer','correct_variants','explanation','domain','difficulty','skill_codes','option_metadata'];
BEGIN
  SELECT id INTO v_sid FROM public.test_sessions WHERE student_id = '00000000-0000-0000-0000-0000000e6c03';
  PERFORM pg_temp.expect_status('ID1', public.exam_start_module('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1'), 200);
  SELECT question_id INTO v_q FROM public.test_form_items
   WHERE test_form_id = 'e6f00000-0000-4000-8000-000000000001' AND section = 'RW' AND module = '1' AND ordinal = 0;

  v := public.exam_submit_answer('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1', 0, v_q, 'B', 'tokB', 900, 'k1');
  PERFORM pg_temp.expect_status('ID1', v, 200);
  v := public.exam_submit_answer('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1', 0, v_q, 'C', 'tokC', 900, 'k1');
  PERFORM pg_temp.expect_status('ID1', v, 200);
  IF NOT (v->'body'->>'idempotent_replay')::boolean OR v->'body'->'stored'->>'answer' <> 'tokB'
     OR NOT (v->'body_mismatch_fields' ? 'answer') THEN
    RAISE EXCEPTION 'E6G FAIL [ID1]: replay response %', v;
  END IF;
  IF (SELECT count(*) FROM public.test_answer_submissions WHERE test_session_id = v_sid) <> 1
     OR (SELECT answer FROM public.test_session_answers WHERE test_session_id = v_sid AND ordinal = 0 AND module = '1') <> 'B' THEN
    RAISE EXCEPTION 'E6G FAIL [ID1]: replay wrote';
  END IF;
  -- §11.3: K2 changes the answer, a delayed K1 retry must not undo it
  PERFORM pg_temp.expect_status('ID1', public.exam_submit_answer('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1', 0, v_q, 'C', 'tokC', 900, 'k2'), 200);
  PERFORM pg_temp.expect_status('ID1', public.exam_submit_answer('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1', 0, v_q, 'B', 'tokB', 900, 'k1'), 200);
  IF (SELECT answer FROM public.test_session_answers WHERE test_session_id = v_sid AND ordinal = 0 AND module = '1') <> 'C'
     OR (SELECT count(*) FROM public.test_answer_submissions WHERE test_session_id = v_sid) <> 2 THEN
    RAISE EXCEPTION 'E6G FAIL [ID1]: delayed K1 replay changed canonical state';
  END IF;
  PERFORM pg_temp.ok('ID1', 'same key replayed: 200, idempotent_replay=true, original body returned, mismatch flagged (answer), 1 ledger row; delayed K1 after K2 leaves canonical C (§11.3)');

  -- invalid position
  SELECT question_id INTO v_q1 FROM public.test_form_items
   WHERE test_form_id = 'e6f00000-0000-4000-8000-000000000001' AND section = 'RW' AND module = '1' AND ordinal = 1;
  PERFORM pg_temp.expect_status('ID1', public.exam_submit_answer('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1', 0, v_q1, 'A', 'x', 1, 'k3'), 400, 'invalid_question_for_form');

  v := public.exam_module_items('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1');
  v_items := v->'body'->'items';
  SELECT array_agg(DISTINCT k) INTO v_keys FROM jsonb_array_elements(v_items) e, jsonb_object_keys(e) k;
  IF jsonb_array_length(v_items) <> 27 OR v_keys && v_forbidden THEN
    RAISE EXCEPTION 'E6G FAIL [AL1]: items % keys %', jsonb_array_length(v_items), v_keys;
  END IF;
  PERFORM pg_temp.ok('AL1', format('module items RPC: 27 items, keys %s — none of %s', v_keys, v_forbidden));
END $$;

-- EX1/EX2: expiry is decided by server time
DO $$
DECLARE v_sid uuid; v jsonb; v_q text; r record;
BEGIN
  SELECT id INTO v_sid FROM public.test_sessions WHERE student_id = '00000000-0000-0000-0000-0000000e6c03';
  -- time passes: the stored deadline moves into the past; nothing from the client
  UPDATE public.test_session_sections SET module1_expires_at = clock_timestamp() - interval '1 second'
   WHERE test_session_id = v_sid AND section = 'RW';
  v := public.exam_submit_module('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1');
  PERFORM pg_temp.expect_status('EX1', v, 409, 'module_submitted');
  SELECT state, module1_submitted_by, module2_path INTO r FROM public.test_session_sections
   WHERE test_session_id = v_sid AND section = 'RW';
  IF r.state <> 'module1_submitted' OR r.module1_submitted_by <> 'timeout' OR r.module2_path IS NULL THEN
    RAISE EXCEPTION 'E6G FAIL [EX1]: section after expiry %', r;
  END IF;
  PERFORM pg_temp.ok('EX1', format('module submit after server-side expiry: 409 module_submitted; section module1_submitted by timeout, routed (%s)', r.module2_path));

  SELECT question_id INTO v_q FROM public.test_form_items
   WHERE test_form_id = 'e6f00000-0000-4000-8000-000000000001' AND section = 'RW' AND module = '1' AND ordinal = 2;
  PERFORM pg_temp.expect_status('EX2', public.exam_submit_answer('00000000-0000-0000-0000-0000000e6c03', v_sid, 'RW', '1', 2, v_q, 'A', 'x', 1, 'k-late'), 409, 'module_submitted');
  PERFORM pg_temp.ok('EX2', 'answer to the expired module: 409 module_submitted');
END $$;

-- SUB2 / PATH1 / M2L
DO $$
DECLARE v jsonb; v_sid uuid; r record; r2 record; v_q text; v_other text;
BEGIN
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6d04', 'e6f00000-0000-4000-8000-000000000001', 'lenient');
  v_sid := (v->'body'->>'session_id')::uuid;
  PERFORM pg_temp.expect_status('SUB2', public.exam_start_module('00000000-0000-0000-0000-0000000e6d04', v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.answer_module('00000000-0000-0000-0000-0000000e6d04', v_sid, 'RW', '1', true);
  PERFORM pg_temp.expect_status('SUB2', public.exam_submit_module('00000000-0000-0000-0000-0000000e6d04', v_sid, 'RW', '1'), 200);
  SELECT module1_submitted_at, module1_submitted_by, module2_path INTO r FROM public.test_session_sections
   WHERE test_session_id = v_sid AND section = 'RW';
  v := public.exam_submit_module('00000000-0000-0000-0000-0000000e6d04', v_sid, 'RW', '1');
  PERFORM pg_temp.expect_status('SUB2', v, 409, 'module_submitted');
  SELECT module1_submitted_at, module1_submitted_by, module2_path INTO r2 FROM public.test_session_sections
   WHERE test_session_id = v_sid AND section = 'RW';
  IF r IS DISTINCT FROM r2 THEN RAISE EXCEPTION 'E6G FAIL [SUB2]: second submit changed the section % -> %', r, r2; END IF;
  PERFORM pg_temp.ok('SUB2', 'second submit of Module 1: 409 module_submitted; submitted_at/by/path unchanged');

  BEGIN
    UPDATE public.test_session_sections SET module2_path = CASE r.module2_path WHEN 'A' THEN 'B' ELSE 'A' END
     WHERE test_session_id = v_sid AND section = 'RW';
    RAISE EXCEPTION 'E6G FAIL [PATH1]: module2_path rewrite accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'module2_path is immutable once set%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.ok('PATH1', format('module2_path %s -> rewrite refused: "module2_path is immutable once set"', r.module2_path));

  -- M2L: the client says '2'; the server stores the locked path
  PERFORM pg_temp.expect_status('M2L', public.exam_start_module('00000000-0000-0000-0000-0000000e6d04', v_sid, 'RW', '2'), 200);
  SELECT question_id INTO v_q FROM public.test_form_items
   WHERE test_form_id = 'e6f00000-0000-4000-8000-000000000001' AND section = 'RW' AND module = '2' || r.module2_path AND ordinal = 0;
  SELECT question_id INTO v_other FROM public.test_form_items
   WHERE test_form_id = 'e6f00000-0000-4000-8000-000000000001' AND section = 'RW'
     AND module = CASE r.module2_path WHEN 'A' THEN '2B' ELSE '2A' END AND ordinal = 0;
  PERFORM pg_temp.expect_status('M2L', public.exam_submit_answer('00000000-0000-0000-0000-0000000e6d04', v_sid, 'RW', '2', 0, v_q, 'A', 'x', 1, 'm2-0'), 200);
  PERFORM pg_temp.expect_status('M2L', public.exam_submit_answer('00000000-0000-0000-0000-0000000e6d04', v_sid, 'RW', '2', 0, v_other, 'A', 'x', 1, 'm2-1'), 400, 'invalid_question_for_form');
  IF (SELECT module FROM public.test_session_answers WHERE test_session_id = v_sid AND section = 'RW' AND ordinal = 0 AND module <> '1')
     <> '2' || r.module2_path THEN
    RAISE EXCEPTION 'E6G FAIL [M2L]: stored module is not the routed path';
  END IF;
  IF (public.exam_session_state('00000000-0000-0000-0000-0000000e6d04', v_sid))::text ~ '"module2_path"' THEN
    RAISE EXCEPTION 'E6G FAIL [M2L]: state read exposes module2_path';
  END IF;
  PERFORM pg_temp.ok('M2L', format('module ''2'' resolves to the locked 2%s; the non-routed module''s item is 400; state read carries no path', r.module2_path));
END $$;

-- GR1/GR2/GR3: past-grace sessions finalise on touch
DO $$
DECLARE v jsonb; v_sid uuid; v_out uuid; v_sc jsonb; r record; v_old uuid;
BEGIN
  -- GR1: RW submitted, Math Module 1 active, grace passes -> partial scored on touch
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6e05', 'e6f00000-0000-4000-8000-000000000001', 'lenient');
  v_sid := (v->'body'->>'session_id')::uuid;
  PERFORM public.exam_start_module('00000000-0000-0000-0000-0000000e6e05', v_sid, 'RW', '1');
  PERFORM pg_temp.answer_module('00000000-0000-0000-0000-0000000e6e05', v_sid, 'RW', '1', true);
  PERFORM public.exam_submit_module('00000000-0000-0000-0000-0000000e6e05', v_sid, 'RW', '1');
  PERFORM public.exam_start_module('00000000-0000-0000-0000-0000000e6e05', v_sid, 'RW', '2');
  PERFORM public.exam_submit_module('00000000-0000-0000-0000-0000000e6e05', v_sid, 'RW', '2');
  PERFORM public.exam_start_module('00000000-0000-0000-0000-0000000e6e05', v_sid, 'M', '1');
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_sid;

  v := public.exam_session_state('00000000-0000-0000-0000-0000000e6e05', v_sid);
  PERFORM pg_temp.expect_status('GR1', v, 200);
  IF v->'body'->>'state' <> 'partial_scored_abandoned' OR jsonb_array_length(v->'outbox_ids') <> 1 THEN
    RAISE EXCEPTION 'E6G FAIL [GR1]: touch did not finalise: %', v;
  END IF;
  v_out := (v->'outbox_ids'->>0)::uuid;
  SELECT event_type, payload INTO r FROM public.exam_runtime_outbox WHERE id = v_out;
  IF r.event_type <> 'test_session_partial_scored_abandoned'
     OR NOT (r.payload->'sections'->0->>'scoreable')::boolean
     OR (r.payload->'sections'->1->>'scoreable')::boolean THEN
    RAISE EXCEPTION 'E6G FAIL [GR1]: outbox %', r;
  END IF;
  v_sc := public.exam_score_outbox_event(v_out);
  SELECT rw_scaled, math_scaled, total_scaled INTO r FROM public.score_runs WHERE test_session_id = v_sid;
  IF NOT (v_sc->>'ok')::boolean OR r.rw_scaled IS NULL OR r.math_scaled IS NOT NULL THEN
    RAISE EXCEPTION 'E6G FAIL [GR1]: partial score %, %', v_sc, r;
  END IF;
  PERFORM pg_temp.ok('GR1', format('past-grace touch (state read): 200 partial_scored_abandoned, outbox RW scoreable / M not; score run RW %s, Math NULL', r.rw_scaled));

  -- GR2: a mutating request on a past-grace session: finalised, 409 session_grace_expired
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6f06', 'e6f00000-0000-4000-8000-000000000001', 'strict');
  v_sid := (v->'body'->>'session_id')::uuid;
  PERFORM public.exam_start_module('00000000-0000-0000-0000-0000000e6f06', v_sid, 'RW', '1');
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_sid;
  v := public.exam_submit_module('00000000-0000-0000-0000-0000000e6f06', v_sid, 'RW', '1');
  PERFORM pg_temp.expect_status('GR2', v, 409, 'session_grace_expired');
  IF (SELECT state FROM public.test_sessions WHERE id = v_sid) <> 'abandoned_final'
     OR EXISTS (SELECT 1 FROM public.exam_runtime_outbox WHERE aggregate_id = v_sid) THEN
    RAISE EXCEPTION 'E6G FAIL [GR2]: not abandoned_final / outbox written';
  END IF;
  PERFORM pg_temp.expect_status('GR2', public.exam_submit_module('00000000-0000-0000-0000-0000000e6f06', v_sid, 'RW', '1'), 409, 'session_terminal');
  PERFORM pg_temp.ok('GR2', 'module submit on a past-grace session: finalised to abandoned_final (no section submitted, no outbox), 409 session_grace_expired; next call 409 session_terminal');

  -- GR3: create over a past-grace session finalises it and starts attempt 2
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6a07', 'e6f00000-0000-4000-8000-000000000001', 'lenient');
  v_old := (v->'body'->>'session_id')::uuid;
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_old;
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6a07', 'e6f00000-0000-4000-8000-000000000001', 'lenient');
  PERFORM pg_temp.expect_status('GR3', v, 201);
  IF (SELECT state FROM public.test_sessions WHERE id = v_old) <> 'abandoned_final'
     OR (v->'body'->>'attempt_number_for_form')::int <> 2 THEN
    RAISE EXCEPTION 'E6G FAIL [GR3]: %', v;
  END IF;
  PERFORM pg_temp.ok('GR3', 'create over a past-grace session: old -> abandoned_final inline, new session 201 attempt 2');
END $$;

-- BR1/BR2 (break) and LN1/LS1 (pause) — student A lenient, student B strict
CREATE FUNCTION pg_temp.finish_rw(p_student uuid, p_session uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p_student, p_session, 'RW', '1'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p_student, p_session, 'RW', '1'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p_student, p_session, 'RW', '2'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p_student, p_session, 'RW', '2'), 200);
END $f$;

DO $$
DECLARE v jsonb; v_a uuid; v_b uuid; r record; v_brk timestamptz; v_rem bigint;
BEGIN
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6a01', 'e6f00000-0000-4000-8000-000000000001', 'lenient');
  v_a := (v->'body'->>'session_id')::uuid;
  v := public.exam_create_session('00000000-0000-0000-0000-0000000e6b02', 'e6f00000-0000-4000-8000-000000000001', 'strict');
  v_b := (v->'body'->>'session_id')::uuid;
  PERFORM pg_temp.finish_rw('00000000-0000-0000-0000-0000000e6a01', v_a);
  PERFORM pg_temp.finish_rw('00000000-0000-0000-0000-0000000e6b02', v_b);

  -- the break ended 5 minutes ago in both sessions
  v_brk := date_trunc('milliseconds', clock_timestamp()) - interval '15 minutes';
  UPDATE public.test_session_sections SET module2_submitted_at = v_brk
   WHERE test_session_id IN (v_a, v_b) AND section = 'RW';

  -- BR1 strict: the next touch finds Math Module 1 running since the break's end
  v := public.exam_session_state('00000000-0000-0000-0000-0000000e6b02', v_b);
  SELECT state, module1_started_at, module1_expires_at INTO r FROM public.test_session_sections
   WHERE test_session_id = v_b AND section = 'M';
  v_rem := (v->'body'->'sections'->1->>'remaining_ms')::bigint;
  IF v->'body'->>'state' <> 'active' OR r.state <> 'module1_active'
     OR r.module1_started_at <> v_brk + interval '10 minutes'
     OR v_rem > 2100000 - 290000 OR v_rem < 2100000 - 310000 THEN
    RAISE EXCEPTION 'E6G FAIL [BR1]: strict break % / % / remaining %', v->'body'->>'state', r, v_rem;
  END IF;
  PERFORM pg_temp.ok('BR1', format('strict: break over -> Math Module 1 started AT the break''s end (RW submit + 10 min); remaining %s ms of 2100000 (5 min already spent)', v_rem));

  -- BR2 lenient: unbounded — still in the break, suggested time shown as 0
  v := public.exam_session_state('00000000-0000-0000-0000-0000000e6a01', v_a);
  IF v->'body'->>'state' <> 'section_break' OR (v->'body'->>'break_remaining_ms')::bigint <> 0 THEN
    RAISE EXCEPTION 'E6G FAIL [BR2]: lenient break %', v->'body';
  END IF;
  PERFORM pg_temp.ok('BR2', 'lenient: 5 min past the suggested break, still section_break (break_remaining_ms 0); Math starts only on request');

  -- LN1 lenient pause: 20 minutes away from Math Module 1 do not count
  PERFORM pg_temp.expect_status('LN1', public.exam_start_module('00000000-0000-0000-0000-0000000e6a01', v_a, 'M', '1'), 200);
  UPDATE public.test_session_sections
     SET module1_started_at = clock_timestamp() - interval '25 minutes',
         module1_expires_at = clock_timestamp() - interval '25 minutes' + interval '35 minutes',
         last_active_at     = clock_timestamp() - interval '20 minutes'
   WHERE test_session_id IN (v_a, v_b) AND section = 'M';
  v_rem := public.exam_remaining_ms(v_a, 'M', clock_timestamp());
  IF v_rem < 1790000 OR v_rem > 1810000 THEN   -- 35 - 25 + 20 = 30 min
    RAISE EXCEPTION 'E6G FAIL [LN1]: lenient remaining %', v_rem;
  END IF;
  PERFORM pg_temp.expect_status('LN1', public.exam_heartbeat('00000000-0000-0000-0000-0000000e6a01', v_a, 'M'), 200);
  SELECT active_paused_ms INTO r FROM public.test_session_sections WHERE test_session_id = v_a AND section = 'M';
  IF r.active_paused_ms < 1190000 THEN RAISE EXCEPTION 'E6G FAIL [LN1]: pause not folded (%)', r; END IF;
  PERFORM pg_temp.ok('LN1', format('lenient: 25 min elapsed, 20 of them away -> remaining %s ms (~30 min); heartbeat folds %s ms into active_paused_ms', v_rem, r.active_paused_ms));

  -- LS1 strict: the same 20 minutes away count
  v_rem := public.exam_remaining_ms(v_b, 'M', clock_timestamp());
  IF v_rem < 590000 OR v_rem > 610000 THEN      -- 35 - 25 = 10 min
    RAISE EXCEPTION 'E6G FAIL [LS1]: strict remaining %', v_rem;
  END IF;
  PERFORM pg_temp.expect_status('LS1', public.exam_heartbeat('00000000-0000-0000-0000-0000000e6b02', v_b, 'M'), 200);
  IF (SELECT active_paused_ms FROM public.test_session_sections WHERE test_session_id = v_b AND section = 'M') <> 0 THEN
    RAISE EXCEPTION 'E6G FAIL [LS1]: strict accumulated pause';
  END IF;
  PERFORM pg_temp.ok('LS1', format('strict: the same 20 min away count -> remaining %s ms (~10 min); heartbeat leaves active_paused_ms 0', v_rem));
END $$;

-- SW1: the scheduled sweep finalises what nobody touches and scores what it wrote
DO $$
DECLARE v jsonb; v_g uuid; v_d uuid;
BEGIN
  SELECT id INTO v_g FROM public.test_sessions
   WHERE student_id = '00000000-0000-0000-0000-0000000e6a07' AND state = 'created';
  SELECT id INTO v_d FROM public.test_sessions
   WHERE student_id = '00000000-0000-0000-0000-0000000e6d04' AND state = 'active';   -- RW Module 2 active
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id IN (v_g, v_d);
  v := public.exam_abandonment_sweep();
  -- E9: the sweep also consumes pending seams events; the one enqueued by the
  -- scoring it does in this pass is consumed by the next pass.
  PERFORM public.exam_abandonment_sweep();
  IF (v->>'finalized')::int <> 2 OR (v->>'score_failed')::int <> 0
     OR (SELECT state FROM public.test_sessions WHERE id = v_g) <> 'abandoned_final'
     OR (SELECT state FROM public.test_sessions WHERE id = v_d) <> 'partial_scored_abandoned'
     OR NOT EXISTS (SELECT 1 FROM public.score_runs WHERE test_session_id = v_d AND rw_scaled IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.exam_runtime_outbox WHERE status <> 'published')
     OR (SELECT count(*) FROM public.score_runs)
          <> (SELECT count(*) FROM public.exam_runtime_outbox WHERE event_type <> 'test_session_scored')
     OR (SELECT count(*) FROM public.score_runs)
          <> (SELECT count(*) FROM public.exam_runtime_outbox WHERE event_type = 'test_session_scored') THEN
    RAISE EXCEPTION 'E6G FAIL [SW1]: sweep %', v;
  END IF;
  PERFORM pg_temp.ok('SW1', format('sweep %s: untouched created session -> abandoned_final; RW-Module-2-active session -> RW timed out, partial_scored_abandoned, scored in the same run; every outbox row published', v));
END $$;

-- FIN1: a completed session reads back 200; any other call is 409 session_terminal
DO $$
DECLARE v_sid uuid; v jsonb;
BEGIN
  SELECT id INTO v_sid FROM public.test_sessions
   WHERE student_id = '00000000-0000-0000-0000-0000000e6a01' AND state = 'completed';
  v := public.exam_session_state('00000000-0000-0000-0000-0000000e6a01', v_sid);
  PERFORM pg_temp.expect_status('FIN1', v, 200);
  IF v->'body'->>'state' <> 'completed' THEN RAISE EXCEPTION 'E6G FAIL [FIN1]: %', v; END IF;
  PERFORM pg_temp.expect_status('FIN1', public.exam_heartbeat('00000000-0000-0000-0000-0000000e6a01', v_sid, 'M'), 409, 'session_terminal');
  PERFORM pg_temp.ok('FIN1', 'completed session: state read 200 completed; heartbeat 409 session_terminal');
END $$;
