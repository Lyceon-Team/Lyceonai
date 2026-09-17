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
    'canonical_domain_order','enabled_block_types'];
BEGIN
  SELECT string_agg(k, ', ') INTO v_missing
  FROM unnest(v_expected) k
  WHERE NOT EXISTS (SELECT 1 FROM public.calendar_runtime_config c WHERE c.key = k);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-01 formula sheet §4 key(s) missing: %', v_missing;
  END IF;

  SELECT string_agg(c.key, ', ') INTO v_extra
  FROM public.calendar_runtime_config c WHERE NOT (c.key = ANY (v_expected));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-01 key(s) not in formula sheet §4: %', v_extra;
  END IF;
  RAISE NOTICE '    OK C-01 calendar_runtime_config holds exactly the 20 formula sheet §4 keys';

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

  -- Launch value: practice only (sheet §8 item 12 / V-03).
  IF (SELECT value FROM public.calendar_runtime_config WHERE key = 'enabled_block_types')
     <> '["practice"]'::jsonb THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-07 enabled_block_types is not the launch value ["practice"]';
  END IF;
  RAISE NOTICE '    OK C-07 enabled_block_types is the launch value ["practice"]';

  -- The config history trigger pair is wired exactly as the other thirteen
  -- *_runtime_config tables (sheet §8 item 9).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'calendar_runtime_config_notify')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'calendar_runtime_config_history_no_mutate') THEN
    RAISE EXCEPTION 'CALENDAR_SCHEMA_GATE_FAILED: C-08 the config notify / history-no-mutate trigger pair is not wired';
  END IF;
  RAISE NOTICE '    OK C-08 calendar_runtime_config has the standard notify + append-only history triggers';
END;
$config$;

ROLLBACK;
