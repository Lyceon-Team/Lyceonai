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
  v_bool boolean;
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

  -- 7. a PENDING link is not an active link
  UPDATE public.guardian_links SET status='pending_student_accept', revoked_at=NULL WHERE id=v_link_id;
  SELECT public.guardian_view_decision(g, s_ok) INTO v_got;
  IF v_got <> 'not_linked' THEN RAISE EXCEPTION 'GATE 7 FAIL: pending link expected not_linked, got %', v_got; END IF;
  RAISE NOTICE 'GATE 7 PASS: pending_student_accept -> not_linked';
  UPDATE public.guardian_links SET status='active' WHERE id=v_link_id;

  -- 8. direction matters: the student is not the guardian's guardian
  SELECT public.guardian_view_decision(s_ok, g) INTO v_got;
  IF v_got <> 'not_linked' THEN RAISE EXCEPTION 'GATE 8 FAIL: reversed pair expected not_linked, got %', v_got; END IF;
  RAISE NOTICE 'GATE 8 PASS: reversed pair -> not_linked (link is directional)';

  -- 9. the boolean form agrees with the decision on every case above
  FOR v_got, v_bool IN
    SELECT public.guardian_view_decision(g, t.sid), public.guardian_can_view_student_as(g, t.sid)
    FROM (VALUES (s_ok),(s_lapsed),(s_grace),(s_none)) AS t(sid)
  LOOP
    IF v_bool <> (v_got = 'allow') THEN
      RAISE EXCEPTION 'GATE 9 FAIL: boolean form disagrees with decision (decision=%, bool=%)', v_got, v_bool;
    END IF;
  END LOOP;
  RAISE NOTICE 'GATE 9 PASS: guardian_can_view_student_as agrees with guardian_view_decision';

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

  -- 11. the two delegating forms really delegate — they contain no test of their own
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='guardian_can_view_student' AND p.pronargs=1)
     NOT LIKE '%guardian_can_view_student_as%' THEN
    RAISE EXCEPTION 'GATE 11 FAIL: guardian_can_view_student(uuid) does not delegate';
  END IF;
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='guardian_can_view_student_as')
     NOT LIKE '%guardian_view_decision%' THEN
    RAISE EXCEPTION 'GATE 11 FAIL: guardian_can_view_student_as does not delegate';
  END IF;
  RAISE NOTICE 'GATE 11 PASS: both boolean forms delegate, neither re-tests';

  -- 12. the six RLS policies still route through the ONE-ARG form
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND qual LIKE '%guardian_can_view_student(%';
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'GATE 12 FAIL: % RLS policies call guardian_can_view_student, expected 6', v_count;
  END IF;
  RAISE NOTICE 'GATE 12 PASS: 6 RLS policies route through the one-arg form';

  -- 13. ENUMERATION ORACLE. The two-argument forms take the guardian id as an
  --     argument, so an authenticated caller who could execute them could probe
  --     "is A linked to B" for any pair. They must be service-role only.
  FOR v_got IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
    IF has_function_privilege(v_got, 'public.guardian_view_decision(uuid,uuid)', 'EXECUTE')
       OR has_function_privilege(v_got, 'public.guardian_can_view_student_as(uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'GATE 13 FAIL: role % can execute a two-argument guardian gate (enumeration oracle)', v_got;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.guardian_can_view_student(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GATE 13 FAIL: authenticated cannot execute the one-arg form; RLS would deny everything';
  END IF;
  RAISE NOTICE 'GATE 13 PASS: two-arg forms service-role only; one-arg callable by authenticated';

  RAISE NOTICE 'GUARDIAN-VIEW-DECISION GATE: PASS';
END
$gate$;

ROLLBACK;
