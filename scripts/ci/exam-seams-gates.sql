-- ============================================================================
-- E9 gate — the exam seams: review queue, mastery, projection outbox, section
-- scores, the scored-seams event, and the anonymised student
-- ============================================================================
-- @spec [SCL-154 .. SCL-158; Doc-04B_V4.3 §16.1; Doc-05A §6.2; Doc-05C §5.7,
--        §7.7; Doc-05D §12.2; Doc-04A_V2.2 §5.7] | @implemented [2026-09-25]
--
-- plain English: whole exams walked through the E6 runtime functions, scored
--   through the consumer, then their 'test_session_scored' events consumed —
--   exactly the calls the API makes — and every E9 plant checked:
--     S1 a completed exam enqueues every miss and every blank, nothing else
--        (served items of submitted modules; the unserved Module 2 path never);
--     S2 replaying scoring and the seams writes nothing twice;
--     S3 mastery applies for a submitted section, raises for an unsubmitted one;
--     S4 full_length_section_scores has 05C's columns, order and stable ids;
--     S5 one projection_refresh_outbox row per completion, none for partial;
--     S6 an anonymised student's score computes and no student-keyed row lands;
--     S7 a seam failure never un-scores: the score stands, the seams event
--        retries and dead-letters, and nothing of the failed attempt persists;
--     S8 grants.
--
-- Answer pattern per module (pg_temp.answer_mixed), by ordinal % 4:
--   0 correct · 1 wrong · 2 never answered (no row) · 3 explicit omit (NULL).
-- Output contract: one "ok   [ID] ..." NOTICE per passing check; a failure
--   raises "E9G FAIL [ID]".
-- ============================================================================
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

\ir lib/exam-form-fixture.sql
\ir lib/exam-walk-fixture.sql

CREATE FUNCTION pg_temp.request_deletion(p_student uuid) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
  VALUES (p_student, now() - interval '8 days', now() - interval '1 day', p_student, 'completed', 'completed', now());
$f$;

\ir lib/exam-seams-walk.sql

-- The independent expectation for S1: served items of submitted modules whose
-- stored answer is not the fixture's correct one ('A' / '1'), by pattern.
CREATE FUNCTION pg_temp.expected_review(p_session uuid)
RETURNS TABLE (item uuid, outcome text) LANGUAGE sql AS $f$
  SELECT md5('full_length:' || i.test_session_id::text || ':' || i.section || ':' || i.module || ':' || i.ordinal::text)::uuid,
         CASE WHEN i.ordinal % 4 = 1 THEN 'incorrect' ELSE 'skipped' END
    FROM public.test_session_items i
    JOIN public.test_session_sections sec ON sec.test_session_id = i.test_session_id AND sec.section = i.section
   WHERE i.test_session_id = p_session
     AND ((i.module = '1' AND sec.state IN ('module1_submitted', 'module2_active', 'submitted'))
       OR (i.module <> '1' AND sec.state = 'submitted'))
     AND i.ordinal % 4 <> 0;
$f$;

-- ---------------------------------------------------------------------------
-- Fixtures
--   MIX   e9...01  one completed exam, mixed answers (S1-S3, S5)
--   TWO   e9...02  two completed exams, forms F1 then F2 (S4, S5)
--   PART  e9...03  RW walked, Math Module 1 answered, then past grace (S3-S5)
--   ANON  e9...04  RW walked, anonymised mid-exam, finalised by the sweep (S6)
--   LATE  e9...05  completed + scored, anonymised BEFORE its seams run (S6)
--   FAIL  e9...06  completed; its seams hit a planted failure (S7)
--   LIVE  e9...07  RW Module 1 answered and still active (S3)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e9001', 'e9-mix@example.com'),
  ('00000000-0000-0000-0000-0000000e9002', 'e9-two@example.com'),
  ('00000000-0000-0000-0000-0000000e9003', 'e9-part@example.com'),
  ('00000000-0000-0000-0000-0000000e9004', 'e9-anon@example.com'),
  ('00000000-0000-0000-0000-0000000e9005', 'e9-late@example.com'),
  ('00000000-0000-0000-0000-0000000e9006', 'e9-fail@example.com'),
  ('00000000-0000-0000-0000-0000000e9007', 'e9-live@example.com');
