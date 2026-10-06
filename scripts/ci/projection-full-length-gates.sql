-- ============================================================================
-- SCL-206 gate — real exams feed the score projection: the two most recent
-- completed full-lengths, refreshed through the 05C §8.3 outbox
-- ============================================================================
-- @spec [Doc-05C_V1 §5.7, §6.3, §8.2 item 3, §8.3, §13.1 P2-P5, INV-05C-13/14;
--        SCL-154/155/157; SCL-206] | @implemented [2026-10-03]
--
-- plain English: whole exams are sat through the E6 runtime functions and scored
--   and their seams consumed exactly as the API does (lib/exam-seams-walk.sql),
--   so the full-length terms come from the REAL 04B view full_length_section_scores
--   over real score runs — the formula's own parity is 05c-projection-gates.sh's.
--   Domain mastery and the section KPI are then pinned (all eight domains 0.5, five
--   events; 500 section events), so the mastery term is exactly 500 and the range
--   half-width exactly 25, and every expected projection below is arithmetic on the
--   exams' own stored scores:
--     J1 three completed exams: the projection uses the newest two, in order, and
--        never the oldest (P4) — both sections, denominator 3;
--     J2 an abandoned (partially scored) exam never counts (P5): one completed exam
--        after it -> denominator 2; the partial session wrote no outbox row;
--     J3 below the Q4 gate the projection stays NULL whatever exams exist
--        (INV-05C-14), and its outbox row is still consumed;
--     J4 the API read-through refreshes exactly the session it finished, and only it;
--        a replay, an unknown event and a partial session refresh nothing;
--     J5 the drain: every pending row consumed, the throttle counter reset, a row
--        whose refresh raises is left pending and counted, the rest still drain;
--        a second drain writes nothing;
--     J6 grants: the three consumer functions are service_role only.
-- Output contract: one "ok   [ID] ..." NOTICE per passing check; a failure raises
--   "PFL FAIL [ID]".
-- ============================================================================
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

\ir lib/exam-form-fixture.sql
\ir lib/exam-walk-fixture.sql
\ir lib/exam-seams-walk.sql

-- The section score a session's score run stored, via the real view.
CREATE FUNCTION pg_temp.fl(p_session uuid, p_section text) RETURNS int LANGUAGE sql AS $f$
  SELECT f.section_scaled_score FROM public.full_length_section_scores f
    JOIN public.score_runs r ON md5(r.id::text || ':' || f.section)::uuid = f.id
   WHERE r.test_session_id = p_session AND f.section = p_section;
$f$;

-- Pin a student's domain mastery (all eight domains) and both section KPIs.
CREATE FUNCTION pg_temp.pin_mastery(p_student uuid, p_math_score numeric) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d record;
BEGIN
  FOR d IN SELECT * FROM (VALUES
      ('M','Algebra'), ('M','Advanced Math'), ('M','Problem Solving and Data Analysis'),
      ('M','Geometry and Trigonometry'), ('RW','Information and Ideas'), ('RW','Craft and Structure'),
      ('RW','Expression of Ideas'), ('RW','Standard English Conventions')) AS x(section, domain)
  LOOP
    INSERT INTO public.student_domain_mastery
      (student_id, section, domain, mastery_score, mastery_pct, mastery_level,
       event_count_total, mastery_model_version, constants_snapshot_hash, computed_at)
    VALUES (p_student, d.section, d.domain,
            CASE WHEN d.section = 'M' THEN p_math_score ELSE 0.5 END,
            CASE WHEN d.section = 'M' THEN p_math_score * 100 ELSE 50 END,
            2, 5, 'v1.0', 'ci', now())
    ON CONFLICT (student_id, section, domain) DO UPDATE
       SET mastery_score = EXCLUDED.mastery_score, mastery_pct = EXCLUDED.mastery_pct,
           event_count_total = EXCLUDED.event_count_total;
  END LOOP;
  INSERT INTO public.student_section_kpi (student_id, section, events_total, refreshed_at_t_now)
  VALUES (p_student, 'M', 500, now()), (p_student, 'RW', 500, now())
  ON CONFLICT (student_id, section) DO UPDATE SET events_total = EXCLUDED.events_total;
