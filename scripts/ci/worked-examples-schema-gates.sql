-- ============================================================================
-- Worked examples — schema gates
-- ============================================================================
-- Proves, against a throwaway database with the full migration pipeline applied, that the
-- worked-example schema refuses what the brief says it must refuse. Every gate asserts the
-- expected outcome or raises WORKED_EXAMPLES_GATE_FAILED. One transaction, rolled back.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/worked-examples-schema-gates.sql
--
-- @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): data model,
--        acceptance "metrics table schema and RLS"; Step 0 ruling 1 (no future-QOTD or
--        full-length questions; the QOTD scheduler skips approved worked-example questions)]
--       | @implemented [2026-10-27]
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixture: eight published Math MCQs (WEGT01..08), one full-length form holding WEGT02,
-- QOTD days for WEGT03 (today), WEGT04 (in 5 days) and WEGT05 (10 days ago).
-- ---------------------------------------------------------------------------
INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer,
   explanation, status, published_at, item_type)
SELECT format('SATM1WEGT%s', lpad(n::text, 2, '0')), 'M', 1, 'Problem Solving and Data Analysis',
       ARRAY['Percentages'], 1, format('Worked-example gate stem %s', n),
       '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
       'B', 'Gate explanation', 'published', now(), 'mcq'
  FROM generate_series(1, 8) AS n;

INSERT INTO public.test_forms
  (id, name, test_kind, status, score_table_version, routing_threshold_rw, routing_threshold_m,
   break_duration_ms, rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms)
VALUES ('99999999-0000-0000-0000-0000000000e1', 'we gate form', 'full_length', 'draft', 'v1.0',
        14, 11, 600000, 1920000, 1920000, 2100000, 2100000);
INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
VALUES ('99999999-0000-0000-0000-0000000000e1', 'M', '1', 1, 'SATM1WEGT02');

INSERT INTO public.qotd_schedule (qotd_date, question_id)
VALUES (public.qotd_today(),      'SATM1WEGT03'),
       (public.qotd_today() + 5,  'SATM1WEGT04'),
       (public.qotd_today() - 10, 'SATM1WEGT05');

-- A valid row for a question; status and post_on vary per gate.
CREATE TEMP TABLE we_gate_row AS
SELECT '{"notepad":"+25% → × 1.25","voice":"Up twenty-five percent means times one point two five."}'::jsonb AS step;

CREATE OR REPLACE FUNCTION pg_temp.we_insert(p_qid text, p_status text, p_post_on date, p_steps jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.worked_examples
    (id, question_id, skill_code, signature_move, steps, trap, check_step, takeaway, video_script,
     hook_type, hook_line, post_on, status, approved_by, approved_at)
  VALUES ('we-' || lower(p_qid), p_qid, 'Percentages', 'Turn each percent change into a multiplier.',
          COALESCE(p_steps, (SELECT jsonb_build_array(step, step, step) FROM we_gate_row)),
          'Adding the percents.', 'Plug in 100.', 'Percent changes multiply.', 'Script.',
          'puzzle', 'Up 25%, then down 25%. Back to $64?', p_post_on, p_status,
          CASE WHEN p_status = 'approved' THEN 'Karl' END,
          CASE WHEN p_status = 'approved' THEN now() END);
END $$;

-- Asserts that a statement is refused with the given SQLSTATE.
CREATE OR REPLACE FUNCTION pg_temp.we_refused(p_sql text, p_state text, p_gate text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: % refused with % (%), expected %', p_gate, SQLSTATE, SQLERRM, p_state;
  END;
  RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: % was accepted: %', p_gate, p_sql;
END $$;

-- ---------------------------------------------------------------------------
-- W-01 catalog: PK, question_id UNIQUE NOT NULL FK, one approved row per post_on, metrics FK.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.worked_examples'::regclass AND c.contype = 'u'
       AND a.attname = 'question_id' AND array_length(c.conkey, 1) = 1) THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-01 worked_examples.question_id is not UNIQUE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.worked_examples'::regclass AND c.contype = 'f'
       AND c.confrelid = 'public.questions'::regclass) THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-01 worked_examples.question_id has no FK to questions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.worked_example_metrics'::regclass AND c.contype = 'f'
       AND c.confrelid = 'public.worked_examples'::regclass) THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-01 worked_example_metrics has no FK to worked_examples';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.worked_examples'::regclass AND i.indisunique
       AND pg_get_indexdef(i.indexrelid) LIKE '%(post_on)%'
       AND pg_get_expr(i.indpred, i.indrelid) LIKE '%approved%') THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-01 no unique index on post_on for approved rows';
  END IF;
  -- The brief's metric columns, under their stored names.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'worked_example_metrics'
         AND column_name IN ('worked_example_id','platform','captured_at','views','retention_3s_pct',
                             'avg_watch_seconds','completion_pct','non_follower_view_pct','follows')) <> 9 THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-01 worked_example_metrics is missing a brief column';
  END IF;
  RAISE NOTICE '    OK W-01 question_id UNIQUE FK; metrics FK + 9 columns; one approved per post_on';
