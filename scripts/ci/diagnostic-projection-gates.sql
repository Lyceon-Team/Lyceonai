-- ============================================================================
-- SCL-236 gate — the stored diagnostic projection and the one completion path
-- ============================================================================
-- @spec [SCL-236 (Doc 05C §12A, §12; Doc 05A §11.4); SCL-235; owner rulings 2026-10-16 and
--        2026-10-17 (constraints 1-7; D1 = (a), D2 = yes)] | @implemented [2026-10-17]
--
-- plain English: real diagnostic sessions (40 items, 5 per canonical domain, deterministic
--   answers) are completed through complete_diagnostic_session, the only completion path, and
--   the stored rows are checked against the canonical live path on the same evidence:
--     D1  the exact failure this fixes: the live projection is EMPTY (no mastery was ever
--         applied) and completion still stores a computed diagnostic projection for both
--         sections; the student reads baseline_ready;
--     D2  equivalence: a fresh student whose 40 answers went through apply_mastery_event gets a
--         live projection (refreshed at completion, D2) whose mid/low/high equal the stored
--         diagnostic projection's — same formulas, same evidence;
--     D3  isolation: a student with 30 earlier practice answers and the SAME 40 diagnostic
--         answers stores the SAME diagnostic projection as D1, while their live projection
--         differs (earlier practice moves the live number, never the diagnostic one);
--     D4  replay: completing again stores nothing, changes nothing, and does not rewrite
--         completed_at;
--     D5  write-once: an UPDATE raises; no API role may INSERT/UPDATE/DELETE the table;
--     D6  D1 = (a): one skipped item leaves its domain at 4 answers, so the unchanged evidence
--         gate fails and both sections store insufficient_evidence with no numbers;
--     D7  an abandoned diagnostic is never completed and stores nothing;
--     D8  repair: a completed diagnostic with no rows reads baseline_pending; the repair stores
--         them (baseline_ready) and a second run stores nothing;
--     D9  one diagnostic in flight per student (partial unique index);
--     D10 the four functions are service_role only;
--     D11 complete_diagnostic_session refuses a non-diagnostic session;
--     D12 the account-deletion cascade removes the rows in anonymize mode (the session is kept).
-- Output contract: one "ok   [ID] ..." NOTICE per passing check; a failure raises "DPG FAIL [ID]".
-- ============================================================================
\set ON_ERROR_STOP 0
SET client_min_messages = notice;

-- One student with a profile (handle_new_user assigns actor_id).
CREATE FUNCTION pg_temp.mk_student(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := md5('dpg-student-' || p_tag)::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v, 'dpg-' || p_tag || '@example.com');
  RETURN v;
END $f$;

-- The 40 diagnostic questions: 5 per canonical domain, deterministic difficulty.
DO $q$
DECLARE d record; i int; n int := 0;
BEGIN
  FOR d IN SELECT * FROM (VALUES
      ('M','Algebra','ALG'), ('M','Advanced Math','ADV'), ('M','Problem Solving and Data Analysis','PSD'),
      ('M','Geometry and Trigonometry','GEO'), ('RW','Information and Ideas','INI'),
      ('RW','Craft and Structure','CAS'), ('RW','Expression of Ideas','EOI'),
      ('RW','Standard English Conventions','SEC')) AS x(section, domain, code)
  LOOP
    FOR i IN 1..5 LOOP
      n := n + 1;
      INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
      VALUES ('SAT' || d.section || '1' || d.code || lpad(i::text, 3, '0'), d.section, 1, d.domain,
              ARRAY[d.code || '.01'], 1 + (n % 3), 'Stem',
              '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
              'A', 'Explanation');
    END LOOP;
  END LOOP;
END $q$;