SELECT pg_temp.exam_fixture_make_form('e9f00000-0000-4000-8000-000000000001', 'N1', 20, 15);
SELECT pg_temp.exam_fixture_make_form('e9f00000-0000-4000-8000-000000000002', 'N2', 20, 15);
UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'E9 form ' || right(id::text, 1)
 WHERE id IN ('e9f00000-0000-4000-8000-000000000001', 'e9f00000-0000-4000-8000-000000000002');

CREATE TEMP TABLE _s (who text PRIMARY KEY, student uuid, session uuid);
DO $$
DECLARE F1 uuid := 'e9f00000-0000-4000-8000-000000000001'; F2 uuid := 'e9f00000-0000-4000-8000-000000000002';
        v uuid; v2 uuid; v_sid uuid; r jsonb;
BEGIN
  INSERT INTO _s VALUES ('MIX', '00000000-0000-0000-0000-0000000e9001',
    pg_temp.walk('00000000-0000-0000-0000-0000000e9001', F1, 'strict', ARRAY['RW', 'M']));

  v  := pg_temp.walk('00000000-0000-0000-0000-0000000e9002', F1, 'lenient', ARRAY['RW', 'M']);
  PERFORM pg_temp.drain();                      -- the first completes (and scores) first
  -- the second exam all correct, so "latest" and "second latest" differ in S4
  PERFORM pg_temp.complete_session('00000000-0000-0000-0000-0000000e9002', F2, 'lenient', true, true);
  SELECT id INTO v2 FROM public.test_sessions
   WHERE student_id = '00000000-0000-0000-0000-0000000e9002' AND test_form_id = F2;
  INSERT INTO _s VALUES ('TWO1', '00000000-0000-0000-0000-0000000e9002', v),
                        ('TWO2', '00000000-0000-0000-0000-0000000e9002', v2);

  -- PART: RW walked, Math Module 1 answered but never submitted; past grace
  v_sid := pg_temp.walk('00000000-0000-0000-0000-0000000e9003', F1, 'strict', ARRAY['RW']);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module('00000000-0000-0000-0000-0000000e9003', v_sid, 'M', '1'), 200);
  PERFORM pg_temp.answer_mixed('00000000-0000-0000-0000-0000000e9003', v_sid, 'M', '1');
  INSERT INTO _s VALUES ('PART', '00000000-0000-0000-0000-0000000e9003', v_sid);

  -- LIVE: RW Module 1 answered, still active (never finalised)
  r := public.exam_create_session('00000000-0000-0000-0000-0000000e9007', F1, 'strict');
  v_sid := (r->'body'->>'session_id')::uuid;
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module('00000000-0000-0000-0000-0000000e9007', v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.answer_mixed('00000000-0000-0000-0000-0000000e9007', v_sid, 'RW', '1');
  INSERT INTO _s VALUES ('LIVE', '00000000-0000-0000-0000-0000000e9007', v_sid);

  -- ANON: RW walked, then anonymised mid-exam
  v_sid := pg_temp.walk('00000000-0000-0000-0000-0000000e9004', F1, 'strict', ARRAY['RW']);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module('00000000-0000-0000-0000-0000000e9004', v_sid, 'M', '1'), 200);
  INSERT INTO _s VALUES ('ANON', '00000000-0000-0000-0000-0000000e9004', v_sid);

  -- LATE: completed; scored below, anonymised before its seams event runs
  INSERT INTO _s VALUES ('LATE', '00000000-0000-0000-0000-0000000e9005',
    pg_temp.walk('00000000-0000-0000-0000-0000000e9005', F1, 'strict', ARRAY['RW', 'M']));
END $$;

-- Score everything pending except LATE's seams, which run after anonymisation.
DO $$
DECLARE e record; v jsonb;
BEGIN
  FOR e IN SELECT id FROM public.exam_runtime_outbox WHERE status = 'pending' ORDER BY created_at LOOP
    v := public.exam_score_outbox_event(e.id);
    IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'E9G FAIL [fixture]: scoring %', v; END IF;
  END LOOP;
  FOR e IN SELECT o.id FROM public.exam_runtime_outbox o
            WHERE o.status = 'pending' AND o.event_type = 'test_session_scored'
              AND o.aggregate_id <> (SELECT session FROM _s WHERE who = 'LATE') LOOP
    v := public.exam_score_outbox_event(e.id);
    IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'E9G FAIL [fixture]: seams %', v; END IF;
  END LOOP;
