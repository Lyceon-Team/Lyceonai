-- ============================================================================
-- E9b gate — the calendar's full-length seam (Doc 05F §9.4, G-08-02)
-- ============================================================================
-- @spec [Doc_05F §7.4 (SCL-167), §9.4, §10.1 exams{} (SCL-169), formula sheet
--        §2 step 4 and §6; SCL-168 (the next test), SCL-170 (exam-review scope)]
-- | @implemented [2026-09-25]
--
-- plain English: real exams are walked through the E6 runtime functions and
--   their outbox drained exactly as the API does (lib/exam-seams-walk.sql), and
--   then the calendar's reading of them is checked:
--     FL1  the full_length scope is {form_id, exam_mode}, both required;
--     FL2  exam_next_form_for_student: live session's form, else first never
--          completed, else least recently completed; drafts and unselectable
--          forms never; NULL when nothing is selectable;
--     FL3  full_length disabled -> exams{} all NULL, no test weekday;
--          degraded[] never carries "exams" any more;
--     FL4  a student who never sat an exam -> exams{} all NULL, weak [];
--     FL5  a completed exam -> date, days since, missed_count (active servable
--          queue rows from it), source_session_id; reviewed false;
--     FL6  scored but its seams not yet applied -> missed_count NULL (unknown,
--          not zero), and the generator places no exam review;
--     FL7  weak_domains is Doc 05B's own levels at weak_level_max, and the
--          generator's explanation step reads the SAME row;
--     FL8  reviewed: a completed SESSION review of that exam, or nothing left
--          outstanding from it -- never a queue review;
--     FL9  the generator: exam review is a session review of that exam;
--          placeholder stays queue; a generated test carries test-day timing;
--          an exam review without a session id raises;
--     FL10 the anonymised student: the calendar path terminates;
--     FL11 grants.
-- Output contract: one "ok   [ID] ..." NOTICE per passing check; a failure
--   raises "E9BG FAIL [ID]".
-- ============================================================================
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

\ir lib/exam-form-fixture.sql
\ir lib/exam-walk-fixture.sql
\ir lib/exam-seams-walk.sql