-- A diagnostic session with all 40 items resolved. Answer pattern is a pure function of the
-- ordinal, so every student given the same pattern answers identically. p_skip_ordinals are
-- resolved as skipped instead. p_apply_mastery runs apply_mastery_event per answered item, as the
-- answer route does.
CREATE FUNCTION pg_temp.mk_diagnostic(p_student uuid, p_base timestamptz, p_skip_ordinals int[],
                                      p_apply_mastery boolean, p_status text DEFAULT 'active')
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_session uuid := gen_random_uuid();
  v_actor uuid;
  q record;
  v_ord int := 0;
  v_skip boolean;
  v_correct boolean;
  v_item uuid;
  v_at timestamptz;
BEGIN
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = p_student;
  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id, abandoned_at)
  VALUES (v_session, p_student, 'diagnostic', 40, 'web', 'inst-' || v_session, p_status, v_actor,
          CASE WHEN p_status = 'abandoned' THEN p_base END);
  FOR q IN SELECT * FROM public.questions WHERE id ~ '^SAT(M|RW)1(ALG|ADV|PSD|GEO|INI|CAS|EOI|SEC)' ORDER BY section, domain, id LOOP
    v_ord := v_ord + 1;
    v_skip := v_ord = ANY (COALESCE(p_skip_ordinals, '{}'));
    v_correct := (v_ord % 3) <> 0;
    v_item := gen_random_uuid();
    v_at := p_base + make_interval(mins => v_ord);
    INSERT INTO public.practice_session_items (
      id, session_id, user_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
    ) VALUES (
      v_item, v_session, p_student, v_ord, q.id, 'Stem', q.options, 'A', 'E',
      q.domain, q.skill_codes[1], q.difficulty, q.section,
      CASE WHEN v_skip THEN 'skipped' ELSE 'answered' END,
      CASE WHEN v_skip THEN NULL WHEN v_correct THEN 'A' ELSE 'B' END,
      CASE WHEN v_skip THEN false ELSE v_correct END,
      CASE WHEN v_skip THEN 'skipped' WHEN v_correct THEN 'correct' ELSE 'incorrect' END,
      v_at, v_at, v_actor);
    IF p_apply_mastery AND NOT v_skip THEN
      PERFORM public.apply_mastery_event(p_student, q.section, q.domain, q.skill_codes[1], q.difficulty::smallint,
        'practice', 'diagnostic_attempt', v_correct, v_at, v_item, q.id);
    END IF;
  END LOOP;
  RETURN v_session;
END $f$;

-- 30 earlier practice answers (all wrong, Algebra + Information and Ideas), mastery applied.
CREATE FUNCTION pg_temp.mk_prior_practice(p_student uuid, p_base timestamptz) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_session uuid := gen_random_uuid(); v_actor uuid; i int; q record; v_item uuid; v_at timestamptz;
BEGIN
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = p_student;
  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES (v_session, p_student, 'flow', 30, 'web', 'inst-' || v_session, 'completed', v_actor);
  FOR i IN 1..30 LOOP
    SELECT * INTO q FROM public.questions
     WHERE id = CASE WHEN i % 2 = 0 THEN 'SATM1ALG' ELSE 'SATRW1INI' END || lpad((1 + i % 5)::text, 3, '0');
    v_item := gen_random_uuid();
    v_at := p_base + make_interval(mins => i);
    INSERT INTO public.practice_session_items (
      id, session_id, user_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
    ) VALUES (
      v_item, v_session, p_student, i, q.id, 'Stem', q.options, 'A', 'E',
      q.domain, q.skill_codes[1], q.difficulty, q.section,
      'answered', 'B', false, 'incorrect', v_at, v_at, v_actor);
    PERFORM public.apply_mastery_event(p_student, q.section, q.domain, q.skill_codes[1], q.difficulty::smallint,
      'practice', 'practice_attempt', false, v_at, v_item, q.id);
  END LOOP;
END $f$;

CREATE FUNCTION pg_temp.dp(p_session uuid, p_section text) RETURNS public.student_diagnostic_projections
LANGUAGE sql AS $f$
  SELECT * FROM public.student_diagnostic_projections WHERE practice_session_id = p_session AND section = p_section;
$f$;

