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
-- Saturday every 2 weeks, with two measured domains so the weighted branch runs.
--
-- SETUP IS FOURTEEN DAYS BACK, AND THAT IS NOW LOAD-BEARING (20261011000000).
-- These three used to set up `now()`, and Z-03 relied on an exam being placed
-- inside the horizon anyway -- which was true only because the retired rule
-- anchored the series on the first preferred weekday ON OR AFTER setup, so a
-- student who set up today got an exam within the week. Placement is now
-- arithmetic: the first sitting is `interval_weeks x 7` days after setup, so for
-- a fortnightly student who set up today it falls on day 15 of a 14-day horizon
-- and is CORRECTLY absent. That is the anchor defect being fixed, not a
-- regression, and a fixture that sets up today can no longer carry a gate about
-- where exams land. Backdating by one interval makes these students ones whose
-- cadence is genuinely due, which is what Z-03 was always trying to describe.
-- The offset is one interval, not a literal date, so it holds on any weekday.
INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
   full_length_interval_weeks, target_score, setup_completed_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'America/Chicago', 62, 60, 6, 2, 1400, now() - interval '14 days'),
       ('22222222-2222-2222-2222-222222222222', 'America/Chicago', 62, 60, 6, 2, 1400, now() - interval '14 days'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'America/Chicago', 62, 60, 6, 2, 1400, now() - interval '14 days');

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
  v_clear   date;
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
  -- V-03 at the writer: every persisted block type is one enabled_block_types
  -- names. This used to pin the LAUNCH literal ["practice"]; review (2026-09-22)
  -- and full_length (E9b, 20261004010000) have since been enabled, so the gate
  -- now reads the live list rather than asserting a state the product has left.
  --
  -- S1 has a Saturday full_length_weekday and a fortnightly cadence whose first
  -- sitting falls inside this horizon (see the fixture note above -- setup is
  -- backdated one interval precisely so that it does), so with full_length
  -- enabled the formula places an exam and it must reach the persisted plan.
  --
  -- NOTE WHAT THIS DOES *NOT* CLAIM after 20261011000000: that an enabled engine
  -- plus a weekday always yields an exam. A monthly student, or one who set up
  -- today, legitimately sees none inside fourteen days. The guarantee is about
  -- this fixture's cadence being due, not about every student's.
  SELECT count(DISTINCT b.block_type), string_agg(DISTINCT b.block_type, ',' ORDER BY b.block_type)
    INTO v_n, v_txt
  FROM public.calendar_current_plan cp JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S1;
  IF EXISTS (
    SELECT 1
    FROM public.calendar_current_plan cp JOIN public.calendar_blocks b ON b.block_id = cp.block_id
    WHERE cp.student_id = S1
      AND NOT (SELECT value FROM public.calendar_runtime_config WHERE key = 'enabled_block_types')
              @> jsonb_build_array(b.block_type)) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-03 persisted block types are % but enabled_block_types is %',
      v_txt, (SELECT value::text FROM public.calendar_runtime_config WHERE key = 'enabled_block_types');
  END IF;
  IF (SELECT value FROM public.calendar_runtime_config WHERE key = 'enabled_block_types') @> '["full_length"]'::jsonb
     AND v_txt NOT LIKE '%full_length%' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-03 full_length is enabled and S1 has a test weekday, but no full_length block was persisted (%)', v_txt;
  END IF;
  -- The filter itself, planted: narrow the list to ["practice"] inside a
  -- sub-block, regenerate, and require practice only. The sub-block ends by
  -- raising its own sentinel, which rolls back the narrowed config and the
  -- extra version; any OTHER error propagates and fails the gate.
  BEGIN
    UPDATE public.calendar_runtime_config SET value = '["practice"]'::jsonb WHERE key = 'enabled_block_types';
    PERFORM public.calendar_persist_version(S1, 'student_refresh', 'student', 'v1', NULL);
    IF EXISTS (
      SELECT 1 FROM public.calendar_current_plan cp JOIN public.calendar_blocks b ON b.block_id = cp.block_id
      WHERE cp.student_id = S1 AND cp.scheduled_date >= v_today AND b.block_type <> 'practice') THEN
      RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-03 with enabled_block_types ["practice"] a non-practice block was persisted';
    END IF;
    RAISE EXCEPTION 'z03 plant rolled back' USING ERRCODE = 'LYZ03';
  EXCEPTION WHEN SQLSTATE 'LYZ03' THEN
    NULL;  -- the sentinel above: the plant ran to completion and is now undone
  END;
  RAISE NOTICE '    OK Z-03 persisted types (%) are all enabled, and a narrowed list filters the rest (V-03 at the writer)', v_txt;

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
  --
  -- THE DATE IS CHOSEN, NOT ASSUMED, and that is the whole of this fix. This used
  -- to clear `v_today + 2`, which silently assumed that date held nothing §12.2
  -- protects. It does -- but only on five days in seven. S1 studies Mon-Fri, so
  -- when v_today is a SATURDAY the first future practice block is the Monday two
  -- days out, which is exactly the date Z-06 launches and Z-08 retries. An empty
  -- edit then CARRIES that started block, correctly and by §12.2, so the day is
  -- not cleared, no `block_id IS NULL` row appears, and this gate failed claiming
  -- §12.4 was broken when §12.4 had behaved exactly as specified.
  --
  -- The failure was therefore a property of the CALENDAR DATE the job ran on,
  -- not of the code under test: green Mon-Fri, red every Saturday and Sunday.
  -- Choosing a date with no launched block makes the assertion mean what its
  -- name says on all seven days.
  SELECT g.d::date INTO v_clear
  FROM generate_series(v_today + 1, v_today + 13, interval '1 day') AS g(d)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.calendar_current_plan cp
    JOIN public.calendar_block_launches l ON l.block_id = cp.block_id
    WHERE cp.student_id = S1 AND cp.scheduled_date = g.d::date)
  ORDER BY g.d
  LIMIT 1;
  IF v_clear IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-12 fixture has no future date free of a launched block';
  END IF;
  PERFORM public.calendar_edit_day(S1, v_clear, '[]'::jsonb, 'v1', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S1 AND scheduled_date = v_clear
                   AND block_id IS NULL AND is_user_override) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-12 a cleared day (%) lost its row or its override flag', v_clear;
  END IF;
  RAISE NOTICE '    OK Z-12 an empty edit clears the day (%) and keeps the override (§12.4)', v_clear;

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
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
   full_length_interval_weeks, target_score, planner_mode, setup_completed_at)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'America/Chicago', 62, 60, 6, 2, 1400, 'auto',   now()),
  ('cccccccc-0000-0000-0000-000000000002', 'America/Chicago', 62, 60, 6, 2, 1400, 'custom', now()),
  ('cccccccc-0000-0000-0000-000000000003', 'America/Chicago', 62, 60, 6, 2, 1400, 'auto',   now()),
  ('cccccccc-0000-0000-0000-000000000004', 'America/Chicago', 62, 60, 6, 2, 1400, 'auto',   now()),
  -- Setup UNFINISHED. Not a skip: absent from the population entirely (R-08-04).
  ('cccccccc-0000-0000-0000-000000000005', 'America/Chicago', 62, 60, 6, 2, 1400, 'auto',   NULL),
  ('cccccccc-0000-0000-0000-000000000006', 'America/Chicago', 62, 60, 6, 2, 1400, 'auto',   now());

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