END $$;

-- ---------------------------------------------------------------------------
-- W-02 access: RLS on, no anon/authenticated privilege on either table or either view; the
-- views run as the invoker so they carry the tables' protection.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; p text;
BEGIN
  FOR r IN SELECT unnest(ARRAY['worked_examples','worked_example_metrics']) AS t LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', r.t)::regclass) THEN
      RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-02 RLS off on %', r.t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.t) THEN
      RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-02 % has an RLS policy (service_role only means none)', r.t;
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['worked_examples','worked_example_metrics',
                               'questions_with_usage','worked_example_metrics_monthly']) AS t LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('anon', format('public.%I', r.t), p)
         OR has_table_privilege('authenticated', format('public.%I', r.t), p) THEN
        RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-02 % has % for anon/authenticated', r.t, p;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role', format('public.%I', r.t), 'SELECT') THEN
      RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-02 service_role cannot read %', r.t;
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['questions_with_usage','worked_example_metrics_monthly']) AS t LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = format('public.%I', r.t)::regclass
                    AND 'security_invoker=true' = ANY (reloptions)) THEN
      RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-02 view % is not security_invoker', r.t;
    END IF;
  END LOOP;
  RAISE NOTICE '    OK W-02 RLS on, no policies, no anon/authenticated privilege, views security_invoker';
END $$;

-- Behavioural proof of W-02: the roles are actually refused.
SET LOCAL ROLE anon;
SELECT pg_temp.we_refused('SELECT 1 FROM public.questions_with_usage LIMIT 1', '42501', 'W-02 anon reads questions_with_usage');
SELECT pg_temp.we_refused('SELECT 1 FROM public.worked_examples LIMIT 1', '42501', 'W-02 anon reads worked_examples');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.we_refused('SELECT 1 FROM public.worked_example_metrics LIMIT 1', '42501', 'W-02 authenticated reads worked_example_metrics');
SELECT pg_temp.we_refused('SELECT 1 FROM public.questions_with_usage LIMIT 1', '42501', 'W-02 authenticated reads questions_with_usage');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- W-03 row shape: steps 3..6 {notepad, voice}; hook_type in the library; id from question_id;
-- an approved row carries approver, time and post_on.
-- ---------------------------------------------------------------------------
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT06', 'draft', NULL,
  (SELECT jsonb_build_array(step, step) FROM we_gate_row))$$, '23514', 'W-03 two steps');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT06', 'draft', NULL,
  (SELECT jsonb_build_array(step, step, step, step, step, step, step) FROM we_gate_row))$$, '23514', 'W-03 seven steps');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT06', 'draft', NULL,
  (SELECT jsonb_build_array(step, step, step - 'voice') FROM we_gate_row))$$, '23514', 'W-03 step without voice');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT06', 'draft', NULL,
  (SELECT jsonb_build_array(step, step, jsonb_set(step, '{notepad}', '""')) FROM we_gate_row))$$, '23514', 'W-03 empty notepad line');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT06', 'draft', NULL,
  (SELECT jsonb_build_array(step, step, '"just text"'::jsonb) FROM we_gate_row))$$, '23514', 'W-03 non-object step');
SELECT pg_temp.we_refused($$INSERT INTO public.worked_examples (id, question_id, skill_code, signature_move, steps, trap, check_step,
    takeaway, video_script, hook_type, hook_line)
  SELECT 'we-satm1wegt06', 'SATM1WEGT06', 's', 'm', jsonb_build_array(step, step, step), 't', 'c', 'k', 'v',
         'statistic', 'h' FROM we_gate_row$$, '23514', 'W-03 hook_type outside the library');
SELECT pg_temp.we_refused($$INSERT INTO public.worked_examples (id, question_id, skill_code, signature_move,
    steps, trap, check_step, takeaway, video_script, hook_type, hook_line)
  SELECT 'we-other', 'SATM1WEGT06', 's', 'm', jsonb_build_array(step, step, step), 't', 'c', 'k', 'v',
         'puzzle', 'h' FROM we_gate_row$$, '23514', 'W-03 id not derived from question_id');