CREATE FUNCTION pg_temp.student(p_id uuid, p_weekday int DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
  -- handle_new_user creates the profile (with its actor_id) from the auth row.
  INSERT INTO auth.users (id, email) VALUES (p_id, p_id::text || '@e9b.test');
  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
  VALUES (p_id, 'UTC', 127, 180, p_weekday, 1400, now());
$f$;

CREATE FUNCTION pg_temp.input(p_student uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.calendar_build_plan_input(p_student,
    ARRAY(SELECT generate_series((now() AT TIME ZONE 'UTC')::date,
                                 (now() AT TIME ZONE 'UTC')::date + 13, '1 day')::date));
$f$;

CREATE FUNCTION pg_temp.fail(p_id text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'E9BG FAIL [%]: %', p_id, p_msg; END $f$;

-- ---------------------------------------------------------------------------
-- Fixtures
--   F1, F2  published, selectable (F1 published first); F3 a draft.
--   W  e9b...01  walked a whole exam on F1, drained: scored AND seams applied.
--   S  e9b...02  walked a whole exam on F1, scored, seams event NOT consumed.
--   N  e9b...03  never sat an exam.
--   M  e9b...04  synthetic 05B levels + one completed exam 30 days ago.
--   G  e9b...05  a Saturday test weekday, never sat: generated tests + placeholders.
--   A  e9b...06  walked a whole exam, drained, then anonymised.
-- ---------------------------------------------------------------------------
SELECT pg_temp.exam_fixture_make_form('e9b0f000-0000-4000-8000-0000000000f1', 'G1');
SELECT pg_temp.exam_fixture_make_form('e9b0f000-0000-4000-8000-0000000000f2', 'G2');
SELECT pg_temp.exam_fixture_make_form('e9b0f000-0000-4000-8000-0000000000f3', 'G3');
UPDATE public.test_forms SET status = 'published', published_at = '2026-01-01', name = 'Practice Test 1'
 WHERE id = 'e9b0f000-0000-4000-8000-0000000000f1';
UPDATE public.test_forms SET status = 'published', published_at = '2026-01-02', name = 'Practice Test 2'
 WHERE id = 'e9b0f000-0000-4000-8000-0000000000f2';
UPDATE public.test_forms SET status = 'draft', published_at = NULL, name = 'Draft'
 WHERE id = 'e9b0f000-0000-4000-8000-0000000000f3';

SELECT pg_temp.student('e9b00000-0000-4000-8000-000000000001');
SELECT pg_temp.student('e9b00000-0000-4000-8000-000000000002');
SELECT pg_temp.student('e9b00000-0000-4000-8000-000000000003');
SELECT pg_temp.student('e9b00000-0000-4000-8000-000000000004');
SELECT pg_temp.student('e9b00000-0000-4000-8000-000000000005', 6);
SELECT pg_temp.student('e9b00000-0000-4000-8000-000000000006');

-- W and A: whole exams, drained (scoring then seams, one call each).
SELECT pg_temp.walk('e9b00000-0000-4000-8000-000000000001', 'e9b0f000-0000-4000-8000-0000000000f1', 'strict', ARRAY['RW','M']);
SELECT pg_temp.walk('e9b00000-0000-4000-8000-000000000006', 'e9b0f000-0000-4000-8000-0000000000f1', 'strict', ARRAY['RW','M']);
SELECT pg_temp.drain();
-- S: a whole exam, scored, its seams event left pending.
SELECT pg_temp.walk('e9b00000-0000-4000-8000-000000000002', 'e9b0f000-0000-4000-8000-0000000000f1', 'strict', ARRAY['RW','M']);
SELECT public.exam_score_outbox_event(o.id)
  FROM public.exam_runtime_outbox o JOIN public.test_sessions s ON s.id = o.aggregate_id
 WHERE s.student_id = 'e9b00000-0000-4000-8000-000000000002' AND o.event_type = 'test_session_completed';
-- M: synthetic mastery (L0, L1, L2, L3, and one unmeasured) and a completed exam 30 days ago.
INSERT INTO public.student_domain_mastery
  (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
VALUES ('e9b00000-0000-4000-8000-000000000004', 'M',  'Algebra',                           0, 0, 0, 10, 'h'),
       ('e9b00000-0000-4000-8000-000000000004', 'M',  'Advanced Math',                     1, 0, 0, 10, 'h'),
       ('e9b00000-0000-4000-8000-000000000004', 'M',  'Problem Solving and Data Analysis', 2, 0, 0, 10, 'h'),
       ('e9b00000-0000-4000-8000-000000000004', 'RW', 'Craft and Structure',               3, 0, 0, 10, 'h'),
       ('e9b00000-0000-4000-8000-000000000004', 'RW', 'Information and Ideas',          NULL, 0, 0,  4, 'h');
INSERT INTO public.test_sessions (student_id, actor_id, test_form_id, state, mode, completed_at, grace_expires_at,
                                  attempt_number_for_form, is_first_seen_form_attempt)
SELECT p.id, p.actor_id, 'e9b0f000-0000-4000-8000-0000000000f1', 'completed', 'strict',
       now() - interval '30 days', now() - interval '29 days', 1, true
  FROM public.profiles p WHERE p.id = 'e9b00000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
DO $fl1$
BEGIN
  IF NOT public.calendar_scope_is_valid('full_length', NULL, '{"form_id":null,"exam_mode":"strict"}')
     OR NOT public.calendar_scope_is_valid('full_length', NULL, '{"form_id":"e9b0f000-0000-4000-8000-0000000000f1","exam_mode":"lenient"}') THEN
    PERFORM pg_temp.fail('FL1', 'a two-key scope was refused');
  END IF;
  IF public.calendar_scope_is_valid('full_length', NULL, '{"form_id":null}')
     OR public.calendar_scope_is_valid('full_length', NULL, '{"form_id":null,"exam_mode":"untimed"}')
     OR public.calendar_scope_is_valid('full_length', NULL, '{"form_id":null,"exam_mode":"strict","module":2}')
     OR public.calendar_scope_is_valid('full_length', NULL, '{"exam_mode":"strict"}') THEN
    PERFORM pg_temp.fail('FL1', 'a one-key, bad-mode, extra-key or form-less scope was accepted');
  END IF;
  PERFORM pg_temp.ok('FL1', 'full_length scope is {form_id, exam_mode}; both required, exam_mode in the engine''s vocabulary');
END $fl1$;

DO $fl2$
DECLARE
  F1 CONSTANT uuid := 'e9b0f000-0000-4000-8000-0000000000f1';
  F2 CONSTANT uuid := 'e9b0f000-0000-4000-8000-0000000000f2';
  N  CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000003';
  W  CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000001';
  v  jsonb;
BEGIN
  IF public.exam_next_form_for_student(N) IS DISTINCT FROM F1 THEN
    PERFORM pg_temp.fail('FL2', 'a new student should get the first published form, got ' || coalesce(public.exam_next_form_for_student(N)::text, 'NULL'));
  END IF;
  IF public.exam_next_form_for_student(W) IS DISTINCT FROM F2 THEN
    PERFORM pg_temp.fail('FL2', 'after completing F1 the next test should be F2');
  END IF;
  -- A live session wins: the launch must resume it, not be refused for another form.
  BEGIN
    v := public.exam_create_session(N, F2, 'lenient');
    IF public.exam_next_form_for_student(N) IS DISTINCT FROM F2 THEN
      PERFORM pg_temp.fail('FL2', 'a live session on F2 did not make F2 the next test');
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'LYFL2';
  EXCEPTION WHEN SQLSTATE 'LYFL2' THEN NULL;  -- plant undone
  END;
  -- Everything completed: least recently completed first.
  BEGIN
    INSERT INTO public.test_sessions (student_id, actor_id, test_form_id, state, mode, completed_at, grace_expires_at,
                                      attempt_number_for_form, is_first_seen_form_attempt)
    SELECT W, p.actor_id, F2, 'completed', 'strict', now() + interval '1 minute', now(), 1, true
      FROM public.profiles p WHERE p.id = W;
    IF public.exam_next_form_for_student(W) IS DISTINCT FROM F1 THEN
      PERFORM pg_temp.fail('FL2', 'with both completed, the least recently completed (F1) should be next');
    END IF;
    UPDATE public.test_forms SET is_selectable = false WHERE id IN (F1, F2);
    IF public.exam_next_form_for_student(N) IS NOT NULL THEN
      PERFORM pg_temp.fail('FL2', 'with nothing selectable the next test should be NULL (the draft is never offered)');
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'LYFL2';
  EXCEPTION WHEN SQLSTATE 'LYFL2' THEN NULL;  -- plant undone
  END;
  PERFORM pg_temp.ok('FL2', 'next test: live form, else never completed (published order), else least recently completed; never a draft; NULL when none');
END $fl2$;

DO $fl3$
DECLARE v jsonb;
BEGIN
  BEGIN
    UPDATE public.calendar_runtime_config SET value = '["practice","review"]' WHERE key = 'enabled_block_types';
    v := pg_temp.input('e9b00000-0000-4000-8000-000000000001');
    IF v -> 'exams' <> '{"last_completed_local_date":null,"days_since_exam":null,"missed_count":null,"reviewed":null,"weak_domains":[],"source_session_id":null}'::jsonb THEN
      PERFORM pg_temp.fail('FL3', 'full_length disabled but exams{} = ' || (v -> 'exams')::text);
    END IF;
    v := pg_temp.input('e9b00000-0000-4000-8000-000000000005');
    IF v #> '{profile,full_length_weekday}' <> 'null'::jsonb THEN
      PERFORM pg_temp.fail('FL3', 'full_length disabled but the test weekday reached the generator');
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'LYFL3';
  EXCEPTION WHEN SQLSTATE 'LYFL3' THEN NULL;  -- plant undone
  END;
  v := pg_temp.input('e9b00000-0000-4000-8000-000000000005');
  IF v #>> '{profile,full_length_weekday}' IS DISTINCT FROM '6' OR v -> 'degraded' <> '[]'::jsonb THEN
    PERFORM pg_temp.fail('FL3', 'enabled: weekday ' || coalesce(v #>> '{profile,full_length_weekday}', 'NULL') || ', degraded ' || (v -> 'degraded')::text);
  END IF;
  PERFORM pg_temp.ok('FL3', 'disabled -> exams{} NULL and no test weekday; enabled -> weekday flows and degraded[] carries no "exams"');
END $fl3$;

DO $fl4$
DECLARE v jsonb := pg_temp.input('e9b00000-0000-4000-8000-000000000003');
BEGIN
  IF v -> 'exams' <> '{"last_completed_local_date":null,"days_since_exam":null,"missed_count":null,"reviewed":null,"weak_domains":[],"source_session_id":null}'::jsonb
     OR v -> 'degraded' <> '[]'::jsonb THEN
    PERFORM pg_temp.fail('FL4', 'never sat: ' || (v -> 'exams')::text || ' degraded ' || (v -> 'degraded')::text);
  END IF;
  PERFORM pg_temp.ok('FL4', 'a student who never sat an exam: exams{} NULL, weak [], degraded []');
END $fl4$;

DO $fl5$
DECLARE
  W CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000001';
  v jsonb := pg_temp.input(W);
  s record;
  n int;
BEGIN
  SELECT id, (completed_at AT TIME ZONE 'UTC')::date AS d INTO s
    FROM public.test_sessions WHERE student_id = W AND state = 'completed';
  SELECT count(*) INTO n FROM public.review_schedule r JOIN public.servable_questions q ON q.id = r.question_id
   WHERE r.student_id = W AND r.source_engine = 'full_length' AND r.source_session_id = s.id AND r.status = 'active';
  IF n = 0
     OR v #>> '{exams,last_completed_local_date}' IS DISTINCT FROM s.d::text
     OR (v #>> '{exams,days_since_exam}')::int IS DISTINCT FROM ((now() AT TIME ZONE 'UTC')::date - s.d)
     OR (v #>> '{exams,missed_count}')::int IS DISTINCT FROM n
     OR v #>> '{exams,source_session_id}' IS DISTINCT FROM s.id::text
     OR v #> '{exams,reviewed}' <> 'false'::jsonb
     OR v -> 'degraded' <> '[]'::jsonb THEN
    PERFORM pg_temp.fail('FL5', 'exams{} = ' || (v -> 'exams')::text || ', expected missed ' || n);
  END IF;
  -- H5: a queue row whose question stops being servable leaves the count.
  BEGIN
    UPDATE public.questions SET status = 'retired'
     WHERE id = (SELECT r.question_id FROM public.review_schedule r
                  WHERE r.student_id = W AND r.source_session_id = s.id AND r.status = 'active' LIMIT 1);
    IF (pg_temp.input(W) #>> '{exams,missed_count}')::int IS DISTINCT FROM n - 1 THEN
      PERFORM pg_temp.fail('FL5', 'a retired question still counted in missed_count');
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'LYFL5';
  EXCEPTION WHEN SQLSTATE 'LYFL5' THEN NULL;  -- plant undone
  END;
  PERFORM pg_temp.ok('FL5', format('a completed exam: date, days since, missed_count %s (active, servable), its session id; reviewed false', n));
END $fl5$;

DO $fl6$
DECLARE
  S CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000002';
  v jsonb := pg_temp.input(S);
BEGIN
  IF v #> '{exams,missed_count}' <> 'null'::jsonb OR v #> '{exams,last_completed_local_date}' = 'null'::jsonb THEN
    PERFORM pg_temp.fail('FL6', 'seams pending: ' || (v -> 'exams')::text);
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.calendar_compute_plan(v) -> 'days') d,
                           jsonb_array_elements(d -> 'blocks') b
              WHERE b ->> 'explanation_key' = 'exam_review') THEN
    PERFORM pg_temp.fail('FL6', 'an exam review was placed against an unknown missed count');
  END IF;
  PERFORM pg_temp.ok('FL6', 'seams not yet applied: missed_count NULL (unknown, not zero); no exam review placed');
END $fl6$;

DO $fl7$
DECLARE
  M CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000004';
  W CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000001';
  v jsonb;
  w05b jsonb;
  k1 text; k2 text;
BEGIN
  -- W: the builder's set is exactly 05B's own rows at the threshold, canonical order.
  SELECT coalesce(jsonb_agg(d.domain ORDER BY d.ord), '[]'::jsonb) INTO w05b
    FROM jsonb_array_elements_text((SELECT value FROM public.calendar_runtime_config WHERE key = 'canonical_domain_order'))
         WITH ORDINALITY AS d(domain, ord)
    JOIN public.student_domain_mastery m ON m.student_id = W AND m.domain = d.domain
   WHERE m.mastery_level <= (SELECT (value #>> '{}')::int FROM public.calendar_runtime_config WHERE key = 'weak_level_max');
  IF pg_temp.input(W) #> '{exams,weak_domains}' <> w05b THEN
    PERFORM pg_temp.fail('FL7', 'W weak_domains ' || (pg_temp.input(W) #> '{exams,weak_domains}')::text || ' <> 05B ' || w05b::text);
  END IF;
  v := pg_temp.input(M);
  IF v #> '{exams,weak_domains}' <> '["Algebra","Advanced Math"]'::jsonb THEN
    PERFORM pg_temp.fail('FL7', 'M weak_domains at max 1: ' || (v #> '{exams,weak_domains}')::text);
  END IF;
  -- The explanation key for M's L2 domain, from the generator itself (M's exam is 30 days
  -- ago, outside post_exam_emphasis_days, so the key is the explanation step's alone).
  SELECT e ->> 'explanation_key' INTO k1
    FROM jsonb_array_elements(public.calendar_compute_plan(v) -> 'days') d,
         jsonb_array_elements(d -> 'blocks') b, jsonb_array_elements(b #> '{scope,mix}') e
   WHERE e ->> 'domain' = 'Problem Solving and Data Analysis' LIMIT 1;
  BEGIN
    UPDATE public.calendar_runtime_config SET value = '2' WHERE key = 'weak_level_max';
    v := pg_temp.input(M);
    SELECT e ->> 'explanation_key' INTO k2
      FROM jsonb_array_elements(public.calendar_compute_plan(v) -> 'days') d,
           jsonb_array_elements(d -> 'blocks') b, jsonb_array_elements(b #> '{scope,mix}') e
     WHERE e ->> 'domain' = 'Problem Solving and Data Analysis' LIMIT 1;
    IF v #> '{exams,weak_domains}' <> '["Algebra","Advanced Math","Problem Solving and Data Analysis"]'::jsonb
       OR k1 IS DISTINCT FROM 'balanced' OR k2 IS DISTINCT FROM 'weak' THEN
      PERFORM pg_temp.fail('FL7', format('weak_level_max 2: weak %s, L2 key %s -> %s', v #> '{exams,weak_domains}', k1, k2));
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'LYFL7';
  EXCEPTION WHEN SQLSTATE 'LYFL7' THEN NULL;  -- plant undone
  END;
  PERFORM pg_temp.ok('FL7', 'weak_domains = 05B levels <= weak_level_max (NULL never weak); moving the row moves the builder AND the generator''s key');
END $fl7$;

DO $fl8$
DECLARE
  W CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000001';
  sid uuid := (SELECT id FROM public.test_sessions WHERE student_id = W AND state = 'completed');
BEGIN
  BEGIN
    INSERT INTO public.review_sessions (student_id, actor_id, status, mode, filters, target_count, platform, completed_at)
    VALUES (W, W, 'completed', 'queue', '{}', 5, 'web', now());
    IF pg_temp.input(W) #> '{exams,reviewed}' <> 'false'::jsonb THEN
      PERFORM pg_temp.fail('FL8', 'a completed QUEUE review marked the exam reviewed');
    END IF;
    INSERT INTO public.review_sessions (student_id, actor_id, status, mode, filters, target_count, platform, completed_at)
    VALUES (W, W, 'completed', 'session',
            jsonb_build_object('source_engine', 'full_length', 'source_session_id', sid::text), 5, 'web', now());
    IF pg_temp.input(W) #> '{exams,reviewed}' <> 'true'::jsonb THEN
      PERFORM pg_temp.fail('FL8', 'a completed session review of the exam did not mark it reviewed');
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'LYFL8';
  EXCEPTION WHEN SQLSTATE 'LYFL8' THEN NULL;  -- plant undone
  END;
  BEGIN
    UPDATE public.review_schedule SET status = 'graduated', closed_at = now()
     WHERE student_id = W AND source_session_id = sid AND status = 'active';
    IF pg_temp.input(W) -> 'exams' @> '{"missed_count":0,"reviewed":true}'::jsonb IS NOT TRUE THEN
      PERFORM pg_temp.fail('FL8', 'nothing outstanding should read reviewed: ' || (pg_temp.input(W) -> 'exams')::text);
    END IF;
    -- ...and so the debt clears: ordinary review is placed again.
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.calendar_compute_plan(pg_temp.input(W)) -> 'days') d,
                                 jsonb_array_elements(d -> 'blocks') b
                    WHERE b ->> 'explanation_key' = 'exam_review') THEN
      NULL;
    ELSE
      PERFORM pg_temp.fail('FL8', 'a cleared exam still placed an exam review');
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'LYFL8';
  EXCEPTION WHEN SQLSTATE 'LYFL8' THEN NULL;  -- plant undone
  END;
  PERFORM pg_temp.ok('FL8', 'reviewed: a completed SESSION review of the exam, or nothing outstanding from it; a queue review never');
END $fl8$;

DO $fl9$
DECLARE
  W CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000001';
  G CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000005';
  sid uuid := (SELECT id FROM public.test_sessions WHERE student_id = W AND state = 'completed');
  v jsonb := pg_temp.input(W);
  r jsonb;
  fb jsonb;
  n_fl int; n_ph int;
BEGIN
  SELECT b INTO r FROM jsonb_array_elements(public.calendar_compute_plan(v) -> 'days') d,
                       jsonb_array_elements(d -> 'blocks') b
   WHERE b ->> 'explanation_key' = 'exam_review';
  SELECT b INTO fb FROM jsonb_array_elements(public.calendar_compute_plan_fallback(v) -> 'days') d,
                        jsonb_array_elements(d -> 'blocks') b
   WHERE b ->> 'explanation_key' = 'exam_review';
  IF r -> 'scope' <> jsonb_build_object('mode','session','source_engine','full_length','source_session_id',sid::text)
     OR (r ->> 'target_count')::int IS DISTINCT FROM (v #>> '{exams,missed_count}')::int
     OR fb -> 'scope' <> r -> 'scope' THEN
    PERFORM pg_temp.fail('FL9', 'exam review: det ' || coalesce(r::text, 'none') || ' / fallback ' || coalesce(fb::text, 'none'));
  END IF;
  -- G: generated tests carry test-day timing; the review each one sets up is a placeholder, queue-scoped.
  v := pg_temp.input(G);
  SELECT count(*) FILTER (WHERE b ->> 'block_type' = 'full_length'
                            AND b -> 'scope' = '{"form_id":null,"exam_mode":"strict"}'::jsonb),
         count(*) FILTER (WHERE b ->> 'explanation_key' = 'exam_review_placeholder'
                            AND b -> 'scope' = '{"mode":"queue"}'::jsonb)
    INTO n_fl, n_ph
    FROM jsonb_array_elements(public.calendar_compute_plan(v) -> 'days') d, jsonb_array_elements(d -> 'blocks') b;
  IF n_fl = 0 OR n_ph = 0 THEN
    PERFORM pg_temp.fail('FL9', format('G: %s strict tests, %s queue placeholders', n_fl, n_ph));
  END IF;
  BEGIN
    PERFORM public.calendar_exam_review_scope('exam_review', NULL);
    PERFORM pg_temp.fail('FL9', 'an exam review with no session id did not raise');
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;  -- the refusal under test
  END;
  PERFORM pg_temp.ok('FL9', format('exam review = session review of that exam at missed_count (both generators); %s generated tests at test-day timing; %s queue placeholders; no id -> raises', n_fl, n_ph));
END $fl9$;

DO $fl10$
DECLARE
  A CONSTANT uuid := 'e9b00000-0000-4000-8000-000000000006';
  sid uuid := (SELECT id FROM public.test_sessions WHERE student_id = A AND state = 'completed');
  raised boolean := false;
BEGIN
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
  VALUES (A, now() - interval '8 days', now() - interval '1 day', A, 'completed', 'completed', now());
  PERFORM public.execute_account_deletion_cascade(A, 'anonymize');
  -- 1. The calendar's own rows went with the profile (student_study_profile ON DELETE CASCADE).
  IF EXISTS (SELECT 1 FROM public.student_study_profile WHERE student_id = A) THEN
    PERFORM pg_temp.fail('FL10', 'the study profile survived anonymisation');
  END IF;
  -- 2. So the builder refuses before reading anything: no plan is generated for them.
  BEGIN
    PERFORM public.calendar_build_plan_input(A, ARRAY[(now() AT TIME ZONE 'UTC')::date]);
  EXCEPTION WHEN SQLSTATE '22023' THEN raised := true;
  END;
  IF NOT raised THEN PERFORM pg_temp.fail('FL10', 'the builder read an anonymised student'); END IF;
  -- 3. The exam itself is student-less, so it is nobody's "last exam" and nobody's next test.
  IF (SELECT student_id FROM public.test_sessions WHERE id = sid) IS NOT NULL THEN
    PERFORM pg_temp.fail('FL10', 'the anonymised exam still carries a student');
  END IF;
  IF EXISTS (SELECT 1 FROM public.calendar_blocks WHERE student_id = A) THEN
    PERFORM pg_temp.fail('FL10', 'calendar blocks survived for the anonymised student');
  END IF;
  PERFORM pg_temp.ok('FL10', 'anonymised: study profile cascaded away, the builder refuses (22023), the exam is student-less -- the path terminates');
END $fl10$;

DO $fl11$
BEGIN
  IF has_function_privilege('anon', 'public.exam_next_form_for_student(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.exam_next_form_for_student(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.calendar_exam_review_scope(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.calendar_exam_review_scope(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.exam_next_form_for_student(uuid)', 'EXECUTE') THEN
    PERFORM pg_temp.fail('FL11', 'grants: the new functions must be service_role only');
  END IF;
  PERFORM pg_temp.ok('FL11', 'exam_next_form_for_student and calendar_exam_review_scope: service_role only');
END $fl11$;
