-- ============================================================================
-- E6b gate — exam tables in the account-deletion cascade, both modes
-- ============================================================================
-- @spec [Doc-05E, §1, §3 Rule 4, §5.1, §6 INV-05E-03/-06/-07/-08]
--       [Doc-05D, §10, §10.5]
--       [Doc-04B_V4.3, §9.4 (insert-once); Doc-04A_V2.2, §5.3, §14.3]
--       [SCL-143] | @implemented [2026-09-24]
--
-- plain English: walks whole exams through the E6 runtime functions (the ones
--   the API calls), scores them, then runs execute_account_deletion_cascade in
--   each mode and checks every behaviour the E6b brief names:
--     anonymize -> sessions, children, scores, ledger, outbox RETAINED; every
--                  student_id NULL; actor_id intact; counts in the result JSON;
--                  the INV-05E-07 sentinel refuses an ungrouped exam row;
--     hard_delete -> every exam row of the student gone, children included,
--                  with a count per table in the result JSON;
--     both      -> a re-run is a no-op (§10.5); a third student's rows are
--                  byte-identical; the insert-once trigger still refuses every
--                  UPDATE and DELETE a caller can issue.
--
-- Output contract (read by exam-deletion-cascade-gates.sh): one
--   "ok   [ID] ..." NOTICE per passing check; a failure raises "EDC FAIL [ID]".
-- ============================================================================
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

\ir lib/exam-form-fixture.sql
\ir lib/exam-walk-fixture.sql

-- The exam footprint of a set of sessions: one row per exam table, with a
-- content hash so "unchanged" means unchanged, not merely "same count".
CREATE FUNCTION pg_temp.exam_rows(p_sessions uuid[])
RETURNS TABLE (tbl text, n bigint, digest text) LANGUAGE sql AS $f$
  SELECT 'test_sessions', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), ''))
    FROM public.test_sessions t WHERE t.id = ANY (p_sessions)
  UNION ALL
  SELECT 'test_session_sections', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), ''))
    FROM public.test_session_sections t WHERE t.test_session_id = ANY (p_sessions)
  UNION ALL
  SELECT 'test_session_items', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.test_session_id, t.section, t.module, t.ordinal), ''))
    FROM public.test_session_items t WHERE t.test_session_id = ANY (p_sessions)
  UNION ALL
  SELECT 'test_answer_submissions', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), ''))
    FROM public.test_answer_submissions t WHERE t.test_session_id = ANY (p_sessions)
  UNION ALL
  SELECT 'test_session_answers', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.test_session_id, t.section, t.module, t.ordinal), ''))
    FROM public.test_session_answers t WHERE t.test_session_id = ANY (p_sessions)
  UNION ALL
  SELECT 'score_runs', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), ''))
    FROM public.score_runs t WHERE t.test_session_id = ANY (p_sessions)
  UNION ALL
  SELECT 'score_run_event_ledger', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.outbox_event_id), ''))
    FROM public.score_run_event_ledger t WHERE t.test_session_id = ANY (p_sessions)
  UNION ALL
  SELECT 'exam_runtime_outbox', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), ''))
    FROM public.exam_runtime_outbox t WHERE t.aggregate_id = ANY (p_sessions);
$f$;

CREATE FUNCTION pg_temp.sessions_of(p_student uuid) RETURNS uuid[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[]) FROM public.test_sessions WHERE student_id = p_student;
$f$;

CREATE FUNCTION pg_temp.request_deletion(p_student uuid) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
  VALUES (p_student, now() - interval '8 days', now() - interval '1 day', p_student, 'completed', 'completed', now());
$f$;

