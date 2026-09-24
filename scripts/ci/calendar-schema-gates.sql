-- ============================================================================
-- Doc 05F calendar — schema gates
-- ============================================================================
-- Proves, against a throwaway database with the full migration pipeline
-- applied, that the calendar schema refuses what Doc 05F says it must refuse.
-- Every gate asserts: the expected error fires, or the gate raises.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/calendar-schema-gates.sql
--
-- @spec [Doc-05F_V1.0 §7 (DDL), INV-08-05 (immutability), INV-08-22 (composite
--        FKs make same-student / same-date relational facts)]
--       [Doc_05F_formula_sheet.md §8 items 1, 3]
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixture. profiles rows are created by the handle_new_user() trigger.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'gate-a@example.test', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'gate-b@example.test', '{}'::jsonb);

INSERT INTO public.calendar_plan_versions
  (plan_version_id, student_id, version_no, generator_version, trigger, initiated_by,
   input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
        'v1', 'setup', 'student', '{}', 'h', '{}', 'accepted');

INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '2026-09-21', 'America/Chicago'),
       ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '2026-09-22', 'America/Chicago');

INSERT INTO public.calendar_blocks
  (block_id, student_id, created_in_version_id, scheduled_date, block_type, section,
   scope, target_count, source, explanation_key)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-21', 'practice', 'M',
        '{"level":"domain","mix":[{"domain":"Algebra","count":10,"explanation_key":"weak"}]}',
        10, 'auto', 'weighted');

INSERT INTO public.calendar_plan_block_memberships
  (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '2026-09-21', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'created');

-- ---------------------------------------------------------------------------
-- Each gate runs a statement that MUST fail with a named SQLSTATE.
--   23503 foreign_key_violation   23505 unique_violation   23514 check_violation
-- ---------------------------------------------------------------------------
DO $gates$
DECLARE
  g RECORD;
  v_sqlstate text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES

      ('G-01 a membership cannot move a block to another date (INV-08-22)', '23503', $s$
        INSERT INTO public.calendar_plan_block_memberships
          (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
        VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
                '2026-09-22','bbbbbbbb-0000-0000-0000-000000000001',1,'carried')$s$),

      ('G-02 a block cannot hang off another student''s version (INV-08-22)', '23503', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, scope, target_count, source)
        VALUES ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-21','review','{"mode":"queue"}',5,'auto')$s$),

      ('G-03 display_ordinal is unique within a date (V-08 has no duplicates to break)', '23505', $s$
        INSERT INTO public.calendar_blocks
          (block_id, student_id, created_in_version_id, scheduled_date, block_type, section, scope, target_count, source)
        VALUES ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
                'aaaaaaaa-0000-0000-0000-000000000001','2026-09-21','practice','RW',
                '{"level":"section","count":20,"explanation_key":"cold_start"}',20,'auto');
        INSERT INTO public.calendar_plan_block_memberships
          (plan_version_id, student_id, scheduled_date, block_id, display_ordinal, membership_type)
        VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
                '2026-09-21','bbbbbbbb-0000-0000-0000-000000000002',1,'created')$s$),

      ('G-04 a full_length block carries exactly one form (§7.4)', '23514', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, scope, target_count, source)
        VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-23','full_length','{"form_id":null}',2,'auto')$s$),

      ('G-05 a Math domain cannot appear in an R&W block (V-06 at the schema)', '23514', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, section, scope, target_count, source)
        VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-23','practice','RW',
                '{"level":"domain","mix":[{"domain":"Algebra","count":5,"explanation_key":"weak"}]}',5,'auto')$s$),

      ('G-06 a practice block must carry a section (sheet §8 item 3)', '23514', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, scope, target_count, source)
        VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-23','practice','{"level":"section","count":20,"explanation_key":"cold_start"}',20,'auto')$s$),

      ('G-07 a review block carries no section (§7.4)', '23514', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, section, scope, target_count, source)
        VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-23','review','M','{"mode":"queue"}',5,'auto')$s$),

      ('G-08 the review adapter has no source_origin field (sheet §8 item 13)', '23514', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, scope, target_count, source)
        VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-23','review','{"mode":"queue","source_origin":"practice"}',5,'auto')$s$),

      ('G-09 a practice count must be a positive integer', '23514', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, section, scope, target_count, source)
        VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-23','practice','M',
                '{"level":"domain","mix":[{"domain":"Algebra","count":10.5,"explanation_key":"weak"}]}',10,'auto')$s$),

      ('G-10 a domain appears at most once in a mix', '23514', $s$
        INSERT INTO public.calendar_blocks
          (student_id, created_in_version_id, scheduled_date, block_type, section, scope, target_count, source)
        VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
                '2026-09-23','practice','M',
                '{"level":"domain","mix":[{"domain":"Algebra","count":5,"explanation_key":"weak"},{"domain":"Algebra","count":5,"explanation_key":"weak"}]}',10,'auto')$s$),

      ('G-11 version_no is unique per student', '23505', $s$
        INSERT INTO public.calendar_plan_versions
          (student_id, version_no, generator_version, trigger, initiated_by,
           input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
        VALUES ('11111111-1111-1111-1111-111111111111',1,'v1','weekly','system','{}','h','{}','accepted')$s$),

      ('G-12 only the two named generators exist (sheet §8 item 1)', '23514', $s$
        INSERT INTO public.calendar_plan_versions
          (student_id, version_no, generator, generator_version, trigger, initiated_by,
           input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
        VALUES ('11111111-1111-1111-1111-111111111111',99,'smooth_weighted_v1','v1','weekly','system','{}','h','{}','accepted')$s$)

    ) AS t(name, want_sqlstate, stmt)
  LOOP
    BEGIN
      EXECUTE g.stmt;
      RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: % — the statement was ACCEPTED; expected SQLSTATE %',
        g.name, g.want_sqlstate;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        IF v_sqlstate = 'P0001' AND SQLERRM LIKE 'CALENDAR_SCHEMA_GATE_FAILED:%' THEN
          RAISE;
        END IF;
        IF v_sqlstate <> g.want_sqlstate THEN
          RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: % — expected SQLSTATE %, got % (%)',
            g.name, g.want_sqlstate, v_sqlstate, SQLERRM;
        END IF;
        RAISE NOTICE '    OK %', g.name;
    END;
  END LOOP;
END;
$gates$;

-- ---------------------------------------------------------------------------
-- fallback_v1 is an accepted generator (the positive half of G-12).
-- ---------------------------------------------------------------------------
INSERT INTO public.calendar_plan_versions
  (plan_version_id, student_id, version_no, generator, generator_version, trigger, initiated_by,
   input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 2,
        'fallback_v1', 'v1', 'weekly', 'system', '{}', 'h', '{}', 'accepted');

-- A rejected version must never own a date, and a cleared day keeps its
-- override flag with block_id NULL (§7.6).
INSERT INTO public.calendar_plan_versions
  (plan_version_id, student_id, version_no, generator_version, trigger, initiated_by,
   input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 3,
        'v1', 'weekly', 'system', '{}', 'h', '{}', 'rejected');

INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        '2026-09-21', 'America/Chicago');

INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone, is_user_override)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        '2026-09-25', 'America/Chicago', true);

DO $view$
DECLARE
  v_owner integer;
  v_cleared RECORD;
BEGIN
  SELECT DISTINCT version_no INTO v_owner
  FROM public.calendar_current_plan WHERE scheduled_date = '2026-09-21';
  IF v_owner <> 1 THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: G-13 a rejected version owns 2026-09-21 (version_no = %)', v_owner;
  END IF;
  RAISE NOTICE '    OK G-13 a rejected version never owns a date (§7.6)';

  SELECT * INTO v_cleared FROM public.calendar_current_plan WHERE scheduled_date = '2026-09-25';
  IF v_cleared IS NULL OR v_cleared.block_id IS NOT NULL OR v_cleared.is_user_override IS NOT true THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: G-14 a cleared day lost its row or its override flag';
  END IF;
  RAISE NOTICE '    OK G-14 a cleared day keeps its override flag with block_id NULL (§7.6)';
END;
$view$;

-- ---------------------------------------------------------------------------
-- Config gates. The VALUES are cross-checked against the parity oracle's own
-- constants by scripts/ci/calendar-parity.ts, so they are not restated here;
-- these gates cover completeness, typing and self-consistency.
-- ---------------------------------------------------------------------------
DO $config$
DECLARE
  v_missing text;
  v_extra   text;
  v_bad     text;
  v_expected text[] := ARRAY[
    'horizon_days','review_share_max_bp','review_block_max','exam_review_default_count',
    'weight_by_level','null_level_weight','post_exam_emphasis_days','post_exam_multiplier',
    'min_domain_questions','max_domains_per_block','granularity',
    'full_length_every_n_occurrences','full_length_min_gap_days','final_exam_lead_days',
    'max_full_length_per_horizon','taper_days','taper_ratio_bp','recent_planned_window_days',
    'canonical_domain_order','enabled_block_types',
    -- Doc 05F §21 / SCL-08-F: calendar-owned until Doc 02B claims a review
    -- timing constant. Not in sheet §4's table, which lists it as read from an
    -- owner that does not have it.
    'review_estimated_seconds_per_item',
    -- Doc 05F §8.1 and §12.5, seeded by 20260917140000. These are ROUTE and JOB
    -- constants, not formula constants: the generator never reads one, which is
    -- why sheet §4 does not list them and why the parity gate does not
    -- cross-check them against the oracle. They bound the settings sheet and
    -- pace the weekly job.
    'daily_minutes_min','daily_minutes_max','daily_minutes_presets',
    'target_exam_date_max_days','weekly_job_interval_minutes',
    -- Doc 05F §10.2. Not a tunable: the formula naming its own revision, seeded
    -- beside the formula so a stored plan version traces to the exact SQL that
    -- made it. C-09 below asserts it names a migration timestamp.
    'generator_version'];