-- NO EXAM DAY, DELIBERATELY (`full_length_weekday` NULL = no automatic exams, which is
-- what the nullable column means). Everything below is about which VERSION owns which
-- DATE, and about move semantics -- not about exams. Giving this fixture an exam weekday
-- made its assertions depend on the day of the week CI happened to run: a full_length
-- consumes the whole of its day's budget, so on the Saturdays when v_today WAS weekday 6
-- today held the exam and no practice block, and "no practice block on today" failed
-- claiming a §12 violation that had not happened. The exam belongs in S1's fixture, where
-- Z-03 asserts it; here it only adds a calendar-date dependency.
INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'America/Chicago', 127, 60, NULL, 1400, now());

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
  v_engine   text;
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
  --
  -- THE BLOCK TYPE IS INCIDENTAL AND MUST NOT BE ASSUMED. This used to demand a
  -- PRACTICE block on today. That held until full_length was enabled
  -- (20261004010000): this fixture's student has full_length_weekday = 6, and on
  -- the Saturdays when v_today IS that weekday the exam is today's ONLY block, so
  -- the select found nothing and the gate failed with "no practice block on today
  -- to start" -- a fixture assumption, not a §12.2 violation. What Z-38 actually
  -- claims is that a STARTED block on today survives a weekly run; which engine
  -- started it is beside the point, and `calendar_block_launches.engine` accepts
  -- all three. So take today's first block whatever it is and launch it with its
  -- own engine.
  SELECT cp.block_id, b.block_type INTO v_blk, v_engine
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id
  WHERE cp.student_id = S AND cp.scheduled_date = v_today
  ORDER BY cp.display_ordinal LIMIT 1;
  IF v_blk IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-38 no block on today to start (today owns nothing)';
  END IF;
  PERFORM public.calendar_link_launch(S, v_blk, v_engine, 'eeeeeeee-0000-4000-8000-000000000001');

  PERFORM public.calendar_persist_version(S, 'weekly', 'system', 'v1');

  IF NOT EXISTS (SELECT 1 FROM public.calendar_current_plan
                 WHERE student_id = S AND scheduled_date = v_today AND block_id = v_blk) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-38 a STARTED block on today did not survive a weekly run';
  END IF;
  RAISE NOTICE '    OK Z-38 a started % block on today survives a weekly run, identity unchanged', v_engine;
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

-- No exam day, for the reason given above the sysdates fixture.
INSERT INTO public.student_study_profile
  (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday, target_score, setup_completed_at)
VALUES ('dddddddd-0000-0000-0000-000000000002', 'America/Chicago', 127, 60, NULL, 1400, now());

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
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
     full_length_interval_weeks, target_score, setup_completed_at)
  VALUES (S, 'America/Chicago', 126, 60, 6, 2, 1400, now());

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