END $f$;

-- The expected projection, independently: mastery term 500 (every domain 0.5), plus the
-- given exam scores; 500 events = target, so the half-width is MIN_DELTA 25 (§6.5).
CREATE FUNCTION pg_temp.want(VARIADIC p_fl int[]) RETURNS TABLE (mid int, low int, high int)
LANGUAGE sql AS $f$
  WITH m AS (
    SELECT (round(((500 + COALESCE((SELECT sum(x) FROM unnest(p_fl) x), 0))::numeric
                   / (1 + COALESCE(array_length(p_fl, 1), 0))) / 10) * 10)::int AS mid)
  SELECT m.mid,
         (round(greatest(m.mid - 25, 200)::numeric / 10) * 10)::int,
         (round(least(m.mid + 25, 800)::numeric / 10) * 10)::int
    FROM m;
$f$;

-- ---------------------------------------------------------------------------
-- Fixtures
--   STU    p...01  three completed exams: all wrong, mixed, all correct (J1, J5)
--   PART   p...02  an abandoned exam (RW scored only), then a completed one (J2)
--   NOGATE p...03  one completed exam, mastery never pinned (J3)
--   FAST   p...04  one completed exam, refreshed by the API read-through (J4)
--   SLOW   p...05  one completed exam, left for the drain (J4, J5)
--   BAD    p...06  one completed exam; its Math mastery is NULL, so its refresh raises (J5)
-- Each exam is its own statement, so completed_at strictly increases.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000fa001', 'pfl-stu@example.com'),
  ('00000000-0000-0000-0000-0000000fa002', 'pfl-part@example.com'),
  ('00000000-0000-0000-0000-0000000fa003', 'pfl-nogate@example.com'),
  ('00000000-0000-0000-0000-0000000fa004', 'pfl-fast@example.com'),
  ('00000000-0000-0000-0000-0000000fa005', 'pfl-slow@example.com'),
  ('00000000-0000-0000-0000-0000000fa006', 'pfl-bad@example.com');
SELECT pg_temp.exam_fixture_make_form('fa0f0000-0000-4000-8000-000000000001', 'Q1', 20, 15);
SELECT pg_temp.exam_fixture_make_form('fa0f0000-0000-4000-8000-000000000002', 'Q2', 20, 15);
SELECT pg_temp.exam_fixture_make_form('fa0f0000-0000-4000-8000-000000000003', 'Q3', 20, 15);
UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'PFL form ' || right(id::text, 1)
 WHERE id::text LIKE 'fa0f0000-%';

CREATE TEMP TABLE _x (who text PRIMARY KEY, student uuid, session uuid);

-- STU: oldest all wrong, then mixed, newest all correct — three distinct scores per section.
DO $$ BEGIN
  PERFORM pg_temp.complete_session('00000000-0000-0000-0000-0000000fa001', 'fa0f0000-0000-4000-8000-000000000001', 'lenient', false, false);
  INSERT INTO _x SELECT 'STU1', student_id, id FROM public.test_sessions
   WHERE student_id = '00000000-0000-0000-0000-0000000fa001' AND test_form_id = 'fa0f0000-0000-4000-8000-000000000001';
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'PFL FAIL [fixture]: drain STU1'; END IF;
END $$;
DO $$ BEGIN
  INSERT INTO _x VALUES ('STU2', '00000000-0000-0000-0000-0000000fa001',
    pg_temp.walk('00000000-0000-0000-0000-0000000fa001', 'fa0f0000-0000-4000-8000-000000000002', 'lenient', ARRAY['RW', 'M']));
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'PFL FAIL [fixture]: drain STU2'; END IF;
END $$;
DO $$ BEGIN
  PERFORM pg_temp.complete_session('00000000-0000-0000-0000-0000000fa001', 'fa0f0000-0000-4000-8000-000000000003', 'lenient', true, true);
  INSERT INTO _x SELECT 'STU3', student_id, id FROM public.test_sessions
   WHERE student_id = '00000000-0000-0000-0000-0000000fa001' AND test_form_id = 'fa0f0000-0000-4000-8000-000000000003';
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'PFL FAIL [fixture]: drain STU3'; END IF;
END $$;