-- ---------------------------------------------------------------------------
-- Fixtures: one published form; five students (profiles via handle_new_user).
--   ANON  e6b...a1  completed + scored exam, then a second exam left pending
--   HARD  e6b...b2  completed + scored exam
--   CTRL  e6b...c3  completed + scored exam, never deleted (the control)
--   PEND  e6b...d4  completed exam, outbox still PENDING at anonymisation
--   LIVE  e6b...e5  RW submitted, Math in progress at anonymisation
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000e6b0a1', 'e6b-anon@example.com'),
  ('00000000-0000-0000-0000-000000e6b0b2', 'e6b-hard@example.com'),
  ('00000000-0000-0000-0000-000000e6b0c3', 'e6b-ctrl@example.com'),
  ('00000000-0000-0000-0000-000000e6b0d4', 'e6b-pend@example.com'),
  ('00000000-0000-0000-0000-000000e6b0e5', 'e6b-live@example.com');
SELECT pg_temp.exam_fixture_make_form('e6bf0000-0000-4000-8000-000000000001', 'D1', 20, 15);
UPDATE public.test_forms SET status = 'published', published_at = now()
 WHERE id = 'e6bf0000-0000-4000-8000-000000000001';

DO $$
DECLARE v_out uuid; s uuid;
BEGIN
  FOREACH s IN ARRAY ARRAY['00000000-0000-0000-0000-000000e6b0a1', '00000000-0000-0000-0000-000000e6b0b2',
                           '00000000-0000-0000-0000-000000e6b0c3']::uuid[] LOOP
    v_out := pg_temp.complete_session(s, 'e6bf0000-0000-4000-8000-000000000001', 'lenient', true, false);
    IF NOT (public.exam_score_outbox_event(v_out)->>'ok')::boolean THEN
      RAISE EXCEPTION 'EDC FAIL [fixture]: scoring %', s;
    END IF;
  END LOOP;
  -- PEND: completed, NOT scored — the outbox row is still pending
  PERFORM pg_temp.complete_session('00000000-0000-0000-0000-000000e6b0d4',
            'e6bf0000-0000-4000-8000-000000000001', 'strict', false, true);
END $$;

-- LIVE: RW fully submitted, Math Module 1 in progress
DO $$
DECLARE v jsonb; v_sid uuid; p uuid := '00000000-0000-0000-0000-000000e6b0e5';
BEGIN
  v := public.exam_create_session(p, 'e6bf0000-0000-4000-8000-000000000001', 'lenient');
  v_sid := (v->'body'->>'session_id')::uuid;
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p, v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.answer_module(p, v_sid, 'RW', '1', true);
  PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p, v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p, v_sid, 'RW', '2'), 200);
  PERFORM pg_temp.answer_module(p, v_sid, 'RW', '2', true);
  PERFORM pg_temp.expect_status('fixture', public.exam_submit_module(p, v_sid, 'RW', '2'), 200);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p, v_sid, 'M', '1'), 200);
  PERFORM pg_temp.answer_module(p, v_sid, 'M', '1', false);
END $$;

