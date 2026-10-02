-- ---------------------------------------------------------------------------
-- guardian_view_decision gate — proves ONE derivation, exercised on REAL rows.
--
-- @spec [Doc 01 V8 §35/§38.1; Doc 05B §10.1/§10.3/§10.4; owner rulings
--        2026-08-26 R3/R6 and 2026-08-27 OQ1]
-- @implemented 2026-08-27
--
-- plain English: the guardian gate has never executed in production —
-- guardian_links holds zero rows, and the TypeScript that would have written one
-- addressed columns that do not exist. Every guardian test to date mocked the
-- link layer away, which is precisely how unrunnable code passed for ten weeks.
-- This gate inserts REAL guardian_links rows and asserts the decision each one
-- produces. The first row it inserts is the first time this feature has executed.
--
-- Raises on the first failure; prints one NOTICE per passing assertion.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on

BEGIN;

-- ---- GATE 0: the gate's BODY is pinned -------------------------------------
-- @spec [Guardian_Closure_Plan G1-08; audit G-AUD-11] | @implemented 2026-09-29
--
-- Gates 1-13 prove BEHAVIOUR on the fixture rows below. They cannot see a change
-- the fixtures do not exercise — a condition that lets one particular id through,
-- say — and they cannot tell that a migration which has ALREADY been applied was
-- edited afterwards, which is how a deployed body silently drifts from source
-- (calendar-schema-gates B-02, same reasoning). So the function that IS the
-- guardian gate is pinned to its recorded checksum (its two boolean forms were
-- dropped with the dead RLS policies that called them: 20261017000000, SCL-196), checked FIRST so a body
-- change is always named here rather than as whatever behavioural gate it happens
-- to trip. The same hashes are what the owner compares against production
-- (pg_proc.prosrc, CRs stripped) to answer "is the live gate this gate?".
--
-- TO RE-RECORD after a deliberate change (and ship the change to production):
--   SELECT p.oid::regprocedure, md5(replace(p.prosrc, chr(13), ''))
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname = 'guardian_view_decision';
DO $pin$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s (got %s)', e.sig, coalesce(md5(replace(p.prosrc, chr(13), '')), 'MISSING')), '; ')
    INTO v_bad
  FROM (VALUES
    ('public.guardian_view_decision(uuid,uuid)',       'c54e5697c856f817b6071d195bd37188')
  ) AS e(sig, md5_expected)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) <> e.md5_expected;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'GATE 0 FAIL: guardian gate body differs from the pinned checksum: %. If deliberate, re-record (query above) AND apply the same body in production.', v_bad;
  END IF;
  RAISE NOTICE 'GATE 0 PASS: guardian_view_decision matches its pinned body';
END
$pin$;

-- ---- fixtures: real rows, mirroring production shapes -----------------------
-- profiles are created by the handle_new_user trigger on auth.users insert.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-00000000f001','gate-guardian@example.com','{"role":"guardian"}'::jsonb),
  ('00000000-0000-0000-0000-00000000f002','gate-student-paid@example.com','{"role":"student"}'::jsonb),
  ('00000000-0000-0000-0000-00000000f003','gate-student-lapsed@example.com','{"role":"student"}'::jsonb),
  ('00000000-0000-0000-0000-00000000f004','gate-student-grace@example.com','{"role":"student"}'::jsonb),
  ('00000000-0000-0000-0000-00000000f005','gate-stranger@example.com','{"role":"student"}'::jsonb);

INSERT INTO public.entitlements (profile_id, tier, status) VALUES
  ('00000000-0000-0000-0000-00000000f002','premium','active'),
  ('00000000-0000-0000-0000-00000000f003','premium','canceled'),
  ('00000000-0000-0000-0000-00000000f004','premium','past_due'),
  ('00000000-0000-0000-0000-00000000f005','premium','active');

INSERT INTO public.guardian_links
  (guardian_profile_id, student_profile_id, status, initiated_by, accepted_at, accepted_by_profile_id) VALUES
  ('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000f002','active','guardian',now(),'00000000-0000-0000-0000-00000000f002'),
  ('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000f003','active','guardian',now(),'00000000-0000-0000-0000-00000000f003'),
  ('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000f004','active','guardian',now(),'00000000-0000-0000-0000-00000000f004');

DO $gate$
DECLARE
  g   uuid := '00000000-0000-0000-0000-00000000f001';
  s_ok uuid := '00000000-0000-0000-0000-00000000f002';
  s_lapsed uuid := '00000000-0000-0000-0000-00000000f003';
  s_grace  uuid := '00000000-0000-0000-0000-00000000f004';
  s_none   uuid := '00000000-0000-0000-0000-00000000f005';
  v_link_id uuid;
  v_got text;
  v_count int;
