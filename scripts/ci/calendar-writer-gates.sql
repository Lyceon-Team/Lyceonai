-- ============================================================================
-- Doc 05F calendar — write-RPC gates
-- ============================================================================
-- Proves the five write RPCs behave as §12 says: version allocation under the
-- profile lock, idempotent replay, started blocks carried, the fail-open ladder
-- to fallback_v1, a rejected version owning nothing, and no client execute.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/calendar-writer-gates.sql
--
-- @spec [Doc-05F_V1.0 §12.1 triggers, §12.2 protected state, §12.3 version
--        allocation (INV-08-17), §12.4 day edit, §12.6 do it now,
--        §7.8 idempotency (INV-08-09), §7.12 access boundary]
--       [Doc_05F_formula_sheet.md §5A fail-open ladder, §6]
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'writer-a@example.test', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'writer-b@example.test', '{}'::jsonb),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'writer-c@example.test', '{}'::jsonb);

-- A student who studies Mon-Fri (mask 62 = bits 1..5), 60 minutes, exams on
-- Saturday, with two measured domains so the weighted branch runs.
INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'America/Chicago', 62, 60, 6, 1400, now()),
       ('22222222-2222-2222-2222-222222222222', 'America/Chicago', 62, 60, 6, 1400, now()),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'America/Chicago', 62, 60, 6, 1400, now());