-- ANON also has a second, unscored exam in progress (RW Module 1 only)
DO $$
DECLARE v jsonb; v_sid uuid; p uuid := '00000000-0000-0000-0000-000000e6b0a1';
BEGIN
  v := public.exam_create_session(p, 'e6bf0000-0000-4000-8000-000000000001', 'strict');
  v_sid := (v->'body'->>'session_id')::uuid;
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module(p, v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.answer_module(p, v_sid, 'RW', '1', false);
END $$;

SELECT pg_temp.request_deletion(s) FROM unnest(ARRAY[
  '00000000-0000-0000-0000-000000e6b0a1', '00000000-0000-0000-0000-000000e6b0b2',
  '00000000-0000-0000-0000-000000e6b0d4', '00000000-0000-0000-0000-000000e6b0e5']::uuid[]) AS s;

-- Frozen "before" footprints (plain tables: they outlive each check's statement)
CREATE TEMP TABLE _sess AS
  SELECT p.id AS student, p.actor_id, pg_temp.sessions_of(p.id) AS sessions
    FROM public.profiles p
   WHERE p.id IN ('00000000-0000-0000-0000-000000e6b0a1', '00000000-0000-0000-0000-000000e6b0b2',
                  '00000000-0000-0000-0000-000000e6b0c3', '00000000-0000-0000-0000-000000e6b0d4',
                  '00000000-0000-0000-0000-000000e6b0e5');
CREATE TEMP TABLE _before AS
  SELECT s.student, r.* FROM _sess s, pg_temp.exam_rows(s.sessions) r;
CREATE TEMP TABLE _score_before AS
  SELECT to_jsonb(r) - 'student_id' AS row, r.test_session_id FROM public.score_runs r;
CREATE TEMP TABLE _results (mode text, student uuid, result jsonb);

-- ---------------------------------------------------------------------------
-- S1 — schema: identity nullable + SET NULL; actor_id NOT NULL, no DEFAULT;
--      both insert-once triggers enabled; the scoring owner reads actor_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s nullable=%s default=%s', table_name, column_name, is_nullable, column_default), '; ')
    INTO v_bad
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('test_sessions', 'score_runs')
     AND ((column_name = 'student_id' AND is_nullable <> 'YES')
       OR (column_name = 'actor_id' AND (is_nullable <> 'NO' OR column_default IS NOT NULL OR data_type <> 'uuid')));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'EDC FAIL [S1]: %', v_bad; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name IN ('test_sessions', 'score_runs') AND column_name = 'actor_id') <> 2 THEN
    RAISE EXCEPTION 'EDC FAIL [S1]: actor_id missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('test_sessions_student_id_fkey', 'score_runs_student_id_fkey')
         AND confrelid = 'public.profiles'::regclass AND confdeltype = 'n') <> 2 THEN
    RAISE EXCEPTION 'EDC FAIL [S1]: identity FKs are not both ON DELETE SET NULL';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.score_runs'::regclass
        AND tgname IN ('trg_prevent_score_runs_update', 'trg_prevent_score_runs_delete') AND tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'EDC FAIL [S1]: insert-once triggers not both enabled';
  END IF;
  IF NOT has_column_privilege('lyceon_scoring_owner', 'public.test_sessions', 'actor_id', 'SELECT') THEN
    RAISE EXCEPTION 'EDC FAIL [S1]: lyceon_scoring_owner cannot read test_sessions.actor_id';
  END IF;
  PERFORM pg_temp.ok('S1', 'student_id nullable + ON DELETE SET NULL on both; actor_id uuid NOT NULL, no DEFAULT, on both; insert-once triggers enabled');
END $$;

-- ---------------------------------------------------------------------------
-- W1 — the writers stamp actor_id: session = profiles.actor_id, run = session
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad bigint; v_sessions bigint; v_runs bigint;
BEGIN
  SELECT count(*) FILTER (WHERE t.actor_id IS DISTINCT FROM p.actor_id), count(*)
    INTO v_bad, v_sessions
    FROM public.test_sessions t JOIN public.profiles p ON p.id = t.student_id;
  IF v_bad <> 0 OR v_sessions <> 6 THEN
    RAISE EXCEPTION 'EDC FAIL [W1]: % of % sessions carry a foreign actor_id (want 0 of 6)', v_bad, v_sessions;
  END IF;
  SELECT count(*) FILTER (WHERE r.actor_id IS DISTINCT FROM t.actor_id), count(*)
    INTO v_bad, v_runs
    FROM public.score_runs r JOIN public.test_sessions t ON t.id = r.test_session_id;
  IF v_bad <> 0 OR v_runs <> 3 THEN
    RAISE EXCEPTION 'EDC FAIL [W1]: % of % score runs differ from their session actor_id (want 0 of 3)', v_bad, v_runs;
  END IF;
  PERFORM pg_temp.ok('W1', format('exam_create_session stamped profiles.actor_id on %s sessions; the scorer copied it onto %s runs', v_sessions, v_runs));
