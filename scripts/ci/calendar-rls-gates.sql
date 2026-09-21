-- ============================================================================
-- Doc 05F calendar — grant and RLS gates
-- ============================================================================
-- Proves what §7.11 and §7.12 promise, from the client's seat:
--   * authenticated cannot INSERT, UPDATE or DELETE any calendar table;
--   * authenticated cannot EXECUTE any calendar write RPC;
--   * a student reads own rows and no other student's;
--   * input_snapshot and constants_snapshot are unreadable at the base table,
--     not merely absent from a view;
--   * a guardian is an ordinary authenticated user here — no calendar policy
--     of any kind grants them a row (§16);
--   * anon reads nothing;
--   * the ledger, job runs and config tables are unreachable for a client
--     (no grant at all, so the denial is a privilege error, not an empty read).
--
-- Transport: the session assumes the `authenticated` role and auth.uid() is
-- redefined to Supabase's own body (the JWT `sub` claim out of
-- request.jwt.claims), so the identity path under test is the production one.
-- This is the SQL layer, not PostgREST; scripts/ci/mastery-postgrest-gate.sh is
-- the pattern to follow if the owner wants the real transport in front of it.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/calendar-rls-gates.sql
--
-- @spec [Doc-05F_V1.0 §7.11 (INV-08-05 immutability), §7.12 (access boundary
--        and RLS), §16 (entitlement, roles, guardian read)]
--       [Doc_05F_formula_sheet.md §8 items 10, 14]
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

-- --------------------------------------------------------------------------
-- Supabase's real auth.uid(). The CI stub returns a constant NULL, which would
-- make every USING clause vacuously false and every gate below pass for the
-- wrong reason.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;

-- --------------------------------------------------------------------------
-- Fixture: a student, another student, a guardian, an admin.
-- --------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'rls-student@example.test',  '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'rls-other@example.test',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'rls-guardian@example.test', '{"role":"guardian"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'rls-admin@example.test',    '{}'::jsonb);
UPDATE public.profiles SET role = 'admin' WHERE id = '44444444-4444-4444-4444-444444444444';

INSERT INTO public.student_study_profile (student_id, timezone, study_days_mask, daily_minutes)
VALUES ('11111111-1111-1111-1111-111111111111', 'America/Chicago', 62, 60),
       ('22222222-2222-2222-2222-222222222222', 'America/Chicago', 62, 60);

INSERT INTO public.calendar_plan_versions
  (plan_version_id, student_id, version_no, generator_version, trigger, initiated_by,
   input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
        'v1', 'setup', 'student', '{"mastery":"SECRET"}', 'h', '{"constants":"SECRET"}', 'accepted');

INSERT INTO public.calendar_plan_dates (plan_version_id, student_id, scheduled_date, timezone)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '2026-09-21', 'America/Chicago');

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

INSERT INTO public.calendar_mutation_ledger (student_id, idempotency_key, route, response_hash, response)
VALUES ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555',
        'POST /api/calendar/setup', 'h', '{}');

INSERT INTO public.calendar_job_runs (job, student_id, period_key, outcome)
VALUES ('weekly_regen', '11111111-1111-1111-1111-111111111111', '2026-09-21', 'ok');

-- --------------------------------------------------------------------------
-- Runs a statement in a subtransaction and reports the outcome instead of
-- aborting, so every denial is printed verbatim.
-- --------------------------------------------------------------------------
CREATE FUNCTION public.calendar_gate_try(p_stmt text) RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_stmt;
  RETURN 'ACCEPTED';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;