BEGIN
  SELECT string_agg(k, ', ') INTO v_missing
  FROM unnest(v_expected) k
  WHERE NOT EXISTS (SELECT 1 FROM public.calendar_runtime_config c WHERE c.key = k);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-01 expected calendar_runtime_config key(s) missing: %', v_missing;
  END IF;

  SELECT string_agg(c.key, ', ') INTO v_extra
  FROM public.calendar_runtime_config c WHERE NOT (c.key = ANY (v_expected));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-01 unexpected calendar_runtime_config key(s): %', v_extra;
  END IF;
  RAISE NOTICE '    OK C-01 calendar_runtime_config holds exactly the 20 formula sheet §4 keys, review_estimated_seconds_per_item (SCL-08-F) and the 6 route/job/provenance keys of Doc 05F §8.1/§12.5/§10.2';

  -- Sheet §2: "Every quantity is an integer ... No floats anywhere."
  SELECT string_agg(key || ' (' || value_type || ')', ', ') INTO v_bad
  FROM public.calendar_runtime_config WHERE value_type = 'float';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-02 float-typed calendar config key(s): %', v_bad;
  END IF;
  RAISE NOTICE '    OK C-02 no float-typed key exists (ratios are basis points)';

  -- Every integer key sits inside its own declared bounds.
  SELECT string_agg(key || '=' || value::text || ' not in [' || min_value::text || ',' || max_value::text || ']', ', ')
    INTO v_bad
  FROM public.calendar_runtime_config
  WHERE value_type = 'integer' AND min_value IS NOT NULL AND max_value IS NOT NULL
    AND NOT ((value::text)::bigint BETWEEN (min_value::text)::bigint AND (max_value::text)::bigint);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-03 launch value outside its bounds: %', v_bad;
  END IF;
  RAISE NOTICE '    OK C-03 every integer launch value sits inside its declared bounds';

  -- weight_by_level covers exactly mastery levels 0-4 (sheet §8 item 8; prod CHECK is 0..4).
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(
        (SELECT value FROM public.calendar_runtime_config WHERE key = 'weight_by_level')) k)
     <> ARRAY['0','1','2','3','4'] THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-04 weight_by_level is not keyed 0..4';
  END IF;
  RAISE NOTICE '    OK C-04 weight_by_level is keyed to the live mastery levels 0..4';

  -- Every level carries a floor of at least 1, so a strong domain never falls
  -- out of rotation (sheet §2 step 3).
  IF EXISTS (SELECT 1 FROM jsonb_each(
        (SELECT value FROM public.calendar_runtime_config WHERE key = 'weight_by_level')) e
      WHERE (e.value::text)::bigint < 1) THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-05 a weight_by_level entry is below 1';
  END IF;
  RAISE NOTICE '    OK C-05 every mastery level keeps a weight floor of 1';

  -- canonical_domain_order is exactly the canonical eight, and every entry is a
  -- real (section, domain) pair as 20260816010000_canonical_domain_checks.sql
  -- defines them.
  SELECT string_agg(d, ', ') INTO v_bad
  FROM jsonb_array_elements_text(
    (SELECT value FROM public.calendar_runtime_config WHERE key = 'canonical_domain_order')) d
  WHERE NOT public.calendar_scope_is_valid(
    'practice',
    CASE WHEN d IN ('Algebra','Advanced Math','Problem Solving and Data Analysis',
                    'Geometry and Trigonometry') THEN 'M' ELSE 'RW' END,
    jsonb_build_object('level','domain','mix',
      jsonb_build_array(jsonb_build_object('domain', d, 'count', 5, 'explanation_key','weak'))));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-06 non-canonical domain(s) in canonical_domain_order: %', v_bad;
  END IF;
  IF (SELECT jsonb_array_length(value) FROM public.calendar_runtime_config
      WHERE key = 'canonical_domain_order') <> 8 THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-06 canonical_domain_order is not eight entries';
  END IF;
  RAISE NOTICE '    OK C-06 canonical_domain_order is the canonical eight, Math then Reading & Writing';

  -- Sheet §8 item 12 / V-03. This used to pin the LAUNCH value, `["practice"]`. Review
  -- shipped on 2026-09-22 and was enabled, so pinning that literal would now assert a
  -- state the product has deliberately left -- the test pushing against the truth rather
  -- than protecting it.
  --
  -- What is still worth asserting, and is the part that can actually go wrong, is that
  -- nothing is enabled whose ADAPTER is a fail-open stub. Enabling an engine before its
  -- engine exists puts live Start controls on blocks with nothing behind them, which is
  -- the one failure this gate was really there to prevent. full_length is that engine
  -- today; it joins the list when its contract test passes against a real engine, and
  -- this line moves with it.
  IF (SELECT value FROM public.calendar_runtime_config WHERE key = 'enabled_block_types')
       @> '["full_length"]'::jsonb THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-07 full_length is enabled but its adapter is still the fail-open stub (enabled_block_types = %)',
      (SELECT value::text FROM public.calendar_runtime_config WHERE key = 'enabled_block_types');
  END IF;
  IF NOT (SELECT value FROM public.calendar_runtime_config WHERE key = 'enabled_block_types')
         @> '["practice"]'::jsonb THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-07 practice is not enabled, which no release has ever intended (enabled_block_types = %)',
      (SELECT value::text FROM public.calendar_runtime_config WHERE key = 'enabled_block_types');
  END IF;
  RAISE NOTICE '    OK C-07 enabled_block_types = % — practice on, no stub engine enabled',
    (SELECT value::text FROM public.calendar_runtime_config WHERE key = 'enabled_block_types');

  -- The config history trigger pair is wired exactly as the other thirteen
  -- *_runtime_config tables (sheet §8 item 9).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'calendar_runtime_config_notify')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'calendar_runtime_config_history_no_mutate') THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-08 the config notify / history-no-mutate trigger pair is not wired';
  END IF;
  RAISE NOTICE '    OK C-08 calendar_runtime_config has the standard notify + append-only history triggers';

  -- C-09. generator_version is a migration timestamp, stored as a string.
  --
  -- Doc 05F §10.2 makes it the provenance stamp on every calendar_plan_versions
  -- row, and it only earns that if it names the SQL that produced the plan. The
  -- format is asserted here because a value like `v1` or `latest` would store
  -- cleanly and trace to nothing. That the named migration FILE exists is
  -- asserted by the CI step that runs this file -- SQL cannot see a filesystem.
  IF NOT EXISTS (
    SELECT 1 FROM public.calendar_runtime_config
    WHERE key = 'generator_version'
      AND value_type = 'string'
      AND (value #>> '{}') ~ '^[0-9]{14}$'
  ) THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-09 generator_version is not a 14-digit migration timestamp stored as a string (got %)',
      (SELECT value::text || ' / ' || value_type FROM public.calendar_runtime_config WHERE key = 'generator_version');
  END IF;
  RAISE NOTICE '    OK C-09 generator_version names a migration timestamp, so a stored plan version traces to its SQL';
END;
$config$;

-- ---------------------------------------------------------------------------
-- Validator gates. calendar-parity.ts proves the validator ACCEPTS every plan
-- both generators produce; a validator that accepted everything would pass that
-- just as well. These prove each rule actually fires, by taking a plan the
-- generator produced and breaking one thing at a time.
-- ---------------------------------------------------------------------------
DO $validator$
DECLARE
  v_snap    jsonb;
  v_plan    jsonb;
  v_out     jsonb;
  v_res     jsonb;
  g         RECORD;
  v_rules   text;
BEGIN
  v_snap := jsonb_build_object(
    'today', '2026-09-21',
    'profile', jsonb_build_object('setup_date','2026-09-21','study_days_mask',62,
                                  'daily_minutes',60,'target_exam_date',NULL,'full_length_weekday',6),
    'mastery', (SELECT jsonb_agg(jsonb_build_object(
                  'section', CASE WHEN d IN ('Algebra','Advanced Math','Problem Solving and Data Analysis',
                                             'Geometry and Trigonometry') THEN 'M' ELSE 'RW' END,
                  'domain', d, 'mastery_level', 2) ORDER BY ord)
                FROM jsonb_array_elements_text(
                  (SELECT value FROM public.calendar_runtime_config WHERE key='canonical_domain_order')
                ) WITH ORDINALITY AS t(d, ord)),
    'review_due_by_date', '[]'::jsonb,
    'exams', jsonb_build_object('last_completed_local_date', NULL, 'days_since_exam', NULL,
                                'missed_count', NULL, 'reviewed', true, 'weak_domains', '[]'::jsonb),
    'recent_planned_by_domain', '[]'::jsonb,
    'enabled_block_types', jsonb_build_array('practice','review','full_length'),
    'engine_planning', jsonb_build_object('practice_seconds_per_unit',90,'review_seconds_per_unit',120),
    'constants', (SELECT jsonb_object_agg(key, value) FROM public.calendar_runtime_config));

  v_plan := public.calendar_compute_plan(v_snap);
  v_out  := public.calendar_plan_to_output(v_plan, 'gate', ARRAY['practice','review','full_length']);

  IF public.calendar_validate_plan('generated', v_snap, v_out) ->> 'result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: W-00 the validator rejected an unmodified generated plan: %',
      public.calendar_validate_plan('generated', v_snap, v_out);
  END IF;
  RAISE NOTICE '    OK W-00 the validator accepts an unmodified generated plan';

  FOR g IN
    SELECT * FROM (VALUES
      ('W-01 a date before today',                       'V-01',
       jsonb_set(v_out, '{dates,0,scheduled_date}', '"2026-09-01"'), NULL::jsonb),

      ('W-02 a practice block on a non-study day',       'V-02',
       jsonb_set(v_out, '{dates,6,members}', v_out #> '{dates,0,members}'), NULL::jsonb),

      -- The converter filters disabled types out, so a disabled type can only
      -- reach the validator from somewhere else: a student edit asking for one,
      -- or an output built before the flag narrowed. Narrow the SNAPSHOT.
      ('W-03 a block type that is not enabled',          'V-03',
       v_out, jsonb_set(v_snap, '{enabled_block_types}', '["review"]'::jsonb)),

      ('W-04 a domain count that is not a multiple of granularity', 'V-04',
       jsonb_set(v_out, '{dates,0,members,0,block,scope,mix,0,count}', '7'), NULL::jsonb),

      ('W-05 two practice blocks in the same section',   'V-04',
       jsonb_set(v_out, '{dates,0,members,1,block,section}',
                 v_out #> '{dates,0,members,0,block,section}'), NULL::jsonb),

      ('W-06 a Math domain inside an R&W block',         'V-06',
       jsonb_set(v_out, '{dates,0,members,0,block,section}', '"RW"'), NULL::jsonb),

      ('W-07 an explanation key outside the sheet §6 set', 'V-09',
       jsonb_set(v_out, '{dates,0,members,0,block,explanation_key}', '"weak_domain"'), NULL::jsonb),

      ('W-08 a per-domain key outside the sheet §6 set', 'V-09',
       jsonb_set(v_out, '{dates,0,members,0,block,scope,mix,0,explanation_key}', '"maintain_strength"'), NULL::jsonb),

      ('W-09 a day planned past its budget',             'V-05',
       jsonb_set(jsonb_set(v_out, '{dates,0,members,0,block,target_count}', '500'),
                 '{dates,0,members,0,block,scope,mix,0,count}', '500'), NULL::jsonb),

      ('W-10 the same date twice in the output',         'V-08',
       jsonb_set(v_out, '{dates}', (v_out -> 'dates') || jsonb_build_array(v_out #> '{dates,0}')), NULL::jsonb),

      ('W-11 a carried block that is not the student''s', 'V-13',
       jsonb_set(v_out, '{dates,0,members}',
                 jsonb_build_array(jsonb_build_object('kind','carried','block_id','deadbeef'))), NULL::jsonb),

      ('W-12 a started block that was not carried',      'V-12',
       v_out, jsonb_set(v_snap, '{started_blocks_by_date}',
                jsonb_build_array(jsonb_build_object(
                  'scheduled_date', v_out #>> '{dates,0,scheduled_date}',
                  'block_id','11111111-1111-1111-1111-111111111111'))))
    ) AS t(name, rule, output, snap_override)
  LOOP
    v_res := public.calendar_validate_plan('generated', COALESCE(g.snap_override, v_snap), g.output);

    IF v_res ->> 'result' <> 'rejected' THEN
      RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: % — the validator ACCEPTED it; expected %', g.name, g.rule;
    END IF;
    SELECT string_agg(DISTINCT x ->> 'rule', ',') INTO v_rules
    FROM jsonb_array_elements(v_res -> 'violations') x;
    IF position(g.rule in v_rules) = 0 THEN
      RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: % — rejected, but for % rather than %', g.name, v_rules, g.rule;
    END IF;
    RAISE NOTICE '    OK % — rejected by %', g.name, g.rule;
  END LOOP;

  -- V-10: ordinary review may not outrun what is actually due.
  v_res := public.calendar_validate_plan('generated',
             jsonb_set(v_snap, '{review_due_by_date}',
               jsonb_build_array(jsonb_build_object('date', v_out #>> '{dates,0,scheduled_date}', 'due_count', 2))),
             jsonb_set(v_out, '{dates,0,members}',
               jsonb_build_array(jsonb_build_object('kind','created','block', jsonb_build_object(
                 'block_type','review','section', NULL, 'scope', jsonb_build_object('mode','queue'),
                 'target_count', 25, 'explanation_key','review_due')))));
  IF v_res ->> 'result' <> 'rejected'
     OR position('V-10' in (SELECT string_agg(x ->> 'rule', ',') FROM jsonb_array_elements(v_res -> 'violations') x)) = 0 THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: W-16 review outran the queue without tripping V-10: %', v_res;
  END IF;
  RAISE NOTICE '    OK W-16 ordinary review may not outrun what is due — rejected by V-10';

  -- V-11: the horizon cap on full-lengths.
  v_res := public.calendar_validate_plan('generated', v_snap,
             jsonb_set(v_out, '{dates}', (
               SELECT jsonb_agg(CASE WHEN ord <= 3 THEN jsonb_set(d, '{members}',
                        jsonb_build_array(jsonb_build_object('kind','created','block', jsonb_build_object(
                          'block_type','full_length','section', NULL,
                          'scope', jsonb_build_object('form_id', NULL),
                          'target_count', 1, 'explanation_key','exam_cadence'))))
                                ELSE d END ORDER BY ord)
               FROM jsonb_array_elements(v_out -> 'dates') WITH ORDINALITY AS t(d, ord))));
  IF v_res ->> 'result' <> 'rejected'
     OR position('V-11' in (SELECT string_agg(x ->> 'rule', ',') FROM jsonb_array_elements(v_res -> 'violations') x)) = 0 THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: W-17 three full-lengths in one horizon did not trip V-11: %', v_res;
  END IF;
  RAISE NOTICE '    OK W-17 more full-lengths than max_full_length_per_horizon — rejected by V-11';

  -- V-14: a non-student mode may not take over a date the student overrode.
  v_res := public.calendar_validate_plan('generated',
             jsonb_set(v_snap, '{current_overrides}', jsonb_build_array(jsonb_build_object(
               'scheduled_date', v_out #>> '{dates,0,scheduled_date}', 'is_user_override', true))),
             v_out);
  IF v_res ->> 'result' <> 'rejected'
     OR position('V-14' in (SELECT string_agg(x ->> 'rule', ',') FROM jsonb_array_elements(v_res -> 'violations') x)) = 0 THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: W-13 a generated plan took over an overridden date without tripping V-14';
  END IF;
  RAISE NOTICE '    OK W-13 a generated plan may not take over an overridden date — rejected by V-14';

  -- ...and the same plan in student_edit mode is fine, so V-14 is about the mode.
  IF public.calendar_validate_plan('student_edit',
       jsonb_set(v_snap, '{current_overrides}', jsonb_build_array(jsonb_build_object(
         'scheduled_date', v_out #>> '{dates,0,scheduled_date}', 'is_user_override', true))),
       v_out) ->> 'result' <> 'accepted' THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: W-14 student_edit was blocked from a date the student overrode';
  END IF;
  RAISE NOTICE '    OK W-14 student_edit may own a date the student overrode';

  -- An unknown mode is a programming error, not a rejection.
  BEGIN
    PERFORM public.calendar_validate_plan('sideways', v_snap, v_out);
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: W-15 an unknown validator mode was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'CALENDAR_SCHEMA_GATE_FAILED%' THEN RAISE; END IF;
    RAISE NOTICE '    OK W-15 an unknown validator mode raises — %', SQLERRM;
  END;
END;
$validator$;

ROLLBACK;

-- ----------------------------------------------------------------------------
-- B-01 — the live calendar_build_plan_input reads the CURRENT review column
--
-- This is a CLASS, not an instance. review R2 (20260921000000) renamed
-- review_schedule.next_review_at to queued_at and re-declared the builder to
-- match. PL/pgSQL does not resolve column names until the function RUNS, so a
-- migration that re-declares the builder from the stale calendar_v1 body passes
-- every structural gate in this file, applies cleanly, and then fails on the
-- first real plan generation in production with "column next_review_at does not
-- exist" -- at which point no student gets a calendar.
--
-- Nothing else catches it. genesis-fresh-apply compares a schema dump, and the
-- dump contains the stale body quite happily. The parity gate never reaches the
-- builder: it feeds snapshots straight to calendar_compute_plan.
--
-- So the gate asserts the BODY of whatever function is live at the end of the
-- migration pipeline, whichever migration declared it last.
-- ----------------------------------------------------------------------------
DO $builder$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'calendar_build_plan_input';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: B-01 calendar_build_plan_input does not exist';
  END IF;

  IF v_src LIKE '%next_review_at%' THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: B-01 the live calendar_build_plan_input still reads next_review_at. review R2 renamed that column to queued_at (20260921000000). A migration re-declared the builder from the pre-R2 body — rebuild it from the 20260921000000 body, never from 20260917130000.';
  END IF;

  IF v_src NOT LIKE '%queued_at%' THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: B-01 the live calendar_build_plan_input does not read queued_at at all, so review_due_by_date cannot be populated';
  END IF;

  -- The column has to exist for the body to mean anything.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'review_schedule'
                   AND column_name = 'queued_at') THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: B-01 review_schedule.queued_at does not exist';
  END IF;

  RAISE NOTICE '    OK B-01 the live calendar_build_plan_input reads review_schedule.queued_at and not next_review_at';
END;
$builder$;

-- ----------------------------------------------------------------------------
-- B-02 — every calendar function body is PINNED to a recorded checksum
--
-- THE GAP THIS FILLS. calendar-parity proves the SOURCE matches the Python
-- oracle. genesis-fresh-apply proves the pipeline reproduces a schema dump.
-- Neither can prove that what is DEPLOYED matches source, because migrations
-- reach production out of band -- supabase_migrations.schema_migrations stops
-- at 20260624020000 while the calendar is live, so the ledger cannot answer it
-- either. Comparing function BODIES is the only method that works, and this is
-- the half of it CI can own.
--
-- WHAT IT ACTUALLY CATCHES, since the pipeline builds these bodies from the
-- very files it compares against: EDITING A MIGRATION THAT HAS ALREADY BEEN
-- APPLIED. That edit is the act that creates drift. The file changes, the
-- deployed body does not, and nothing downstream notices -- the dump still
-- matches, the oracle still matches, and the two databases quietly differ.
-- Pinning turns that edit into a red gate, so it becomes a decision someone
-- makes on purpose and re-records, rather than one nobody sees.
--
-- Proven on calendar_compute_plan, 2026-09-24. Deployed body vs source:
--   4 lines differed out of 416, all of them inside  comments
--   line 161  source "here, and canonical..."  deployed "here; canonical..."
--   line 281  "...needs it,"                   "...needs it;"
--   line 355  "...its share. Once..."          "...its share; once..."
--   line 357  Math<U+2019>s                            Math's
-- Applying exactly those four substitutions to the source body reproduces the
-- deployed md5 (2087563ccd150d51421e633399d7bbb2, 19389 chars) exactly, so the
-- divergence is comment-only and accounted for in full. Its cause: commit
-- 6f7f78b6 "make the migration safe for statement-splitting SQL runners"
-- rewrote those comments AFTER the body had been deployed. Production is
-- therefore OLDER than source, by that commit, in comments alone.
--
-- NORMALISATION: carriage returns are stripped before hashing. The deployed
-- copies store CRLF (415 CRs in calendar_compute_plan) purely because of how
-- they were applied; that is not drift and must not read as drift.
--
-- TO RE-RECORD after deliberately changing a calendar function, run this
-- against the pipeline database and paste the result over the list below:
--
--   SELECT format('      (%L, %s, %L),', p.proname,
--                 length(replace(p.prosrc, chr(13), '')),
--                 md5(replace(p.prosrc, chr(13), '')))
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE 'calendar\_%'
--   ORDER BY p.proname;
--
-- THE OTHER HALF IS OWNER-RUN, because CI holds no production credentials by
-- design (genesis-fresh-apply: "No prod creds -- throwaway PG"). The same
-- query against production, diffed against this list, answers "is deployed
-- still source?" in one read-only round trip.
-- ----------------------------------------------------------------------------
DO $bodies$
DECLARE
  v_bad text;
BEGIN
  WITH expected(name, len, md5) AS (VALUES
      ('calendar_acknowledge_version', 709, 'efea435c708ffec687802c7df28c0ee2'),
      ('calendar_build_plan_input', 10839, '1d1e89a5e80cf30716508092eed1560b'),
      ('calendar_carry_started', 882, '1a34b4dec6664e8c13028098d7563ea0'),
      ('calendar_compute_plan', 19393, '0567edbbd7b034ba7d54bd89942f526d'),
      ('calendar_compute_plan_fallback', 7994, 'ed231d0bcf1c26e57d52cd7de11e8c5d'),
      ('calendar_do_it_now', 3921, 'cb08df2b79ae17e0b17e11af2cebcd33'),
      ('calendar_drop_today_for_system', 325, 'a037c331145e3afc8c94dc17b18a4cf4'),
      ('calendar_drop_unowned_dates', 336, 'afa423c5bf6382097610133e64707412'),
      ('calendar_edit_day', 2323, 'd03883155de01a174fd761426518ec36'),
      ('calendar_is_known_timezone', 91, '946a562369e4d62e7ed74d83a529e890'),
      ('calendar_link_launch', 1450, 'bbb60d44b09a40a2e060493dbe269135'),
      ('calendar_move_block', 5729, '4f4c193a69a720f1d7baa99d3282cd68'),
      ('calendar_persist_version', 5225, '8769894020580f0525c4e817af4860e3'),
      ('calendar_place_full_lengths', 3375, '5d75f39c96396a22d6d4276ad2833d27'),
      ('calendar_plan_to_output', 729, 'aa6f7e9f331a5f9dfac05f855ac7f84d'),
      ('calendar_regenerate_day', 7306, '6875bfde324a4b153899cd2d61696ae1'),
      ('calendar_regenerate_day_only', 199, '5d0b0a15caca7ea867cda145a35f2fec'),
      ('calendar_require_int', 238, '907d3f984f1b8c8f1b12384c574f0bd6'),
      ('calendar_scope_is_valid', 3177, '3279a87f58e47efb8e8f38b74babefcd'),
      ('calendar_validate_plan', 17209, '628372c06c754574ecf5b5f262f14518'),
      ('calendar_viewer_is_admin', 130, 'd0707346dc5e5486d8dd014ee386b79d'),
      ('calendar_weekly_candidates', 884, '562c5433b509895852bcb2462c87e955'),
      ('calendar_write_version', 3806, '6da5b170ec14ee5c9c7eab0f311ed7ef')
  ),
  live AS (
    SELECT p.proname::text AS name,
           length(replace(p.prosrc, chr(13), '')) AS len,
           md5(replace(p.prosrc, chr(13), '')) AS md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'calendar\_%'
  )
  SELECT string_agg(msg, '; ' ORDER BY msg) INTO v_bad
  FROM (
    -- Pinned but absent: a function the manifest names no longer exists.
    SELECT format('%s is pinned but does not exist', e.name) AS msg
    FROM expected e LEFT JOIN live l USING (name) WHERE l.name IS NULL
    UNION ALL
    -- Present but unpinned: a NEW calendar function. Recording it is the point;
    -- an unpinned body is one this gate cannot speak for.
    SELECT format('%s exists but is not pinned', l.name)
    FROM live l LEFT JOIN expected e USING (name) WHERE e.name IS NULL
    UNION ALL
    -- Pinned and present, but the body moved.
    SELECT format('%s body changed (pinned %s chars/%s, live %s chars/%s)',
                  e.name, e.len, left(e.md5, 8), l.len, left(l.md5, 8))
    FROM expected e JOIN live l USING (name)
    WHERE e.len IS DISTINCT FROM l.len OR e.md5 IS DISTINCT FROM l.md5
  ) d;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: B-02 calendar function bodies diverge from the pinned manifest: %. If the change was deliberate, re-record the list in this gate (query in the header) AND make sure the deployed copy is updated too -- the pin is what tells you production is behind.', v_bad;
  END IF;

  RAISE NOTICE '    OK B-02 all % calendar function bodies match the pinned manifest',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'calendar\_%');
END;
$bodies$;