-- ---------------------------------------------------------------- D1, D4
DO $t$
DECLARE s uuid := pg_temp.mk_student('fresh'); v_sess uuid; r jsonb; m public.student_diagnostic_projections;
        rw public.student_diagnostic_projections; v_at1 timestamptz; v_at2 timestamptz; m2 public.student_diagnostic_projections;
BEGIN
  v_sess := pg_temp.mk_diagnostic(s, timestamptz '2026-10-01 10:00Z', NULL, false);
  IF EXISTS (SELECT 1 FROM public.student_domain_mastery WHERE student_id = s) THEN
    RAISE EXCEPTION 'DPG FAIL [D1] fixture: live mastery should be empty';
  END IF;
  r := public.complete_diagnostic_session(v_sess, timestamptz '2026-10-01 11:00Z');
  m := pg_temp.dp(v_sess, 'M'); rw := pg_temp.dp(v_sess, 'RW');
  IF r->>'state' <> 'completed' OR (r->>'completed_now')::boolean IS NOT TRUE OR r->>'projection' <> 'computed'
     OR m.status <> 'computed' OR rw.status <> 'computed' OR m.projected_score_mid IS NULL OR rw.projected_score_mid IS NULL
     OR m.answered_count <> 20 OR rw.answered_count <> 20 OR m.relevant_question_count <> 20 THEN
    RAISE EXCEPTION 'DPG FAIL [D1] r=% M=% RW=%', r, row_to_json(m), row_to_json(rw);
  END IF;
  IF EXISTS (SELECT 1 FROM public.student_section_projections WHERE student_id = s AND projected_score_mid IS NOT NULL) THEN
    RAISE EXCEPTION 'DPG FAIL [D1] the live projection should still be empty (no mastery applied)';
  END IF;
  IF public.student_diagnostic_state(s) <> 'baseline_ready' THEN
    RAISE EXCEPTION 'DPG FAIL [D1] state %', public.student_diagnostic_state(s);
  END IF;
  RAISE NOTICE 'ok   [D1] live projection empty, stored diagnostic projection computed: M % (%-%), RW % (%-%), 20 answers each; baseline_ready',
    m.projected_score_mid, m.projected_score_low, m.projected_score_high,
    rw.projected_score_mid, rw.projected_score_low, rw.projected_score_high;

  SELECT completed_at INTO v_at1 FROM public.practice_sessions WHERE id = v_sess;
  r := public.complete_diagnostic_session(v_sess, timestamptz '2026-10-05 09:00Z');
  SELECT completed_at INTO v_at2 FROM public.practice_sessions WHERE id = v_sess;
  m2 := pg_temp.dp(v_sess, 'M');
  IF (r->>'completed_now')::boolean OR (r->>'rows_stored')::int <> 0 OR v_at1 <> v_at2
     OR row_to_json(m)::text <> row_to_json(m2)::text
     OR (SELECT count(*) FROM public.student_diagnostic_projections WHERE practice_session_id = v_sess) <> 2 THEN
    RAISE EXCEPTION 'DPG FAIL [D4] r=% completed_at % -> %', r, v_at1, v_at2;
  END IF;
  RAISE NOTICE 'ok   [D4] replay: completed_now false, 0 rows stored, the 2 rows unchanged, completed_at unchanged (%)', v_at2;
END $t$;

-- ---------------------------------------------------------------- D2
DO $t$
DECLARE s uuid := pg_temp.mk_student('canonical'); v_sess uuid; r jsonb; sec text;
        d public.student_diagnostic_projections; l public.student_section_projections;