END $$;

-- ANON (mid-exam) and LATE (scored, seams pending) are anonymised first; then
-- PART and ANON pass their grace and the sweep finalises and scores them.
DO $$
BEGIN
  PERFORM pg_temp.request_deletion('00000000-0000-0000-0000-0000000e9004');
  PERFORM public.execute_account_deletion_cascade('00000000-0000-0000-0000-0000000e9004', 'anonymize');
  PERFORM pg_temp.request_deletion('00000000-0000-0000-0000-0000000e9005');
  PERFORM public.execute_account_deletion_cascade('00000000-0000-0000-0000-0000000e9005', 'anonymize');
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second'
   WHERE id IN (SELECT session FROM _s WHERE who IN ('PART', 'ANON'));
  PERFORM public.exam_abandonment_sweep();
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'E9G FAIL [fixture]: drain failed'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- S1 — every miss and every blank, and nothing else
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v_want int; v_got int; v_bad int; v_unserved int; v_mismatch int;
BEGIN
  SELECT * INTO s FROM _s WHERE who = 'MIX';
  SELECT count(*) INTO v_want FROM pg_temp.expected_review(s.session);
  SELECT count(*) INTO v_got FROM public.review_schedule
   WHERE source_engine = 'full_length' AND source_session_id = s.session AND student_id = s.student;
  -- every row is an expected item with the expected outcome
  SELECT count(*) INTO v_bad FROM public.review_schedule r
    LEFT JOIN pg_temp.expected_review(s.session) e ON e.item = r.source_item_id AND e.outcome = r.source_outcome
   WHERE r.source_session_id = s.session AND e.item IS NULL;
  -- no row for a question of the Module 2 path the student was NOT routed to
  SELECT count(*) INTO v_unserved FROM public.review_schedule r
   WHERE r.source_session_id = s.session
     AND NOT EXISTS (SELECT 1 FROM public.test_session_items i
                      WHERE i.test_session_id = s.session AND i.question_id = r.question_id);
  -- no row for an item answered correctly
  SELECT count(*) INTO v_mismatch FROM public.review_schedule r
    JOIN public.test_session_answers a ON a.test_session_id = s.session AND a.question_id = r.question_id
   WHERE r.source_session_id = s.session AND public.is_answer_correct(a.answer, a.question_id);
  IF v_want = 0 OR v_got <> v_want OR v_bad <> 0 OR v_unserved <> 0 OR v_mismatch <> 0 THEN
    RAISE EXCEPTION 'E9G FAIL [S1]: want %, got %, unexpected %, unserved %, correct-but-queued %',
      v_want, v_got, v_bad, v_unserved, v_mismatch;
  END IF;
  PERFORM pg_temp.ok('S1', format('MIX: %s rows = every miss (incorrect %s) and blank (skipped %s, incl. never-answered and explicit omit); 0 correct, 0 from the unserved path',
    v_got,
    (SELECT count(*) FROM public.review_schedule WHERE source_session_id = s.session AND source_outcome = 'incorrect'),
    (SELECT count(*) FROM public.review_schedule WHERE source_session_id = s.session AND source_outcome = 'skipped')));
END $$;