-- PART: RW walked, Math Module 1 answered, grace expires -> partial_scored_abandoned (RW scored).
DO $$ DECLARE v_sid uuid; BEGIN
  v_sid := pg_temp.walk('00000000-0000-0000-0000-0000000fa002', 'fa0f0000-0000-4000-8000-000000000001', 'strict', ARRAY['RW']);
  PERFORM pg_temp.expect_status('fixture', public.exam_start_module('00000000-0000-0000-0000-0000000fa002', v_sid, 'M', '1'), 200);
  PERFORM pg_temp.answer_mixed('00000000-0000-0000-0000-0000000fa002', v_sid, 'M', '1');
  INSERT INTO _x VALUES ('PART1', '00000000-0000-0000-0000-0000000fa002', v_sid);
  UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_sid;
  PERFORM public.exam_abandonment_sweep();
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'PFL FAIL [fixture]: drain PART1'; END IF;
END $$;
DO $$ BEGIN
  PERFORM pg_temp.complete_session('00000000-0000-0000-0000-0000000fa002', 'fa0f0000-0000-4000-8000-000000000002', 'lenient', true, false);
  INSERT INTO _x SELECT 'PART2', student_id, id FROM public.test_sessions
   WHERE student_id = '00000000-0000-0000-0000-0000000fa002' AND test_form_id = 'fa0f0000-0000-4000-8000-000000000002';
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'PFL FAIL [fixture]: drain PART2'; END IF;
END $$;

-- NOGATE, FAST, SLOW, BAD: one completed exam each.
DO $$ DECLARE w record; BEGIN
  FOR w IN SELECT * FROM (VALUES ('NOGATE', '00000000-0000-0000-0000-0000000fa003'::uuid),
                                 ('FAST',   '00000000-0000-0000-0000-0000000fa004'::uuid),
                                 ('SLOW',   '00000000-0000-0000-0000-0000000fa005'::uuid),
                                 ('BAD',    '00000000-0000-0000-0000-0000000fa006'::uuid)) AS t(who, student)
  LOOP
    INSERT INTO _x VALUES (w.who, w.student,
      pg_temp.walk(w.student, 'fa0f0000-0000-4000-8000-000000000001', 'lenient', ARRAY['RW', 'M']));
  END LOOP;
  IF pg_temp.drain() < 0 THEN RAISE EXCEPTION 'PFL FAIL [fixture]: drain singles'; END IF;
END $$;

-- Pin mastery AFTER the seams applied (they recompute domain mastery from events).
-- BAD's Math mastery is NULL with five events each: the Q4 gate passes and the mastery term
-- raises PROJECTION_MASTERY_TERM_NULL — a data-integrity fault the drain must survive.
DO $$ BEGIN
  PERFORM pg_temp.pin_mastery('00000000-0000-0000-0000-0000000fa001', 0.5);
  PERFORM pg_temp.pin_mastery('00000000-0000-0000-0000-0000000fa002', 0.5);
  PERFORM pg_temp.pin_mastery('00000000-0000-0000-0000-0000000fa004', 0.5);
  PERFORM pg_temp.pin_mastery('00000000-0000-0000-0000-0000000fa005', 0.5);
  PERFORM pg_temp.pin_mastery('00000000-0000-0000-0000-0000000fa006', NULL);
  -- NOGATE: below the gate — one domain short of five events.
  PERFORM pg_temp.pin_mastery('00000000-0000-0000-0000-0000000fa003', 0.5);
  UPDATE public.student_domain_mastery SET event_count_total = 4
   WHERE student_id = '00000000-0000-0000-0000-0000000fa003' AND domain = 'Algebra';