END $$;

-- ---------------------------------------------------------------------------
-- N1 — a missing actor_id fails closed, at every write
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_state text; v_msg text; v_hits int := 0;
BEGIN
  BEGIN
    INSERT INTO public.test_sessions (student_id, test_form_id, state, mode, grace_expires_at,
                                      attempt_number_for_form, is_first_seen_form_attempt)
    VALUES ('00000000-0000-0000-0000-000000e6b0c3', 'e6bf0000-0000-4000-8000-000000000001',
            'abandoned_final', 'strict', now(), 9, false);
  EXCEPTION WHEN not_null_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE '%"actor_id"%test_sessions%' THEN v_hits := v_hits + 1; END IF;
  END;
  BEGIN
    INSERT INTO public.score_runs (test_session_id, student_id, test_form_id, scoring_model_version,
        source_outbox_event_id, source_event_type, rw_scored, rw_module1_correct, rw_scaled, math_scored,
        partial_display_scaled, constants_snapshot)
    SELECT r.test_session_id, r.student_id, r.test_form_id, r.scoring_model_version, r.source_outbox_event_id,
           r.source_event_type, true, 0, 200, false, 200, '{}'::jsonb
      FROM public.score_runs r LIMIT 1;
  EXCEPTION WHEN not_null_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE '%"actor_id"%score_runs%' THEN v_hits := v_hits + 1; END IF;
  END;
  BEGIN
    PERFORM public.exam_create_session('00000000-0000-0000-0000-00000000dead',
              'e6bf0000-0000-4000-8000-000000000001', 'strict');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE 'EXAM_SESSION_NO_ACTOR_ID%' THEN v_hits := v_hits + 1; END IF;
  END;
  IF v_hits <> 3 THEN
    RAISE EXCEPTION 'EDC FAIL [N1]: % of 3 actor_id-less writes refused (session insert 23502, run insert 23502, create EXAM_SESSION_NO_ACTOR_ID)', v_hits;
  END IF;
  PERFORM pg_temp.ok('N1', 'actor_id-less session insert 23502, actor_id-less score insert 23502, exam_create_session without a profile actor_id -> EXAM_SESSION_NO_ACTOR_ID');
END $$;

-- ---------------------------------------------------------------------------
-- T1 — the insert-once trigger is not weakened (Doc 04B §9.4)
--   on a live student's run: UPDATE of a score column, UPDATE student_id ->
--   NULL while the profile exists, UPDATE of actor_id, DELETE while the
--   session exists — all refused with the §9.4 message
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_msg text; v_hits int := 0; v_sql text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    'UPDATE public.score_runs SET rw_scaled = 800 WHERE student_id = %L',
    'UPDATE public.score_runs SET student_id = NULL WHERE student_id = %L',
    'UPDATE public.score_runs SET actor_id = gen_random_uuid() WHERE student_id = %L',
    'UPDATE public.score_runs SET student_id = NULL, rw_scaled = 800 WHERE student_id = %L',
    'DELETE FROM public.score_runs WHERE student_id = %L'] LOOP
    BEGIN
      EXECUTE format(v_sql, '00000000-0000-0000-0000-000000e6b0c3');
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg LIKE 'score_runs is insert-once.%' THEN v_hits := v_hits + 1; END IF;
    END;
  END LOOP;
  IF v_hits <> 5 THEN
    RAISE EXCEPTION 'EDC FAIL [T1]: % of 5 caller mutations of a live score run refused', v_hits;
  END IF;
  PERFORM pg_temp.ok('T1', 'live run: UPDATE score / student_id->NULL (profile exists) / actor_id / both, and DELETE (session exists) -> all 5 refused, §9.4 message');
END $$;