BEGIN
  v_sess := pg_temp.mk_diagnostic(s, timestamptz '2026-10-01 10:00Z', NULL, true);
  r := public.complete_diagnostic_session(v_sess, timestamptz '2026-10-01 11:00Z');
  FOREACH sec IN ARRAY ARRAY['M','RW'] LOOP
    d := pg_temp.dp(v_sess, sec);
    SELECT * INTO l FROM public.student_section_projections WHERE student_id = s AND section = sec;
    IF d.projected_score_mid IS DISTINCT FROM l.projected_score_mid OR d.projected_score_low IS DISTINCT FROM l.projected_score_low
       OR d.projected_score_high IS DISTINCT FROM l.projected_score_high OR d.relevant_question_count IS DISTINCT FROM l.relevant_question_count
       OR d.mastery_term IS DISTINCT FROM l.mastery_term OR d.projected_score_mid IS NULL THEN
      RAISE EXCEPTION 'DPG FAIL [D2] % diagnostic=% live=%', sec, row_to_json(d), row_to_json(l);
    END IF;
  END LOOP;
  RAISE NOTICE 'ok   [D2] fresh student: the live projection refreshed at completion equals the stored diagnostic projection in both sections (mid, low, high, mastery_term, evidence count)';
END $t$;

-- ---------------------------------------------------------------- D3
DO $t$
DECLARE a uuid := md5('dpg-student-fresh')::uuid; b uuid := pg_temp.mk_student('prior'); c uuid := md5('dpg-student-canonical')::uuid;
        sa uuid; sb uuid; sec text; da public.student_diagnostic_projections; db public.student_diagnostic_projections;
        lb int; lc int;
BEGIN
  PERFORM pg_temp.mk_prior_practice(b, timestamptz '2026-09-01 10:00Z');
  sb := pg_temp.mk_diagnostic(b, timestamptz '2026-10-01 10:00Z', NULL, true);
  PERFORM public.complete_diagnostic_session(sb, timestamptz '2026-10-01 11:00Z');
  SELECT id INTO sa FROM public.practice_sessions WHERE user_id = a AND mode = 'diagnostic';
  FOREACH sec IN ARRAY ARRAY['M','RW'] LOOP
    da := pg_temp.dp(sa, sec); db := pg_temp.dp(sb, sec);
    IF (da.status, da.projected_score_mid, da.projected_score_low, da.projected_score_high, da.mastery_term, da.domain_mastery, da.relevant_question_count)
       IS DISTINCT FROM
       (db.status, db.projected_score_mid, db.projected_score_low, db.projected_score_high, db.mastery_term, db.domain_mastery, db.relevant_question_count) THEN
      RAISE EXCEPTION 'DPG FAIL [D3] % fresh=% prior=%', sec, row_to_json(da), row_to_json(db);
    END IF;
  END LOOP;
  SELECT projected_score_mid INTO lb FROM public.student_section_projections WHERE student_id = b AND section = 'M';
  SELECT projected_score_mid INTO lc FROM public.student_section_projections WHERE student_id = c AND section = 'M';
  IF lb IS NOT DISTINCT FROM lc THEN
    RAISE EXCEPTION 'DPG FAIL [D3] fixture does not separate the paths: live M % vs %', lb, lc;
  END IF;
  RAISE NOTICE 'ok   [D3] 30 earlier wrong practice answers: diagnostic projection identical to the fresh student''s in both sections (RW %), live projection differs (M % vs %)',
    db.projected_score_mid, lb, lc;
END $t$;