INSERT INTO public.student_domain_mastery
  (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
VALUES ('11111111-1111-1111-1111-111111111111', 'M',  'Algebra',             0, 0, 0, 10, 'h'),
       ('11111111-1111-1111-1111-111111111111', 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h');

DO $writer$
DECLARE
  S1 CONSTANT uuid := '11111111-1111-1111-1111-111111111111';
  S2 CONSTANT uuid := '22222222-2222-2222-2222-222222222222';
  v_today   date;
  v_r1      jsonb;
  v_r2      jsonb;
  v_n       integer;
  v_block   uuid;
  v_txt     text;
  v_version uuid;
BEGIN
  SELECT (now() AT TIME ZONE 'America/Chicago')::date INTO v_today;

  ---------------------------------------------------------------- Z-01
  v_r1 := public.calendar_persist_version(S1, 'setup', 'student', 'v1',
            '55555555-5555-5555-5555-555555555555');
  IF v_r1 ->> 'validator_result' <> 'accepted' OR (v_r1 ->> 'version_no')::int <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-01 setup did not produce an accepted version 1: %', v_r1;
  END IF;
  RAISE NOTICE '    OK Z-01 setup writes an accepted version 1 (generator %)', v_r1 ->> 'generator';

  ---------------------------------------------------------------- Z-02
  -- INV-08-09: a replayed idempotency key returns the stored response and
  -- writes NOTHING. Same plan_version_id, still one version.
  v_r2 := public.calendar_persist_version(S1, 'setup', 'student', 'v1',
            '55555555-5555-5555-5555-555555555555');
  SELECT count(*) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S1;
  IF v_r2 <> v_r1 OR v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-02 replay was not idempotent (versions=%, response equal=%)',
      v_n, (v_r2 = v_r1);
  END IF;
  RAISE NOTICE '    OK Z-02 a replayed idempotency key returns the stored response and writes nothing';

  ---------------------------------------------------------------- Z-03
  -- enabled_block_types is ["practice"] at launch, so only practice is
  -- persisted even though the formula computed review and full-length too.
  SELECT count(DISTINCT b.block_type), string_agg(DISTINCT b.block_type, ',')
    INTO v_n, v_txt
  FROM public.calendar_current_plan cp JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S1;
  IF v_txt IS DISTINCT FROM 'practice' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-03 persisted block types are % but enabled_block_types is ["practice"]', v_txt;
  END IF;
  RAISE NOTICE '    OK Z-03 only enabled block types are persisted (V-03 holds at the writer)';

  ---------------------------------------------------------------- Z-04
  -- Every version allocates the next version_no, and a second student's
  -- numbering is independent.
  PERFORM public.calendar_persist_version(S1, 'weekly', 'system', 'v1', NULL);
  PERFORM public.calendar_persist_version(S2, 'setup', 'student', 'v1', NULL);
  SELECT max(version_no) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S1;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-04 second version for S1 is version_no %, expected 2', v_n;
  END IF;
  SELECT max(version_no) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S2;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-04 S2 version numbering is not independent (max=%)', v_n;
  END IF;
  RAISE NOTICE '    OK Z-04 version_no is MAX+1 per student and independent between students';

  ---------------------------------------------------------------- Z-05
  -- The newest accepted version owns every date: the older one owns none.
  SELECT count(DISTINCT version_no) INTO v_n FROM public.calendar_current_plan WHERE student_id = S1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-05 % versions own dates at once; expected 1', v_n;
  END IF;
  RAISE NOTICE '    OK Z-05 exactly one version owns the plan after a regeneration';

  ---------------------------------------------------------------- Z-06
  -- §12.2 protected state: a started block is carried onto the next version of
  -- its date, with the same identity, and V-12 would reject a plan that dropped
  -- it. Start one, regenerate, and look for the SAME block_id.
  SELECT cp.block_id INTO v_block
  FROM public.calendar_current_plan cp JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S1 AND cp.scheduled_date >= v_today AND b.block_type = 'practice'
  ORDER BY cp.scheduled_date, cp.display_ordinal LIMIT 1;
  IF v_block IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-06 fixture produced no practice block to start';
  END IF;

  PERFORM public.calendar_link_launch(S1, v_block, 'practice', '99999999-9999-9999-9999-999999999999');
  PERFORM public.calendar_persist_version(S1, 'weekly', 'system', 'v1', NULL);

  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S1 AND block_id = v_block AND membership_type = 'carried') THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-06 a started block was not carried onto the new version';
  END IF;
  RAISE NOTICE '    OK Z-06 a started block is carried onto the next version, identity unchanged (§12.2, V-12)';

  ---------------------------------------------------------------- Z-07
  -- The carried block keeps its ORIGINAL date. INV-08-22 makes that a
  -- relational fact, but prove the writer honours it.
  SELECT count(*) INTO v_n
  FROM public.calendar_plan_block_memberships m
  WHERE m.block_id = v_block
  GROUP BY m.scheduled_date;
  IF (SELECT count(DISTINCT scheduled_date) FROM public.calendar_plan_block_memberships WHERE block_id = v_block) <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-07 a carried block appears on more than one date';
  END IF;
  RAISE NOTICE '    OK Z-07 a carried block never moves dates';

  ---------------------------------------------------------------- Z-08
  -- calendar_link_launch is idempotent on (engine, engine_session_id): a
  -- retried launch must not inflate the launch count.
  v_r1 := public.calendar_link_launch(S1, v_block, 'practice', '99999999-9999-9999-9999-999999999999');
  IF (v_r1 ->> 'replayed')::boolean IS NOT true THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-08 a repeated launch was not reported as a replay: %', v_r1;
  END IF;
  SELECT count(*) INTO v_n FROM public.calendar_block_launches WHERE block_id = v_block;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-08 a retried launch created % rows', v_n;
  END IF;
  RAISE NOTICE '    OK Z-08 calendar_link_launch is idempotent on (engine, engine_session_id)';

  ---------------------------------------------------------------- Z-09
  -- A block belonging to another student can never be launched.
  BEGIN
    PERFORM public.calendar_link_launch(S2, v_block, 'practice', '88888888-8888-8888-8888-888888888888');
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-09 another student launched a block that is not theirs';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'CALENDAR_WRITER_GATE_FAILED%' THEN RAISE; END IF;
    RAISE NOTICE '    OK Z-09 a cross-student launch is refused — %', SQLERRM;
  END;

  ---------------------------------------------------------------- Z-10
  -- §12.4 day edit: the client's full member list, persisted with
  -- is_user_override = true, validated in student_edit mode.
  v_r1 := public.calendar_edit_day(S1, v_today + 1,
            jsonb_build_array(jsonb_build_object('kind','created','block', jsonb_build_object(
              'block_type','practice','section','M',
              'scope', jsonb_build_object('level','domain','mix', jsonb_build_array(
                jsonb_build_object('domain','Algebra','count',15,'explanation_key','weak'))),
              'target_count', 15, 'explanation_key','weighted'))),
            'v1', NULL);
  IF v_r1 ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-10 a day edit was rejected: %', v_r1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S1 AND scheduled_date = v_today + 1 AND is_user_override) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-10 the edited date did not keep is_user_override';
  END IF;
  RAISE NOTICE '    OK Z-10 a day edit owns its date with is_user_override = true (§12.4)';

  ---------------------------------------------------------------- Z-11
  -- §12.1 / §12.2: a non-student regeneration never takes an overridden date.
  PERFORM public.calendar_persist_version(S1, 'weekly', 'system', 'v1', NULL);
  SELECT version_no INTO v_n FROM public.calendar_current_plan
  WHERE student_id = S1 AND scheduled_date = v_today + 1 LIMIT 1;
  IF v_n <> (SELECT version_no FROM public.calendar_plan_versions
             WHERE student_id = S1 AND trigger = 'day_edit' ORDER BY version_no DESC LIMIT 1) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-11 a weekly run took over the student''s overridden date';
  END IF;
  RAISE NOTICE '    OK Z-11 a weekly regeneration leaves an overridden date to the student (§12.1)';

  ---------------------------------------------------------------- Z-12
  -- §12.4: an empty member list is a cleared day, and the override is kept.
  PERFORM public.calendar_edit_day(S1, v_today + 2, '[]'::jsonb, 'v1', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S1 AND scheduled_date = v_today + 2
                   AND block_id IS NULL AND is_user_override) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-12 a cleared day lost its row or its override flag';
  END IF;
  RAISE NOTICE '    OK Z-12 an empty edit clears the day and keeps the override (§12.4)';

  ---------------------------------------------------------------- Z-13
  -- §12.2: a past date is never owned and never edited.
  BEGIN
    PERFORM public.calendar_edit_day(S1, v_today - 1, '[]'::jsonb, 'v1', NULL);
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-13 a past date was edited';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'CALENDAR_WRITER_GATE_FAILED%' THEN RAISE; END IF;
    RAISE NOTICE '    OK Z-13 a past date cannot be edited — %', SQLERRM;
  END;

  ---------------------------------------------------------------- Z-14
  -- §12.6 do it now: today gains one created block derived from the missed one,
  -- and today's existing members are carried unchanged.
  SELECT count(*) INTO v_n FROM public.calendar_current_plan
  WHERE student_id = S1 AND scheduled_date = v_today AND block_id IS NOT NULL;
  v_r1 := public.calendar_do_it_now(S1, v_block, 'v1', NULL);
  IF v_r1 ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-14 do_it_now was rejected: %', v_r1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan cp
                 JOIN public.calendar_blocks b ON b.block_id = cp.block_id
                 WHERE cp.student_id = S1 AND cp.scheduled_date = v_today
                   AND b.derived_from_block_id = v_block AND b.source = 'student') THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-14 do_it_now did not append a block derived from the missed one';
  END IF;
  RAISE NOTICE '    OK Z-14 do_it_now appends one derived block to today (§12.6)';

  ---------------------------------------------------------------- Z-15
  -- A rejected version is RECORDED and owns nothing: the prior plan stands
  -- (sheet §6 clause 3). Force a rejection by editing a date into the past
  -- through the writer directly, which is the only way to reach it.
  SELECT plan_version_id INTO v_version FROM public.calendar_plan_versions
  WHERE student_id = S1 ORDER BY version_no DESC LIMIT 1;
  SELECT count(*) INTO v_n FROM public.calendar_current_plan WHERE student_id = S1;

  v_r1 := public.calendar_write_version(S1, 'weekly', 'system', 'deterministic_v1', 'v1',
            public.calendar_build_plan_input(S1, ARRAY[v_today]),
            jsonb_build_object('generator','deterministic_v1','dates', jsonb_build_array(
              jsonb_build_object('scheduled_date', (v_today - 30)::text, 'is_user_override', false,
                                 'members', '[]'::jsonb))),
            'generated', NULL);
  IF v_r1 ->> 'validator_result' <> 'rejected' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-15 a plan dated 30 days ago was accepted: %', v_r1;
  END IF;
  IF (SELECT validator_result FROM public.calendar_plan_versions
      WHERE plan_version_id = (v_r1 ->> 'plan_version_id')::uuid) <> 'rejected' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-15 the rejected version was not recorded';
  END IF;
  IF (SELECT count(*) FROM public.calendar_current_plan WHERE student_id = S1) <> v_n
     OR (SELECT DISTINCT version_no FROM public.calendar_current_plan
         WHERE student_id = S1 AND scheduled_date = v_today)
        <> (SELECT version_no FROM public.calendar_plan_versions WHERE plan_version_id = v_version) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-15 a rejected version disturbed the standing plan';
  END IF;
  RAISE NOTICE '    OK Z-15 a rejected version is recorded, owns no date, and the prior plan stands';

  ---------------------------------------------------------------- Z-16
  -- Sheet §5A: a degraded mastery read runs fallback_v1 on the SAME snapshot in
  -- the SAME transaction, recording the generator and the reason.
  v_r1 := public.calendar_write_version(S1, 'weekly', 'system', 'fallback_v1', 'v1',
            public.calendar_build_plan_input(S1, ARRAY[v_today + 3]),
            public.calendar_plan_to_output(
              public.calendar_compute_plan_fallback(public.calendar_build_plan_input(S1, ARRAY[v_today + 3])),
              'v1', ARRAY['practice']),
            'generated',
            jsonb_build_object('reason','degraded_input','degraded', jsonb_build_array('mastery')));
  IF (SELECT generator FROM public.calendar_plan_versions
      WHERE plan_version_id = (v_r1 ->> 'plan_version_id')::uuid) <> 'fallback_v1' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-16 the fallback generator was not recorded on the version';
  END IF;
  IF (SELECT validator_detail #>> '{fallback,reason}' FROM public.calendar_plan_versions
      WHERE plan_version_id = (v_r1 ->> 'plan_version_id')::uuid) <> 'degraded_input' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-16 the fallback reason was not recorded in validator_detail';
  END IF;
  RAISE NOTICE '    OK Z-16 a fallback run records generator = fallback_v1 and its reason (sheet §5A)';

  ---------------------------------------------------------------- Z-17
  -- Essential input missing: nothing is generated, and the caller is told.
  BEGIN
    PERFORM public.calendar_persist_version('33333333-3333-3333-3333-333333333333',
              'setup', 'student', 'v1', NULL);
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-17 a student with no study profile got a plan';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'CALENDAR_WRITER_GATE_FAILED%' THEN RAISE; END IF;
    RAISE NOTICE '    OK Z-17 no study profile means nothing is generated — %', SQLERRM;
  END;

  ---------------------------------------------------------------- Z-18
  -- Nothing the writers produced may violate the append-only rule: every block
  -- and membership is still exactly as first written.
  IF EXISTS (SELECT 1 FROM public.calendar_blocks WHERE created_at > now()) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-18 impossible created_at';
  END IF;
  SELECT count(*) INTO v_n FROM public.calendar_plan_block_memberships m
  JOIN public.calendar_blocks b ON b.block_id = m.block_id
  WHERE b.scheduled_date <> m.scheduled_date;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-18 % membership(s) disagree with their block''s date', v_n;
  END IF;
  RAISE NOTICE '    OK Z-18 every membership agrees with its block''s scheduled_date';