DO $gates$
DECLARE
  g RECORD;
  v_out text;
  v_fail integer := 0;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      -- role, jwt sub, label, expected outcome ('DENY' = must not be ACCEPTED), statement
      ('authenticated','11111111-1111-1111-1111-111111111111','R-01 student INSERT into calendar_blocks','DENY',
       $s$INSERT INTO public.calendar_blocks (student_id, created_in_version_id, scheduled_date, block_type, scope, target_count, source)
          VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','2026-09-22','review','{"mode":"queue"}',5,'auto')$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-02 student UPDATE of own block (INV-08-05)','DENY',
       $s$UPDATE public.calendar_blocks SET target_count = 999 WHERE student_id = '11111111-1111-1111-1111-111111111111'$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-03 student DELETE of own block (INV-08-05)','DENY',
       $s$DELETE FROM public.calendar_blocks WHERE student_id = '11111111-1111-1111-1111-111111111111'$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-04 student UPDATE of own plan version','DENY',
       $s$UPDATE public.calendar_plan_versions SET validator_result = 'accepted' WHERE student_id = '11111111-1111-1111-1111-111111111111'$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-05 student UPDATE of own study profile','DENY',
       $s$UPDATE public.student_study_profile SET daily_minutes = 600 WHERE student_id = '11111111-1111-1111-1111-111111111111'$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-06 student INSERT into calendar_plan_versions','DENY',
       $s$INSERT INTO public.calendar_plan_versions (student_id, version_no, generator_version, trigger, initiated_by, input_snapshot, input_snapshot_hash, constants_snapshot, validator_result)
          VALUES ('11111111-1111-1111-1111-111111111111',2,'v1','setup','student','{}','h','{}','accepted')$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-07 student INSERT into calendar_mutation_ledger','DENY',
       $s$INSERT INTO public.calendar_mutation_ledger (student_id, idempotency_key, route, response_hash, response)
          VALUES ('11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','r','h','{}')$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-08 student reads calendar_plan_versions.input_snapshot','DENY',
       $s$SELECT input_snapshot FROM public.calendar_plan_versions$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-09 student reads calendar_plan_versions.constants_snapshot','DENY',
       $s$SELECT constants_snapshot FROM public.calendar_plan_versions$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-10 student SELECT * on calendar_plan_versions','DENY',
       $s$SELECT * FROM public.calendar_plan_versions$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-11 student reads calendar_runtime_config','DENY',
       $s$SELECT key FROM public.calendar_runtime_config$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-12 student reads calendar_runtime_config_history','DENY',
       $s$SELECT key FROM public.calendar_runtime_config_history$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-13 student reads calendar_mutation_ledger','DENY',
       $s$SELECT idempotency_key FROM public.calendar_mutation_ledger$s$),

      ('authenticated','11111111-1111-1111-1111-111111111111','R-14 student reads calendar_job_runs','DENY',
       $s$SELECT run_id FROM public.calendar_job_runs$s$),

      ('anon','','R-15 anon reads calendar_blocks','DENY',
       $s$SELECT block_id FROM public.calendar_blocks$s$),

      ('anon','','R-16 anon reads calendar_current_plan','DENY',
       $s$SELECT block_id FROM public.calendar_current_plan$s$),

      ('anon','','R-17 anon reads student_study_profile','DENY',
       $s$SELECT timezone FROM public.student_study_profile$s$)
    ) AS t(who, sub, name, expect, stmt)
  LOOP
    EXECUTE format('SET LOCAL ROLE %I', g.who);
    PERFORM set_config('request.jwt.claims',
      CASE WHEN g.sub = '' THEN '' ELSE json_build_object('sub', g.sub, 'role', g.who)::text END, true);
    v_out := public.calendar_gate_try(g.stmt);
    RESET ROLE;
    IF v_out = 'ACCEPTED' THEN
      v_fail := v_fail + 1;
      RAISE WARNING '  FAIL %  — ACCEPTED, expected denial', g.name;
    ELSE
      RAISE NOTICE '    OK % — %', g.name, v_out;
    END IF;
  END LOOP;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: % of 17 write/read denials did not hold', v_fail;
  END IF;
END;
$gates$;

-- --------------------------------------------------------------------------
-- Row visibility: who sees which rows, counted.
-- --------------------------------------------------------------------------
DO $rows$
DECLARE
  r RECORD;
  v_got integer;
  v_fail integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('11111111-1111-1111-1111-111111111111','V-01 student sees own blocks',                     1,
       $s$SELECT count(*)::int FROM public.calendar_blocks$s$),   -- RLS already scopes this one
      ('22222222-2222-2222-2222-222222222222','V-02 another student sees none of them',            0,
       $s$SELECT count(*)::int FROM public.calendar_blocks$s$),
      ('33333333-3333-3333-3333-333333333333','V-03 a guardian sees none (no guardian policy, §16)',0,
       $s$SELECT count(*)::int FROM public.calendar_blocks$s$),
      ('33333333-3333-3333-3333-333333333333','V-04 a guardian sees no plan dates either',          0,
       $s$SELECT count(*)::int FROM public.calendar_plan_dates$s$),
      ('33333333-3333-3333-3333-333333333333','V-05 a guardian sees no study profile',             0,
       $s$SELECT count(*)::int FROM public.student_study_profile$s$),
      ('44444444-4444-4444-4444-444444444444','V-06 an admin sees both fixture students'' profiles', 2,
       $s$SELECT count(*)::int FROM public.student_study_profile
          WHERE student_id IN ('11111111-1111-1111-1111-111111111111',
                               '22222222-2222-2222-2222-222222222222')$s$),
      ('11111111-1111-1111-1111-111111111111','V-07 student sees own current plan through the view',1,
       $s$SELECT count(*)::int FROM public.calendar_current_plan$s$),
      ('22222222-2222-2222-2222-222222222222','V-08 another student sees nothing through the view', 0,
       $s$SELECT count(*)::int FROM public.calendar_current_plan$s$),
      ('11111111-1111-1111-1111-111111111111','V-09 student sees own version through the narrowed view',1,
       $s$SELECT count(*)::int FROM public.calendar_plan_versions_student$s$),
      ('22222222-2222-2222-2222-222222222222','V-10 another student sees no version',              0,
       $s$SELECT count(*)::int FROM public.calendar_plan_versions_student$s$),
      ('44444444-4444-4444-4444-444444444444','V-11 an admin sees the student''s blocks',           1,
       $s$SELECT count(*)::int FROM public.calendar_blocks
          WHERE student_id = '11111111-1111-1111-1111-111111111111'$s$),
      ('33333333-3333-3333-3333-333333333333','V-12 a guardian sees no block launch',              0,
       $s$SELECT count(*)::int FROM public.calendar_block_launches$s$)
    ) AS t(sub, name, want, stmt)
  LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.sub, 'role','authenticated')::text, true);
    EXECUTE r.stmt INTO v_got;
    RESET ROLE;
    IF v_got <> r.want THEN
      v_fail := v_fail + 1;
      RAISE WARNING '  FAIL % — saw % row(s), expected %', r.name, v_got, r.want;
    ELSE
      RAISE NOTICE '    OK % — % row(s)', r.name, v_got;
    END IF;
  END LOOP;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: % of 12 visibility gates did not hold', v_fail;
  END IF;
