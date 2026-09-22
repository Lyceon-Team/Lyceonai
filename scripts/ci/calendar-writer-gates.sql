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
  -- WHICH version owns which date, after setup (v1) then weekly (v2).
  --
  -- This gate used to assert "exactly one version owns every date". That was
  -- true until the 2026-09-22 ruling, and is deliberately false now: weekly is
  -- system-initiated and owns dates from TOMORROW, so today stays on the setup
  -- version and the rest moves to the weekly one. calendar_current_plan
  -- resolves per date -- MAX(version_no) among accepted versions owning that
  -- date -- so two versions composing one plan is the designed behaviour, not
  -- a leak.
  --
  -- Asserting the exact ownership rather than a count keeps everything the old
  -- gate caught: a stale version lingering over a date it no longer owns still
  -- reddens this, and so does a third version appearing from nowhere.
  SELECT count(DISTINCT version_no) INTO v_n FROM public.calendar_current_plan WHERE student_id = S1;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-05 % version(s) own dates after setup+weekly; expected exactly 2 (today on setup, the rest on weekly)', v_n;
  END IF;
  IF (SELECT DISTINCT version_no FROM public.calendar_current_plan
      WHERE student_id = S1 AND scheduled_date = v_today) <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-05 today is not owned by the setup version -- a system trigger took today';
  END IF;
  IF EXISTS (SELECT 1 FROM public.calendar_current_plan
             WHERE student_id = S1 AND scheduled_date > v_today AND version_no <> 2) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-05 a future date is still owned by a superseded version';
  END IF;
  RAISE NOTICE '    OK Z-05 today stays on the setup version, every future date moves to the weekly one';

  ---------------------------------------------------------------- Z-06
  -- §12.2 protected state: a started block is carried onto the next version of
  -- its date, with the same identity, and V-12 would reject a plan that dropped
  -- it. Start one, regenerate, and look for the SAME block_id.
  --
  -- The block is chosen from a STRICTLY FUTURE date. It used to be today's, and
  -- that stopped testing the carry mechanism after the 2026-09-22 ruling: a
  -- weekly run no longer produces a later version of today, so today's block is
  -- not carried -- it is never touched at all. Carrying is what protects a
  -- started block on a date the system version DOES own, which is tomorrow
  -- onward, so that is where this has to look. The today case is its own
  -- assertion, Z-38 below.
  SELECT cp.block_id INTO v_block
  FROM public.calendar_current_plan cp JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S1 AND cp.scheduled_date > v_today AND b.block_type = 'practice'
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
  --
  -- THE FIRST ASSERTION IS NEW AND IS THE POINT. Until 2026-09-22 this gate checked only
  -- the version number on the overridden date, and passed for the wrong reason: the weekly
  -- run it fires was REJECTED (V-01 + V-14 on the overridden date, falling to fallback_v1
  -- and rejected again), so nothing was written anywhere and the date trivially still
  -- carried the day_edit's version. A gate that cannot tell "left alone" from "nothing
  -- happened at all" is not measuring the rule it names. See
  -- 20260926000000_calendar_drop_unowned_dates.sql.
  v_r1 := public.calendar_persist_version(S1, 'weekly', 'system', 'v1', NULL);
  IF v_r1 ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-11 the weekly run was REJECTED, so it left the overridden date alone only by failing: %', v_r1;
  END IF;
  -- And by the PRIMARY generator. "accepted" alone would also be true of a run whose
  -- deterministic plan was rejected and whose fallback happened to be accepted -- a silent
  -- downgrade of the whole planning engine for every student who ever edited a day.
  IF v_r1 ->> 'generator' <> 'deterministic_v1' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-11 an overridden date pushed the run onto %, not deterministic_v1: %', v_r1 ->> 'generator', v_r1;
  END IF;
  SELECT version_no INTO v_n FROM public.calendar_current_plan
  WHERE student_id = S1 AND scheduled_date = v_today + 1 LIMIT 1;
  IF v_n <> (SELECT version_no FROM public.calendar_plan_versions
             WHERE student_id = S1 AND trigger = 'day_edit' ORDER BY version_no DESC LIMIT 1) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-11 a weekly run took over the student''s overridden date';
  END IF;
  RAISE NOTICE '    OK Z-11 an ACCEPTED weekly regeneration leaves an overridden date to the student (§12.1)';

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

-- ----------------------------------------------------------------------------
-- Z-28 .. Z-32 — calendar_weekly_candidates (Doc 05F §12.5, R-08-30)
--
-- The §12.5 predicate decides who the weekly job replans, and the TypeScript
-- job stubs it -- so this is the only place the real query is exercised. Every
-- case here is one arm of the CASE expression, plus the two things §12.5 says
-- in words and a query can silently get wrong: day-scoped versions must NOT
-- suppress the run, and a student whose setup is unfinished is not in the
-- population at all.
--
-- Fresh students, because the earlier blocks in this file have already written
-- versions for S1..S3 and a shared fixture would make these outcomes depend on
-- gate order.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'weekly-auto@example.test',    '{}'::jsonb),
  ('cccccccc-0000-0000-0000-000000000002', 'weekly-custom@example.test',  '{}'::jsonb),
  ('cccccccc-0000-0000-0000-000000000003', 'weekly-fresh@example.test',   '{}'::jsonb),
  ('cccccccc-0000-0000-0000-000000000004', 'weekly-dayedit@example.test', '{}'::jsonb),
  ('cccccccc-0000-0000-0000-000000000005', 'weekly-setup@example.test',   '{}'::jsonb),
  ('cccccccc-0000-0000-0000-000000000006', 'weekly-unent@example.test',   '{}'::jsonb);

INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, planner_mode, setup_completed_at)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'America/Chicago', 62, 60, 6, 1400, 'auto',   now()),
  ('cccccccc-0000-0000-0000-000000000002', 'America/Chicago', 62, 60, 6, 1400, 'custom', now()),
  ('cccccccc-0000-0000-0000-000000000003', 'America/Chicago', 62, 60, 6, 1400, 'auto',   now()),
  ('cccccccc-0000-0000-0000-000000000004', 'America/Chicago', 62, 60, 6, 1400, 'auto',   now()),
  -- Setup UNFINISHED. Not a skip: absent from the population entirely (R-08-04).
  ('cccccccc-0000-0000-0000-000000000005', 'America/Chicago', 62, 60, 6, 1400, 'auto',   NULL),
  ('cccccccc-0000-0000-0000-000000000006', 'America/Chicago', 62, 60, 6, 1400, 'auto',   now());

-- Entitlement for everyone EXCEPT ...006, who exists to make the
-- skipped_no_entitlement arm reachable. entitlement_active reads
-- public.entitlements and counts active / past_due / trialing.
INSERT INTO public.entitlements (profile_id, tier, status)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'premium', 'active'),
       ('cccccccc-0000-0000-0000-000000000002', 'premium', 'active'),
       ('cccccccc-0000-0000-0000-000000000003', 'premium', 'active'),
       ('cccccccc-0000-0000-0000-000000000004', 'premium', 'active'),
       ('cccccccc-0000-0000-0000-000000000005', 'premium', 'active');

DO $weekly$
DECLARE
  W_AUTO    CONSTANT uuid := 'cccccccc-0000-0000-0000-000000000001';
  W_CUSTOM  CONSTANT uuid := 'cccccccc-0000-0000-0000-000000000002';
  W_FRESH   CONSTANT uuid := 'cccccccc-0000-0000-0000-000000000003';
  W_DAYEDIT CONSTANT uuid := 'cccccccc-0000-0000-0000-000000000004';
  W_SETUP   CONSTANT uuid := 'cccccccc-0000-0000-0000-000000000005';
  W_UNENT   CONSTANT uuid := 'cccccccc-0000-0000-0000-000000000006';
  v_monday  date;
  v_out     text;
  v_n       integer;
BEGIN
  v_monday := date_trunc('week', now() AT TIME ZONE 'America/Chicago')::date;

  -- A HORIZON-refresh version, accepted, inside the current local week.
  INSERT INTO public.calendar_plan_versions
    (student_id, version_no, generator_version, trigger, initiated_by,
     input_snapshot, input_snapshot_hash, constants_snapshot, validator_result, created_at)
  VALUES (W_FRESH, 1, 'v1', 'weekly', 'system', '{}', 'h', '{}', 'accepted', now());

  -- A DAY-SCOPED version, accepted, inside the same week. §12.5: this must NOT
  -- suppress the weekly run.
  INSERT INTO public.calendar_plan_versions
    (student_id, version_no, generator_version, trigger, initiated_by,
     input_snapshot, input_snapshot_hash, constants_snapshot, validator_result, created_at)
  VALUES (W_DAYEDIT, 1, 'v1', 'day_edit', 'student', '{}', 'h', '{}', 'accepted', now());

  ------------------------------------------------------------------- Z-28
  SELECT outcome INTO v_out FROM public.calendar_weekly_candidates(1000)
  WHERE student_id = W_AUTO;
  IF v_out IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-28 an entitled auto student with no version this week got outcome %, expected NULL (generate)', v_out;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calendar_weekly_candidates(1000) WHERE student_id = W_AUTO) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-28 the due student is not in the population at all';
  END IF;
  RAISE NOTICE '    OK Z-28 an entitled auto student with no horizon version this week is due (outcome NULL)';

  ------------------------------------------------------------------- Z-29
  SELECT outcome INTO v_out FROM public.calendar_weekly_candidates(1000)
  WHERE student_id = W_CUSTOM;
  IF v_out IS DISTINCT FROM 'skipped_custom' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-29 a custom-planner student got outcome %, expected skipped_custom', v_out;
  END IF;
  -- W_UNENT carries no entitlements row, which is what makes this arm reachable. A student
  -- who stopped paying is RECORDED as skipped, not deleted and not silently dropped (§16:
  -- "402, rows retained").
  SELECT outcome INTO v_out FROM public.calendar_weekly_candidates(1000)
  WHERE student_id = W_UNENT;
  IF v_out IS DISTINCT FROM 'skipped_no_entitlement' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-29 an unentitled auto student got outcome %, expected skipped_no_entitlement', v_out;
  END IF;
  RAISE NOTICE '    OK Z-29 custom and unentitled students are RECORDED as skipped, not filtered away';

  ------------------------------------------------------------------- Z-30
  SELECT outcome INTO v_out FROM public.calendar_weekly_candidates(1000)
  WHERE student_id = W_FRESH;
  IF v_out IS DISTINCT FROM 'skipped_fresh' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-30 a student with an accepted weekly version this local week got outcome %, expected skipped_fresh', v_out;
  END IF;
  RAISE NOTICE '    OK Z-30 a horizon-refresh version inside the current local week suppresses the run';

  ------------------------------------------------------------------- Z-31
  -- THE LOAD-BEARING ONE. §12.5: "Day-scoped versions (day_edit,
  -- day_regenerate, day_reset, do_it_now) never suppress the weekly run."
  -- Widen the trigger list in the SQL by one string and this goes red.
  SELECT outcome INTO v_out FROM public.calendar_weekly_candidates(1000)
  WHERE student_id = W_DAYEDIT;
  IF v_out IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-31 a day_edit version suppressed the weekly run (outcome %); §12.5 says only horizon refreshes do', v_out;
  END IF;
  RAISE NOTICE '    OK Z-31 a day-scoped version does NOT suppress the weekly run';

  ------------------------------------------------------------------- Z-32
  SELECT count(*) INTO v_n FROM public.calendar_weekly_candidates(1000)
  WHERE student_id = W_SETUP;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-32 a student whose setup is unfinished is in the weekly population; R-08-04 puts their first plan on their first open';
  END IF;
  -- And the period key is the local MONDAY, which is R-08-30.
  IF (SELECT period_key FROM public.calendar_weekly_candidates(1000) WHERE student_id = W_AUTO)
     IS DISTINCT FROM v_monday THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-32 period_key is not the local Monday';
  END IF;
  IF EXTRACT(ISODOW FROM v_monday) <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-32 the computed period_key % is not a Monday', v_monday;
  END IF;
  RAISE NOTICE '    OK Z-32 unfinished setup is outside the population, and period_key is the local Monday (R-08-30)';