END;
$writer$;

-- ---------------------------------------------------------------------------
-- No client may execute a calendar write RPC (§7.12).
-- ---------------------------------------------------------------------------
DO $exec$
DECLARE
  v_n     integer;
  v_names text;
BEGIN
  SELECT count(*), string_agg(DISTINCT p.proname, ', ') INTO v_n, v_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'calendar\_%'
    AND p.proname <> 'calendar_viewer_is_admin'   -- called from inside the RLS policies
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-19 anon/authenticated can execute % calendar function(s): %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK Z-19 no calendar RPC is executable by anon or authenticated';

  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_names
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN
    ('calendar_persist_version','calendar_edit_day','calendar_do_it_now',
     'calendar_regenerate_day',
     'calendar_link_launch','calendar_build_plan_input','calendar_viewer_is_admin')
    AND NOT (p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-20 % function(s) are not SECURITY DEFINER with a pinned search_path: %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK Z-20 every write RPC is SECURITY DEFINER with search_path = public, pg_temp';

  -- The generators must stay pure: IMMUTABLE and no table access.
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_names
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN
    ('calendar_compute_plan','calendar_compute_plan_fallback','calendar_validate_plan',
     'calendar_place_full_lengths','calendar_plan_to_output','calendar_carry_started',
     'calendar_regenerate_day_only',
     'calendar_scope_is_valid','calendar_require_int')
    AND p.provolatile <> 'i';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-21 % pure function(s) are not IMMUTABLE: %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK Z-21 every pure calendar function is IMMUTABLE';
END;
$exec$;

-- ----------------------------------------------------------------------------
-- Z-22 .. Z-27 — calendar_regenerate_day (Doc 05F §12.1, §15)
--
-- The writer behind POST /api/calendar/days/:date/regenerate and /reset. Doc 05F
-- §12.1 lists both triggers and §15 gives each a route, but 20260917130000
-- named no writer for either. These gates prove the one that landed in
-- 20260917140000 does what those two routes need, and in particular that its
-- validator mode is load-bearing rather than cosmetic.
-- ----------------------------------------------------------------------------
DO $regen$
DECLARE
  S3 CONSTANT uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_today   date;
  v_d1      date;
  v_d2      date;
  v_r1      jsonb;
  v_r2      jsonb;
  v_input   jsonb;
  v_output  jsonb;
  v_gen     jsonb;
  v_day     jsonb;
  v_n       integer;
  v_ovr     boolean;
  v_blocks  integer;
  v_sqlst   text;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Chicago')::date;

  -- The first two study days (mask 62 = Mon..Fri) on or after today.
  SELECT min(d), min(d) FILTER (WHERE d > (SELECT min(d2) FROM generate_series(v_today, v_today + 13, interval '1 day') g2(d2)
                                           WHERE ((62 >> (EXTRACT(DOW FROM d2)::integer)) & 1) = 1))
  INTO v_d1, v_d2
  FROM generate_series(v_today, v_today + 13, interval '1 day') g(d)
  WHERE ((62 >> (EXTRACT(DOW FROM d)::integer)) & 1) = 1;

  ------------------------------------------------------------------- Z-22
  BEGIN
    PERFORM public.calendar_regenerate_day(S3, v_d1, 'weekly', 'v1');
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-22 a horizon-scoped trigger was accepted by a day-scoped writer';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    RAISE NOTICE '    OK Z-22 calendar_regenerate_day refuses a horizon-scoped trigger';
  END;

  ------------------------------------------------------------------- Z-23
  BEGIN
    PERFORM public.calendar_regenerate_day(S3, v_today - 1, 'day_regenerate', 'v1');
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-23 a past date was regenerated';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    RAISE NOTICE '    OK Z-23 calendar_regenerate_day refuses a past date (§12.2)';
  END;

  -- Setup, then the student clears two days by hand. Both are now overridden.
  PERFORM public.calendar_persist_version(S3, 'setup', 'student', 'v1');
  PERFORM public.calendar_edit_day(S3, v_d1, '[]'::jsonb, 'v1');
  PERFORM public.calendar_edit_day(S3, v_d2, '[]'::jsonb, 'v1');

  SELECT DISTINCT is_user_override INTO v_ovr
  FROM public.calendar_current_plan WHERE student_id = S3 AND scheduled_date = v_d1;
  IF v_ovr IS NOT TRUE THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-24 setup is wrong, % is not overridden before the test', v_d1;
  END IF;

  ------------------------------------------------------------------- Z-25
  -- The negative control, and the reason mode day_regenerate exists at all.
  -- Same snapshot, same output, two modes: generated is REJECTED by V-14
  -- because the date is overridden, day_regenerate is ACCEPTED. Run on v_d2,
  -- which is still overridden, so the comparison is real.
  -- Built exactly the way calendar_regenerate_day builds it: the generator sees
  -- the whole horizon, and the output is narrowed to the one date afterwards.
  -- calendar_compute_plan ignores generated_for.dates and always emits the
  -- horizon, so a one-date snapshot would fail V-01 rather than V-14 and this
  -- control would prove nothing.
  v_input  := public.calendar_build_plan_input(S3,
                ARRAY(SELECT d::date FROM generate_series(v_today, v_today + 13, interval '1 day') g(d)));
  v_gen    := public.calendar_compute_plan(v_input);
  v_output := public.calendar_carry_started(v_input,
                public.calendar_regenerate_day_only(
                  public.calendar_plan_to_output(v_gen, 'v1',
                    ARRAY(SELECT jsonb_array_elements_text(v_input -> 'enabled_block_types'))),
                  v_d2));

  v_r1 := public.calendar_validate_plan('generated',      v_input, v_output);
  v_r2 := public.calendar_validate_plan('day_regenerate', v_input, v_output);

  IF v_r1 ->> 'result' <> 'rejected'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_r1 -> 'violations') x
                    WHERE x ->> 'rule' = 'V-14') THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-25 mode generated did NOT reject an overridden date on V-14, so mode day_regenerate is not doing any work: %', v_r1;
  END IF;
  IF v_r2 ->> 'result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-25 mode day_regenerate rejected the same plan mode generated only refused on V-14: %', v_r2;
  END IF;
  RAISE NOTICE '    OK Z-25 generated rejects an overridden date on V-14, day_regenerate accepts the same plan';

  ------------------------------------------------------------------- Z-24
  v_r1 := public.calendar_regenerate_day(S3, v_d1, 'day_regenerate', 'v1');
  IF v_r1 ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-24 regenerating an overridden day was rejected: %', v_r1;
  END IF;

  SELECT DISTINCT is_user_override INTO v_ovr
  FROM public.calendar_current_plan WHERE student_id = S3 AND scheduled_date = v_d1;
  SELECT count(*) INTO v_blocks
  FROM public.calendar_current_plan
  WHERE student_id = S3 AND scheduled_date = v_d1 AND block_id IS NOT NULL;

  IF v_ovr IS NOT FALSE THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-24 the override did not clear on %', v_d1;
  END IF;
  IF v_blocks < 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-24 a regenerated study day carries no blocks — the fail-open promise is broken';
  END IF;
  RAISE NOTICE '    OK Z-24 an overridden day regenerates, the override clears and the day carries % block(s)', v_blocks;

  ------------------------------------------------------------------- Z-26
  SELECT count(*) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S3;
  v_r1 := public.calendar_regenerate_day(S3, v_d2, 'day_reset', 'v1',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  v_r2 := public.calendar_regenerate_day(S3, v_d2, 'day_reset', 'v1',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  IF v_r1 IS DISTINCT FROM v_r2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-26 a replayed idempotency key returned a different response: % vs %', v_r1, v_r2;
  END IF;
  SELECT count(*) - v_n INTO v_n FROM public.calendar_plan_versions WHERE student_id = S3;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-26 a replayed key wrote % versions, expected exactly 1', v_n;
  END IF;
  RAISE NOTICE '    OK Z-26 a replayed idempotency key returns the stored response and writes nothing';

  ------------------------------------------------------------------- Z-27
  SELECT count(DISTINCT scheduled_date) INTO v_n
  FROM public.calendar_plan_dates
  WHERE plan_version_id = (v_r1 ->> 'plan_version_id')::uuid;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-27 a day-scoped version owns % dates, expected exactly 1', v_n;
  END IF;
  SELECT trigger INTO v_sqlst FROM public.calendar_plan_versions
  WHERE plan_version_id = (v_r1 ->> 'plan_version_id')::uuid;
  IF v_sqlst <> 'day_reset' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-27 the recorded trigger is %, expected day_reset', v_sqlst;
  END IF;
  RAISE NOTICE '    OK Z-27 a day-scoped version owns exactly one date and records the trigger the route named';
END;
$regen$;

ROLLBACK;