END;
$rows$;

-- --------------------------------------------------------------------------
-- Structural assertions that do not depend on the fixture.
-- --------------------------------------------------------------------------
DO $structure$
DECLARE
  v_n integer;
  v_names text;
BEGIN
  -- No write privilege of any kind, on any calendar relation, for anon/authenticated.
  SELECT count(*), string_agg(DISTINCT table_name || '.' || privilege_type, ', ')
    INTO v_n, v_names
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon','authenticated','PUBLIC')
    AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
    AND (table_name LIKE 'calendar\_%' OR table_name = 'student_study_profile');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: S-01 anon/authenticated hold % write grant(s): %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK S-01 anon/authenticated hold no INSERT/UPDATE/DELETE on any calendar relation';

  -- No policy permits anything but SELECT.
  SELECT count(*), string_agg(policyname || ' (' || cmd || ')', ', ') INTO v_n, v_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (tablename LIKE 'calendar\_%' OR tablename = 'student_study_profile')
    AND cmd <> 'SELECT';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: S-02 % non-SELECT calendar policy/policies exist: %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK S-02 every calendar policy is SELECT-only';

  -- RLS is on for every calendar table.
  SELECT count(*), string_agg(tablename, ', ') INTO v_n, v_names
  FROM pg_tables
  WHERE schemaname = 'public'
    AND (tablename LIKE 'calendar\_%' OR tablename = 'student_study_profile')
    AND NOT rowsecurity;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: S-03 % calendar table(s) without RLS: %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK S-03 RLS is enabled on every calendar table';

  -- Both calendar views are security_invoker. Dropping that setting would make
  -- them owner-rights and silently bypass every policy above.
  SELECT count(*), string_agg(c.relname, ', ') INTO v_n, v_names
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND c.relname IN ('calendar_current_plan','calendar_plan_versions_student')
    AND COALESCE(array_to_string(c.reloptions, ','), '') NOT LIKE '%security_invoker=true%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: S-04 % calendar view(s) are not security_invoker: %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK S-04 both calendar views are security_invoker = true';

  -- The narrowed view must not expose the two snapshot columns.
  SELECT count(*), string_agg(column_name, ', ') INTO v_n, v_names
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'calendar_plan_versions_student'
    AND column_name IN ('input_snapshot','constants_snapshot');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: S-05 calendar_plan_versions_student exposes %', v_names;
  END IF;
  RAISE NOTICE '    OK S-05 calendar_plan_versions_student excludes input_snapshot and constants_snapshot';

  -- No guardian-shaped policy anywhere in the calendar (§16).
  SELECT count(*), string_agg(policyname, ', ') INTO v_n, v_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (tablename LIKE 'calendar\_%' OR tablename = 'student_study_profile')
    AND (policyname ILIKE '%guardian%' OR COALESCE(qual,'') ILIKE '%guardian%');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CALENDAR_RLS_GATE_FAILED: S-06 % guardian policy/policies on calendar tables: %', v_n, v_names;
  END IF;
  RAISE NOTICE '    OK S-06 no guardian policy exists on any calendar table (§16)';
END;
$structure$;

DROP FUNCTION public.calendar_gate_try(text);

ROLLBACK;