SELECT pg_temp.we_refused($$INSERT INTO public.worked_examples (id, question_id, skill_code, signature_move,
    steps, trap, check_step, takeaway, video_script, hook_type, hook_line, status, approved_by, approved_at)
  SELECT 'we-satm1wegt06', 'SATM1WEGT06', 's', 'm', jsonb_build_array(step, step, step), 't', 'c', 'k', 'v',
         'puzzle', 'h', 'approved', 'Karl', now() FROM we_gate_row$$, '23514', 'W-03 approved without post_on');
-- Presence before absence: the same row, valid, is accepted (six steps, the upper bound).
SELECT pg_temp.we_insert('SATM1WEGT06', 'draft', NULL,
  (SELECT jsonb_build_array(step, step, step, step, step, step) FROM we_gate_row));
DO $$ BEGIN RAISE NOTICE '    OK W-03 steps 3..6 {notepad, voice}, hook library, derived id, complete approval'; END $$;

-- ---------------------------------------------------------------------------
-- W-04 leak rule, worked-example side: never approved while in a full-length form or a QOTD
-- today or later, on INSERT and on UPDATE; a past QOTD is allowed; a draft is allowed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT02', 'approved', public.qotd_today() + 30)$$,
  '23514', 'W-04 approve a full-length question');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT03', 'approved', public.qotd_today() + 31)$$,
  '23514', 'W-04 approve today''s QOTD question');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_insert('SATM1WEGT04', 'approved', public.qotd_today() + 32)$$,
  '23514', 'W-04 approve a future QOTD question');
-- A draft of a future-QOTD question may exist; approving it by UPDATE is refused.
SELECT pg_temp.we_insert('SATM1WEGT04', 'draft', NULL);
SELECT pg_temp.we_refused($$UPDATE public.worked_examples
   SET status = 'approved', approved_by = 'Karl', approved_at = now(), post_on = public.qotd_today() + 33
 WHERE question_id = 'SATM1WEGT04'$$, '23514', 'W-04 approve by UPDATE a future QOTD question');
-- A past QOTD question is already public in the archive: allowed.
SELECT pg_temp.we_insert('SATM1WEGT05', 'approved', public.qotd_today() + 34);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.worked_examples WHERE question_id = 'SATM1WEGT05' AND status = 'approved') THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-04 a past-QOTD question could not be approved';
  END IF;
  RAISE NOTICE '    OK W-04 full-length and today/future QOTD refused (insert and update); past QOTD allowed';
END $$;

-- ---------------------------------------------------------------------------
-- W-05 leak rule, QOTD side: an approved worked example makes its question ineligible for the
-- QOTD (eligibility, candidates, insert); a draft one does not.
-- ---------------------------------------------------------------------------
SELECT pg_temp.we_insert('SATM1WEGT07', 'approved', public.qotd_today() + 35);
SELECT pg_temp.we_insert('SATM1WEGT08', 'draft', NULL);
DO $$
DECLARE v text;
BEGIN
  IF public.qotd_question_is_eligible('SATM1WEGT07') THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-05 an approved worked-example question is QOTD-eligible';
  END IF;
  IF NOT public.qotd_question_is_eligible('SATM1WEGT08') THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-05 a draft worked example made its question ineligible';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qotd_schedule_candidates('M', 'Problem Solving and Data Analysis', 500)
              WHERE question_id = 'SATM1WEGT07') THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-05 an approved worked-example question is a QOTD candidate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qotd_schedule_candidates('M', 'Problem Solving and Data Analysis', 500)
                  WHERE question_id = 'SATM1WEGT08') THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-05 the draft question is missing from the candidates';
  END IF;
  v := public.qotd_schedule_insert(public.qotd_today() + 40, 'SATM1WEGT07');
  IF v <> 'ineligible' THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-05 qotd_schedule_insert returned % for an approved worked-example question', v;
  END IF;
  RAISE NOTICE '    OK W-05 approved worked example skipped by eligibility, candidates and insert; draft not';
END $$;

-- ---------------------------------------------------------------------------
-- W-06 one approved example per post_on; a retired one may share the day.
-- ---------------------------------------------------------------------------
SELECT pg_temp.we_refused($$UPDATE public.worked_examples
   SET status = 'approved', approved_by = 'Karl', approved_at = now(), post_on = public.qotd_today() + 35
 WHERE question_id = 'SATM1WEGT08'$$, '23505', 'W-06 two approved examples on one day');
UPDATE public.worked_examples SET status = 'retired', post_on = public.qotd_today() + 35
 WHERE question_id = 'SATM1WEGT08';
DO $$ BEGIN RAISE NOTICE '    OK W-06 one approved example per post_on'; END $$;

