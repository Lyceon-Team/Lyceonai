-- ============================================================================
-- Destructive-path rehearsal for the §40.5 hard-delete RPC + §40.5 cron selection
-- ============================================================================
-- @spec [Doc-01_V8 §40.5 Hard delete at T+7 — deidentify_user RPC + cron selection]
-- WHY: deidentify_user performs an IRREVERSIBLE PII UPDATE. A mocked unit suite cannot
-- prove the load-bearing WHERE clause or the cron eligibility filter against the REAL
-- schema (real triggers, real indexes, real constraints). This seeds one deletion-eligible
-- row plus three INELIGIBLE personas (active / mid-grace / already-anonymized) and proves:
--   (A) the cron selection targets ONLY the eligible row;
--   (B) deidentify_user anonymizes EXACTLY that row and leaves every other seeded row
--       BYTE-IDENTICAL (md5(to_jsonb(row)) unchanged);
--   (C) the eligible row is genuinely de-identified (no PII remains);
--   (D) re-running deidentify_user over an already-anonymized row is a PII-safe no-op
--       (idempotent / retry-after-partial-failure safe);
--   (E) once the request is marked completed, the cron selection no longer returns it.
-- Pre-req: genesis pipeline + 20260621000000_account_deletion_lifecycle.sql applied.
-- ============================================================================
--
-- PORTABLE + PROD-SAFE + RE-RUNNABLE: the ENTIRE rehearsal is ONE self-contained DO block — no psql
-- meta-commands, no :'var' interpolation, no TEMP tables, and no reliance on a shared session or a
-- multi-statement transaction. (The Supabase SQL editor does not guarantee either across statements,
-- which is why a cross-statement TEMP-table snapshot or a BEGIN…ROLLBACK wrapper is unreliable there.)
-- A single DO block is one atomic statement: it seeds, proves (A)-(E), then DELETEs its own seed —
-- so a successful run commits ZERO residue, and ANY assertion failure RAISEs and rolls the WHOLE
-- block back (still zero residue). Re-runnable. The before/after snapshot lives in a local jsonb
-- variable; all checks are scoped to the four seeded persona IDs, so real users are never touched and
-- the result is deterministic even against a populated prod DB. Runs identically under psql/CI
-- (-v ON_ERROR_STOP=1 → an assertion RAISE exits non-zero).
-- UUIDs:  ELIGIBLE=11111111-…  ACTIVE=22222222-…  MIDGRACE=33333333-…  DONE=44444444-…

DO $$
DECLARE
  before_snapshot jsonb;
  v_ids     uuid[];
  v_changed uuid[];
  r         public.profiles%ROWTYPE;
  before_h  text;
  after_h   text;
  fn        text := 'deleted_44444444-4444-4444-4444-444444444444@deleted.lyceon.ai';
  persona   uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid];