-- ---------------------------------------------------------------------------
-- SN1 / SN2 — INV-05E-07 sentinel: an ungrouped exam row blocks anonymize.
--   The seal makes that state unreachable, so each check builds it inside a
--   transaction it rolls back (drop the seal, null one row), then asserts the
--   cascade refuses and names the table.
-- ---------------------------------------------------------------------------
BEGIN;
ALTER TABLE public.test_sessions ALTER COLUMN actor_id DROP NOT NULL;
UPDATE public.test_sessions SET actor_id = NULL
 WHERE student_id = '00000000-0000-0000-0000-000000e6b0a1'
   AND id = (SELECT min(id::text)::uuid FROM public.test_sessions WHERE student_id = '00000000-0000-0000-0000-000000e6b0a1');
DO $$
DECLARE v_msg text := '';
BEGIN
  BEGIN
    PERFORM public.execute_account_deletion_cascade('00000000-0000-0000-0000-000000e6b0a1', 'anonymize');
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg NOT LIKE '05E-5d SENTINEL (INV-05E-07): 1 row(s) in public.test_sessions %' THEN
    RAISE EXCEPTION 'EDC FAIL [SN1]: anonymize did not refuse an ungrouped test_sessions row (got "%")', v_msg;
  END IF;
  PERFORM pg_temp.ok('SN1', 'test_sessions row with identity + actor_id NULL -> anonymize refused: ' || v_msg);
END $$;
ROLLBACK;

BEGIN;
ALTER TABLE public.score_runs ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.score_runs DISABLE TRIGGER trg_prevent_score_runs_update;
UPDATE public.score_runs SET actor_id = NULL WHERE student_id = '00000000-0000-0000-0000-000000e6b0a1';
ALTER TABLE public.score_runs ENABLE TRIGGER trg_prevent_score_runs_update;
DO $$
DECLARE v_msg text := '';
BEGIN
  BEGIN
    PERFORM public.execute_account_deletion_cascade('00000000-0000-0000-0000-000000e6b0a1', 'anonymize');
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg NOT LIKE '05E-5d SENTINEL (INV-05E-07): 1 row(s) in public.score_runs %' THEN
    RAISE EXCEPTION 'EDC FAIL [SN2]: anonymize did not refuse an ungrouped score_runs row (got "%")', v_msg;
  END IF;
  PERFORM pg_temp.ok('SN2', 'score_runs row with identity + actor_id NULL -> anonymize refused: ' || v_msg);
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- The anonymize runs (ANON, PEND, LIVE) and the hard delete (HARD)
-- ---------------------------------------------------------------------------
INSERT INTO _results
SELECT 'anonymize', s, public.execute_account_deletion_cascade(s, 'anonymize')
  FROM unnest(ARRAY['00000000-0000-0000-0000-000000e6b0a1', '00000000-0000-0000-0000-000000e6b0d4',
                    '00000000-0000-0000-0000-000000e6b0e5']::uuid[]) AS s;
INSERT INTO _results
SELECT 'hard_delete', '00000000-0000-0000-0000-000000e6b0b2',
       public.execute_account_deletion_cascade('00000000-0000-0000-0000-000000e6b0b2', 'hard_delete');

-- Evidence: the result JSON of each run
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _results ORDER BY mode, student LOOP
    RAISE NOTICE 'result % %: %', r.mode, r.student, r.result;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- A1 — anonymize severs: no exam row names the student; every one of their