-- ---------------------------------------------------------------------------
-- S2 — replaying scoring and the seams writes nothing twice
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v_before text; v_after text; v_comp uuid; v_seam uuid; r1 jsonb; r2 jsonb;
BEGIN
  SELECT * INTO s FROM _s WHERE who = 'MIX';
  v_before := (SELECT count(*) FROM public.review_schedule)::text || '/' ||
              (SELECT count(*) FROM public.mastery_event_audit_log)::text || '/' ||
              (SELECT count(*) FROM public.projection_refresh_outbox)::text || '/' ||
              (SELECT count(*) FROM public.exam_runtime_outbox)::text || '/' ||
              (SELECT count(*) FROM public.score_runs)::text;
  SELECT id INTO v_comp FROM public.exam_runtime_outbox WHERE aggregate_id = s.session AND event_type = 'test_session_completed';
  SELECT id INTO v_seam FROM public.exam_runtime_outbox WHERE aggregate_id = s.session AND event_type = 'test_session_scored';
  -- replay the scoring event (a published row: the consumer re-scores idempotently)
  UPDATE public.exam_runtime_outbox SET status = 'pending' WHERE id = v_comp;
  r1 := public.exam_score_outbox_event(v_comp);
  -- replay the seams, both through the consumer and directly
  UPDATE public.exam_runtime_outbox SET status = 'pending' WHERE id = v_seam;
  r2 := public.exam_score_outbox_event(v_seam);
  PERFORM public.exam_apply_scored_seams(v_seam);
  v_after := (SELECT count(*) FROM public.review_schedule)::text || '/' ||
             (SELECT count(*) FROM public.mastery_event_audit_log)::text || '/' ||
             (SELECT count(*) FROM public.projection_refresh_outbox)::text || '/' ||
             (SELECT count(*) FROM public.exam_runtime_outbox)::text || '/' ||
             (SELECT count(*) FROM public.score_runs)::text;
  IF v_before <> v_after OR (r1->>'followup_outbox_id')::uuid IS DISTINCT FROM v_seam
     OR NOT (r2->>'ok')::boolean THEN
    RAISE EXCEPTION 'E9G FAIL [S2]: before % after % (review/audit/projection/outbox/runs); r1 % r2 %', v_before, v_after, r1, r2;
  END IF;
  PERFORM pg_temp.ok('S2', format('replayed scoring + seams (consumer and direct): review/audit/projection/outbox/runs %s unchanged; the replayed score returned the same seams event', v_after));
END $$;

-- ---------------------------------------------------------------------------
-- S3 — mastery for a submitted section; NOT_DERIVED for an unsubmitted one
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v_want int; v_got int; v_bad int; a record; v_msg text := ''; v_raised int := 0;
BEGIN
  SELECT * INTO s FROM _s WHERE who = 'MIX';
  SELECT count(*) INTO v_want FROM public.test_session_answers
   WHERE test_session_id = s.session AND answer IS NOT NULL;
  SELECT count(*) INTO v_got FROM public.mastery_event_audit_log l
    JOIN public.test_session_answers x ON x.last_submission_id = l.event_id
   WHERE x.test_session_id = s.session AND l.event_source_kind = 'full_length_answer'
     AND l.source_family = 'test' AND l.student_id = s.student;
  SELECT count(*) INTO v_bad FROM public.mastery_event_audit_log l
    JOIN public.test_session_answers x ON x.last_submission_id = l.event_id
   WHERE x.test_session_id = s.session
     AND (l.correct IS DISTINCT FROM (x.ordinal % 4 = 0) OR l.question_id <> x.question_id);
  IF v_want = 0 OR v_got <> v_want OR v_bad <> 0
     OR NOT EXISTS (SELECT 1 FROM public.student_skill_mastery WHERE student_id = s.student AND acc_test IS NOT NULL) THEN
    RAISE EXCEPTION 'E9G FAIL [S3]: MIX audit % of % answered, % wrong-valued', v_got, v_want, v_bad;
  END IF;

  -- unsubmitted sections: LIVE (RW Module 1 active) and PART's Math Module 1
  FOR a IN
    SELECT x.*, q.domain, q.skill_codes[1] AS skill, q.difficulty::smallint AS diff, t.student_id
      FROM public.test_session_answers x
      JOIN public.test_sessions t ON t.id = x.test_session_id
      JOIN public.questions q ON q.id = x.question_id
     WHERE x.answer IS NOT NULL
       AND ((x.test_session_id = (SELECT session FROM _s WHERE who = 'LIVE'))
         OR (x.test_session_id = (SELECT session FROM _s WHERE who = 'PART') AND x.section = 'M'))
     ORDER BY x.test_session_id, x.ordinal LIMIT 2
  LOOP
    BEGIN
      PERFORM public.apply_mastery_event(a.student_id, a.section, a.domain, a.skill, a.diff, 'test',
        'full_length_answer', public.is_answer_correct(a.answer, a.question_id), now(),
        a.last_submission_id, a.question_id, 'submitted');   -- the caller CLAIMS submitted
      v_msg := v_msg || ' applied!';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%MASTERY_EVENT_NOT_DERIVED%' THEN v_raised := v_raised + 1; ELSE v_msg := v_msg || ' ' || SQLERRM; END IF;
    END;
  END LOOP;
  IF v_raised <> 2 THEN RAISE EXCEPTION 'E9G FAIL [S3]: unsubmitted section events: raised % of 2;%', v_raised, v_msg; END IF;
  IF EXISTS (SELECT 1 FROM public.mastery_event_audit_log l JOIN public.test_session_answers x ON x.last_submission_id = l.event_id
              WHERE x.test_session_id IN (SELECT session FROM _s WHERE who IN ('LIVE'))
                 OR (x.test_session_id = (SELECT session FROM _s WHERE who = 'PART') AND x.section = 'M')) THEN
    RAISE EXCEPTION 'E9G FAIL [S3]: an unsubmitted section reached the audit log';
  END IF;
  PERFORM pg_temp.ok('S3', format('MIX: %s audit rows = its %s answered items (blanks none), correctness as stored; an unsubmitted section (LIVE RW1, PART M1) -> MASTERY_EVENT_NOT_DERIVED even when the caller claims submitted', v_got, v_want));