BEGIN
  -- ---- seed: auth.users inserts fire handle_new_user -> active profiles (email derived) ----
  INSERT INTO auth.users (id, email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'eligible@example.com'),
    ('22222222-2222-2222-2222-222222222222', 'active@example.com'),
    ('33333333-3333-3333-3333-333333333333', 'midgrace@example.com'),
    ('44444444-4444-4444-4444-444444444444', 'deleted_44444444-4444-4444-4444-444444444444@deleted.lyceon.ai');

  -- persona-specific PII / deleted_at via UPDATE (rows were trigger-created above).
  -- ELIGIBLE: soft-deleted, grace already elapsed -> hard-delete eligible. Full PII.
  UPDATE public.profiles SET full_name='Ellie Eligible', display_name='Ellie', date_of_birth='2008-05-01',
         stripe_customer_id='cus_ELIGIBLE', guardian_email='guardian.eligible@example.com',
         deleted_at = now() - interval '8 days'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  -- ACTIVE: ordinary live user, no deletion request. Must be untouched.
  UPDATE public.profiles SET full_name='Andy Active', display_name='Andy', date_of_birth='2007-03-03',
         stripe_customer_id='cus_ACTIVE', guardian_email='guardian.active@example.com',
         deleted_at = NULL
   WHERE id = '22222222-2222-2222-2222-222222222222';
  -- MIDGRACE: soft-deleted but still inside the 7-day grace. Must be untouched by this run.
  UPDATE public.profiles SET full_name='Mia Midgrace', display_name='Mia', date_of_birth='2009-09-09',
         stripe_customer_id='cus_MIDGRACE', guardian_email='guardian.midgrace@example.com',
         deleted_at = now() - interval '2 days'
   WHERE id = '33333333-3333-3333-3333-333333333333';
  -- DONE: already anonymized (a prior completed deletion). Re-run must be a PII-safe no-op.
  UPDATE public.profiles SET full_name=NULL, display_name='Deleted User', date_of_birth=NULL,
         stripe_customer_id=NULL, guardian_email=NULL,
         deleted_at = now() - interval '30 days'
   WHERE id = '44444444-4444-4444-4444-444444444444';

  -- ELIGIBLE: pending, scheduled in the past -> selected by the cron.
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
  VALUES ('11111111-1111-1111-1111-111111111111', now() - interval '8 days', now() - interval '1 day',
          '11111111-1111-1111-1111-111111111111','pending','pending');
  -- MIDGRACE: pending, scheduled in the FUTURE -> NOT yet eligible.
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
  VALUES ('33333333-3333-3333-3333-333333333333', now() - interval '2 days', now() + interval '5 days',
          '33333333-3333-3333-3333-333333333333','pending','pending');
  -- DONE: already completed.
  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
  VALUES ('44444444-4444-4444-4444-444444444444', now() - interval '30 days', now() - interval '23 days',
          '44444444-4444-4444-4444-444444444444','completed','completed', now() - interval '23 days');

  -- ---- (A) CRON SELECTION targets ONLY the eligible row ----------------------------------------
  -- (mirrors execute-deletions: status='pending' AND scheduled_hard_delete_at <= now(); scoped to
  --  the seeded personas so real pending requests can't perturb the assertion.)
  SELECT array_agg(profile_id ORDER BY profile_id) INTO v_ids
    FROM public.account_deletion_requests
   WHERE status = 'pending' AND scheduled_hard_delete_at <= now()
     AND profile_id = ANY (persona);
  IF v_ids IS DISTINCT FROM ARRAY['11111111-1111-1111-1111-111111111111'::uuid] THEN
    RAISE EXCEPTION '(A) cron selection returned %, expected ONLY ELIGIBLE (active/mid-grace/completed must be excluded)', v_ids;
  END IF;
  RAISE NOTICE '(A) OK  cron selection = {ELIGIBLE} only';

  -- ---- (B)+(C) deidentify EXACTLY the eligible row; every other seeded row byte-identical -------
  -- byte identity = md5 of the full jsonb row (incl. updated_at), snapshotted into a local jsonb map.
  SELECT jsonb_object_agg(p.id::text, md5(to_jsonb(p.*)::text)) INTO before_snapshot
    FROM public.profiles p
   WHERE p.id = ANY (persona);

  PERFORM public.deidentify_user(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'deleted_11111111-1111-1111-1111-111111111111@deleted.lyceon.ai');

  SELECT array_agg(p.id ORDER BY p.id) INTO v_changed
    FROM public.profiles p
   WHERE p.id = ANY (persona)
     AND md5(to_jsonb(p.*)::text) IS DISTINCT FROM (before_snapshot ->> p.id::text);
  IF v_changed IS DISTINCT FROM ARRAY['11111111-1111-1111-1111-111111111111'::uuid] THEN
    RAISE EXCEPTION '(B) deidentify_user mutated % — expected ONLY ELIGIBLE; all other seeded rows must be byte-identical', v_changed;
  END IF;
  RAISE NOTICE '(B) OK  exactly ELIGIBLE changed; active/mid-grace/completed byte-identical';

  SELECT * INTO r FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  IF r.full_name IS NOT NULL OR r.stripe_customer_id IS NOT NULL OR r.guardian_email IS NOT NULL
     OR r.date_of_birth IS NOT NULL OR r.display_name <> 'Deleted User'
     OR r.email <> 'deleted_11111111-1111-1111-1111-111111111111@deleted.lyceon.ai' THEN
    RAISE EXCEPTION '(C) ELIGIBLE not fully de-identified: %', to_jsonb(r);
  END IF;
  -- the date_of_birth NULL must have fired profiles_set_age -> derived cols nulled
  IF r.age_years IS NOT NULL OR r.is_under_13 IS NOT NULL THEN
    RAISE EXCEPTION '(C) derived age cols not nulled by trigger after dob cleared: age_years=%, is_under_13=%', r.age_years, r.is_under_13;
  END IF;
  RAISE NOTICE '(C) OK  ELIGIBLE PII removed + derived age cols nulled by trigger';

  -- ---- (D) IDEMPOTENCY: re-running deidentify over the already-anonymized DONE row is a no-op ----
  SELECT md5(coalesce(email,'')||'|'||coalesce(full_name,'')||'|'||coalesce(display_name,'')||'|'
            ||coalesce(stripe_customer_id,'')||'|'||coalesce(guardian_email,'')||'|'||coalesce(date_of_birth::text,''))
    INTO before_h FROM public.profiles WHERE id = '44444444-4444-4444-4444-444444444444';
  PERFORM public.deidentify_user('44444444-4444-4444-4444-444444444444'::uuid, fn);
  SELECT md5(coalesce(email,'')||'|'||coalesce(full_name,'')||'|'||coalesce(display_name,'')||'|'
            ||coalesce(stripe_customer_id,'')||'|'||coalesce(guardian_email,'')||'|'||coalesce(date_of_birth::text,''))
    INTO after_h FROM public.profiles WHERE id = '44444444-4444-4444-4444-444444444444';
  IF before_h <> after_h THEN
    RAISE EXCEPTION '(D) re-running deidentify on an already-anonymized row mutated its PII (not idempotent)';
  END IF;
  RAISE NOTICE '(D) OK  re-run over already-anonymized row is a PII-safe no-op';

  -- ---- (E) RE-ENTRANCY: once the request is completed, the cron selection no longer returns it ---
  UPDATE public.account_deletion_requests
     SET status = 'completed', completion_at = now()
   WHERE profile_id = '11111111-1111-1111-1111-111111111111';

  SELECT array_agg(profile_id) INTO v_ids
    FROM public.account_deletion_requests
   WHERE status = 'pending' AND scheduled_hard_delete_at <= now()
     AND profile_id = ANY (persona);
  IF v_ids IS NOT NULL AND '11111111-1111-1111-1111-111111111111'::uuid = ANY (v_ids) THEN
    RAISE EXCEPTION '(E) completed ELIGIBLE was re-selected by the cron — a re-run would re-touch it';
  END IF;
  RAISE NOTICE '(E) OK  completed request excluded from cron re-selection';

  -- ---- self-clean: remove every seeded row (child -> parent) so a live run leaves ZERO residue ---
  DELETE FROM public.account_deletion_requests WHERE profile_id = ANY (persona);
  DELETE FROM public.profiles               WHERE id         = ANY (persona);
  DELETE FROM auth.users                    WHERE id         = ANY (persona);

  RAISE NOTICE '==> REHEARSAL PASSED: exact-target + idempotency/re-entrancy proven on real schema (no residue)';
END $$;
