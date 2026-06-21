-- ============================================================================
-- Destructive-path rehearsal for the §40.5 hard-delete RPC + §40.5 cron selection
-- ============================================================================
-- @spec [Doc-01_V8 §40.5 Hard delete at T+7 — deidentify_user RPC + cron selection]
-- WHY: deidentify_user performs an IRREVERSIBLE PII UPDATE. A mocked unit suite cannot
-- prove the load-bearing WHERE clause or the cron eligibility filter against the REAL
-- schema (real triggers, real indexes, real constraints). This script seeds one
-- deletion-eligible row plus three INELIGIBLE personas (active / mid-grace / already-
-- anonymized) and proves, on a throwaway DB:
--   (A) the cron selection targets ONLY the eligible row;
--   (B) deidentify_user anonymizes EXACTLY that row and leaves every other row
--       BYTE-IDENTICAL (md5(to_jsonb(row)) unchanged);
--   (C) the eligible row is genuinely de-identified (no PII remains);
--   (D) re-running deidentify_user over an already-anonymized row is a PII-safe no-op
--       (idempotent / retry-after-partial-failure safe);
--   (E) once the request is marked completed, the cron selection no longer returns it
--       (cron double-run cannot re-touch or strand the batch).
-- Any assertion failure RAISEs (psql -v ON_ERROR_STOP=1 => non-zero exit).
-- Pre-req: genesis pipeline + 20260621000000_account_deletion_lifecycle.sql applied.
-- ============================================================================

-- NOTE: portable + prod-safe + re-runnable — no psql meta-commands (\set/\echo) or :'var'
-- interpolation, so it runs as-is through the Supabase SQL editor / any libpq connection AND under
-- the CI runner (which also passes psql -v ON_ERROR_STOP=1). The ENTIRE rehearsal runs in one
-- transaction that ROLLBACKs at the end: it seeds, proves (A)-(E), then leaves ZERO residue — safe
-- to run against a live DB and re-runnable. An assertion failure RAISEs (the editor shows the error;
-- CI's -v ON_ERROR_STOP=1 exits non-zero). UUIDs are inlined below:
--   ELIGIBLE=11111111-… ACTIVE=22222222-… MIDGRACE=33333333-… DONE=44444444-…

BEGIN;

-- ---- auth.users backing rows (profiles.id FK -> auth.users) -----------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111','eligible@example.com'),
  ('22222222-2222-2222-2222-222222222222',  'active@example.com'),
  ('33333333-3333-3333-3333-333333333333','midgrace@example.com'),
  ('44444444-4444-4444-4444-444444444444',    'deleted_44444444-4444-4444-4444-444444444444@deleted.lyceon.ai');

-- ---- profiles ---------------------------------------------------------------
-- Rows were auto-created by the handle_new_user trigger on the auth.users insert
-- above (role=student, email/display_name derived). Set persona-specific PII /
-- deleted_at here via UPDATE.
-- ELIGIBLE: soft-deleted in grace, grace already elapsed -> hard-delete eligible. Full PII.
UPDATE profiles SET full_name='Ellie Eligible', display_name='Ellie', date_of_birth='2008-05-01',
       stripe_customer_id='cus_ELIGIBLE', guardian_email='guardian.eligible@example.com',
       deleted_at = now() - interval '8 days'
 WHERE id = '11111111-1111-1111-1111-111111111111';
-- ACTIVE: ordinary live user, no deletion request. Must be untouched.
UPDATE profiles SET full_name='Andy Active', display_name='Andy', date_of_birth='2007-03-03',
       stripe_customer_id='cus_ACTIVE', guardian_email='guardian.active@example.com',
       deleted_at = NULL
 WHERE id = '22222222-2222-2222-2222-222222222222';
-- MIDGRACE: soft-deleted but still inside the 7-day grace. Must be untouched by this run.
UPDATE profiles SET full_name='Mia Midgrace', display_name='Mia', date_of_birth='2009-09-09',
       stripe_customer_id='cus_MIDGRACE', guardian_email='guardian.midgrace@example.com',
       deleted_at = now() - interval '2 days'
 WHERE id = '33333333-3333-3333-3333-333333333333';
-- DONE: already anonymized (a prior completed deletion). email is already the deleted_<id>
-- form (from auth.users). Re-run must be a PII-safe no-op.
UPDATE profiles SET full_name=NULL, display_name='Deleted User', date_of_birth=NULL,
       stripe_customer_id=NULL, guardian_email=NULL,
       deleted_at = now() - interval '30 days'
 WHERE id = '44444444-4444-4444-4444-444444444444';

-- ---- account_deletion_requests ---------------------------------------------
-- ELIGIBLE: pending, scheduled in the past -> selected by the cron.
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES ('11111111-1111-1111-1111-111111111111', now() - interval '8 days', now() - interval '1 day', '11111111-1111-1111-1111-111111111111','pending','pending');
-- MIDGRACE: pending, scheduled in the FUTURE -> NOT yet eligible.
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES ('33333333-3333-3333-3333-333333333333', now() - interval '2 days', now() + interval '5 days', '33333333-3333-3333-3333-333333333333','pending','pending');
-- DONE: already completed.
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status, completion_at)
VALUES ('44444444-4444-4444-4444-444444444444', now() - interval '30 days', now() - interval '23 days', '44444444-4444-4444-4444-444444444444','completed','completed', now() - interval '23 days');