END $$;

-- ---------------------------------------------------------------------------
-- J4 — the API read-through: exactly the session it finished
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_seams uuid; v_res jsonb; v_res2 jsonb; v_res3 jsonb; v_res4 jsonb;
        v_fast_done boolean; v_slow_pending boolean; v_proj int; v_part_seams uuid;
BEGIN
  SELECT o.id INTO v_seams FROM public.exam_runtime_outbox o
   WHERE o.event_type = 'test_session_scored' AND o.aggregate_id = (SELECT session FROM _x WHERE who = 'FAST');
  v_res := public.projection_refresh_after_exam(v_seams);
  SELECT processed_at IS NOT NULL INTO v_fast_done FROM public.projection_refresh_outbox
   WHERE test_session_id = (SELECT session FROM _x WHERE who = 'FAST');
  SELECT processed_at IS NULL INTO v_slow_pending FROM public.projection_refresh_outbox
   WHERE test_session_id = (SELECT session FROM _x WHERE who = 'SLOW');
  SELECT count(*) INTO v_proj FROM public.student_section_projections
   WHERE student_id = '00000000-0000-0000-0000-0000000fa004' AND fl_count_used = 1 AND blend_denominator = 2;
  v_res2 := public.projection_refresh_after_exam(v_seams);                       -- replay
  v_res3 := public.projection_refresh_after_exam(gen_random_uuid());              -- unknown
  SELECT o.id INTO v_part_seams FROM public.exam_runtime_outbox o
   WHERE o.event_type = 'test_session_scored' AND o.aggregate_id = (SELECT session FROM _x WHERE who = 'PART1');
  v_res4 := public.projection_refresh_after_exam(v_part_seams);                   -- partial: no row
  IF v_res->>'outcome' <> 'refreshed' OR NOT v_fast_done OR NOT v_slow_pending OR v_proj <> 2
     OR v_res2->>'outcome' <> 'nothing_pending' OR v_res3->>'outcome' <> 'seams_not_published'
     OR v_part_seams IS NULL OR v_res4->>'outcome' <> 'nothing_pending' THEN
    RAISE EXCEPTION 'PFL FAIL [J4]: % / fast done % / slow pending % / fast rows at denom 2: % / replay % / unknown % / partial %',
      v_res, v_fast_done, v_slow_pending, v_proj, v_res2, v_res3, v_res4;
  END IF;
  PERFORM pg_temp.ok('J4', 'read-through refreshed FAST (both sections, denominator 2) and left SLOW pending; replay -> nothing_pending; unknown event -> seams_not_published; partial session -> nothing_pending');
END $$;

-- ---------------------------------------------------------------------------
-- J5 — the drain (runs before J1-J3, which read what it wrote)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _drain (n int PRIMARY KEY, res jsonb, snapshots bigint);
DO $$ DECLARE v jsonb; BEGIN
  v := public.projection_refresh_outbox_drain(50);
  INSERT INTO _drain VALUES (1, v, (SELECT count(*) FROM public.student_section_projection_snapshots));
  v := public.projection_refresh_outbox_drain(50);
  INSERT INTO _drain VALUES (2, v, (SELECT count(*) FROM public.student_section_projection_snapshots));
