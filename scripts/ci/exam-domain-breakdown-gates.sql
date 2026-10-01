-- ============================================================================
-- G1 gate — the exam report's per-domain breakdown (exam_domain_breakdown)
-- ============================================================================
-- @spec [Doc 04C §8.1/§9.1, §2.3 (no Module 2 path), §6 (04B's canonical
--        decomposition); Doc 04 Parent Q9 as amended by SCL-180; SCL-160]
-- @implemented [2026-09-27]
--
-- plain English: real exams walked through the E6 runtime functions and scored
--   exactly as the API does, then the breakdown read back and checked:
--     D1 a missing or foreign session is the same bare 403;
--     D2 per scored section, correct sums to score_runs' module1_correct +
--        module2_correct, total to the served item count, and each domain's
--        correct matches an independent count from the answers;
--     D3 THE ROUTING PREMISE (SCL-160): every published form in the database has
--        identical per-domain counts in 2A and 2B, so a total cannot reveal the
--        path. Read from the live rows, not the fixture's intent;
--     D4 each row carries exactly {section, domain, correct, total} — no module,
--        path, skill, difficulty or question id;
--     D5 a partial_scored session lists only its scored section; a session with
--        no score run lists nothing;
--     D6 service_role only.
-- Output contract: one "ok   [ID] ..." NOTICE per passing check; a failure
--   raises "G1 FAIL [ID]".
-- ============================================================================
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

\ir lib/exam-form-fixture.sql
\ir lib/exam-walk-fixture.sql
\ir lib/exam-seams-walk.sql

-- Fixtures
--   FULL  ...061001  one completed exam, mixed answers (D2, D4)
--   PART  ...061002  RW walked, Math Module 1 answered, past grace -> partial_scored (D5)
--   LIVE  ...061003  RW Module 1 answered, still active: no score run (D5)
--   OTHER ...061004  another student, for the foreign-session probe (D1)
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000061001', 'g1-full@example.com'),
  ('00000000-0000-0000-0000-000000061002', 'g1-part@example.com'),
  ('00000000-0000-0000-0000-000000061003', 'g1-live@example.com'),
  ('00000000-0000-0000-0000-000000061004', 'g1-other@example.com');
SELECT pg_temp.exam_fixture_make_form('61f00000-0000-4000-8000-000000000001', 'G1', 20, 15);
UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'G1 form'
 WHERE id = '61f00000-0000-4000-8000-000000000001';

CREATE TEMP TABLE _s (who text PRIMARY KEY, student uuid, session uuid);
DO $$
DECLARE F uuid := '61f00000-0000-4000-8000-000000000001'; v_sid uuid; r jsonb;
BEGIN
  INSERT INTO _s VALUES ('FULL', '00000000-0000-0000-0000-000000061001',
    pg_temp.walk('00000000-0000-0000-0000-000000061001', F, 'strict', ARRAY['RW', 'M']));

  v_sid := pg_temp.walk('00000000-0000-0000-0000-000000061002', F, 'strict', ARRAY['RW']);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module('00000000-0000-0000-0000-000000061002', v_sid, 'M', '1'), 200);
  PERFORM pg_temp.answer_mixed('00000000-0000-0000-0000-000000061002', v_sid, 'M', '1');
  INSERT INTO _s VALUES ('PART', '00000000-0000-0000-0000-000000061002', v_sid);

  r := public.exam_create_session('00000000-0000-0000-0000-000000061003', F, 'strict');
  v_sid := (r->'body'->>'session_id')::uuid;
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module('00000000-0000-0000-0000-000000061003', v_sid, 'RW', '1'), 200);
  PERFORM pg_temp.answer_mixed('00000000-0000-0000-0000-000000061003', v_sid, 'RW', '1');
  INSERT INTO _s VALUES ('LIVE', '00000000-0000-0000-0000-000000061003', v_sid);

  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'G1 FAIL [fixture]: drain failed'; END IF;
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second'
   WHERE id = (SELECT session FROM _s WHERE who = 'PART');
  PERFORM public.exam_abandonment_sweep();
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'G1 FAIL [fixture]: drain failed'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- D1 — missing and foreign sessions: one bare 403
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; a jsonb; b jsonb;
BEGIN
  SELECT * INTO s FROM _s WHERE who = 'FULL';
  a := public.exam_domain_breakdown('00000000-0000-0000-0000-000000061004', s.session);
  b := public.exam_domain_breakdown(s.student, gen_random_uuid());
  IF (a->>'status')::int <> 403 OR a IS DISTINCT FROM b OR a ? 'body' THEN
    RAISE EXCEPTION 'G1 FAIL [D1]: foreign % / missing %', a, b;
  END IF;
  PERFORM pg_temp.ok('D1', 'a foreign session and a missing one return the identical bare 403 (no body)');