BEGIN
  -- 1. active link + active entitlement -> allow
  SELECT public.guardian_view_decision(g, s_ok) INTO v_got;
  IF v_got <> 'allow' THEN RAISE EXCEPTION 'GATE 1 FAIL: linked+entitled expected allow, got %', v_got; END IF;
  RAISE NOTICE 'GATE 1 PASS: linked + entitled -> allow';

  -- 2. active link + lapsed entitlement -> student_unentitled (the 402 path, NOT 404)
  SELECT public.guardian_view_decision(g, s_lapsed) INTO v_got;
  IF v_got <> 'student_unentitled' THEN RAISE EXCEPTION 'GATE 2 FAIL: linked+canceled expected student_unentitled, got %', v_got; END IF;
  RAISE NOTICE 'GATE 2 PASS: linked + canceled -> student_unentitled (402, not 404)';

  -- 3. grace-inclusive: past_due still grants (SCL-029 — platform predicate beats literal 'active')
  SELECT public.guardian_view_decision(g, s_grace) INTO v_got;
  IF v_got <> 'allow' THEN RAISE EXCEPTION 'GATE 3 FAIL: past_due expected allow (grace-inclusive), got %', v_got; END IF;
  RAISE NOTICE 'GATE 3 PASS: past_due -> allow (grace-inclusive per SCL-029)';

  -- 4. no link at all -> not_linked (the 404 path); the student IS entitled, so this
  --    isolates the link term rather than passing for the wrong reason.
  SELECT public.guardian_view_decision(g, s_none) INTO v_got;
  IF v_got <> 'not_linked' THEN RAISE EXCEPTION 'GATE 4 FAIL: unlinked expected not_linked, got %', v_got; END IF;
  RAISE NOTICE 'GATE 4 PASS: unlinked (but entitled) student -> not_linked (404)';

  -- 5. NULL principal fails closed. This is the service-role case: auth.uid() is NULL.
  SELECT public.guardian_view_decision(NULL, s_ok) INTO v_got;
  IF v_got <> 'not_linked' THEN RAISE EXCEPTION 'GATE 5 FAIL: NULL principal expected not_linked, got %', v_got; END IF;
  RAISE NOTICE 'GATE 5 PASS: NULL principal -> not_linked (fails closed)';

  -- 6. a REVOKED link is not an active link
  UPDATE public.guardian_links SET status='revoked', revoked_at=now()
   WHERE guardian_profile_id=g AND student_profile_id=s_ok RETURNING id INTO v_link_id;
  SELECT public.guardian_view_decision(g, s_ok) INTO v_got;
  IF v_got <> 'not_linked' THEN RAISE EXCEPTION 'GATE 6 FAIL: revoked link expected not_linked, got %', v_got; END IF;
  RAISE NOTICE 'GATE 6 PASS: revoked link -> not_linked';

  -- 7. a PENDING link cannot EXIST, which is stronger than not conferring view.
  --    This gate used to set status='pending_student_accept' and assert the function
  --    returned 'not_linked'. SCL-080 narrowed guardian_links_status_check to
  --    ('active','revoked'), so that UPDATE now raises 23514 and the gate died on its
  --    own fixture. The assertion is not dropped, it is MOVED DOWN A LAYER: instead of
  --    proving the function ignores a pending row, prove the database refuses to store
  --    one. A status that cannot be written cannot be mis-read.
  BEGIN
    UPDATE public.guardian_links SET status='pending_student_accept', revoked_at=NULL WHERE id=v_link_id;
    RAISE EXCEPTION 'GATE 7 FAIL: guardian_links accepted a pending status; the SCL-080 CHECK is not in force';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'GATE 7 PASS: pending_student_accept is refused by the status CHECK';
  END;
  UPDATE public.guardian_links SET status='active', revoked_at=NULL WHERE id=v_link_id;

  -- 8. direction matters: the student is not the guardian's guardian
  SELECT public.guardian_view_decision(s_ok, g) INTO v_got;
  IF v_got <> 'not_linked' THEN RAISE EXCEPTION 'GATE 8 FAIL: reversed pair expected not_linked, got %', v_got; END IF;
  RAISE NOTICE 'GATE 8 PASS: reversed pair -> not_linked (link is directional)';

  -- 9. the boolean forms are gone (20261017000000, G-NEW-15, SCL-196). They existed only
  --    for the guardian RLS policies, which never served a request (every read runs on the
  --    service role); a second callable form of the gate is a second place to drift.
  IF to_regprocedure('public.guardian_can_view_student(uuid)') IS NOT NULL
     OR to_regprocedure('public.guardian_can_view_student_as(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'GATE 9 FAIL: a boolean guardian gate form still exists';
  END IF;
  RAISE NOTICE 'GATE 9 PASS: guardian_view_decision is the only form of the gate';

  -- 10. PROVENANCE. Exactly ONE function in the schema performs the link+entitlement
  --     test. If anyone re-derives it anywhere else — in SQL or by adding a second
  --     helper — this count moves and the gate reds. This is the assertion that makes
  --     "one derivation" a fact rather than a claim.
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc LIKE '%guardian_links%'
     AND p.prosrc LIKE '%entitlement_active%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'GATE 10 FAIL: % function(s) derive guardian visibility, expected exactly 1 (guardian_view_decision)', v_count;
  END IF;
  RAISE NOTICE 'GATE 10 PASS: exactly ONE function derives guardian visibility';

  -- 11. no RLS policy anywhere consults a guardian gate: guardian visibility is decided in
  --     the route layer, by the server calling guardian_view_decision, and nowhere else.
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND (qual LIKE '%guardian_can_view%' OR qual LIKE '%guardian_view_decision%');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GATE 11 FAIL: % RLS policies consult a guardian gate, expected 0', v_count;
  END IF;
  RAISE NOTICE 'GATE 11 PASS: no RLS policy consults a guardian gate';

  -- 12. the six KPI / mastery / projection tables keep RLS on and carry NO SELECT policy:
  --     anon and authenticated read zero rows; only the service role reads them.
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND cmd IN ('SELECT','ALL')
     AND tablename IN ('student_overall_kpi','student_section_kpi','student_domain_kpi',
                       'student_domain_mastery','student_section_projections',
                       'student_section_projection_snapshots');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GATE 12 FAIL: % read policies on the six KPI/mastery/projection tables, expected 0', v_count;
  END IF;
  IF (SELECT bool_and(rowsecurity) FROM pg_tables WHERE schemaname='public'
       AND tablename IN ('student_overall_kpi','student_section_kpi','student_domain_kpi',
                         'student_domain_mastery','student_section_projections',
                         'student_section_projection_snapshots')) IS NOT TRUE THEN
    RAISE EXCEPTION 'GATE 12 FAIL: RLS is not enabled on all six tables (no policy would then mean open)';
  END IF;
  RAISE NOTICE 'GATE 12 PASS: RLS on, no read policy, on all six tables (denial by absence)';

  -- 13. ENUMERATION ORACLE. guardian_view_decision takes the guardian id as an
  --     argument, so an authenticated caller who could execute it could probe
  --     "is A linked to B" for any pair. It must be service-role only.
  FOR v_got IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
    IF has_function_privilege(v_got, 'public.guardian_view_decision(uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'GATE 13 FAIL: role % can execute guardian_view_decision (enumeration oracle)', v_got;
    END IF;
  END LOOP;
  RAISE NOTICE 'GATE 13 PASS: guardian_view_decision is service-role only';

  -- 14. NO DIRECT READ PATH (SCL-198, 20261019000000). Every read of the eight KPI / mastery /
  --     projection tables is the service role's. The column-level SELECT `authenticated` held
  --     on them is what made G-NEW-15's guardian policies live; it is revoked, and neither
  --     `authenticated` nor `anon` may regain SELECT on any column. The two skill tables keep
  --     no policy at all, and RLS stays on everywhere (no grant AND no policy, both layers).
  FOR v_got IN SELECT unnest(ARRAY['student_overall_kpi','student_section_kpi',
      'student_domain_kpi','student_domain_mastery','student_section_projections',
      'student_section_projection_snapshots','student_skill_kpi','student_skill_mastery']) LOOP
    IF has_any_column_privilege('authenticated', 'public.' || v_got, 'SELECT')
       OR has_any_column_privilege('anon', 'public.' || v_got, 'SELECT') THEN
      RAISE EXCEPTION 'GATE 14 FAIL: authenticated or anon can SELECT public.% (every read is the service role''s)', v_got;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_got)::regclass) THEN
      RAISE EXCEPTION 'GATE 14 FAIL: RLS is not enabled on public.%', v_got;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('student_skill_kpi','student_skill_mastery');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GATE 14 FAIL: % policies on student_skill_kpi / student_skill_mastery, expected 0', v_count;
  END IF;
  -- Presence before absence: the service role, the one reader, still reads all eight.
  IF NOT (SELECT bool_and(has_table_privilege('service_role', 'public.' || t, 'SELECT'))
            FROM unnest(ARRAY['student_overall_kpi','student_section_kpi','student_domain_kpi',
              'student_domain_mastery','student_section_projections',
              'student_section_projection_snapshots','student_skill_kpi',
              'student_skill_mastery']) AS t) THEN
    RAISE EXCEPTION 'GATE 14 FAIL: service_role lost SELECT on one of the eight tables (the app reads through it)';
  END IF;
  RAISE NOTICE 'GATE 14 PASS: no authenticated/anon SELECT on the eight tables; no skill-table policy; service_role reads';

  RAISE NOTICE 'GUARDIAN-VIEW-DECISION GATE: PASS';
END
$gate$;

ROLLBACK;