-- ----------------------------------------------------------------------------
-- Z-52. NOTHING IN SETUP IS REQUIRED: a profile with BOTH target fields NULL
--       generates an ACCEPTED plan. (Doc 05F §8.1, SCL-130, R-08-17 reversed.)
--
-- This is the gate for the student who presses straight through setup without
-- answering anything. Until 20261002000000 such a row could not exist at all --
-- `setup_requires_target_score` refused any completed setup without a score --
-- so "can they still get a plan?" was a question the schema made unaskable.
--
-- It asserts the PLAN, not the row. That a NULL target is storable is the
-- migration's claim and the CHECK's absence proves it; what matters here is the
-- consequence: the generator runs on this profile and the validator accepts the
-- output. A student who skips every field and gets `rejected` has been blocked
-- by the reversal's own gap rather than by a constraint, which is the same
-- outcome wearing a different error.
--
-- PLANT (the reversal, reversed): re-add the CHECK above this block --
--   ALTER TABLE public.student_study_profile ADD CONSTRAINT
--     setup_requires_target_score CHECK (setup_completed_at IS NULL OR target_score IS NOT NULL);
-- -- and the INSERT below fails on it, which is this gate going red.
-- ----------------------------------------------------------------------------
DO $notarget$
DECLARE
  S CONSTANT uuid := 'dddddddd-0000-0000-0000-00000000005a';
  v_r jsonb;
  v_n int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (S, 'no-target@example.test')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, role) VALUES (S, 'no-target@example.test', 'student')
    ON CONFLICT DO NOTHING;

  -- The row setup writes when the student answers NOTHING: the schedule fields come
  -- preselected from config, both target fields stay NULL, and setup is complete because
  -- the student reached the end of the flow.
  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
     full_length_interval_weeks, target_score, target_exam_date, setup_completed_at)
  VALUES (S, 'America/Chicago', 62, 60, 6, 2, NULL, NULL, now());

  INSERT INTO public.student_domain_mastery
    (student_id, section, domain, mastery_level, mastery_score, mastery_pct,
     event_count_total, constants_snapshot_hash)
  VALUES (S, 'M', 'Algebra', 0, 0, 0, 10, 'h'),
         (S, 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h')
  ON CONFLICT DO NOTHING;

  v_r := public.calendar_persist_version(S, 'setup', 'student', 'v1',
           'dddddddd-0000-0000-0000-00000000005b');

  IF v_r ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-52 a profile with no target score and no exam date did not produce an accepted plan: %', v_r;
  END IF;

  SELECT count(*) INTO v_n FROM public.calendar_current_plan
  WHERE student_id = S AND block_id IS NOT NULL;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-52 the plan was accepted but holds no blocks — an empty plan is not "still get a plan"';
  END IF;

  -- The absence survived the write. A generator that quietly defaulted the target would
  -- satisfy everything above while making the reversal cosmetic.
  PERFORM 1 FROM public.student_study_profile
   WHERE student_id = S AND target_score IS NULL AND target_exam_date IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-52 the target fields did not stay NULL through generation';
  END IF;

  RAISE NOTICE '    OK Z-52 both target fields NULL -> accepted plan with % block(s), and they stayed NULL', v_n;
END;
$notarget$;


-- ----------------------------------------------------------------------------
-- Z-53 .. Z-55 — full_length_interval_weeks and the pair
--                (Doc 05F §8.1 / R-08-27 as amended; 20261010000000)
--
-- The cadence is the student's, so the profile has to be able to state it and
-- must not be able to state half of it. Z-53 and Z-54 are the two halves of
-- `full_length_pair`: a weekday with no interval and an interval with no
-- weekday are both refused, and (NULL, NULL) — the student who wants no
-- automatic exams — is accepted.
--
-- WHY THE REJECTIONS ARE ASSERTED BY SQLSTATE AND NOT BY MESSAGE TEXT: a CHECK
-- violation is 23514 whatever the constraint is named, and the constraint name
-- is asserted separately so a rename cannot make this gate pass vacuously
-- against some OTHER check on the same row.
-- ----------------------------------------------------------------------------
DO $flpair$
DECLARE
  S CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_state text;
  v_name  text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (S, 'fl-pair@example.test')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, role) VALUES (S, 'fl-pair@example.test', 'student')
    ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------- Z-53a
  -- A weekday with no interval: "Saturdays, at a frequency nobody picked".
  BEGIN
    INSERT INTO public.student_study_profile
      (student_id, timezone, study_days_mask, daily_minutes,
       full_length_weekday, full_length_interval_weeks, target_score, setup_completed_at)
    VALUES (S, 'America/Chicago', 62, 60, 6, NULL, 1400, now());
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-53a a weekday with no interval was accepted — full_length_pair is not enforcing';
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
      IF v_name <> 'full_length_pair' THEN
        RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-53a rejected by the wrong constraint (%), so the pair rule is untested here', v_name;
      END IF;
  END;

  ---------------------------------------------------------------- Z-53b
  -- An interval with no weekday: "every 2 weeks, on no day".
  BEGIN
    INSERT INTO public.student_study_profile
      (student_id, timezone, study_days_mask, daily_minutes,
       full_length_weekday, full_length_interval_weeks, target_score, setup_completed_at)
    VALUES (S, 'America/Chicago', 62, 60, NULL, 2, 1400, now());
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-53b an interval with no weekday was accepted — full_length_pair is not enforcing';
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
      IF v_name <> 'full_length_pair' THEN
        RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-53b rejected by the wrong constraint (%), so the pair rule is untested here', v_name;
      END IF;
  END;

  ---------------------------------------------------------------- Z-53c
  -- 5 weeks is not one of the four cadences §8.1 offers. Asserted because the
  -- pair CHECK alone would admit it.
  BEGIN
    INSERT INTO public.student_study_profile
      (student_id, timezone, study_days_mask, daily_minutes,
       full_length_weekday, full_length_interval_weeks, target_score, setup_completed_at)
    VALUES (S, 'America/Chicago', 62, 60, 6, 5, 1400, now());
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-53c an interval of 5 weeks was accepted — the column CHECK admits a cadence no surface can produce';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  ---------------------------------------------------------------- Z-54
  -- (NULL, NULL) is the ONE encoding of "no automatic full-lengths", and it
  -- must be storable: it is what "I'll add them myself" writes (§8.1).
  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes,
     full_length_weekday, full_length_interval_weeks, target_score, setup_completed_at)
  VALUES (S, 'America/Chicago', 62, 60, NULL, NULL, 1400, now());

  PERFORM 1 FROM public.student_study_profile
   WHERE student_id = S
     AND full_length_weekday IS NULL AND full_length_interval_weeks IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-54 the both-NULL profile did not survive the write';
  END IF;

  RAISE NOTICE '    OK Z-53 each half alone is refused (and 5 weeks with it); Z-54 both-NULL is accepted';
END;
$flpair$;


