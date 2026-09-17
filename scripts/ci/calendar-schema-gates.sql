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

ROLLBACK;