END $$;
DO $$
DECLARE v1 jsonb; v2 jsonb; s1 bigint; s2 bigint; v_pending text; v_rows int; v_counter text;
BEGIN
  SELECT res, snapshots INTO v1, s1 FROM _drain WHERE n = 1;
  SELECT res, snapshots INTO v2, s2 FROM _drain WHERE n = 2;
  -- rows: STU x3, PART2, NOGATE, SLOW, BAD pending before the drain (FAST done in J4; PART1 none)
  SELECT string_agg(x.who, ',' ORDER BY x.who) INTO v_pending
    FROM public.projection_refresh_outbox o JOIN _x x ON x.session = o.test_session_id
   WHERE o.processed_at IS NULL;
  SELECT count(*) INTO v_rows FROM public.projection_refresh_outbox o JOIN _x x ON x.session = o.test_session_id;
  SELECT events_since_refresh || '|' || (last_refresh_at IS NOT NULL) INTO v_counter
    FROM public.student_projection_refresh_state WHERE student_id = '00000000-0000-0000-0000-0000000fa001';
  IF (v1->>'processed')::int <> 6 OR (v1->>'failed')::int <> 1 OR v_pending IS DISTINCT FROM 'BAD'
     OR v_rows <> 8 OR (v2->>'processed')::int <> 0 OR (v2->>'failed')::int <> 1 OR s2 <> s1
     OR v_counter IS DISTINCT FROM '0|true' THEN
    RAISE EXCEPTION 'PFL FAIL [J5]: drain1 % drain2 % pending % rows % snapshots %->% counter %',
      v1, v2, v_pending, v_rows, s1, s2, v_counter;
  END IF;
  PERFORM pg_temp.ok('J5', format('drain %s: 6 consumed (STU x3, PART2, NOGATE, SLOW), BAD''s raise left it pending and counted; 8 rows for 9 sessions (partial wrote none); second drain %s writes no snapshot; STU counter reset %s',
    v1, v2, v_counter));
END $$;

-- ---------------------------------------------------------------------------
-- J1 — the newest two of three, in order; the oldest never (P4)
-- ---------------------------------------------------------------------------
DO $$
DECLARE sec text; p record; w record; a int; b int; c int; v_line text := '';
BEGIN
  FOREACH sec IN ARRAY ARRAY['M', 'RW'] LOOP
    a := pg_temp.fl((SELECT session FROM _x WHERE who = 'STU1'), sec);   -- oldest
    b := pg_temp.fl((SELECT session FROM _x WHERE who = 'STU2'), sec);
    c := pg_temp.fl((SELECT session FROM _x WHERE who = 'STU3'), sec);   -- newest
    SELECT * INTO p FROM public.student_section_projections
     WHERE student_id = '00000000-0000-0000-0000-0000000fa001' AND section = sec;
    SELECT * INTO w FROM pg_temp.want(c, b);
    IF a IS NULL OR b IS NULL OR c IS NULL OR a IN (b, c)
       OR p.fl1_score IS DISTINCT FROM c OR p.fl2_score IS DISTINCT FROM b
       OR p.fl_count_used <> 2 OR p.blend_denominator <> 3 OR p.mastery_term <> 500
       OR (p.projected_score_mid, p.projected_score_low, p.projected_score_high) IS DISTINCT FROM (w.mid, w.low, w.high) THEN
      RAISE EXCEPTION 'PFL FAIL [J1]: % exams oldest..newest %/%/%; row fl1 % fl2 % count % denom % term % -> % (% - %), want % (% - %)',
        sec, a, b, c, p.fl1_score, p.fl2_score, p.fl_count_used, p.blend_denominator, p.mastery_term,
        p.projected_score_mid, p.projected_score_low, p.projected_score_high, w.mid, w.low, w.high;
    END IF;
    v_line := v_line || format('%s: exams %s, %s, %s -> uses %s and %s, (500+%s+%s)/3 -> %s (%s-%s); ',
      sec, a, b, c, c, b, c, b, p.projected_score_mid, p.projected_score_low, p.projected_score_high);
  END LOOP;
  PERFORM pg_temp.ok('J1', v_line || 'the oldest never read (P4)');
END $$;