-- ----------------------------------------------------------------------------
-- Z-55. The BACKFILL, run against a row shaped like the ones it was written for.
--
-- The migration's UPDATE cannot be observed after the fact — by the time any
-- gate runs, it has already happened and `full_length_pair` makes its input
-- shape unrepresentable. So this gate RECONSTRUCTS that shape: it drops the
-- pair constraint, writes the pre-migration row (weekday set, interval NULL),
-- re-runs the migration's statement verbatim, and asserts the result.
--
-- Dropping a constraint inside a gate is safe here and only here: this whole
-- file runs in one transaction that ends in ROLLBACK, so the drop never
-- outlives the run.
--
-- RE-ADDING IT IS A SECOND ASSERTION, and the more valuable one. ADD CONSTRAINT
-- validates every existing row, so it re-validates every fixture this file has
-- inserted. If any of them sets a weekday without an interval, this is where it
-- surfaces — which is the failure mode that adding the pair to a live schema
-- actually has.
-- ----------------------------------------------------------------------------
DO $flbackfill$
DECLARE
  S CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_iw  smallint;
  v_n   int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (S, 'fl-backfill@example.test')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, role) VALUES (S, 'fl-backfill@example.test', 'student')
    ON CONFLICT DO NOTHING;

  ALTER TABLE public.student_study_profile DROP CONSTRAINT full_length_pair;

  -- The pre-migration row: a student who chose Saturdays under the old model,
  -- where the cadence lived in config and not on the profile.
  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes,
     full_length_weekday, full_length_interval_weeks, target_score, setup_completed_at)
  VALUES (S, 'America/Chicago', 62, 60, 6, NULL, 1400, now());

  -- Verbatim from 20261010000000 PART 2.
  UPDATE public.student_study_profile
     SET full_length_interval_weeks = 2
   WHERE full_length_weekday IS NOT NULL
     AND full_length_interval_weeks IS NULL;

  SELECT full_length_interval_weeks INTO v_iw
  FROM public.student_study_profile WHERE student_id = S;

  IF v_iw IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-55 the backfill left interval_weeks = % on a weekday row, not 2 — existing students would lose the every-2-weeks spacing they already had', coalesce(v_iw::text, 'NULL');
  END IF;

  -- A no-exam student must NOT be given a cadence by the backfill. dddddddd-...001
  -- is this file's NULL-weekday fixture.
  SELECT count(*) INTO v_n FROM public.student_study_profile
   WHERE full_length_weekday IS NULL AND full_length_interval_weeks IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-55 the backfill invented a cadence for % student(s) who declined automatic exams', v_n;
  END IF;

  ALTER TABLE public.student_study_profile
    ADD CONSTRAINT full_length_pair
    CHECK ((full_length_interval_weeks IS NULL) = (full_length_weekday IS NULL));

  RAISE NOTICE '    OK Z-55 the backfill sets 2 on weekday rows, leaves no-exam rows alone, and every fixture in this file re-validates against the pair';
END;
$flbackfill$;