--      sessions and runs has student_id NULL and their actor_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v_named bigint; v_bad bigint; v_total bigint := 0;
BEGIN
  FOR s IN SELECT * FROM _sess WHERE student IN ('00000000-0000-0000-0000-000000e6b0a1',
             '00000000-0000-0000-0000-000000e6b0d4', '00000000-0000-0000-0000-000000e6b0e5') LOOP
    SELECT (SELECT count(*) FROM public.test_sessions WHERE student_id = s.student)
         + (SELECT count(*) FROM public.score_runs WHERE student_id = s.student) INTO v_named;
    SELECT (SELECT count(*) FROM public.test_sessions WHERE id = ANY (s.sessions)
               AND (student_id IS NOT NULL OR actor_id IS DISTINCT FROM s.actor_id))
         + (SELECT count(*) FROM public.score_runs WHERE test_session_id = ANY (s.sessions)
               AND (student_id IS NOT NULL OR actor_id IS DISTINCT FROM s.actor_id)) INTO v_bad;
    IF v_named <> 0 OR v_bad <> 0 THEN
      RAISE EXCEPTION 'EDC FAIL [A1]: student % — % row(s) still name them, % row(s) not (NULL, their actor_id)', s.student, v_named, v_bad;
    END IF;
    v_total := v_total + cardinality(s.sessions);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.anonymized_actors a JOIN _sess x ON x.actor_id = a.actor_id
                  WHERE x.student = '00000000-0000-0000-0000-000000e6b0a1') THEN
    RAISE EXCEPTION 'EDC FAIL [A1]: ANON actor_id missing from anonymized_actors';
  END IF;
  PERFORM pg_temp.ok('A1', format('anonymize x3: 0 exam rows name a deleted student; %s sessions + their runs carry student_id NULL and the student''s actor_id', v_total));
END $$;

-- ---------------------------------------------------------------------------
-- A2 — anonymize retains: for ANON every exam table keeps its row count; the
--      children, ledger and outbox are byte-identical; the score run differs
--      from before in student_id only; the result JSON counts what it kept
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; b record; a record; v_res jsonb; v_msg text := '';
BEGIN
  SELECT * INTO s FROM _sess WHERE student = '00000000-0000-0000-0000-000000e6b0a1';
  FOR b IN SELECT * FROM _before WHERE student = s.student ORDER BY tbl LOOP
    SELECT * INTO a FROM pg_temp.exam_rows(s.sessions) WHERE tbl = b.tbl;
    IF a.n <> b.n OR a.n = 0 THEN
      RAISE EXCEPTION 'EDC FAIL [A2]: % had % row(s), now % (want equal, > 0)', b.tbl, b.n, a.n;
    END IF;
    IF b.tbl NOT IN ('test_sessions', 'score_runs') AND a.digest <> b.digest THEN
      RAISE EXCEPTION 'EDC FAIL [A2]: % content changed', b.tbl;
    END IF;
    v_msg := v_msg || format('%s %s, ', b.tbl, a.n);
  END LOOP;
  IF EXISTS (SELECT 1 FROM _score_before sb
               LEFT JOIN public.score_runs r ON r.test_session_id = sb.test_session_id
              WHERE sb.test_session_id = ANY (s.sessions)
                AND (r.id IS NULL OR to_jsonb(r) - 'student_id' <> sb.row)) THEN
    RAISE EXCEPTION 'EDC FAIL [A2]: a retained score run differs in more than student_id';
  END IF;
  SELECT result INTO v_res FROM _results WHERE mode = 'anonymize' AND student = s.student;
  IF (v_res->'rows_affected'->>'test_sessions')::int <> cardinality(s.sessions)
     OR (v_res->'rows_affected'->>'score_runs')::int <> 1 THEN
    RAISE EXCEPTION 'EDC FAIL [A2]: result JSON counts test_sessions=% score_runs=% (want %/1)',
      v_res->'rows_affected'->'test_sessions', v_res->'rows_affected'->'score_runs', cardinality(s.sessions);
  END IF;
  PERFORM pg_temp.ok('A2', 'ANON retained: ' || v_msg || 'score run equal to before except student_id; result JSON test_sessions '
    || (v_res->'rows_affected'->>'test_sessions') || ', score_runs ' || (v_res->'rows_affected'->>'score_runs'));
END $$;