-- (no COMMIT — the whole script is one transaction; the trailing ROLLBACK discards every seeded
-- row + every mutation below, so a live-DB run leaves zero residue and is re-runnable.)

-- ============================================================================
-- (A) CRON SELECTION targets ONLY the eligible row
--     (mirrors execute-deletions: status='pending' AND scheduled_hard_delete_at <= now())
-- ============================================================================
DO $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(profile_id ORDER BY profile_id) INTO v_ids
    FROM account_deletion_requests
   WHERE status = 'pending' AND scheduled_hard_delete_at <= now();
  IF v_ids IS DISTINCT FROM ARRAY['11111111-1111-1111-1111-111111111111'::uuid] THEN
    RAISE EXCEPTION '(A) cron selection returned %, expected ONLY ELIGIBLE (active/mid-grace/completed must be excluded)', v_ids;
  END IF;
  RAISE NOTICE '(A) OK  cron selection = {ELIGIBLE} only';
END $$;

-- snapshot every profile row (byte identity = md5 of the full jsonb row, incl. updated_at)
CREATE TEMP TABLE snap_before AS SELECT id, md5(to_jsonb(p.*)::text) AS h FROM profiles p;

-- ============================================================================
-- (B)+(C) deidentify EXACTLY the eligible row; every other row byte-identical
-- ============================================================================
SELECT public.deidentify_user(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'deleted_11111111-1111-1111-1111-111111111111@deleted.lyceon.ai');

DO $$
DECLARE v_changed uuid[];
BEGIN
  SELECT array_agg(p.id ORDER BY p.id) INTO v_changed
    FROM profiles p JOIN snap_before s ON s.id = p.id
   WHERE md5(to_jsonb(p.*)::text) <> s.h;
  IF v_changed IS DISTINCT FROM ARRAY['11111111-1111-1111-1111-111111111111'::uuid] THEN
    RAISE EXCEPTION '(B) deidentify_user mutated % — expected ONLY ELIGIBLE; all other rows must be byte-identical', v_changed;
  END IF;
  RAISE NOTICE '(B) OK  exactly ELIGIBLE changed; active/mid-grace/completed byte-identical';
END $$;

DO $$
DECLARE r public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM profiles WHERE id = '11111111-1111-1111-1111-111111111111';
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
END $$;

-- ============================================================================
-- (D) IDEMPOTENCY: re-running deidentify over the already-anonymized DONE row
--     leaves its PII columns unchanged (retry / cron double-run safe)
-- ============================================================================
DO $$
DECLARE before_h text; after_h text;
  fn text := 'deleted_44444444-4444-4444-4444-444444444444@deleted.lyceon.ai';
BEGIN
  SELECT md5(coalesce(email,'')||'|'||coalesce(full_name,'')||'|'||coalesce(display_name,'')||'|'
            ||coalesce(stripe_customer_id,'')||'|'||coalesce(guardian_email,'')||'|'||coalesce(date_of_birth::text,''))
    INTO before_h FROM profiles WHERE id = '44444444-4444-4444-4444-444444444444';
  PERFORM public.deidentify_user('44444444-4444-4444-4444-444444444444'::uuid, fn);
  SELECT md5(coalesce(email,'')||'|'||coalesce(full_name,'')||'|'||coalesce(display_name,'')||'|'
            ||coalesce(stripe_customer_id,'')||'|'||coalesce(guardian_email,'')||'|'||coalesce(date_of_birth::text,''))
    INTO after_h FROM profiles WHERE id = '44444444-4444-4444-4444-444444444444';
  IF before_h <> after_h THEN
    RAISE EXCEPTION '(D) re-running deidentify on an already-anonymized row mutated its PII (not idempotent)';
  END IF;
  RAISE NOTICE '(D) OK  re-run over already-anonymized row is a PII-safe no-op';
END $$;

-- ============================================================================
-- (E) RE-ENTRANCY: once the cron marks the request completed, the selection
--     must no longer return it (a second cron run cannot re-touch / strand it)
-- ============================================================================
UPDATE account_deletion_requests
   SET status = 'completed', completion_at = now()
 WHERE profile_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(profile_id) INTO v_ids
    FROM account_deletion_requests
   WHERE status = 'pending' AND scheduled_hard_delete_at <= now();
  IF v_ids IS NOT NULL AND '11111111-1111-1111-1111-111111111111'::uuid = ANY (v_ids) THEN
    RAISE EXCEPTION '(E) completed ELIGIBLE was re-selected by the cron — a re-run would re-touch it';
  END IF;
  RAISE NOTICE '(E) OK  completed request excluded from cron re-selection';
END $$;

DO $$ BEGIN
  RAISE NOTICE '==> REHEARSAL PASSED: exact-target + idempotency/re-entrancy proven on real schema';
END $$;

-- Discard the whole rehearsal (seed + the deidentify mutation): leaves no residue, re-runnable.
ROLLBACK;