-- ----------------------------------------------------------------------------
-- Z-56 .. Z-59 — exam placement is arithmetic on the student's choice
--                (formula sheet §2 Step 2 as rewritten; 20261011000000)
--
-- THESE GATES DISCOVER THEIR OWN DATES. They call
-- `calendar_place_full_lengths` to learn where it puts an exam, then override
-- that date and assert how the answer changes. Nothing is hardcoded to a
-- weekday or a calendar date, because the last four gates of this class were
-- green Monday to Friday and red every weekend (#903): a fixture that assumes
-- "today is a study day" is a fixture that fails two days in seven.
--
-- They also do NOT restate the arithmetic. A gate that recomputed the expected
-- date would be a second implementation of the rule it is checking, and it
-- would agree with a wrong port for exactly the same reason the port was wrong.
-- ----------------------------------------------------------------------------
DO $placement$
DECLARE
  -- THREE students, because one fixture cannot honestly carry all four claims.
  -- Z-56 needs its setup date INSIDE the horizon (a date outside it is trivially
  -- exam-free and would prove nothing). Z-57/Z-58 need the first sitting early
  -- enough that its +7 shift is still inside the horizon. Z-59 needs a rehearsal
  -- and NO cadence exam competing with it. Those are incompatible in one profile,
  -- and the first attempt here failed exactly on that: a setup-today weekly
  -- student's first exam is at +7, so its shift landed at +14, off the end.
  S_SETUP CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000010';
  S_SHIFT CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000011';
  S_REH   CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000012';
  v_today   date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_dates   date[];
  v_input   jsonb;
  v_out     jsonb;
  v_lead    integer;
  v_first   date;
  v_shift   date;
  v_reh     date;
  v_n       int;

BEGIN
  -- THIS BLOCK STATES ITS OWN PRECONDITION. Earlier gates in this file narrow
  -- `enabled_block_types` to ["practice"] and then ["practice","review"] and never
  -- put full_length back (lines ~1202 and ~1270), and the whole file runs in ONE
  -- transaction, so config state is inherited by everything downstream. With
  -- full_length disabled the BUILDER nulls `full_length_weekday` by design, and
  -- placement then has nothing to place -- these gates would have passed vacuously
  -- against an empty payload, which is the failure mode they exist to catch.
  UPDATE public.calendar_runtime_config
     SET value = '["practice","review","full_length"]'::jsonb
   WHERE key = 'enabled_block_types';

  SELECT (value #>> '{}')::integer INTO v_lead
  FROM public.calendar_runtime_config WHERE key = 'final_exam_lead_days';

  v_dates := ARRAY(SELECT g::date FROM generate_series(v_today, v_today + 13, interval '1 day') g);

  INSERT INTO auth.users (id, email) VALUES
    (S_SETUP, 'place-setup@example.test'),
    (S_SHIFT, 'place-shift@example.test'),
    (S_REH,   'place-reh@example.test')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, role) VALUES
    (S_SETUP, 'place-setup@example.test', 'student'),
    (S_SHIFT, 'place-shift@example.test', 'student'),
    (S_REH,   'place-reh@example.test',   'student')
  ON CONFLICT DO NOTHING;

  -- All three study every day, so nothing below depends on which weekday CI runs.
  -- Every weekday is expressed as an OFFSET from today, never a literal.
  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
     full_length_interval_weeks, target_score, target_exam_date, setup_completed_at)
  VALUES
    -- Z-56: sets up TODAY, so the setup date is in the horizon and the claim bites.
    (S_SETUP, 'America/Chicago', 127, 120, EXTRACT(DOW FROM v_today)::integer,
     1, 1400, v_today + 120, now()),
    -- Z-57/Z-58: setup one interval back minus a day, so the first sitting is
    -- tomorrow and its +7 shift is still comfortably inside the horizon.
    (S_SHIFT, 'America/Chicago', 127, 120, EXTRACT(DOW FROM v_today + 1)::integer,
     1, 1400, v_today + 120, now() - interval '6 days'),
    -- Z-59: MONTHLY, so no cadence exam competes with the rehearsal inside 14 days,
    -- and a target placed so the rehearsal lands on today+3.
    (S_REH, 'America/Chicago', 127, 120, EXTRACT(DOW FROM v_today + 3)::integer,
     4, 1400, v_today + 3 + v_lead, now());

  INSERT INTO public.student_domain_mastery
    (student_id, section, domain, mastery_level, mastery_score, mastery_pct,
     event_count_total, constants_snapshot_hash)
  SELECT u, 'M', 'Algebra', 0, 0, 0, 10, 'h' FROM unnest(ARRAY[S_SETUP,S_SHIFT,S_REH]) u
  UNION ALL
  SELECT u, 'RW', 'Craft and Structure', 4, 0, 0, 10, 'h' FROM unnest(ARRAY[S_SETUP,S_SHIFT,S_REH]) u
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------- Z-56
  -- THE SETUP DAY IS NEVER AN EXAM DAY. The retired rule anchored the series on
  -- the first preferred weekday ON OR AFTER setup, so a student who set up on
  -- their chosen weekday got an exam that same day -- one of the two production
  -- defects. The series now starts a full interval later, so it cannot.
  v_input := public.calendar_build_plan_input(S_SETUP, v_dates);
  v_out   := public.calendar_place_full_lengths(v_input);

  -- Presence before absence: prove the payload is non-trivial first, or the
  -- absence below passes for the wrong reason (CLAUDE.md).
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_out -> 'placed');
  IF v_n = 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-56 placed nothing at all, so "nothing on the setup day" proves nothing';
  END IF;
  IF (v_input #>> '{profile,setup_date}')::date <> v_today THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-56 fixture setup_date is % not today, so it is outside the horizon and the claim is vacuous',
      v_input #>> '{profile,setup_date}';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'placed') f
             WHERE (f ->> 'date')::date = (v_input #>> '{profile,setup_date}')::date) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-56 an exam was placed on the setup date (%) — the anchor defect is back',
      v_input #>> '{profile,setup_date}';
  END IF;
  RAISE NOTICE '    OK Z-56 setup date % is in the horizon and holds no exam, while % block(s) were placed', v_today, v_n;

  ---------------------------------------------------------------- Z-57
  -- AN OVERRIDDEN PREFERRED DATE SHIFTS BY EXACTLY ONE WEEK, never 1..6 days: a
  -- 1..6 day shift cannot satisfy V-02, and it would move the student's test off
  -- the day they chose.
  v_input := public.calendar_build_plan_input(S_SHIFT, v_dates);
  v_out   := public.calendar_place_full_lengths(v_input);
  SELECT min((f ->> 'date')::date) INTO v_first
  FROM jsonb_array_elements(v_out -> 'placed') f WHERE f ->> 'explanation_key' = 'exam_cadence';
  IF v_first IS NULL OR v_first + 7 > v_today + 13 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-57 fixture first exam % leaves no room in the horizon for a +7 shift', v_first;
  END IF;

  PERFORM public.calendar_edit_day(S_SHIFT, v_first, '[]'::jsonb, 'v1', NULL);
  v_input := public.calendar_build_plan_input(S_SHIFT, v_dates);
  v_out   := public.calendar_place_full_lengths(v_input);
  v_shift := v_first + 7;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'placed') f
             WHERE (f ->> 'date')::date = v_first) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-57 the overridden date % still holds an exam', v_first;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'placed') f
                 WHERE (f ->> 'date')::date = v_shift AND f ->> 'explanation_key' = 'exam_cadence') THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-57 the exam did not move to % (one week on); placed = %',
      v_shift, v_out -> 'placed';
  END IF;
  IF EXTRACT(DOW FROM v_shift)::integer
     <> public.calendar_require_int(v_input -> 'profile', 'full_length_weekday') THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-57 the shifted date % is off the student''s full-length weekday, which V-02 refuses', v_shift;
  END IF;
  IF jsonb_array_length(v_out -> 'suppressed') <> 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-57 a date that shifted cleanly was also reported suppressed: %', v_out -> 'suppressed';
  END IF;
  RAISE NOTICE '    OK Z-57 an overridden % shifted to % (+7, same weekday), with no suppression reported', v_first, v_shift;

  ---------------------------------------------------------------- Z-58
  -- BOTH OCCURRENCES OVERRIDDEN RECORDS A SUPPRESSION rather than dropping the
  -- exam silently. Silence is the defect this replaces: on one production profile
  -- an edited day swallowed the only exam in the horizon with no trace anywhere,
  -- and no refresh or profile change would ever have fixed it.
  PERFORM public.calendar_edit_day(S_SHIFT, v_shift, '[]'::jsonb, 'v1', NULL);
  v_input := public.calendar_build_plan_input(S_SHIFT, v_dates);
  v_out   := public.calendar_place_full_lengths(v_input);

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'placed') f
             WHERE (f ->> 'date')::date IN (v_first, v_shift)) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-58 an exam was placed on a date the student blocked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_out -> 'suppressed') t WHERE t::date = v_first) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-58 both occurrences blocked and NOTHING recorded — the silent drop is back. suppressed = %',
      v_out -> 'suppressed';
  END IF;
  RAISE NOTICE '    OK Z-58 both occurrences blocked -> suppression recorded for %, not a silent drop', v_first;

  ---------------------------------------------------------------- Z-59
  -- THE FINAL REHEARSAL IS NEVER SHIFTED. It is anchored to the real test rather
  -- than to a cadence, and a student who blocks that day has made their own call.
  --
  -- Asserted on the FUNCTION, not through a persisted plan, deliberately: at the
  -- persist layer an overridden date is ALSO removed by calendar_drop_unowned_dates,
  -- so a plan-level assertion could not tell "the rehearsal was never shifted" from
  -- "the output filter took it away".
  v_input := public.calendar_build_plan_input(S_REH, v_dates);
  v_out   := public.calendar_place_full_lengths(v_input);
  SELECT (f ->> 'date')::date INTO v_reh
  FROM jsonb_array_elements(v_out -> 'placed') f WHERE f ->> 'explanation_key' = 'final_rehearsal';
  IF v_reh IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-59 no rehearsal in the horizon, so "never shifted" is untested; placed = %',
      v_out -> 'placed';
  END IF;

  PERFORM public.calendar_edit_day(S_REH, v_reh, '[]'::jsonb, 'v1', NULL);
  v_input := public.calendar_build_plan_input(S_REH, v_dates);
  v_out   := public.calendar_place_full_lengths(v_input);

  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'placed') f
                 WHERE (f ->> 'date')::date = v_reh AND f ->> 'explanation_key' = 'final_rehearsal') THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-59 the rehearsal moved or vanished when its day was blocked; placed = %',
      v_out -> 'placed';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_out -> 'suppressed') t WHERE t::date = v_reh) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-59 the rehearsal was reported suppressed; it is never shifted and never suppressed';
  END IF;
  RAISE NOTICE '    OK Z-59 the rehearsal stayed on % with its day blocked — unshifted and unsuppressed', v_reh;
