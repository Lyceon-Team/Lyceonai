-- ============================================================================
-- Question of the Day (QOTD) + anonymous rate-limit ledger — schema gates
-- ============================================================================
-- Proves, against a throwaway database with the full migration pipeline applied, that the
-- QOTD schema refuses what the plan says it must refuse. Every gate asserts the expected
-- outcome or raises QOTD_SCHEMA_GATE_FAILED. Everything runs in one transaction and rolls back.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/qotd-schema-gates.sql
--
-- @spec [docs/plans/seo/seo-marketing-vertical.md R16-R18, Q1 ("DB: constraints in prod
--        catalog; 30 days scheduled, zero overlap with test_form_items; duplicate insert
--        rejected"); SCL-202 (anonymous ledger, rows expire with their window)]
--       | @implemented [2026-10-05]
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixture: 24 Math + 24 Reading & Writing published MCQs (6 per domain), one question with
-- assets, one draft, and a full-length test form holding 4 otherwise-eligible questions.
-- ---------------------------------------------------------------------------
WITH d(section, domain, ord) AS (
  VALUES ('M', 'Algebra', 1), ('M', 'Advanced Math', 2),
         ('M', 'Problem Solving and Data Analysis', 3), ('M', 'Geometry and Trigonometry', 4),
         ('RW', 'Information and Ideas', 1), ('RW', 'Craft and Structure', 2),
         ('RW', 'Expression of Ideas', 3), ('RW', 'Standard English Conventions', 4)
)
INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer,
   explanation, status, published_at, item_type)
SELECT format('SAT%s1Q%s%s', d.section, d.ord, lpad(n::text, 4, '0')),
       d.section, 1, d.domain, ARRAY['GATE'], 1,
       format('Gate stem %s %s', d.domain, n),
       '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
       'B', 'Gate explanation', 'published', now(), 'mcq'
  FROM d CROSS JOIN generate_series(1, 6) AS n;

INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer,
   explanation, status, published_at, item_type, assets)
VALUES ('SATM1XASSET', 'M', 1, 'Algebra', ARRAY['GATE'], 1, 'Has a figure',
        '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
        'A', 'x', 'published', now(), 'mcq', '[{"type":"image","src":"x.png"}]'::jsonb);

INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer,
   explanation, status, item_type)
VALUES ('SATM1XDRAFT', 'M', 1, 'Algebra', ARRAY['GATE'], 1, 'Draft',
        '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
        'A', 'x', 'draft', 'mcq');

INSERT INTO public.test_forms
  (id, name, test_kind, status, score_table_version, routing_threshold_rw, routing_threshold_m,
   break_duration_ms, rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms)
VALUES ('99999999-0000-0000-0000-000000000001', 'gate form', 'full_length', 'draft', 'v1.0',
        14, 11, 600000, 1920000, 1920000, 2100000, 2100000);

-- The first question of each Math domain and of one RW domain belongs to the exam form.
INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
VALUES ('99999999-0000-0000-0000-000000000001', 'M',  '1', 1, 'SATM1Q10001'),
       ('99999999-0000-0000-0000-000000000001', 'M',  '1', 2, 'SATM1Q20001'),
       ('99999999-0000-0000-0000-000000000001', 'M',  '1', 3, 'SATM1Q30001'),
       ('99999999-0000-0000-0000-000000000001', 'RW', '1', 1, 'SATRW1Q10001');

-- ---------------------------------------------------------------------------
-- Q-01 catalog: PK on qotd_date, UNIQUE on question_id, FK to questions; stats PK + FK.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.qotd_schedule'::regclass AND c.contype = 'p'
       AND a.attname = 'qotd_date' AND array_length(c.conkey, 1) = 1) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-01 qotd_schedule PK is not (qotd_date)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.qotd_schedule'::regclass AND c.contype = 'u'
       AND a.attname = 'question_id' AND array_length(c.conkey, 1) = 1) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-01 qotd_schedule.question_id is not UNIQUE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.qotd_schedule'::regclass AND c.contype = 'f'
       AND c.confrelid = 'public.questions'::regclass) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-01 qotd_schedule.question_id has no FK to questions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.qotd_schedule'::regclass
       AND attname = 'question_id' AND attnotnull) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-01 qotd_schedule.question_id is nullable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.qotd_daily_stats'::regclass AND c.contype = 'p') THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-01 qotd_daily_stats has no PK';
  END IF;
  RAISE NOTICE '    OK Q-01 schedule PK(qotd_date), UNIQUE(question_id) NOT NULL FK questions; stats PK';
END $$;