-- ---------------------------------------------------------------------------
-- W-07 questions_with_usage: every question column plus usage_tags, tags in a fixed order,
-- {} (never NULL) for an unused question.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v text[];
BEGIN
  IF (SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'questions_with_usage')
     IS DISTINCT FROM
     (SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'questions') || ARRAY['usage_tags'] THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-07 questions_with_usage columns are not questions.* + usage_tags';
  END IF;
  -- WEGT05: a past QOTD and an approved worked example.
  SELECT usage_tags INTO v FROM public.questions_with_usage WHERE id = 'SATM1WEGT05';
  IF v IS DISTINCT FROM ARRAY['qotd','worked_example'] THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-07 WEGT05 usage_tags = %', v;
  END IF;
  -- Put WEGT05 in the form too (after approval; the guard is on worked_examples writes).
  INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
  VALUES ('99999999-0000-0000-0000-0000000000e1', 'M', '1', 2, 'SATM1WEGT05');
  SELECT usage_tags INTO v FROM public.questions_with_usage WHERE id = 'SATM1WEGT05';
  IF v IS DISTINCT FROM ARRAY['qotd','full_length','worked_example'] THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-07 tag order = %', v;
  END IF;
  SELECT usage_tags INTO v FROM public.questions_with_usage WHERE id = 'SATM1WEGT01';
  IF v IS NULL OR cardinality(v) <> 0 THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-07 an unused question has usage_tags %', v;
  END IF;
  -- A draft worked example is not a use.
  SELECT usage_tags INTO v FROM public.questions_with_usage WHERE id = 'SATM1WEGT06';
  IF cardinality(v) <> 0 THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-07 a draft worked example tagged its question: %', v;
  END IF;
  RAISE NOTICE '    OK W-07 questions.* + usage_tags, fixed order, {} when unused, drafts not counted';
END $$;

-- ---------------------------------------------------------------------------
-- W-08 metrics: bounds, platform list, one reading per (example, platform, captured_at), FK;
-- the monthly readout keeps the latest reading per month.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.we_metric(p_we text, p_platform text, p_at timestamptz, p_views integer,
  p_ret numeric, p_avg numeric, p_comp numeric, p_nonf numeric, p_follows integer)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.worked_example_metrics (worked_example_id, platform, captured_at, views, retention_3s_pct,
    avg_watch_seconds, completion_pct, non_follower_view_pct, follows)
  VALUES (p_we, p_platform, p_at, p_views, p_ret, p_avg, p_comp, p_nonf, p_follows)
$$;
SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-11-03T12:00Z', 1200, 61.5, 14.2, 22.0, 80.0, 9);
SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-11-10T12:00Z', 3400, 58.0, 13.1, 20.5, 84.0, 21);
SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-12-02T12:00Z', 3900, 57.0, 13.0, 20.0, 85.0, 24);
SELECT pg_temp.we_refused($$SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-11-10T12:00Z', 1, 1, 1, 1, 1, 1)$$,
  '23505', 'W-08 duplicate reading');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-11-11T12:00Z', -1, 1, 1, 1, 1, 1)$$,
  '23514', 'W-08 negative views');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-11-11T12:00Z', 1, 100.5, 1, 1, 1, 1)$$,
  '23514', 'W-08 retention over 100');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-11-11T12:00Z', 1, 1, 1, 1, 101, 1)$$,
  '23514', 'W-08 non-follower share over 100');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_metric('we-satm1wegt05', 'tiktok', '2026-11-11T12:00Z', 1, 1, 1, 1, 1, -2)$$,
  '23514', 'W-08 negative follows');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_metric('we-satm1wegt05', 'myspace', '2026-11-11T12:00Z', 1, 1, 1, 1, 1, 1)$$,
  '23514', 'W-08 platform outside the list');
SELECT pg_temp.we_refused($$SELECT pg_temp.we_metric('we-nope', 'tiktok', '2026-11-11T12:00Z', 1, 1, 1, 1, 1, 1)$$,
  '23503', 'W-08 metric for an unknown example');
DO $$
BEGIN
  IF (SELECT array_agg(views ORDER BY month) FROM public.worked_example_metrics_monthly
       WHERE worked_example_id = 'we-satm1wegt05') IS DISTINCT FROM ARRAY[3400, 3900] THEN
    RAISE EXCEPTION 'WORKED_EXAMPLES_GATE_FAILED: W-08 monthly readout is not the latest reading per month';
  END IF;
  RAISE NOTICE '    OK W-08 metric bounds, platform list, one reading per time, FK; monthly readout = latest';
END $$;

DO $$ BEGIN RAISE NOTICE 'WORKED EXAMPLES SCHEMA GATES: PASS'; END $$;

ROLLBACK;