END $$;

-- ---------------------------------------------------------------------------
-- S4 — full_length_section_scores: 05C's columns, order, stable ids
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_cols text; v_first int; v_second int; r1 record; r2 record; v_id1 text; v_id2 text; v_part text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.full_length_section_scores'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols <> 'student_id,section,section_scaled_score,is_complete,completed_at,id' THEN
    RAISE EXCEPTION 'E9G FAIL [S4]: columns %', v_cols;
  END IF;
  IF NOT (SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid = 'public.full_length_section_scores'::regclass) THEN
    RAISE EXCEPTION 'E9G FAIL [S4]: not security_invoker';
  END IF;
  -- 05C §5.7's two reads, verbatim shape
  SELECT fl.section_scaled_score INTO v_first FROM public.full_length_section_scores fl
   WHERE student_id = '00000000-0000-0000-0000-0000000e9002' AND section = 'RW' AND is_complete = true
   ORDER BY completed_at DESC, id DESC LIMIT 1;
  SELECT fl.section_scaled_score INTO v_second FROM public.full_length_section_scores fl
   WHERE student_id = '00000000-0000-0000-0000-0000000e9002' AND section = 'RW' AND is_complete = true
   ORDER BY completed_at DESC, id DESC OFFSET 1 LIMIT 1;
  SELECT r.rw_scaled AS first, (SELECT rw_scaled FROM public.score_runs WHERE test_session_id = (SELECT session FROM _s WHERE who = 'TWO1')) AS second
    INTO r1 FROM public.score_runs r WHERE r.test_session_id = (SELECT session FROM _s WHERE who = 'TWO2');
  IF v_first IS DISTINCT FROM r1.first OR v_second IS DISTINCT FROM r1.second OR v_first = v_second THEN
    RAISE EXCEPTION 'E9G FAIL [S4]: latest/second % / % (want % / %)', v_first, v_second, r1.first, r1.second;
  END IF;
  -- ids: the documented derivation, and stable across reads
  SELECT string_agg(id::text, ',' ORDER BY id) INTO v_id1 FROM public.full_length_section_scores;
  SELECT string_agg(id::text, ',' ORDER BY id) INTO v_id2 FROM public.full_length_section_scores;
  IF v_id1 <> v_id2 OR EXISTS (
       SELECT 1 FROM public.full_length_section_scores f
        WHERE f.id <> ALL (SELECT md5(r.id::text || ':' || x)::uuid FROM public.score_runs r, unnest(ARRAY['RW', 'M']) x)) THEN
    RAISE EXCEPTION 'E9G FAIL [S4]: ids unstable or not md5(score_run_id || '':'' || section)';
  END IF;
  -- partial: scored section present with is_complete false; unscored absent; anonymised absent
  SELECT string_agg(section || '=' || is_complete, ',' ORDER BY section) INTO v_part
    FROM public.full_length_section_scores WHERE student_id = '00000000-0000-0000-0000-0000000e9003';
  IF v_part IS DISTINCT FROM 'RW=false'
     OR EXISTS (SELECT 1 FROM public.full_length_section_scores WHERE student_id IS NULL)
     OR (SELECT count(*) FROM public.full_length_section_scores WHERE student_id = '00000000-0000-0000-0000-0000000e9002') <> 4 THEN
    RAISE EXCEPTION 'E9G FAIL [S4]: PART %, NULL rows %, TWO rows %', v_part,
      (SELECT count(*) FROM public.full_length_section_scores WHERE student_id IS NULL),
      (SELECT count(*) FROM public.full_length_section_scores WHERE student_id = '00000000-0000-0000-0000-0000000e9002');
  END IF;
  PERFORM pg_temp.ok('S4', format('columns %s, security_invoker; 05C LIMIT 1 / OFFSET 1 -> %s / %s (TWO: second exam, first exam); ids = md5(run:section), stable; PART RW=false only; no student-less rows', v_cols, v_first, v_second));