-- ---------------------------------------------------------------------------
-- Q-02 access: RLS on, no privilege for anon/authenticated on tables, functions are
-- SECURITY DEFINER with a pinned search_path and not executable by anon/authenticated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['qotd_schedule','qotd_daily_stats','rate_limit_ledger_anon']) AS t LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', r.t)::regclass) THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-02 RLS off on %', r.t;
    END IF;
    IF has_table_privilege('anon', format('public.%I', r.t), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', r.t), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', r.t), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', r.t), 'INSERT') THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-02 % is reachable by anon/authenticated', r.t;
    END IF;
  END LOOP;
  -- Presence first: the loop below checks only what exists, so all 8 must exist.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('qotd_question_is_eligible','qotd_schedule_candidates','qotd_schedule_insert',
                           'qotd_question_for','qotd_archive','qotd_record_attempt',
                           'rate_limit_check_and_increment_anon','sweep_rate_limit_ledger_anon')) <> 8 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-02 expected exactly 8 QOTD/anon-ledger functions';
  END IF;
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('qotd_question_is_eligible','qotd_schedule_candidates','qotd_schedule_insert',
                         'qotd_question_for','qotd_archive','qotd_record_attempt',
                         'rate_limit_check_and_increment_anon','sweep_rate_limit_ledger_anon')
  LOOP
    IF NOT r.prosecdef OR r.proconfig IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-02 % is not SECURITY DEFINER with a pinned search_path', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-02 % is executable by anon/authenticated', r.proname;
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-02 % is not executable by service_role', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE '    OK Q-02 RLS on, no anon/authenticated access, 8 functions SECDEF + service_role only';
END $$;

-- ---------------------------------------------------------------------------
-- Q-03 eligibility: the insert refuses exam-form items, questions with assets, drafts;
-- reports an existing date as 'exists'.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  v := public.qotd_schedule_insert(public.qotd_today() + 100, 'SATM1Q10001');
  IF v <> 'ineligible' THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-03 a test_form_items question was % (expected ineligible)', v;
  END IF;
  v := public.qotd_schedule_insert(public.qotd_today() + 100, 'SATM1XASSET');
  IF v <> 'ineligible' THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-03 a question with assets was % (expected ineligible)', v;
  END IF;
  v := public.qotd_schedule_insert(public.qotd_today() + 100, 'SATM1XDRAFT');
  IF v <> 'ineligible' THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-03 a draft question was % (expected ineligible)', v;
  END IF;
  IF EXISTS (SELECT 1 FROM public.qotd_schedule_candidates('M', 'Algebra', 100)
              WHERE question_id IN ('SATM1Q10001', 'SATM1XASSET', 'SATM1XDRAFT')) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-03 an ineligible question is offered as a candidate';
  END IF;
  RAISE NOTICE '    OK Q-03 exam-form items, asset questions and drafts are never scheduled or offered';
END $$;

-- ---------------------------------------------------------------------------
-- Q-04 30-day fill: alternate sections, rotate domains, first eligible candidate each day,
-- through qotd_schedule_insert. Then: 30 distinct questions, zero overlap with test_form_items.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  i integer; d date; sec text; dom text; cand text; res text;
  m_domains text[] := ARRAY['Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry'];
  rw_domains text[] := ARRAY['Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions'];
BEGIN
  FOR i IN 0..29 LOOP
    d := public.qotd_today() - 15 + i;
    IF i % 2 = 0 THEN sec := 'M'; dom := m_domains[(i / 2) % 4 + 1];
    ELSE sec := 'RW'; dom := rw_domains[(i / 2) % 4 + 1]; END IF;
    SELECT question_id INTO cand FROM public.qotd_schedule_candidates(sec, dom, 1);
    IF cand IS NULL THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-04 fixture exhausted at day % (% / %)', i, sec, dom;
    END IF;
    res := public.qotd_schedule_insert(d, cand);
    IF res <> 'inserted' THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-04 day % insert returned %', i, res;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.qotd_schedule) <> 30
     OR (SELECT count(DISTINCT question_id) FROM public.qotd_schedule) <> 30 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-04 expected 30 days with 30 distinct questions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qotd_schedule s JOIN public.test_form_items t ON t.question_id = s.question_id) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-04 a scheduled question is in test_form_items';
  END IF;
  -- Rerun of an existing day is a no-op.
  IF public.qotd_schedule_insert(public.qotd_today(), 'SATRW1Q40006') <> 'exists' THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-04 re-inserting a scheduled date was not a no-op';
  END IF;
  RAISE NOTICE '    OK Q-04 30 days scheduled, 30 distinct questions, zero overlap with test_form_items, rerun is a no-op';
END $$;

-- ---------------------------------------------------------------------------
-- Q-05 the database refuses a repeat: a duplicate question_id or a duplicate date (23505).
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_q text;
BEGIN
  SELECT question_id INTO v_q FROM public.qotd_schedule ORDER BY qotd_date LIMIT 1;
  BEGIN
    INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES (public.qotd_today() + 200, v_q);
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-05 a duplicate question_id was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES (public.qotd_today(), 'SATRW1Q40006');
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-05 a second question for one date was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE '    OK Q-05 duplicate question_id and duplicate date both rejected (23505)';
END $$;