END;
$placement$;


-- The shared form fixture, included HERE rather than at the top of the file so no earlier
-- gate's counts see its rows. Same helper as the E3, E4 and E9b gates.
\ir lib/exam-form-fixture.sql

-- ============================================================================
-- Brief 14 Step 5 — the two practice-test notifications (Z-60 .. Z-67)
-- ============================================================================
-- @spec [Doc-05F_V1.0 §8.1, §12.5 (the daily-job pattern), §13 (progress is the
--        allocator over engine events), §18 (job outcomes);
--        contracts/notifications.contract.md §2.2, §2.3, §5.1, §5.2, §8.1;
--        owner ruling 2026-09-26 ("two event types, not one with a kind in the
--        payload")]
--
-- THE FIXTURE IS A REAL PLAN, not hand-inserted rows. `calendar_persist_version`
-- generates it and the exam block is READ BACK out of `calendar_current_plan`,
-- because a hand-built plan row can assert a shape the generator never emits --
-- which is how a fixture and a bug agree with each other and the suite stays
-- green (CLAUDE.md, SCL-137).
--
--   Z-60  the week notice fires on the student's local MONDAY, for that week's exam
--   Z-61  ... and on no other day of the week
--   Z-62  the day-before notice fires when the exam is tomorrow, and not otherwise
--   Z-63  the defaulted clock and an explicit now() agree, so p_now cannot drift
--   Z-64  ONE block yields TWO notifications -- the event type is in the hash
--   Z-65  a rerun writes nothing: 'duplicate', and the counts do not move
--   Z-66  a completed sitting suppresses the notice ('skipped_complete'), and the
--         rule is derived in ONE function with ONE call site
--   Z-67  an unentitled student is a recorded skip, not a silent one; and the
--         payload carries the block id and the date and nothing else
-- ============================================================================
DO $examnotify$
DECLARE
  S     CONSTANT uuid := 'eeeeeeee-0000-0000-0000-00000000000a';
  S_UN  CONSTANT uuid := 'eeeeeeee-0000-0000-0000-00000000000b';
  k_tz  CONSTANT text := 'America/Chicago';
  v_r        jsonb;
  v_exam     date;
  v_block    uuid;
  v_monday   timestamptz;
  v_daybefore timestamptz;
  v_kinds    text[];
  v_out      text;
  v_events   integer;
  v_msgs     integer;
  v_events2  integer;
  v_msgs2    integer;
  v_payload  jsonb;
  v_n        integer;
BEGIN
  -- full_length has to be ON for the generator to place one. Stated here rather than
  -- leaned on: the seeded value has changed twice already, and a gate that assumes it
  -- goes red for the one reason a gate must never go red -- being out of date.
  UPDATE public.calendar_runtime_config
     SET value = '["practice","review","full_length"]'::jsonb
   WHERE key = 'enabled_block_types';

  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (S,    'exam-notify@example.test',       '{}'::jsonb),
    (S_UN, 'exam-notify-unent@example.test', '{}'::jsonb);

  -- Saturday exams every 2 weeks, set up 14 days ago so the first sitting falls INSIDE
  -- the horizon (placement is arithmetic from setup since 20261011000000).
  INSERT INTO public.student_study_profile
    (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
     full_length_interval_weeks, target_score, setup_completed_at)
  VALUES (S,    k_tz, 127, 60, 6, 2, 1400, now() - interval '14 days'),
         (S_UN, k_tz, 127, 60, 6, 2, 1400, now() - interval '14 days');

  -- S is entitled; S_UN deliberately is not, which is what makes the
  -- skipped_no_entitlement arm reachable rather than theoretical.
  INSERT INTO public.entitlements (profile_id, tier, status) VALUES (S, 'premium', 'active');

  -- A sittable form for Z-66's completed exam, from the shared fixture.
  PERFORM pg_temp.exam_fixture_make_form('eeee0f00-0000-4000-8000-0000000000f1', 'EN');

  v_r := public.calendar_persist_version(S, 'setup', 'student', 'v1',
           'eeeeeeee-0000-0000-0000-0000000000a1');
  IF v_r ->> 'validator_result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-60 setup was not accepted: %', v_r;
  END IF;
  PERFORM public.calendar_persist_version(S_UN, 'setup', 'student', 'v1',
            'eeeeeeee-0000-0000-0000-0000000000b1');

  -- The exam, as the GENERATOR placed it. Not a date this gate chose.
  SELECT cp.scheduled_date, cp.block_id INTO v_exam, v_block
  FROM public.calendar_current_plan cp
  JOIN public.calendar_blocks b ON b.block_id = cp.block_id AND b.student_id = cp.student_id
  WHERE cp.student_id = S AND b.block_type = 'full_length'
  ORDER BY cp.scheduled_date
  LIMIT 1;

  IF v_block IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-60 no full_length block in the plan, so every check below would pass vacuously';
  END IF;

  -- Noon local on the two days that matter, so no assertion rides on a DST edge.
  v_monday    := (date_trunc('week', v_exam::timestamp) + interval '12 hours') AT TIME ZONE k_tz;
  v_daybefore := ((v_exam - 1)::timestamp + interval '12 hours') AT TIME ZONE k_tz;

  ---------------------------------------------------------------- Z-60
  SELECT array_agg(kind ORDER BY kind) INTO v_kinds
  FROM public.calendar_exam_notification_candidates(500, v_monday)
  WHERE student_id = S AND block_id = v_block;

  IF v_kinds IS DISTINCT FROM ARRAY['full_length_week'] THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-60 on the local Monday of the exam week the kinds due were %, expected exactly {full_length_week}',
      coalesce(v_kinds::text, 'none');
  END IF;
  RAISE NOTICE '    OK Z-60 the week notice is due on the local Monday of the week holding the % exam', v_exam;

  ---------------------------------------------------------------- Z-61
  -- Tuesday through Sunday: no week notice. Six days asserted, not one, because
  -- "fires on Monday" and "fires every day" are indistinguishable from a single day.
  FOR v_n IN 1..6 LOOP
    IF EXISTS (
      SELECT 1 FROM public.calendar_exam_notification_candidates(500, v_monday + (v_n || ' days')::interval)
      WHERE student_id = S AND block_id = v_block AND kind = 'full_length_week'
    ) THEN
      RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-61 the week notice was also due % day(s) after the Monday', v_n;
    END IF;
  END LOOP;
  RAISE NOTICE '    OK Z-61 the week notice is due on the Monday and on none of the other six days';

  ---------------------------------------------------------------- Z-62
  SELECT array_agg(kind ORDER BY kind) INTO v_kinds
  FROM public.calendar_exam_notification_candidates(500, v_daybefore)
  WHERE student_id = S AND block_id = v_block;

  IF NOT (v_kinds @> ARRAY['full_length_tomorrow']) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-62 the day before the % exam the kinds due were %, with no full_length_tomorrow',
      v_exam, coalesce(v_kinds::text, 'none');
  END IF;
  -- And not on the day itself, nor two days before.
  IF EXISTS (
    SELECT 1 FROM public.calendar_exam_notification_candidates(500, v_daybefore + interval '1 day')
    WHERE student_id = S AND block_id = v_block AND kind = 'full_length_tomorrow'
  ) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-62 full_length_tomorrow was still due ON the exam day';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.calendar_exam_notification_candidates(500, v_daybefore - interval '1 day')
    WHERE student_id = S AND block_id = v_block AND kind = 'full_length_tomorrow'
  ) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-62 full_length_tomorrow was due TWO days before the exam';
  END IF;
  RAISE NOTICE '    OK Z-62 the day-before notice is due on % only -- not on the exam day, not two days out', v_exam - 1;

  ---------------------------------------------------------------- Z-63
  -- The default and the thing it defaults to. A parameter the job never passes is a
  -- parameter that can drift away from `now()`; this is what stops it.
  SELECT count(*) INTO v_n FROM (
    SELECT student_id, block_id, kind FROM public.calendar_exam_notification_candidates(500)
    EXCEPT
    SELECT student_id, block_id, kind FROM public.calendar_exam_notification_candidates(500, now())
  ) d;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-63 the defaulted clock and an explicit now() disagree on % row(s)', v_n;
  END IF;
  RAISE NOTICE '    OK Z-63 calendar_exam_notification_candidates() and (..., now()) return the same rows';

  ---------------------------------------------------------------- Z-64
  -- ONE BLOCK, TWO NOTIFICATIONS. This is the owner's ruling made observable: the
  -- event type is part of notification_event_id's hash input, so the two kinds are two
  -- ids. Derive the id from the block alone -- one type with a kind in the payload --
  -- and the second emit is swallowed by the ON CONFLICT that makes the first
  -- idempotent. That is the plant recorded in the PR.
  IF public.notification_event_id('full_length_week', v_block::text)
     = public.notification_event_id('full_length_tomorrow', v_block::text) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-64 the two kinds hash to ONE event id, so one block can only ever notify once';
  END IF;

  v_out := public.calendar_emit_exam_notification(S, v_block, 'full_length_week', v_exam, k_tz);
  IF v_out <> 'emitted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-64 the week notice returned % rather than emitted', v_out;
  END IF;
  v_out := public.calendar_emit_exam_notification(S, v_block, 'full_length_tomorrow', v_exam, k_tz);
  IF v_out <> 'emitted' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-64 the day-before notice returned % rather than emitted -- one block must yield two', v_out;
  END IF;

  SELECT count(*) INTO v_events FROM public.notification_events
   WHERE subject_profile_id = S AND event_type IN ('full_length_week','full_length_tomorrow');
  IF v_events <> 2 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-64 expected 2 events for one exam, got %', v_events;
  END IF;

  -- The channel rule, §2.3: the week notice in_app, the day-before in_app + email.
  -- The STUDENT alone is the recipient -- no guardian row, at either kind.
  SELECT count(*) INTO v_msgs FROM public.notification_messages m
   JOIN public.notification_events e USING (event_id)
   WHERE e.subject_profile_id = S AND e.event_type IN ('full_length_week','full_length_tomorrow');
  IF v_msgs <> 3 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-64 expected 3 message rows (week in_app; tomorrow in_app + email), got %', v_msgs;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_messages m
    JOIN public.notification_events e USING (event_id)
    WHERE e.event_type IN ('full_length_week','full_length_tomorrow')
      AND m.recipient_profile_id <> S
  ) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-64 a practice-test notice was addressed to somebody other than the student';
  END IF;
  RAISE NOTICE '    OK Z-64 one exam block yields TWO events and 3 message rows, all addressed to the student';

  ---------------------------------------------------------------- Z-65
  -- The rerun. "None on a rerun" (Brief 14 Step 5's own validation), asserted on the
  -- COUNTS and not only on the return value: a writer could report duplicate and still
  -- have inserted.
  v_out := public.calendar_emit_exam_notification(S, v_block, 'full_length_week', v_exam, k_tz);
  IF v_out <> 'duplicate' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-65 a replayed week notice returned % rather than duplicate', v_out;
  END IF;
  v_out := public.calendar_emit_exam_notification(S, v_block, 'full_length_tomorrow', v_exam, k_tz);
  IF v_out <> 'duplicate' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-65 a replayed day-before notice returned % rather than duplicate', v_out;
  END IF;

  SELECT count(*) INTO v_events2 FROM public.notification_events
   WHERE subject_profile_id = S AND event_type IN ('full_length_week','full_length_tomorrow');
  SELECT count(*) INTO v_msgs2 FROM public.notification_messages m
   JOIN public.notification_events e USING (event_id)
   WHERE e.subject_profile_id = S AND e.event_type IN ('full_length_week','full_length_tomorrow');
  IF v_events2 <> v_events OR v_msgs2 <> v_msgs THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-65 a rerun changed the counts: events %->%, messages %->%',
      v_events, v_events2, v_msgs, v_msgs2;
  END IF;
  RAISE NOTICE '    OK Z-65 a rerun returns duplicate and writes nothing (% events, % messages, unchanged)', v_events2, v_msgs2;

  ---------------------------------------------------------------- Z-66
  -- "NOTHING IF THE BLOCK IS ALREADY COMPLETE", observed rather than asserted. A
  -- completed sitting inside the exam's own local day makes the notice a skip.
  --
  -- The completeness rule has ONE derivation and ONE call site. Both are checked here:
  -- the function answers correctly about the new sitting, and grep over pg_proc finds
  -- exactly one body that calls it.
  IF public.calendar_full_length_complete(S, v_exam, k_tz) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-66 the block reads complete before any sitting exists';
  END IF;

  -- The form comes from the SHARED exam fixture (\ir'd above), not a hand-built row: it is
  -- the fixture three other gates already use, and a second minimal form here would be a
  -- second answer to "what does a form look like".
  --
  -- The SITTING is inserted directly, and that is the right call rather than a shortcut. The
  -- whole contract of `calendar_full_length_complete` is (student, state, completed_at), and
  -- the sitting has to be complete on a FUTURE date -- the exam the generator just placed --
  -- which no amount of walking a real exam through the runtime can produce without moving
  -- the clock afterwards anyway. Every NOT NULL column is supplied, `actor_id` READ FROM THE
  -- PROFILE rather than set to the student id (SCL-151: the pseudonymous grouping key is not
  -- the identity key, and a fixture that conflates them teaches the next reader to).
  INSERT INTO public.test_sessions
    (student_id, test_form_id, state, mode, started_at, completed_at, grace_expires_at,
     attempt_number_for_form, is_first_seen_form_attempt, actor_id)
  SELECT S, f.id, 'completed', 'strict',
         (v_exam::timestamp + interval '8 hours')  AT TIME ZONE k_tz,
         (v_exam::timestamp + interval '11 hours') AT TIME ZONE k_tz,
         (v_exam::timestamp + interval '23 hours') AT TIME ZONE k_tz,
         1, true, pr.actor_id
  FROM public.test_forms f
  CROSS JOIN public.profiles pr
  WHERE pr.id = S
  ORDER BY f.id
  LIMIT 1;

  -- THE INSERT IS ASSERTED, because the first draft of this gate did not and the insert
  -- silently matched zero rows: `test_forms` was empty, so `FROM test_forms LIMIT 1` wrote
  -- nothing and the completeness check below was measuring an absent sitting. It reddened
  -- only because the assertion happened to be the positive one. A fixture that can quietly
  -- insert nothing is the "fails green" shape, one layer down.
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-66 the completed sitting inserted % rows, not 1 -- there is nothing for the completeness check to find', v_n;
  END IF;

  IF NOT public.calendar_full_length_complete(S, v_exam, k_tz) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-66 a completed sitting inside the exam day did not read as complete';
  END IF;
  -- And not on the neighbouring days: the window is the block's OWN local day, half-open.
  IF public.calendar_full_length_complete(S, v_exam - 1, k_tz)
     OR public.calendar_full_length_complete(S, v_exam + 1, k_tz) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-66 the completeness window leaked into an adjacent local day';
  END IF;

  -- A block whose sitting is done is never notified about -- even for a kind that has
  -- not been sent yet, which is what makes this the RULE and not the replay guard.
  DELETE FROM public.notification_events
   WHERE subject_profile_id = S AND event_type IN ('full_length_week','full_length_tomorrow');
  v_out := public.calendar_emit_exam_notification(S, v_block, 'full_length_week', v_exam, k_tz);
  IF v_out <> 'skipped_complete' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-66 a completed exam still returned % rather than skipped_complete', v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_events
              WHERE subject_profile_id = S AND event_type IN ('full_length_week','full_length_tomorrow')) THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-66 a completed exam was notified about anyway';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname <> 'calendar_full_length_complete'
    AND p.prosrc LIKE '%calendar_full_length_complete%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-66 completeness is derived through % function bodies, not 1 -- a second caller is a second answer', v_n;
  END IF;
  RAISE NOTICE '    OK Z-66 a completed sitting suppresses the notice; the rule has one definition and one caller';

  ---------------------------------------------------------------- Z-67
  -- The unentitled student is RECORDED, not filtered: `skipped_no_entitlement` is a
  -- calendar_job_runs outcome, and §12.5's doctrine is that a student the job passed
  -- over silently is a student nobody can explain afterwards.
  SELECT outcome INTO v_out
  FROM public.calendar_exam_notification_candidates(500, v_daybefore)
  WHERE student_id = S_UN LIMIT 1;
  IF v_out IS DISTINCT FROM 'skipped_no_entitlement' THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-67 the unentitled student''s outcome was % -- expected skipped_no_entitlement (absent means filtered away)',
      coalesce(v_out, 'NULL (notify)');
  END IF;

  -- The payload rule (contract §8.1): the block id and the date the template renders,
  -- and nothing else. No form id -- that names a specific paper.
  PERFORM public.calendar_emit_exam_notification(S_UN, v_block, 'full_length_tomorrow', v_exam, k_tz);
  SELECT payload INTO v_payload FROM public.notification_events
   WHERE subject_profile_id = S_UN AND event_type = 'full_length_tomorrow';
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-67 no event row to inspect, so the payload rule is untested';
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_payload) k)
     IS DISTINCT FROM ARRAY['block_id','local_date'] THEN
    RAISE EXCEPTION 'CALENDAR_WRITER_GATE_FAILED: Z-67 the payload keys are %, expected exactly {block_id, local_date}', v_payload;
  END IF;
  RAISE NOTICE '    OK Z-67 an unentitled student is a recorded skip, and the payload is {block_id, local_date} exactly';
END;
$examnotify$;


ROLLBACK;