END $$;

-- ---------------------------------------------------------------------------
-- D2 — the counts agree with scoring, with the served items, and with the answers
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; r record; v jsonb; sec text; v_sum_c int; v_sum_t int; v_want_c int; v_want_t int; v_bad int;
BEGIN
  SELECT * INTO s FROM _s WHERE who = 'FULL';
  v := public.exam_domain_breakdown(s.student, s.session);
  SELECT * INTO r FROM public.score_runs WHERE test_session_id = s.session;
  IF (v->>'status')::int <> 200 OR r IS NULL OR NOT (r.rw_scored AND r.math_scored) THEN
    RAISE EXCEPTION 'G1 FAIL [D2]: fixture not scored: % %', v, r;
  END IF;
  FOREACH sec IN ARRAY ARRAY['RW', 'M'] LOOP
    SELECT COALESCE(sum((d->>'correct')::int), 0), COALESCE(sum((d->>'total')::int), 0)
      INTO v_sum_c, v_sum_t
      FROM jsonb_array_elements(v->'body'->'domains') d WHERE d->>'section' = sec;
    v_want_c := CASE sec WHEN 'RW' THEN r.rw_module1_correct + r.rw_module2_correct
                         ELSE r.math_module1_correct + r.math_module2_correct END;
    SELECT count(*) INTO v_want_t FROM public.test_session_items
     WHERE test_session_id = s.session AND section = sec;
    IF v_sum_c <> v_want_c OR v_sum_t <> v_want_t OR v_want_t = 0 THEN
      RAISE EXCEPTION 'G1 FAIL [D2]: % correct % vs score_runs %, total % vs served %',
        sec, v_sum_c, v_want_c, v_sum_t, v_want_t;
    END IF;
  END LOOP;
  -- per domain, against an independent count over the served items and their answers
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v->'body'->'domains') d
   WHERE (d->>'correct')::int <> (
           SELECT count(*) FROM public.test_session_items i
             JOIN public.questions q ON q.id = i.question_id
             JOIN public.test_session_answers a
               ON a.test_session_id = i.test_session_id AND a.section = i.section
              AND a.module = i.module AND a.ordinal = i.ordinal
            WHERE i.test_session_id = s.session AND i.section = d->>'section'
              AND q.domain = d->>'domain' AND public.is_answer_correct(a.answer, a.question_id))
      OR (d->>'total')::int <> (
           SELECT count(*) FROM public.test_session_items i
             JOIN public.questions q ON q.id = i.question_id
            WHERE i.test_session_id = s.session AND i.section = d->>'section'
              AND q.domain = d->>'domain');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'G1 FAIL [D2]: % domain row(s) disagree with the answers', v_bad; END IF;
  PERFORM pg_temp.ok('D2', format('FULL: RW %s/%s and Math %s/%s correct-of-served equal score_runs module1+module2 correct and the served item count; %s domain rows each match an independent count',
    r.rw_module1_correct + r.rw_module2_correct,
    (SELECT count(*) FROM public.test_session_items WHERE test_session_id = s.session AND section = 'RW'),
    r.math_module1_correct + r.math_module2_correct,
    (SELECT count(*) FROM public.test_session_items WHERE test_session_id = s.session AND section = 'M'),
    jsonb_array_length(v->'body'->'domains')));