-- ---------------------------------------------------------------- D5
DO $t$
DECLARE v_sess uuid; v_raised boolean := false;
BEGIN
  SELECT practice_session_id INTO v_sess FROM public.student_diagnostic_projections LIMIT 1;
  BEGIN
    UPDATE public.student_diagnostic_projections SET projected_score_mid = 800 WHERE practice_session_id = v_sess;
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM LIKE 'DIAGNOSTIC_PROJECTION_IMMUTABLE%';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'DPG FAIL [D5] UPDATE was not refused'; END IF;
  IF has_table_privilege('service_role', 'public.student_diagnostic_projections', 'INSERT')
     OR has_table_privilege('service_role', 'public.student_diagnostic_projections', 'UPDATE')
     OR has_table_privilege('service_role', 'public.student_diagnostic_projections', 'DELETE')
     OR has_table_privilege('authenticated', 'public.student_diagnostic_projections', 'SELECT')
     OR has_table_privilege('anon', 'public.student_diagnostic_projections', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.student_diagnostic_projections', 'SELECT') THEN
    RAISE EXCEPTION 'DPG FAIL [D5] privileges are wider than SELECT for service_role';
  END IF;
  RAISE NOTICE 'ok   [D5] UPDATE raises DIAGNOSTIC_PROJECTION_IMMUTABLE; service_role holds SELECT only; anon/authenticated hold nothing';
END $t$;

-- ---------------------------------------------------------------- D6
DO $t$
DECLARE s uuid := pg_temp.mk_student('skipper'); v_sess uuid; r jsonb; m public.student_diagnostic_projections; rw public.student_diagnostic_projections;
BEGIN
  v_sess := pg_temp.mk_diagnostic(s, timestamptz '2026-10-01 10:00Z', ARRAY[40], false);
  r := public.complete_diagnostic_session(v_sess, timestamptz '2026-10-01 11:00Z');
  m := pg_temp.dp(v_sess, 'M'); rw := pg_temp.dp(v_sess, 'RW');
  IF r->>'projection' <> 'insufficient_evidence' OR m.status <> 'insufficient_evidence' OR rw.status <> 'insufficient_evidence'
     OR m.projected_score_mid IS NOT NULL OR rw.projected_score_low IS NOT NULL OR rw.answered_count <> 19
     OR public.student_diagnostic_state(s) <> 'baseline_ready' THEN
    RAISE EXCEPTION 'DPG FAIL [D6] r=% M=% RW=%', r, row_to_json(m), row_to_json(rw);
  END IF;
  RAISE NOTICE 'ok   [D6] one skip (RW 19 answered): both sections stored insufficient_evidence with no numbers; baseline_ready';
END $t$;

-- ---------------------------------------------------------------- D7
DO $t$
DECLARE s uuid := pg_temp.mk_student('quitter'); v_sess uuid; r jsonb;
BEGIN
  v_sess := pg_temp.mk_diagnostic(s, timestamptz '2026-10-01 10:00Z', NULL, false, 'abandoned');
  r := public.complete_diagnostic_session(v_sess, timestamptz '2026-10-01 11:00Z');
  IF r->>'state' <> 'abandoned' OR (SELECT status FROM public.practice_sessions WHERE id = v_sess) <> 'abandoned'
     OR EXISTS (SELECT 1 FROM public.student_diagnostic_projections WHERE practice_session_id = v_sess) THEN
    RAISE EXCEPTION 'DPG FAIL [D7] r=%', r;
  END IF;
  RAISE NOTICE 'ok   [D7] an abandoned diagnostic stays abandoned and stores nothing';
END $t$;

-- ---------------------------------------------------------------- D8
DO $t$
DECLARE s uuid := pg_temp.mk_student('historic'); v_sess uuid; r1 jsonb; r2 jsonb; v_before text;
BEGIN
  v_sess := pg_temp.mk_diagnostic(s, timestamptz '2026-09-15 10:00Z', NULL, false);
  -- The pre-SCL-236 shape: completed by a direct write, no projection stored.
  UPDATE public.practice_sessions SET status = 'completed', completed_at = timestamptz '2026-09-15 11:00Z' WHERE id = v_sess;
  v_before := public.student_diagnostic_state(s);
  r1 := public.diagnostic_projection_repair(500);
  r2 := public.diagnostic_projection_repair(500);
  IF v_before <> 'baseline_pending' OR public.student_diagnostic_state(s) <> 'baseline_ready'
     OR (r1->>'rows_stored')::int < 2 OR (r1->>'failed')::int <> 0
     OR (r2->>'rows_stored')::int <> 0 OR (r2->>'examined')::int <> 0
     OR (SELECT count(*) FROM public.student_diagnostic_projections WHERE practice_session_id = v_sess) <> 2 THEN
    RAISE EXCEPTION 'DPG FAIL [D8] before=% r1=% r2=% after=%', v_before, r1, r2, public.student_diagnostic_state(s);
  END IF;
  RAISE NOTICE 'ok   [D8] baseline_pending -> repair % -> baseline_ready; second run %', r1, r2;
END $t$;

-- ---------------------------------------------------------------- D9
DO $t$
DECLARE s uuid := pg_temp.mk_student('twin'); v_actor uuid; v_raised boolean := false;
BEGIN
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = s;
  INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES (s, 'diagnostic', 40, 'web', 'inst-twin-1', 'active', v_actor);
  BEGIN
    INSERT INTO public.practice_sessions (user_id, mode, target_count, platform, client_instance_id, status, actor_id)
    VALUES (s, 'diagnostic', 40, 'web', 'inst-twin-2', 'created', v_actor);
  EXCEPTION WHEN unique_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'DPG FAIL [D9] a second in-flight diagnostic was accepted'; END IF;
  RAISE NOTICE 'ok   [D9] a second created/active diagnostic for the same student raises unique_violation';
END $t$;

-- ---------------------------------------------------------------- D10
DO $t$
DECLARE f text; bad text := '';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.compute_diagnostic_projection(uuid)',
                           'public.complete_diagnostic_session(uuid,timestamptz,jsonb)',
                           'public.diagnostic_projection_repair(integer)',
                           'public.compute_mastery_core(public.mastery_event[],jsonb)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      bad := bad || ' ' || f;
    END IF;
  END LOOP;
  IF bad <> '' THEN RAISE EXCEPTION 'DPG FAIL [D10] wrong grants:%', bad; END IF;
  RAISE NOTICE 'ok   [D10] compute/complete/repair/mastery core: service_role only';
END $t$;

-- ---------------------------------------------------------------- D11
DO $t$
DECLARE v_sess uuid; v_raised boolean := false;
BEGIN
  SELECT id INTO v_sess FROM public.practice_sessions WHERE mode = 'flow' LIMIT 1;
  BEGIN
    PERFORM public.complete_diagnostic_session(v_sess, now());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM LIKE 'DIAGNOSTIC_COMPLETE_NOT_DIAGNOSTIC%';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'DPG FAIL [D11] a flow session was accepted'; END IF;
  RAISE NOTICE 'ok   [D11] complete_diagnostic_session refuses a non-diagnostic session';
END $t$;

-- ---------------------------------------------------------------- D12
DO $t$
DECLARE s uuid := md5('dpg-student-skipper')::uuid; v_sess uuid; r jsonb;
BEGIN
  SELECT id INTO v_sess FROM public.practice_sessions WHERE user_id = s AND mode = 'diagnostic';
  -- The cascade's status guard: the cron driver marks the request completed first.
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
  VALUES (s, now() - interval '8 days', now() - interval '1 day', s, 'completed', 'completed', now());
  r := public.execute_account_deletion_cascade(s, 'anonymize');
  IF EXISTS (SELECT 1 FROM public.student_diagnostic_projections WHERE student_id = s)
     OR NOT EXISTS (SELECT 1 FROM public.practice_sessions WHERE id = v_sess)
     OR (r->'rows_affected'->>'student_diagnostic_projections')::int <> 2 THEN
    RAISE EXCEPTION 'DPG FAIL [D12] r=%', r;
  END IF;
  RAISE NOTICE 'ok   [D12] anonymize: the session is retained, its 2 diagnostic projection rows are deleted (L1-14)';
END $t$;

-- ---------------------------------------------------------------- D13 setup (race, driven by the .sh)
CREATE TABLE public._dpg_race (session_id uuid PRIMARY KEY);
DO $t$
DECLARE s uuid := pg_temp.mk_student('racer');
BEGIN
  INSERT INTO public._dpg_race SELECT pg_temp.mk_diagnostic(s, timestamptz '2026-10-01 10:00Z', NULL, false);
  RAISE NOTICE 'ok   [D13-setup] racer session ready';
END $t$;