-- ---------------------------------------------------------------------------
-- A3 — an anonymised run is still insert-once: UPDATE and DELETE refused
--      (the DELETE is the hole D3 closes: student_id NULL != "profile gone")
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_msg text; v_hits int := 0; v_sql text; v_run uuid;
BEGIN
  SELECT r.id INTO v_run FROM public.score_runs r JOIN _sess s ON r.test_session_id = ANY (s.sessions)
   WHERE s.student = '00000000-0000-0000-0000-000000e6b0a1';
  FOREACH v_sql IN ARRAY ARRAY[
    'DELETE FROM public.score_runs WHERE id = %L',
    'UPDATE public.score_runs SET rw_scaled = 800 WHERE id = %L',
    'UPDATE public.score_runs SET student_id = ''00000000-0000-0000-0000-000000e6b0c3'' WHERE id = %L'] LOOP
    BEGIN
      EXECUTE format(v_sql, v_run);
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg LIKE 'score_runs is insert-once.%' THEN v_hits := v_hits + 1; END IF;
    END;
  END LOOP;
  IF v_hits <> 3 OR NOT EXISTS (SELECT 1 FROM public.score_runs WHERE id = v_run AND student_id IS NULL) THEN
    RAISE EXCEPTION 'EDC FAIL [A3]: % of 3 mutations of an anonymised run refused', v_hits;
  END IF;
  PERFORM pg_temp.ok('A3', 'anonymised run: DELETE, UPDATE score, UPDATE student_id -> all 3 refused; row intact');
END $$;

-- ---------------------------------------------------------------------------
-- P1 — a score event pending at anonymisation is scored normally afterwards:
--      the run lands with student_id NULL and the session's actor_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v_ev uuid; v_res jsonb; r record;
BEGIN
  SELECT * INTO s FROM _sess WHERE student = '00000000-0000-0000-0000-000000e6b0d4';
  SELECT id INTO v_ev FROM public.exam_runtime_outbox WHERE aggregate_id = ANY (s.sessions) AND status = 'pending';
  IF v_ev IS NULL THEN RAISE EXCEPTION 'EDC FAIL [P1]: premise — no pending outbox row for PEND'; END IF;
  v_res := public.exam_score_outbox_event(v_ev);
  SELECT * INTO r FROM public.score_runs WHERE source_outbox_event_id = v_ev;
  IF NOT (v_res->>'ok')::boolean OR r.id IS NULL OR r.student_id IS NOT NULL
     OR r.actor_id IS DISTINCT FROM s.actor_id OR r.total_scaled IS NULL THEN
    RAISE EXCEPTION 'EDC FAIL [P1]: %; run student_id=% actor_id=% (want NULL / %)', v_res, r.student_id, r.actor_id, s.actor_id;
  END IF;
  PERFORM pg_temp.ok('P1', format('pending completion event scored after anonymisation: total %s, student_id NULL, actor_id = the session''s; outbox published', r.total_scaled));
END $$;

-- ---------------------------------------------------------------------------
-- P2 — an exam in progress at anonymisation is finalised by the sweep past
--      grace (partial: RW submitted) and scored under actor_id alone
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v_sweep jsonb; r record; v_state text;
BEGIN
  SELECT * INTO s FROM _sess WHERE student = '00000000-0000-0000-0000-000000e6b0e5';
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second'
   WHERE id = ANY (s.sessions);
  v_sweep := public.exam_abandonment_sweep();
  SELECT state INTO v_state FROM public.test_sessions WHERE id = ANY (s.sessions);
  SELECT * INTO r FROM public.score_runs WHERE test_session_id = ANY (s.sessions);
  IF v_state <> 'partial_scored_abandoned' OR r.id IS NULL OR r.student_id IS NOT NULL
     OR r.actor_id IS DISTINCT FROM s.actor_id OR r.partial_display_scaled IS NULL THEN
    RAISE EXCEPTION 'EDC FAIL [P2]: sweep % -> state %, run student_id=% actor_id=%', v_sweep, v_state, r.student_id, r.actor_id;
  END IF;
  PERFORM pg_temp.ok('P2', format('in-progress exam of an anonymised student: sweep %s -> partial_scored_abandoned, RW %s, student_id NULL, actor_id kept', v_sweep, r.rw_scaled));