END $$;

-- ---------------------------------------------------------------------------
-- S5 — one projection_refresh_outbox row per completion; none for partial
-- ---------------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(w.who || '=' || (SELECT count(*) FROM public.projection_refresh_outbox p WHERE p.test_session_id = w.session), ',' ORDER BY w.who)
    INTO v FROM _s w;
  IF v <> 'ANON=0,LATE=0,LIVE=0,MIX=1,PART=0,TWO1=1,TWO2=1' THEN
    RAISE EXCEPTION 'E9G FAIL [S5]: projection rows per session %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM public.projection_refresh_outbox WHERE test_session_id IS NOT NULL AND reason <> 'full_length_completed') THEN
    RAISE EXCEPTION 'E9G FAIL [S5]: a row with another reason';
  END IF;
  PERFORM pg_temp.ok('S5', 'projection_refresh_outbox rows per session (after the S2 replays): ' || v);
END $$;

-- ---------------------------------------------------------------------------
-- S6 — anonymised student: the score computes, no student-keyed row lands
-- ---------------------------------------------------------------------------
DO $$
DECLARE w record; v_run record; v_res jsonb; v_msg text := '';
BEGIN
  FOR w IN SELECT * FROM _s WHERE who IN ('ANON', 'LATE') ORDER BY who LOOP
    SELECT * INTO v_run FROM public.score_runs WHERE test_session_id = w.session;
    SELECT result INTO v_res FROM public.exam_runtime_outbox
     WHERE aggregate_id = w.session AND event_type = 'test_session_scored' AND status = 'published';
    IF v_run.id IS NULL OR v_run.student_id IS NOT NULL
       OR v_res->>'outcome' IS DISTINCT FROM 'skipped_no_student'
       OR EXISTS (SELECT 1 FROM public.review_schedule WHERE source_session_id = w.session)
       OR EXISTS (SELECT 1 FROM public.projection_refresh_outbox WHERE test_session_id = w.session)
       OR EXISTS (SELECT 1 FROM public.mastery_event_audit_log l JOIN public.test_session_answers x ON x.last_submission_id = l.event_id
                   WHERE x.test_session_id = w.session)
       OR EXISTS (SELECT 1 FROM public.full_length_answer_events WHERE test_session_id = w.session) THEN
      RAISE EXCEPTION 'E9G FAIL [S6]: % run % student_id % result %', w.who, v_run.id, v_run.student_id, v_res;
    END IF;
    v_msg := v_msg || format('%s: run %s/%s scored, seams %s; ', w.who,
      coalesce(v_run.rw_scaled::text, '-'), coalesce(v_run.math_scaled::text, '-'), v_res->>'outcome');
  END LOOP;
  PERFORM pg_temp.ok('S6', v_msg || 'no review, mastery, projection or answer-event row for either');
END $$;