-- ---------------------------------------------------------------------------
-- J2 — an abandoned exam never counts (P5)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_state text; v_part_rw int; v_part_rows int; sec text; p record; w record; c int; v_line text := '';
BEGIN
  SELECT state INTO v_state FROM public.test_sessions WHERE id = (SELECT session FROM _x WHERE who = 'PART1');
  v_part_rw := pg_temp.fl((SELECT session FROM _x WHERE who = 'PART1'), 'RW');
  SELECT count(*) INTO v_part_rows FROM public.projection_refresh_outbox
   WHERE test_session_id = (SELECT session FROM _x WHERE who = 'PART1');
  IF v_state <> 'partial_scored_abandoned' OR v_part_rw IS NULL OR v_part_rows <> 0 THEN
    RAISE EXCEPTION 'PFL FAIL [J2]: premise — PART1 % RW score % outbox rows %', v_state, v_part_rw, v_part_rows;
  END IF;
  FOREACH sec IN ARRAY ARRAY['M', 'RW'] LOOP
    c := pg_temp.fl((SELECT session FROM _x WHERE who = 'PART2'), sec);
    SELECT * INTO p FROM public.student_section_projections
     WHERE student_id = '00000000-0000-0000-0000-0000000fa002' AND section = sec;
    SELECT * INTO w FROM pg_temp.want(c);
    IF p.fl1_score IS DISTINCT FROM c OR p.fl2_score IS NOT NULL OR p.fl_count_used <> 1
       OR p.blend_denominator <> 2
       OR (p.projected_score_mid, p.projected_score_low, p.projected_score_high) IS DISTINCT FROM (w.mid, w.low, w.high) THEN
      RAISE EXCEPTION 'PFL FAIL [J2]: % completed %, partial RW %; row fl1 % fl2 % count % denom % -> %, want %',
        sec, c, v_part_rw, p.fl1_score, p.fl2_score, p.fl_count_used, p.blend_denominator, p.projected_score_mid, w.mid;
    END IF;
    v_line := v_line || format('%s -> %s (%s-%s); ', sec, p.projected_score_mid, p.projected_score_low, p.projected_score_high);
  END LOOP;
  PERFORM pg_temp.ok('J2', format('PART: abandoned exam (RW scored %s, is_complete false) ignored, no outbox row; one completed exam -> denominator 2: %s', v_part_rw, v_line));
END $$;

-- ---------------------------------------------------------------------------
-- J3 — below the Q4 gate: NULL, whatever exams exist (INV-05C-14)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v text; v_done boolean;
BEGIN
  SELECT string_agg(section || ':' || COALESCE(projected_score_mid::text, 'NULL') || '/' || fl_count_used || '/' || blend_denominator, ',' ORDER BY section)
    INTO v FROM public.student_section_projections WHERE student_id = '00000000-0000-0000-0000-0000000fa003';
  SELECT processed_at IS NOT NULL INTO v_done FROM public.projection_refresh_outbox
   WHERE test_session_id = (SELECT session FROM _x WHERE who = 'NOGATE');
  IF v IS DISTINCT FROM 'M:NULL/0/1,RW:NULL/0/1' OR NOT v_done THEN
    RAISE EXCEPTION 'PFL FAIL [J3]: rows % processed %', v, v_done;
  END IF;
  PERFORM pg_temp.ok('J3', 'NOGATE (one domain at 4 events, one completed exam): both sections NULL, fl_count 0, denominator 1; its outbox row consumed');
END $$;

-- ---------------------------------------------------------------------------
-- J6 — grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE f text; v_bad text := '';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.projection_refresh_outbox_process(bigint)',
                           'public.projection_refresh_outbox_drain(integer)',
                           'public.projection_refresh_after_exam(uuid)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      v_bad := v_bad || f || ' ';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN RAISE EXCEPTION 'PFL FAIL [J6]: %', v_bad; END IF;
  PERFORM pg_temp.ok('J6', 'the three consumer functions: service_role only (anon, authenticated: no EXECUTE)');
END $$;
