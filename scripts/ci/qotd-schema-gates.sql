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
                           'rate_limit_check_and_increment_anon','sweep_rate_limit_ledger_anon',
                           'qotd_schedule_candidate_page','qotd_schedule_upcoming','qotd_schedule_release')) <> 11 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-02 expected exactly 11 QOTD/anon-ledger functions';
  END IF;
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('qotd_question_is_eligible','qotd_schedule_candidates','qotd_schedule_insert',
                         'qotd_question_for','qotd_archive','qotd_record_attempt',
                         'rate_limit_check_and_increment_anon','sweep_rate_limit_ledger_anon',
                         'qotd_schedule_candidate_page','qotd_schedule_upcoming','qotd_schedule_release')
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
  RAISE NOTICE '    OK Q-02 RLS on, no anon/authenticated access, 11 functions SECDEF + service_role only';
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

-- ---------------------------------------------------------------------------
-- Q-09 readability filter support (owner brief "QOTD — readability filter", Karl 2026-10-09):
--   * qotd_schedule_release never touches today or the past, whatever the caller passes, and
--     releases exactly one upcoming row;
--   * qotd_schedule_upcoming lists only days strictly after its argument;
--   * qotd_schedule_candidate_page keeps the eligibility predicate, returns item_type, and pages
--     by id with no overlap.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  q_today text; q_past text; q_future text; n integer; p1 text[]; p2 text[];
BEGIN
  SELECT question_id INTO q_today FROM public.qotd_schedule WHERE qotd_date = public.qotd_today();
  SELECT question_id INTO q_past FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() - 3;
  SELECT question_id INTO q_future FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() + 3;
  -- Presence first: Q-04 scheduled all three days.
  IF q_today IS NULL OR q_past IS NULL OR q_future IS NULL THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 fixture days missing';
  END IF;
  -- The past day first: it has no stats row, so a missing guard shows as this assertion, not as
  -- the stats foreign key (which would also stop today's delete, for the wrong reason).
  IF public.qotd_schedule_release(public.qotd_today() - 3, q_past) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 a past day was released';
  END IF;
  IF public.qotd_schedule_release(public.qotd_today(), q_today) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 today was released';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qotd_schedule WHERE qotd_date = public.qotd_today())
     OR NOT EXISTS (SELECT 1 FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() - 3) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 today or a past day lost its row';
  END IF;
  IF public.qotd_schedule_release(public.qotd_today() + 3, 'SATM1NOTTHIS') THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 a release with the wrong question id deleted a row';
  END IF;
  IF NOT public.qotd_schedule_release(public.qotd_today() + 3, q_future) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 an upcoming day was not released';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() + 3) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 the released upcoming row is still there';
  END IF;
  -- Upcoming: strictly after the argument.
  IF EXISTS (SELECT 1 FROM public.qotd_schedule_upcoming(public.qotd_today()) WHERE qotd_date <= public.qotd_today()) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 upcoming listed today or a past day';
  END IF;
  SELECT count(*) INTO n FROM public.qotd_schedule_upcoming(public.qotd_today());
  IF n <> (SELECT count(*) FROM public.qotd_schedule WHERE qotd_date > public.qotd_today()) OR n = 0 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 upcoming row count %', n;
  END IF;
  -- Candidate pages: eligible only, item_type present, keyset with no overlap.
  IF EXISTS (SELECT 1 FROM public.qotd_schedule_candidate_page('M', 'Algebra', NULL, 100)
              WHERE question_id IN ('SATM1Q10001', 'SATM1XASSET', 'SATM1XDRAFT') OR item_type IS NULL) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 an ineligible question (or no item_type) in a candidate page';
  END IF;
  SELECT array_agg(question_id ORDER BY question_id) INTO p1 FROM public.qotd_schedule_candidate_page('RW', 'Craft and Structure', NULL, 1);
  SELECT array_agg(question_id ORDER BY question_id) INTO p2 FROM public.qotd_schedule_candidate_page('RW', 'Craft and Structure', p1[1], 1);
  IF p1 IS NULL OR p2 IS NULL OR p2[1] <= p1[1] THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-09 candidate pages overlap or do not advance (% then %)', p1, p2;
  END IF;
  RAISE NOTICE '    OK Q-09 release refuses today and the past, upcoming lists only future days, candidate pages advance';
END $$;

-- ---------------------------------------------------------------------------
-- Q-10 shuffle once at scheduling (Karl, 2026-10-28; SCL-258):
--   (a) the insert stores exactly qotd_shuffled_option_order's order and the letter derived from
--       it, for every scheduled day; the readers return both;
--   (b) the stored order and letter are write-once: an UPDATE raises 42501;
--   (c) the shuffle is deterministic and is a permutation of the authored keys;
--   (d) distribution: over 40,000 (date, question) pairs with the correct key 'B', each display
--       letter lands within 5 standard deviations of 25% (sd = sqrt(n * .25 * .75) ~ 86.6),
--       and all 24 orders of four keys appear, each within 5 sd of n/24;
--   (e) three options shuffle too, each letter within 5 sd of a third.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record; v_n integer; v_cnt integer; v_exp numeric; v_sd numeric; v_ord text[]; v_q text;
BEGIN
  -- (a) every day Q-04 scheduled carries the helper's order and the derived letter.
  IF (SELECT count(*) FROM public.qotd_schedule) = 0 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 no scheduled rows to check (presence first)';
  END IF;
  FOR r IN SELECT s.*, q.options, q.correct_answer FROM public.qotd_schedule s
             JOIN public.questions q ON q.id = s.question_id LOOP
    IF r.option_order IS DISTINCT FROM public.qotd_shuffled_option_order(r.options, r.qotd_date, r.question_id) THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 % stored order % is not the shuffle helper''s', r.qotd_date, r.option_order;
    END IF;
    IF r.correct_display_letter IS DISTINCT FROM public.qotd_display_letter(r.option_order, r.correct_answer) THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 % stored letter disagrees with its order', r.qotd_date;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.qotd_schedule WHERE option_order <> '{A,B,C,D}') THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 no scheduled day was shuffled';
  END IF;
  SELECT f.option_order INTO v_ord FROM public.qotd_question_for(public.qotd_today() - 3) f;
  IF v_ord IS DISTINCT FROM (SELECT option_order FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() - 3) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 qotd_question_for does not return the stored order';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qotd_archive() a JOIN public.qotd_schedule s USING (qotd_date)
              WHERE a.option_order IS DISTINCT FROM s.option_order
                 OR a.correct_display_letter IS DISTINCT FROM s.correct_display_letter) THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 qotd_archive does not return the stored order and letter';
  END IF;

  -- (b) write-once.
  BEGIN
    UPDATE public.qotd_schedule SET option_order = '{A,B,C,D}' WHERE qotd_date = (SELECT min(qotd_date) FROM public.qotd_schedule);
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 an UPDATE of a stored order was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.qotd_schedule SET correct_display_letter = 'A' WHERE qotd_date = (SELECT min(qotd_date) FROM public.qotd_schedule);
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 an UPDATE of a stored letter was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- (b2) no caller chooses an order: a direct INSERT carrying one other than the helper's (here
  --      the helper's reversed) is refused (42501); a direct INSERT without one gets the helper's.
  SELECT question_id INTO v_q FROM public.qotd_schedule_candidates('RW', 'Craft and Structure', 1);
  IF v_q IS NULL THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 fixture has no unscheduled candidate left';
  END IF;
  SELECT array_agg(k ORDER BY n DESC) INTO v_ord
    FROM unnest(public.qotd_shuffled_option_order(
           (SELECT options FROM public.questions WHERE id = v_q), public.qotd_today() + 300, v_q))
         WITH ORDINALITY AS t(k, n);
  BEGIN
    INSERT INTO public.qotd_schedule (qotd_date, question_id, option_order)
    VALUES (public.qotd_today() + 300, v_q, v_ord);
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 a caller-supplied order was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() + 300;
  INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES (public.qotd_today() + 300, v_q);
  IF (SELECT option_order FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() + 300)
     IS DISTINCT FROM public.qotd_shuffled_option_order(
       (SELECT options FROM public.questions WHERE id = v_q), public.qotd_today() + 300, v_q)
     OR (SELECT correct_display_letter FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() + 300) IS NULL THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 a direct INSERT did not get the helper''s order and letter';
  END IF;
  DELETE FROM public.qotd_schedule WHERE qotd_date = public.qotd_today() + 300;

  -- (c) deterministic and a permutation.
  IF public.qotd_shuffled_option_order('[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb, DATE '2026-11-01', 'SATM1Q10002')
     IS DISTINCT FROM
     public.qotd_shuffled_option_order('[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb, DATE '2026-11-01', 'SATM1Q10002') THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 the shuffle is not deterministic';
  END IF;

  -- (d) four options.
  CREATE TEMP TABLE q10_runs ON COMMIT DROP AS
    SELECT public.qotd_shuffled_option_order(
             '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
             DATE '2026-01-01' + (g % 2000), 'SATM1Q' || lpad((g / 2000)::text, 5, '0')) AS ord
      FROM generate_series(0, 39999) AS g;
  SELECT count(*) INTO v_n FROM q10_runs;
  IF EXISTS (SELECT 1 FROM q10_runs WHERE (SELECT array_agg(x ORDER BY x) FROM unnest(ord) x) <> '{A,B,C,D}') THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 a shuffle is not a permutation of A-D';
  END IF;
  v_exp := v_n * 0.25; v_sd := sqrt(v_n * 0.25 * 0.75);
  FOR r IN SELECT l, count(*) FILTER (WHERE public.qotd_display_letter(ord, 'B') = l) AS c
             FROM q10_runs, unnest(ARRAY['A','B','C','D']) AS l GROUP BY l LOOP
    IF abs(r.c - v_exp) > 5 * v_sd THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 letter % holds the answer % times in % (expected % +/- %)',
        r.l, r.c, v_n, v_exp, round(5 * v_sd);
    END IF;
  END LOOP;
  SELECT count(DISTINCT ord) INTO v_cnt FROM q10_runs;
  IF v_cnt <> 24 THEN
    RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 only % of the 24 orders appear', v_cnt;
  END IF;
  v_exp := v_n / 24.0; v_sd := sqrt(v_n * (1 / 24.0) * (23 / 24.0));
  FOR r IN SELECT ord, count(*) AS c FROM q10_runs GROUP BY ord LOOP
    IF abs(r.c - v_exp) > 5 * v_sd THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 order % appears % times (expected % +/- %)', r.ord, r.c, round(v_exp), round(5 * v_sd);
    END IF;
  END LOOP;

  -- (e) three options.
  v_exp := 12000 / 3.0; v_sd := sqrt(12000 * (1 / 3.0) * (2 / 3.0));
  FOR r IN
    SELECT public.qotd_display_letter(o, 'B') AS l, count(*) AS c
      FROM (SELECT public.qotd_shuffled_option_order(
                     '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"}]'::jsonb,
                     DATE '2026-01-01' + g, 'SATRW1Q00001') AS o
              FROM generate_series(0, 11999) AS g) t
     GROUP BY 1
  LOOP
    IF r.l NOT IN ('A', 'B', 'C') OR abs(r.c - v_exp) > 5 * v_sd THEN
      RAISE EXCEPTION 'QOTD_SCHEMA_GATE_FAILED: Q-10 three options: letter % holds the answer % times in 12000', r.l, r.c;
    END IF;
  END LOOP;

  RAISE NOTICE '    OK Q-10 stored order = shuffle helper, letter derived, write-once, permutation, 40k-run distribution within 5 sd of 25%%';
END $$;

ROLLBACK;

\echo 'QOTD SCHEMA GATES: PASS'