-- ---------------------------------------------------------------------------
-- Q-06 future days are unreadable; today and past are readable; the archive is past only.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.qotd_question_for(public.qotd_today() + 1)) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-06 tomorrow is readable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qotd_question_for(NULL)) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-06 today (NULL date) is not readable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qotd_question_for(public.qotd_today() - 3)) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-06 a past day is not readable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qotd_archive() WHERE qotd_date >= public.qotd_today()) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-06 the archive includes today or a future day';
  END IF;
  IF (SELECT count(*) FROM public.qotd_archive()) <> 15 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-06 the archive should hold the 15 past days';
  END IF;
  RAISE NOTICE '    OK Q-06 future unreadable; today and past readable; archive is strictly past';
END $$;

-- ---------------------------------------------------------------------------
-- Q-07 stats: atomic increments; a future day cannot be counted; correct <= attempts.
-- ---------------------------------------------------------------------------
DO $$
DECLARE a integer; c integer;
BEGIN
  PERFORM public.qotd_record_attempt(public.qotd_today(), true);
  PERFORM public.qotd_record_attempt(public.qotd_today(), false);
  SELECT attempts, correct INTO a, c FROM public.qotd_record_attempt(public.qotd_today(), true);
  IF a <> 3 OR c <> 2 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-07 counters are %/% (expected 3/2)', a, c;
  END IF;
  BEGIN
    PERFORM public.qotd_record_attempt(public.qotd_today() + 1, true);
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-07 a future day was counted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    UPDATE public.qotd_daily_stats SET correct = attempts + 1 WHERE qotd_date = public.qotd_today();
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-07 correct > attempts was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A past day's counts reach the archive (the prerendered page and the API show one stat).
  PERFORM public.qotd_record_attempt(public.qotd_today() - 1, true);
  SELECT x.attempts, x.correct INTO a, c FROM public.qotd_archive() x
   WHERE x.qotd_date = public.qotd_today() - 1;
  IF a IS DISTINCT FROM 1 OR c IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-07 the archive does not carry a past day''s counts (got %/%)', a, c;
  END IF;
  RAISE NOTICE '    OK Q-07 atomic increments, future day refused, correct <= attempts, archive carries counts';
END $$;

-- ---------------------------------------------------------------------------
-- Q-08 anonymous ledger: the limit holds, the subject is a 32-byte HMAC, rows expire with
-- their window.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; h bytea := decode(repeat('ab', 32), 'hex');
BEGIN
  SELECT * INTO r FROM public.rate_limit_check_and_increment_anon(h, 'qotd_submit_ip', 1, now() - interval '1 minute', now() + interval '59 minutes', 2);
  IF NOT r.allowed OR r.remaining <> 1 THEN RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-08 first call'; END IF;
  SELECT * INTO r FROM public.rate_limit_check_and_increment_anon(h, 'qotd_submit_ip', 1, now() - interval '1 minute', now() + interval '59 minutes', 2);
  IF NOT r.allowed OR r.remaining <> 0 THEN RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-08 second call'; END IF;
  SELECT * INTO r FROM public.rate_limit_check_and_increment_anon(h, 'qotd_submit_ip', 1, now() - interval '1 minute', now() + interval '59 minutes', 2);
  IF r.allowed THEN RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-08 the third call over a limit of 2 was allowed'; END IF;
  BEGIN
    PERFORM public.rate_limit_check_and_increment_anon(decode('abcd', 'hex'), 'qotd_submit_ip', 1, now(), now() + interval '1 hour', 2);
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-08 a 2-byte subject was accepted (raw-IP guard)';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- An ended window is swept; a live one is kept.
  PERFORM public.rate_limit_check_and_increment_anon(h, 'qotd_read_ip', 1, now() - interval '2 hours', now() - interval '1 hour', 120);
  IF public.sweep_rate_limit_ledger_anon() <> 1 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-08 the sweep did not delete exactly the one ended row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rate_limit_ledger_anon WHERE bucket_key = 'qotd_submit_ip') THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-08 the sweep deleted a live row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rate_limit_runtime_config
                  WHERE key = 'bucket_definitions'
                    AND value ? 'qotd_read_ip' AND value ? 'qotd_submit_ip' AND value ? 'qotd_stat_ip') THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-08 qotd_* bucket definitions missing';
  END IF;
  RAISE NOTICE '    OK Q-08 limit holds, 32-byte subject enforced, ended windows swept, buckets seeded';
END $$;

ROLLBACK;

\echo 'QOTD SCHEMA GATES: PASS'