END $$;

-- ---------------------------------------------------------------------------
-- H1 — hard_delete removes every exam row of the student, children included,
--      and the result JSON counts each table exactly
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; b record; v_res jsonb; v_left bigint; v_msg text := '';
BEGIN
  SELECT * INTO s FROM _sess WHERE student = '00000000-0000-0000-0000-000000e6b0b2';
  SELECT result INTO v_res FROM _results WHERE mode = 'hard_delete';
  SELECT sum(n) INTO v_left FROM pg_temp.exam_rows(s.sessions);
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'EDC FAIL [H1]: % exam row(s) of the hard-deleted student survived', v_left;
  END IF;
  FOR b IN SELECT * FROM _before WHERE student = s.student ORDER BY tbl LOOP
    IF b.n = 0 THEN RAISE EXCEPTION 'EDC FAIL [H1]: premise — HARD had no % rows', b.tbl; END IF;
    IF (v_res->'rows_affected'->>b.tbl)::bigint IS DISTINCT FROM b.n THEN
      RAISE EXCEPTION 'EDC FAIL [H1]: result JSON % = % (want %)', b.tbl, v_res->'rows_affected'->b.tbl, b.n;
    END IF;
    v_msg := v_msg || format('%s %s, ', b.tbl, b.n);
  END LOOP;
  PERFORM pg_temp.ok('H1', 'hard_delete removed and counted: ' || rtrim(v_msg, ', ') || '; 0 left');
END $$;

-- ---------------------------------------------------------------------------
-- R1 — Doc 05D §10.5: a re-run on an already-deleted profile is a no-op, in
--      both modes, and changes no exam row anywhere
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_before text; v_after text; v_res1 jsonb; v_res2 jsonb;
BEGIN
  SELECT string_agg(tbl || ':' || n || ':' || digest, ',' ORDER BY tbl) INTO v_before
    FROM pg_temp.exam_rows((SELECT array_agg(id) FROM public.test_sessions));
  v_res1 := public.execute_account_deletion_cascade('00000000-0000-0000-0000-000000e6b0a1', 'anonymize');
  v_res2 := public.execute_account_deletion_cascade('00000000-0000-0000-0000-000000e6b0b2', 'hard_delete');
  SELECT string_agg(tbl || ':' || n || ':' || digest, ',' ORDER BY tbl) INTO v_after
    FROM pg_temp.exam_rows((SELECT array_agg(id) FROM public.test_sessions));
  IF v_res1->>'status' <> 'no_op' OR v_res2->>'status' <> 'no_op' OR v_before <> v_after THEN
    RAISE EXCEPTION 'EDC FAIL [R1]: re-run % / % ; exam rows changed: %', v_res1, v_res2, v_before <> v_after;
  END IF;
  PERFORM pg_temp.ok('R1', 're-run anonymize + hard_delete on gone profiles -> both no_op; every exam table byte-identical');
END $$;

-- ---------------------------------------------------------------------------
-- C1 — the control student's exam rows are byte-identical after every run
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v_diff text;
BEGIN
  SELECT * INTO s FROM _sess WHERE student = '00000000-0000-0000-0000-000000e6b0c3';
  SELECT string_agg(b.tbl, ', ') INTO v_diff
    FROM _before b JOIN pg_temp.exam_rows(s.sessions) a USING (tbl)
   WHERE b.student = s.student AND (a.n <> b.n OR a.digest <> b.digest);
  IF v_diff IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.test_sessions WHERE student_id = s.student) THEN
    RAISE EXCEPTION 'EDC FAIL [C1]: control rows changed in %', v_diff;
  END IF;
  PERFORM pg_temp.ok('C1', 'control student: all 8 exam tables byte-identical');
END $$;