END;
$weekly$;

-- ----------------------------------------------------------------------------
-- Z-33 .. Z-37 — system triggers own from TOMORROW (Doc 05F §12.1)
--
-- Owner ruling 2026-09-22, addendum item 29. weekly and post_exam are
-- system-initiated and must not replace a block on the student`s today.
-- setup, profile_change, student_refresh and rollback keep owning today.
--
-- Z-34 IS THE ONE THAT MATTERS AND IT IS NOT THE OBVIOUS ONE. Asserting only
-- "weekly does not own today" passes just as well when the weekly version was
-- REJECTED and owns nothing at all -- which is exactly what the first attempt
-- at this change produced: narrowing the input generate_series made V-01 reject
-- today as "outside generated_for.dates", the fallback was rejected for the
-- same reason, and calendar_current_plan (accepted only) never saw the version.
-- So Z-34 asserts accepted + deterministic_v1 + a non-empty date set FIRST.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'sysdates@example.test', '{}'::jsonb);

INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'America/Chicago', 127, 60, 6, 1400, now());

INSERT INTO public.student_domain_mastery
  (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'M',  'Algebra',             0, 0, 0, 10, 'h'),
       ('dddddddd-0000-0000-0000-000000000001', 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h');

DO $sysdates$
DECLARE
  S CONSTANT uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_today    date;
  v_r        jsonb;
  v_ver      integer;
  v_before   text;
  v_after    text;
  v_n        integer;
  v_gen      text;
  v_val      text;
  v_blk      uuid;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Chicago')::date;

  ------------------------------------------------------------------- Z-33
  -- A student-initiated setup seeds the plan and owns today.
  v_r := public.calendar_persist_version(S, 'setup', 'student', 'v1');
  IF (v_r ->> 'validator_result') <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-33 setup was not accepted: %', v_r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S AND scheduled_date = v_today) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-33 setup did not own today';
  END IF;
  SELECT string_agg(block_id::text, ',' ORDER BY block_id) INTO v_before
  FROM public.calendar_current_plan WHERE student_id = S AND scheduled_date = v_today;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-33 today carries no block, so the test that follows proves nothing';
  END IF;
  RAISE NOTICE '    OK Z-33 setup owns today and today carries an unstarted block';

  ------------------------------------------------------------------- Z-34
  -- The weekly run. Accepted and deterministic FIRST -- a rejected version owns
  -- nothing and would pass the "does not own today" test vacuously.
  v_r := public.calendar_persist_version(S, 'weekly', 'system', 'v1');
  SELECT (v_r ->> 'version_no')::integer INTO v_ver;
  SELECT generator, validator_result INTO v_gen, v_val
  FROM public.calendar_plan_versions WHERE student_id = S AND version_no = v_ver;
  IF v_val <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-34 the weekly version was NOT accepted (%) -- the plan would never refresh: %', v_val, v_r;
  END IF;
  IF v_gen <> 'deterministic_v1' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-34 the weekly version fell back to % -- the primary generator was rejected', v_gen;
  END IF;
  SELECT count(*) INTO v_n FROM public.calendar_plan_dates d
  JOIN public.calendar_plan_versions v USING (plan_version_id)
  WHERE v.student_id = S AND v.version_no = v_ver;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-34 the weekly version owns ZERO dates';
  END IF;
  RAISE NOTICE '    OK Z-34 the weekly version is accepted, deterministic_v1 and owns % date(s)', v_n;

  ------------------------------------------------------------------- Z-35
  -- It owns from TOMORROW, and today is untouched.
  IF EXISTS (SELECT 1 FROM public.calendar_plan_dates d
             JOIN public.calendar_plan_versions v USING (plan_version_id)
             WHERE v.student_id = S AND v.version_no = v_ver AND d.scheduled_date = v_today) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-35 a weekly version owns today';
  END IF;
  IF (SELECT min(d.scheduled_date) FROM public.calendar_plan_dates d
      JOIN public.calendar_plan_versions v USING (plan_version_id)
      WHERE v.student_id = S AND v.version_no = v_ver) <> v_today + 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-35 the weekly version does not start at tomorrow';
  END IF;
  SELECT string_agg(block_id::text, ',' ORDER BY block_id) INTO v_after
  FROM public.calendar_current_plan WHERE student_id = S AND scheduled_date = v_today;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-35 today''s unstarted block changed across a weekly run: % -> %', v_before, v_after;
  END IF;
  RAISE NOTICE '    OK Z-35 weekly owns from tomorrow and today''s unstarted block survives byte-identical';

  ------------------------------------------------------------------- Z-36
  -- post_exam is the other system trigger and behaves the same way.
  v_r := public.calendar_persist_version(S, 'post_exam', 'system', 'v1');
  SELECT (v_r ->> 'version_no')::integer INTO v_ver;
  IF (v_r ->> 'validator_result') <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-36 the post_exam version was not accepted: %', v_r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.calendar_plan_dates d
             JOIN public.calendar_plan_versions v USING (plan_version_id)
             WHERE v.student_id = S AND v.version_no = v_ver AND d.scheduled_date = v_today) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-36 a post_exam version owns today';
  END IF;
  RAISE NOTICE '    OK Z-36 post_exam is accepted and also owns from tomorrow';

  ------------------------------------------------------------------- Z-37
  -- THE CONTROL. A student-initiated refresh still owns today and replaces it.
  -- Without this, deleting the trigger list from the helper would go unnoticed.
  v_r := public.calendar_persist_version(S, 'student_refresh', 'student', 'v1');
  SELECT (v_r ->> 'version_no')::integer INTO v_ver;
  IF (v_r ->> 'validator_result') <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-37 student_refresh was not accepted: %', v_r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calendar_plan_dates d
                 JOIN public.calendar_plan_versions v USING (plan_version_id)
                 WHERE v.student_id = S AND v.version_no = v_ver AND d.scheduled_date = v_today) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-37 student_refresh did NOT own today -- the trigger list is wrong';
  END IF;
  IF (SELECT DISTINCT version_no FROM public.calendar_current_plan
      WHERE student_id = S AND scheduled_date = v_today) <> v_ver THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-37 today did not move to the student_refresh version';
  END IF;
  RAISE NOTICE '    OK Z-37 student_refresh still owns today and replaces it (the control)';

  ------------------------------------------------------------------- Z-38
  -- A STARTED block on today survives a weekly run too -- not by being carried
  -- (there is no later version of today to carry it onto) but by the system
  -- version never owning today. Belt and braces with V-12, which protects it
  -- on any date a version DOES take.
  SELECT cp.block_id INTO v_blk
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date = v_today AND b.block_type = 'practice'
  ORDER BY cp.display_ordinal LIMIT 1;
  IF v_blk IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-38 no practice block on today to start';
  END IF;
  PERFORM public.calendar_link_launch(S, v_blk, 'practice', 'eeeeeeee-0000-4000-8000-000000000001');

  PERFORM public.calendar_persist_version(S, 'weekly', 'system', 'v1');

  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S AND scheduled_date = v_today AND block_id = v_blk) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-38 a STARTED block on today did not survive a weekly run';
  END IF;
  RAISE NOTICE '    OK Z-38 a started block on today survives a weekly run, identity unchanged';
END;
$sysdates$;

-- ----------------------------------------------------------------------------
-- Z-39 .. Z-44 — calendar_move_block (Doc 05F §12.2, §12.4)
-- ----------------------------------------------------------------------------
-- A move is the only mutation that writes ONE version owning TWO dates, so the
-- thing most worth asserting is not "the block is on the new day" but that the
-- source date was re-stated WITHOUT it in the SAME version. Drop the source-date
-- member removal and the block is on both days at once: the target gains a
-- created copy and the source keeps the original, because nothing in the writer
-- or the validator objects to a block simply staying where it is. Z-40 is the
-- arm that catches that, and it asserts BOTH ends.
--
-- Z-42/Z-44 assert the refusals come back as DATA. If they were raises, the
-- route could only tell a refusal from a bug by matching on an error string.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('dddddddd-0000-0000-0000-000000000002', 'writer-move@example.test', '{}'::jsonb);

INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
VALUES ('dddddddd-0000-0000-0000-000000000002', 'America/Chicago', 127, 60, 6, 1400, now());

INSERT INTO public.student_domain_mastery
  (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
VALUES ('dddddddd-0000-0000-0000-000000000002', 'M',  'Algebra',             0, 0, 0, 10, 'h'),
       ('dddddddd-0000-0000-0000-000000000002', 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h');

DO $movegates$
DECLARE
  S CONSTANT uuid := 'dddddddd-0000-0000-0000-000000000002';
  v_today   date;
  v_to      date;
  v_r       jsonb;
  v_r2      jsonb;
  v_blk     uuid;
  v_blk2    uuid;
  v_new     uuid;
  v_ver     integer;
  v_n       integer;
  v_vcount  integer;
BEGIN
  SELECT (now() AT TIME ZONE 'America/Chicago')::date INTO v_today;
  v_to := v_today + 3;

  PERFORM public.calendar_persist_version(S, 'setup', 'student', 'v1',
            'dddddddd-0000-0000-0000-00000000f001');

  SELECT cp.block_id INTO v_blk
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date = v_today AND b.block_type = 'practice'
  ORDER BY cp.display_ordinal LIMIT 1;
  IF v_blk IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-39 no practice block on today, so there is nothing to move';
  END IF;

  ------------------------------------------------------------------- Z-39
  -- ONE version, TWO dates.
  SELECT count(*) INTO v_vcount FROM public.calendar_plan_versions WHERE student_id = S;
  v_r := public.calendar_move_block(S, v_blk, v_to, 'v1', 'dddddddd-0000-0000-0000-00000000f002');
  IF (v_r ->> 'validator_result') <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-39 the move was not accepted: %', v_r;
  END IF;
  v_ver := (v_r ->> 'version_no')::int;

  SELECT count(*) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S;
  IF v_n <> v_vcount + 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-39 the move wrote % versions, expected exactly 1', v_n - v_vcount;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.calendar_plan_dates d
  JOIN public.calendar_plan_versions v USING (plan_version_id)
  WHERE v.student_id = S AND v.version_no = v_ver;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-39 the move version owns % dates, expected exactly 2', v_n;
  END IF;
  RAISE NOTICE '    OK Z-39 a move writes exactly ONE version owning exactly TWO dates';

  ------------------------------------------------------------------- Z-40
  -- THE LOAD-BEARING ARM. Gone from the source AND present on the target. The
  -- source half is what a dropped member-removal breaks, and it is asserted
  -- first so the failure names the real cause.
  IF EXISTS (SELECT 1 FROM public.calendar_current_plan
             WHERE student_id = S AND scheduled_date = v_today AND block_id = v_blk) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-40 the moved block is STILL on the source date -- it is now on both days at once';
  END IF;

  SELECT cp.block_id INTO v_new
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date = v_to AND b.derived_from_block_id = v_blk;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-40 no block on the target date has lineage back to the source';
  END IF;

  SELECT count(*) INTO v_n FROM public.calendar_blocks
  WHERE student_id = S AND derived_from_block_id = v_blk;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-40 the move created % descendants of the source, expected exactly 1', v_n;
  END IF;

  IF (SELECT b.block_type || '/' || COALESCE(b.section,'-') || '/' || b.target_count::text
        FROM public.calendar_blocks b WHERE b.block_id = v_new)
     <> (SELECT b.block_type || '/' || COALESCE(b.section,'-') || '/' || b.target_count::text
        FROM public.calendar_blocks b WHERE b.block_id = v_blk) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-40 the moved copy does not match the source type/section/target';
  END IF;
  RAISE NOTICE '    OK Z-40 the block left the source date and landed on the target with lineage intact';

  ------------------------------------------------------------------- Z-41
  -- §12.2: the student chose this arrangement, so BOTH dates are overrides and
  -- a later auto-regeneration leaves them alone.
  SELECT count(*) INTO v_n
  FROM public.calendar_plan_dates d
  JOIN public.calendar_plan_versions v USING (plan_version_id)
  WHERE v.student_id = S AND v.version_no = v_ver AND d.is_user_override;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-41 % of the 2 moved dates are user overrides, expected both', v_n;
  END IF;
  RAISE NOTICE '    OK Z-41 both the source and the target date are marked is_user_override';

  ------------------------------------------------------------------- Z-42
  -- INV-08-09 again, on the new writer.
  SELECT count(*) INTO v_vcount FROM public.calendar_plan_versions WHERE student_id = S;
  v_r2 := public.calendar_move_block(S, v_blk, v_to, 'v1', 'dddddddd-0000-0000-0000-00000000f002');
  SELECT count(*) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S;
  IF v_r2 <> v_r OR v_n <> v_vcount THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-42 a replayed move key wrote % new versions and returned a % response',
      v_n - v_vcount, CASE WHEN v_r2 = v_r THEN 'matching' ELSE 'DIFFERENT' END;
  END IF;
  RAISE NOTICE '    OK Z-42 a replayed move key returns the stored response and writes nothing';

  ------------------------------------------------------------------- Z-43
  -- A STARTED block is refused AS DATA, and nothing is written.
  SELECT cp.block_id INTO v_blk2
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date = v_today AND b.block_type = 'practice'
  ORDER BY cp.display_ordinal LIMIT 1;
  IF v_blk2 IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-43 no practice block left on today to start';
  END IF;
  PERFORM public.calendar_link_launch(S, v_blk2, 'practice', 'eeeeeeee-0000-4000-8000-000000000002');

  SELECT count(*) INTO v_vcount FROM public.calendar_plan_versions WHERE student_id = S;
  v_r2 := public.calendar_move_block(S, v_blk2, v_to, 'v1', 'dddddddd-0000-0000-0000-00000000f003');
  IF (v_r2 ->> 'refused') <> 'block_started' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-43 a started block was not refused as data, got %', v_r2;
  END IF;
  SELECT count(*) INTO v_n FROM public.calendar_plan_versions WHERE student_id = S;
  IF v_n <> v_vcount THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-43 a refused move still wrote % versions', v_n - v_vcount;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S AND scheduled_date = v_today AND block_id = v_blk2) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-43 the started block left its date despite the refusal';
  END IF;
  RAISE NOTICE '    OK Z-43 a started block is refused as data and nothing is written';

  ------------------------------------------------------------------- Z-44
  -- The past and the no-op, also as data. A refused move never touches the
  -- ledger either, or a student who dropped a block back where it started
  -- would burn the key their next real move needs.
  SELECT cp.block_id INTO v_blk2
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date = v_to AND b.derived_from_block_id = v_blk;

  v_r2 := public.calendar_move_block(S, v_blk2, v_today - 1, 'v1', 'dddddddd-0000-0000-0000-00000000f004');
  IF (v_r2 ->> 'refused') <> 'date_in_past' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-44 a move into the past was not refused as data, got %', v_r2;
  END IF;

  v_r2 := public.calendar_move_block(S, v_blk2, v_to, 'v1', 'dddddddd-0000-0000-0000-00000000f005');
  IF (v_r2 ->> 'refused') <> 'same_date' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-44 a move to the same date was not refused as data, got %', v_r2;
  END IF;

  SELECT count(*) INTO v_n FROM public.calendar_mutation_ledger
  WHERE student_id = S AND idempotency_key IN ('dddddddd-0000-0000-0000-00000000f003',
                                               'dddddddd-0000-0000-0000-00000000f004',
                                               'dddddddd-0000-0000-0000-00000000f005');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-44 a refused move consumed % idempotency keys, expected 0', v_n;
  END IF;
  RAISE NOTICE '    OK Z-44 a past date and a same-date move are refused as data, and no key is consumed';
END;
$movegates$;


-- ============================================================================
-- Z-45 .. Z-47 — the plan INPUT tells the truth about enabled engines
-- ============================================================================
-- Doc 05F §9.3 / §10.2 (sheet §8 item 12). calendar_plan_to_output drops every
-- member whose block_type is absent from enabled_block_types, but the generator
-- allocates budget from calendar_build_plan_input without consulting that list.
-- Left alone, a disabled engine SPENDS the day's seconds on a block that is then
-- thrown away, and the day is served short with nothing to explain it.
--
-- WHY THIS LIVES IN THE WRITER GATES AND NOT IN PARITY. The formula is unchanged
-- and must stay so -- it is locked to calendar_formula_reference.py by 6018
-- byte-exact comparisons. What changed is what the formula is TOLD. That is a
-- property of the builder against a real database, which is this file's subject.
--
-- THE FIXTURE IS THE PRODUCTION CASE, 2026-09-22, student amingwa08: Mon-Sat
-- (mask 126), 60 minutes, Saturday test day, 76 active queue entries. Before the
-- fix that plan served 20 questions where 40 fit, 10 on a Monday, and an EMPTY
-- Saturday.
-- ============================================================================
DO $inputgates$
DECLARE
  S CONSTANT uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  k_budget  CONSTANT integer := 60 * 60;   -- daily_minutes 60, in seconds
  k_granule CONSTANT integer := 5 * 90;    -- 5 questions, the practice granule
  v_today    date;
  v_r        jsonb;
  v_input    jsonb;
  v_short    integer;
  v_sat      integer;
  v_prac_off integer;
  v_prac_on  integer;
  v_rev_on   integer;
  v_n        integer;
BEGIN
  SELECT (now() AT TIME ZONE 'America/Chicago')::date INTO v_today;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (S, 'writer-input@example.test', '{}'::jsonb);

  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
  VALUES (S, 'America/Chicago', 126, 60, 6, 1400, now());

  INSERT INTO public.student_domain_mastery
    (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
  VALUES (S, 'M', 'Algebra', 0, 0, 0, 10, 'h'),
         (S, 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h');

  -- 76 servable questions and 76 active queue entries -- production's number.
  INSERT INTO public.questions
    (id, stem, item_type, options, correct_answer, explanation, section, domain, skill_codes, difficulty, status, source_type)
  SELECT 'SATM1' || lpad(i::text, 6, '0'), 'stem ' || i, 'mcq',
         '[{"label":"A","text":"a"},{"label":"B","text":"b"},{"label":"C","text":"c"},{"label":"D","text":"d"}]'::jsonb,
         'A', 'because', 'M', 'Algebra', ARRAY['H.C.'], 2, 'published', 1
  FROM generate_series(1, 76) i;

  INSERT INTO public.review_schedule
    (student_id, question_id, status, queued_at, source_engine, source_session_id, source_item_id, source_outcome)
  SELECT S, 'SATM1' || lpad(i::text, 6, '0'), 'active', now(), 'practice',
         gen_random_uuid(), gen_random_uuid(), 'incorrect'
  FROM generate_series(1, 76) i;

  ------------------------------------------------------------------- Z-45
  -- PRACTICE ONLY, set here rather than assumed. These three gates are about what the
  -- snapshot says when an engine is OFF, so the fixture states that condition itself. It
  -- used to lean on the seeded launch value; the moment review was enabled
  -- (20260928000000) the gate began asserting a state the product had left, and went red
  -- for the one reason a gate must never go red — being out of date.
  UPDATE public.calendar_runtime_config
     SET value = '["practice"]'::jsonb
   WHERE key = 'enabled_block_types';

  -- The SNAPSHOT itself, before any plan is computed. With only practice enabled,
  -- neither other engine may appear as work to do.
  -- Asserted on the input rather than only on the plan because this is the
  -- statement the migration actually makes; the plan is the consequence.
  v_input := public.calendar_build_plan_input(S, ARRAY[v_today]);

  IF (v_input #>> '{profile,full_length_weekday}') IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-45 full_length is disabled but the snapshot still names a test weekday (%)',
      v_input #>> '{profile,full_length_weekday}';
  END IF;
  IF (v_input -> 'review_due_by_date') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-45 review is disabled but the snapshot carries review due: %',
      v_input -> 'review_due_by_date';
  END IF;
  -- The PROFILE is untouched. The snapshot narrows what the generator is told;
  -- it never edits what the student asked for.
  SELECT full_length_weekday INTO v_n FROM public.student_study_profile WHERE student_id = S;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-45 the stored profile lost its test day (got %), the snapshot must not write', v_n;
  END IF;
  RAISE NOTICE '    OK Z-45 with only practice enabled the snapshot reports no test day and no review due, and the profile is unchanged';

  ------------------------------------------------------------------- Z-46
  -- The consequence: no day is served short, and the test weekday is an
  -- ordinary study day rather than a reserved-then-discarded exam.
  v_r := public.calendar_persist_version(S, 'setup', 'student', 'v1',
           'cccccccc-0000-0000-0000-000000000001');
  IF v_r ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-46 setup was not accepted: %', v_r;
  END IF;

  -- Both figures come from the SAME unfiltered set. Filtering the rows first and
  -- then reading Saturday off the remainder is how the first draft of this gate
  -- read -1 for a Saturday that was in fact fully planned.
  SELECT count(*) FILTER (WHERE ((126 >> q.dow) & 1) = 1 AND q.secs < k_budget),
         COALESCE(min(q.secs) FILTER (WHERE q.dow = 6), -1)
    INTO v_short, v_sat
  FROM (
    SELECT cp.scheduled_date AS d,
           EXTRACT(DOW FROM cp.scheduled_date)::integer AS dow,
           COALESCE(sum(b.target_count * 90), 0)::integer AS secs
    FROM public.calendar_current_plan cp
    LEFT JOIN public.calendar_blocks b ON b.block_id = cp.block_id
    WHERE cp.student_id = S AND cp.scheduled_date >= v_today
    GROUP BY 1, 2
  ) q;

  IF v_short <> 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-46 % study day(s) were planned below the % s daily budget', v_short, k_budget;
  END IF;
  IF v_sat <> k_budget THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-46 the test weekday holds % s, expected a full % s of practice', v_sat, k_budget;
  END IF;

  SELECT COALESCE(sum(b.target_count * 90), 0)::integer INTO v_prac_off
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date >= v_today AND b.block_type = 'practice';
  RAISE NOTICE '    OK Z-46 every study day is planned to the full daily budget and the test weekday gets practice (% s of practice over the horizon)', v_prac_off;

  ------------------------------------------------------------------- Z-47
  -- Enabling review must MOVE seconds, not create them: review blocks appear and
  -- practice gives up exactly their seconds. A test that only asserted "review
  -- blocks exist" would pass a generator that overspent the day.
  UPDATE public.calendar_runtime_config
     SET value = '["practice","review"]'::jsonb
   WHERE key = 'enabled_block_types';

  v_r := public.calendar_persist_version(S, 'student_refresh', 'student', 'v1',
           'cccccccc-0000-0000-0000-000000000002');
  IF v_r ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-47 the regenerate with review on was not accepted: %', v_r;
  END IF;

  SELECT COALESCE(sum(b.target_count * 90) FILTER (WHERE b.block_type = 'practice'), 0)::integer,
         COALESCE(sum(b.target_count * 120) FILTER (WHERE b.block_type = 'review'), 0)::integer
    INTO v_prac_on, v_rev_on
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date >= v_today;

  IF v_rev_on <= 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-47 review was enabled with 76 servable entries queued and no review block was planned';
  END IF;
  -- Conservation, to within the practice granule: the day cannot buy a sixth of
  -- a five-question block, so the residue is bounded by one granule per day.
  IF abs((v_prac_off - v_prac_on) - v_rev_on) > k_granule THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-47 budget was not conserved: practice fell by % s while review took % s (tolerance % s)',
      v_prac_off - v_prac_on, v_rev_on, k_granule;
  END IF;
  RAISE NOTICE '    OK Z-47 enabling review moves seconds rather than creating them (practice -% s, review +% s)',
    v_prac_off - v_prac_on, v_rev_on;
END;
$inputgates$;


-- ============================================================================
-- Z-48 — a profile change re-plans the OPEN days and nothing else
-- ============================================================================
-- Doc 05F §12.1 `profile_change`. Changing the schedule regenerates future dates the
-- generator owns. It must not touch a date the STUDENT owns -- one they edited, or one they
-- blocked out, which is the same thing wearing a different label: block-out is an edit to
-- an empty member list (§12.4, proved by Z-12), so it carries `is_user_override` exactly as
-- a hand-edited day does.
--
-- "LEFT ALONE" IS ASSERTED AS BYTE-IDENTITY, not as "still overridden". A regeneration that
-- re-derived an overridden day and happened to land on the same shape would pass a weaker
-- check while having replaced the student's rows underneath them. So the gate snapshots the
-- exact current-plan rows for both dates and compares the snapshot afterwards.
--
-- The EMPTY day is the load-bearing half. An implementation that skipped "days with blocks"
-- rather than "days the student owns" would leave a hand-edited day alone and quietly
-- re-fill a blocked-out one -- a student who cleared Saturday for a concert would find
-- Saturday planned again, which is the defect this gate exists to prevent.
-- ============================================================================
DO $profilechange$
DECLARE
  S CONSTANT uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_today    date;
  v_edited   date;
  v_blocked  date;
  v_before   jsonb;
  v_after    jsonb;
  v_r        jsonb;
  v_open     integer;
BEGIN
  SELECT (now() AT TIME ZONE 'America/Chicago')::date INTO v_today;
  v_edited  := v_today + 2;
  v_blocked := v_today + 3;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (S, 'writer-profile@example.test', '{}'::jsonb);

  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
  VALUES (S, 'America/Chicago', 127, 60, NULL, 1400, now());

  INSERT INTO public.student_domain_mastery
    (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
  VALUES (S, 'M', 'Algebra', 0, 0, 0, 10, 'h'),
         (S, 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h');

  PERFORM public.calendar_persist_version(S, 'setup', 'student', 'v1',
            'eeeeeeee-0000-0000-0000-000000000001');

  -- One day the student EDITED (one block), one they BLOCKED OUT (no blocks). Both carry
  -- is_user_override; only the second is empty.
  -- The member wrapper is `{kind, block}`, as Z-10 sends it. A bare block object is
  -- accepted and stores nothing, leaving the date GENERATED -- which is how the first
  -- draft of this gate came to compare two generated days and call it a failure.
  PERFORM public.calendar_edit_day(S, v_edited,
    jsonb_build_array(jsonb_build_object('kind', 'created', 'block', jsonb_build_object(
      'block_type', 'practice', 'section', 'M',
      'scope', jsonb_build_object('level', 'domain',
                 'mix', jsonb_build_array(jsonb_build_object(
                          'domain', 'Algebra', 'count', 10, 'explanation_key', 'weak'))),
      'target_count', 10, 'explanation_key', 'weighted'))),
    'v1', 'eeeeeeee-0000-0000-0000-000000000002');
  PERFORM public.calendar_edit_day(S, v_blocked, '[]'::jsonb, 'v1',
            'eeeeeeee-0000-0000-0000-000000000003');

  -- Both dates must really be the student's, or the byte-identity below is vacuous --
  -- the same mistake Z-11 made for two months.
  IF (SELECT count(*) FROM public.calendar_current_plan cp
      WHERE cp.student_id = S AND cp.scheduled_date IN (v_edited, v_blocked)
        AND cp.is_user_override) < 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-48 the fixture did not produce two overridden dates, so nothing below is being measured';
  END IF;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.scheduled_date, t.block_id NULLS FIRST)
    INTO v_before
  FROM (SELECT cp.scheduled_date, cp.block_id, cp.is_user_override
        FROM public.calendar_current_plan cp
        WHERE cp.student_id = S AND cp.scheduled_date IN (v_edited, v_blocked)) t;

  -- The schedule change itself: drop to weekdays only and halve the day.
  UPDATE public.student_study_profile
     SET study_days_mask = 62, daily_minutes = 30
   WHERE student_id = S;

  v_r := public.calendar_persist_version(S, 'profile_change', 'student', 'v1',
           'eeeeeeee-0000-0000-0000-000000000004');
  IF v_r ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-48 the profile_change was not accepted: %', v_r;
  END IF;
  -- Same reason as Z-11: accepted-by-fallback is not the behaviour this rule describes.
  IF v_r ->> 'generator' <> 'deterministic_v1' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-48 the profile_change fell to %, not deterministic_v1: %', v_r ->> 'generator', v_r;
  END IF;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.scheduled_date, t.block_id NULLS FIRST)
    INTO v_after
  FROM (SELECT cp.scheduled_date, cp.block_id, cp.is_user_override
        FROM public.calendar_current_plan cp
        WHERE cp.student_id = S AND cp.scheduled_date IN (v_edited, v_blocked)) t;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-48 a profile change altered a day the student owns.
  before: %
  after:  %', v_before, v_after;
  END IF;

  -- And it DID do its job on the days it owns, or the comparison above would be passing
  -- because nothing was regenerated at all.
  SELECT count(*) INTO v_open
  FROM public.calendar_current_plan cp
  WHERE cp.student_id = S
    AND cp.scheduled_date > v_today
    AND cp.scheduled_date NOT IN (v_edited, v_blocked)
    AND cp.is_user_override IS NOT TRUE;
  IF v_open = 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-48 no open date was re-planned, so the byte-identity above proves nothing';
  END IF;

  RAISE NOTICE '    OK Z-48 a profile change re-planned % open row(s) and left the edited and blocked-out days byte-identical', v_open;
END;
$profilechange$;


-- ============================================================================
-- Z-49 .. Z-51 — blocking out a day, and undoing it beyond the horizon
-- ============================================================================
-- Doc 05F §12.4 (block-out is an edit to an empty member list), §12.1 (a day reset
-- clears the override), §12.2 (a started block is carried, V-12).
--
-- Z-12 already proves an empty edit clears a day and keeps the override. These add
-- the three things the BLOCK-OUT feature needs on top of that: a started session
-- survives being blocked out; an undo works beyond the horizon, where it used to
-- raise; and once the date is inside the horizon the generator really does take it
-- back, which is the only thing that makes the undo mean anything.
-- ============================================================================
DO $blockout$
DECLARE
  S CONSTANT uuid := 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
  v_today   date;
  v_far     date;
  v_blk     uuid;
  v_r       jsonb;
  v_n       integer;
  v_started integer;
  v_ov      boolean;
BEGIN
  SELECT (now() AT TIME ZONE 'America/Chicago')::date INTO v_today;
  v_far := v_today + 21;   -- beyond the 14-day horizon, by seven days

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (S, 'writer-blockout@example.test', '{}'::jsonb);

  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
  VALUES (S, 'America/Chicago', 127, 60, NULL, 1400, now());

  INSERT INTO public.student_domain_mastery
    (student_id, section, domain, mastery_level, mastery_score, mastery_pct, event_count_total, constants_snapshot_hash)
  VALUES (S, 'M', 'Algebra', 0, 0, 0, 10, 'h'),
         (S, 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h');

  PERFORM public.calendar_persist_version(S, 'setup', 'student', 'v1',
            'bbbbbbbb-0000-0000-0000-000000000001');

  ------------------------------------------------------------------- Z-49
  -- §12.2 / V-12: blocking out TODAY keeps a session already underway. A student
  -- mid-set who clears the rest of their day must not lose the set they are in.
  SELECT cp.block_id INTO v_blk FROM public.calendar_current_plan cp
  WHERE cp.student_id = S AND cp.scheduled_date = v_today AND cp.block_id IS NOT NULL
  LIMIT 1;
  IF v_blk IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-49 the fixture planned no block on today, so nothing can be started';
  END IF;
  -- Through the real writer, not an ad-hoc INSERT: calendar_carry_started reads what a
  -- launch actually leaves behind, and a hand-built row could satisfy this gate while
  -- differing from what the route writes.
  PERFORM public.calendar_link_launch(S, v_blk, 'practice', gen_random_uuid());

  SELECT count(*) INTO v_n FROM public.calendar_current_plan
  WHERE student_id = S AND scheduled_date = v_today AND block_id IS NOT NULL;
  IF v_n < 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-49 today holds % block(s); the carry cannot be distinguished from a no-op with fewer than 2', v_n;
  END IF;

  PERFORM public.calendar_edit_day(S, v_today, '[]'::jsonb, 'v1',
            'bbbbbbbb-0000-0000-0000-000000000002');

  SELECT count(*) INTO v_n FROM public.calendar_current_plan
  WHERE student_id = S AND scheduled_date = v_today AND block_id IS NOT NULL;
  SELECT count(*) INTO v_started FROM public.calendar_current_plan
  WHERE student_id = S AND scheduled_date = v_today AND block_id = v_blk;
  IF v_n <> 1 OR v_started <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-49 blocking out today left % block(s), started block present: %; expected exactly the started one',
      v_n, v_started = 1;
  END IF;
  RAISE NOTICE '    OK Z-49 blocking out today clears the day and carries the STARTED block (V-12)';

  ------------------------------------------------------------------- Z-50
  -- The undo, on a date beyond the horizon. This RAISED before
  -- 20260927000000: a day blocked out three weeks ahead could not be taken back.
  PERFORM public.calendar_edit_day(S, v_far, '[]'::jsonb, 'v1',
            'bbbbbbbb-0000-0000-0000-000000000003');
  SELECT bool_or(is_user_override) INTO v_ov FROM public.calendar_current_plan
  WHERE student_id = S AND scheduled_date = v_far;
  IF v_ov IS NOT TRUE THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-50 the fixture did not block out the far date';
  END IF;

  v_r := public.calendar_regenerate_day(S, v_far, 'day_reset', 'v1',
           'bbbbbbbb-0000-0000-0000-000000000004');
  IF v_r ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-50 undoing a day off beyond the horizon was not accepted: %', v_r;
  END IF;

  SELECT count(*) FILTER (WHERE block_id IS NOT NULL), bool_or(is_user_override)
    INTO v_n, v_ov
  FROM public.calendar_current_plan WHERE student_id = S AND scheduled_date = v_far;
  IF v_n <> 0 OR v_ov IS NOT FALSE THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-50 after the undo the far date holds % block(s) and override=%; expected 0 and false',
      v_n, v_ov;
  END IF;
  RAISE NOTICE '    OK Z-50 a day off beyond the horizon is undone into a non-override empty version';

  ------------------------------------------------------------------- Z-51
  -- And the undo MEANS something: once the date is inside the horizon the ordinary
  -- weekly run plans it. Without this, Z-50 would prove only that a flag flipped.
  -- The horizon is widened rather than time being moved, because the clock is not
  -- ours to move and horizon_days is a config row that exists to be read.
  UPDATE public.calendar_runtime_config SET value = '28'::jsonb WHERE key = 'horizon_days';

  v_r := public.calendar_persist_version(S, 'weekly', 'system', 'v1',
           'bbbbbbbb-0000-0000-0000-000000000005');
  IF v_r ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-51 the weekly run was not accepted: %', v_r;
  END IF;

  SELECT count(*) INTO v_n FROM public.calendar_current_plan
  WHERE student_id = S AND scheduled_date = v_far AND block_id IS NOT NULL;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-51 the undone date entered the horizon and the weekly run still planned nothing on it';
  END IF;
  RAISE NOTICE '    OK Z-51 once inside the horizon the weekly run plans the undone date (% block(s))', v_n;
END;
$blockout$;


ROLLBACK;