-- ---------------------------------------------------------------------------
-- S7 — a seam failure never un-scores; retry, dead letter, nothing partial
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_sid uuid; v_comp uuid; v_seam uuid; r jsonb; i int; v_ev record; v_run uuid;
BEGIN
  v_sid := pg_temp.walk('00000000-0000-0000-0000-0000000e9006', 'e9f00000-0000-4000-8000-000000000001', 'strict', ARRAY['RW', 'M']);
  INSERT INTO _s VALUES ('FAIL', '00000000-0000-0000-0000-0000000e9006', v_sid);
  SELECT id INTO v_comp FROM public.exam_runtime_outbox WHERE aggregate_id = v_sid AND event_type = 'test_session_completed';
  -- the plant: the projection write (the LAST seam) fails, after review + mastery ran
  ALTER TABLE public.projection_refresh_outbox ADD CONSTRAINT zz_e9_plant CHECK (false) NOT VALID;
  r := public.exam_score_outbox_event(v_comp);
  v_seam := (r->>'followup_outbox_id')::uuid;
  SELECT id INTO v_run FROM public.score_runs WHERE test_session_id = v_sid;
  IF NOT (r->>'ok')::boolean OR v_run IS NULL THEN RAISE EXCEPTION 'E9G FAIL [S7]: scoring itself failed %', r; END IF;
  FOR i IN 1..5 LOOP
    r := public.exam_score_outbox_event(v_seam);
    IF (r->>'ok')::boolean THEN RAISE EXCEPTION 'E9G FAIL [S7]: the planted failure did not fail'; END IF;
  END LOOP;
  SELECT * INTO v_ev FROM public.exam_runtime_outbox WHERE id = v_seam;
  IF v_ev.status <> 'failed' OR v_ev.attempts <> 5 OR v_ev.failure_reason NOT LIKE '%zz_e9_plant%'
     OR (SELECT status FROM public.exam_runtime_outbox WHERE id = v_comp) <> 'published'
     OR NOT EXISTS (SELECT 1 FROM public.score_runs WHERE id = v_run)
     OR EXISTS (SELECT 1 FROM public.review_schedule WHERE source_session_id = v_sid)
     OR EXISTS (SELECT 1 FROM public.mastery_event_audit_log l JOIN public.test_session_answers x ON x.last_submission_id = l.event_id
                 WHERE x.test_session_id = v_sid)
     OR (SELECT (public.exam_report_source('00000000-0000-0000-0000-0000000e9006', v_sid)->'body'->'failure')) <> 'null'::jsonb THEN
    RAISE EXCEPTION 'E9G FAIL [S7]: seams event % attempts % reason %; completion %; partial writes survived or report failed',
      v_ev.status, v_ev.attempts, v_ev.failure_reason, (SELECT status FROM public.exam_runtime_outbox WHERE id = v_comp);
  END IF;
  ALTER TABLE public.projection_refresh_outbox DROP CONSTRAINT zz_e9_plant;
  -- an operator re-drive (status back to pending) then applies everything once
  UPDATE public.exam_runtime_outbox SET status = 'pending', attempts = 0 WHERE id = v_seam;
  r := public.exam_score_outbox_event(v_seam);
  IF NOT (r->>'ok')::boolean OR (SELECT count(*) FROM public.projection_refresh_outbox WHERE test_session_id = v_sid) <> 1 THEN
    RAISE EXCEPTION 'E9G FAIL [S7]: re-drive %', r;
  END IF;
  PERFORM pg_temp.ok('S7', format('planted projection failure: score run kept, completion published, seams event failed after 5 attempts (%s), 0 review/mastery rows survived the rolled-back attempts, report not flagged; re-drive -> %s',
    left(v_ev.failure_reason, 60), r->'seams'));
END $$;

-- ---------------------------------------------------------------------------
-- S8 — grants: the seams run as service_role; nothing reaches clients
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.exam_apply_scored_seams(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.exam_apply_scored_seams(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.exam_apply_scored_seams(uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.full_length_section_scores', 'SELECT')
     OR has_table_privilege('authenticated', 'public.full_length_section_scores', 'SELECT')
     OR has_table_privilege('authenticated', 'public.full_length_answer_events', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.full_length_section_scores', 'SELECT')
     OR to_regprocedure('public.emit_score_run_side_effects(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'E9G FAIL [S8]: grants';
  END IF;
  PERFORM pg_temp.ok('S8', 'exam_apply_scored_seams + both views: service_role only; the E5 hook is gone');
END $$;