END $$;

-- ---------------------------------------------------------------------------
-- D3 — the routing premise, on the live rows: 2A and 2B agree domain by domain
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_forms int; v_diff int;
BEGIN
  SELECT count(*) INTO v_forms FROM public.test_forms WHERE status = 'published';
  SELECT count(*) INTO v_diff FROM (
    SELECT fi.test_form_id, fi.section, q.domain,
           count(*) FILTER (WHERE fi.module = '2A') AS a,
           count(*) FILTER (WHERE fi.module = '2B') AS b
      FROM public.test_form_items fi
      JOIN public.test_forms f ON f.id = fi.test_form_id AND f.status = 'published'
      JOIN public.questions q  ON q.id = fi.question_id
     WHERE fi.module IN ('2A', '2B')
     GROUP BY 1, 2, 3) x
   WHERE a <> b;
  IF v_forms = 0 OR v_diff <> 0 THEN
    RAISE EXCEPTION 'G1 FAIL [D3]: % published form(s), % (form, section, domain) cell(s) where 2A and 2B differ', v_forms, v_diff;
  END IF;
  PERFORM pg_temp.ok('D3', format('%s published form(s): every (section, domain) has the same count in 2A and 2B, so a total never reveals the routed module', v_forms));
END $$;

-- ---------------------------------------------------------------------------
-- D4 — exactly four keys per row; nothing module-, path-, skill- or item-shaped
-- ---------------------------------------------------------------------------
DO $$
DECLARE s record; v jsonb; v_bad int;
BEGIN
  SELECT * INTO s FROM _s WHERE who = 'FULL';
  v := public.exam_domain_breakdown(s.student, s.session);
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(v->'body'->'domains') d
   WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(d) k) <> ARRAY['correct', 'domain', 'section', 'total'];
  IF v_bad <> 0 OR v::text ~* '(module|path|2A|2B|skill|difficulty|question_id|SAT[A-Z]*1)' THEN
    RAISE EXCEPTION 'G1 FAIL [D4]: % row(s) with other keys, or a forbidden token in %', v_bad, v;
  END IF;
  PERFORM pg_temp.ok('D4', 'every row is exactly {section, domain, correct, total}; no module, path, skill, difficulty or question id anywhere in the output');
END $$;

-- ---------------------------------------------------------------------------
-- D5 — only scored sections; nothing without a score run
-- ---------------------------------------------------------------------------
DO $$
DECLARE p record; l record; vp jsonb; vl jsonb; v_rw_scored boolean; v_m_scored boolean;
BEGIN
  SELECT * INTO p FROM _s WHERE who = 'PART';
  SELECT * INTO l FROM _s WHERE who = 'LIVE';
  SELECT rw_scored, math_scored INTO v_rw_scored, v_m_scored FROM public.score_runs WHERE test_session_id = p.session;
  vp := public.exam_domain_breakdown(p.student, p.session);
  vl := public.exam_domain_breakdown(l.student, l.session);
  IF NOT COALESCE(v_rw_scored, false) OR COALESCE(v_m_scored, true)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(vp->'body'->'domains') d WHERE d->>'section' <> 'RW')
     OR jsonb_array_length(vp->'body'->'domains') = 0
     OR vl->'body'->'domains' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'G1 FAIL [D5]: partial % (rw %, m %), live %', vp, v_rw_scored, v_m_scored, vl;
  END IF;
  PERFORM pg_temp.ok('D5', format('PART (partial_scored, RW scored, Math not): %s RW rows and no Math row; LIVE (no score run): []',
    jsonb_array_length(vp->'body'->'domains')));
END $$;

-- ---------------------------------------------------------------------------
-- D6 — service_role only
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.exam_domain_breakdown(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.exam_domain_breakdown(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.exam_domain_breakdown(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G1 FAIL [D6]: grants wrong';
  END IF;
  PERFORM pg_temp.ok('D6', 'exam_domain_breakdown: anon and authenticated cannot execute it; service_role can');
END $$;
