-- ============================================================================
-- Atomicity rehearsal for the §40.4 in-app cancel RPC (cancel_account_deletion)
-- ============================================================================
-- @spec [Doc-01_V8 §40.4 recovery during grace — in-app cancel]
-- WHY: in-app cancel must clear profiles.deleted_at AND cancel the pending request as ONE
-- transaction. The strand the §40.3 lock exists to prevent is "request cancelled but lock
-- remains" — a user with no pending request yet still soft-locked, unreachable by in-app cancel
-- (needs pending) OR token recovery (needs pending). A mocked unit suite cannot prove a DB
-- transaction rolls back. This seeds, against the REAL schema (real idx_profiles_email_active),
-- and proves:
--   (1) happy path — clear + cancel applied atomically;
--   (2) LOAD-BEARING — when clearing deleted_at collides with a reclaimed email (23505), BOTH
--       writes roll back: the request stays 'pending' and deleted_at stays set (no strand);
--   (3) no pending request → NULL (route maps to 404).
-- Pre-req: genesis pipeline + 20260621000000_account_deletion_lifecycle.sql applied.
-- ============================================================================
--
-- PORTABLE + PROD-SAFE + RE-RUNNABLE: no psql meta-commands (\set/\echo) or :'var' interpolation,
-- so it runs as-is through the Supabase SQL editor / any libpq connection AND under the CI runner
-- (which also passes psql -v ON_ERROR_STOP=1). The ENTIRE rehearsal runs in one transaction that
-- ROLLBACKs at the end: it seeds, proves the three properties, then leaves ZERO residue — so it is
-- safe to run against a live DB and can be re-run without colliding with its own prior seed. An
-- assertion failure RAISEs (the editor shows the error; CI's -v ON_ERROR_STOP=1 exits non-zero).
-- UUIDs are inlined:  HAPPY=55555555-…  RECLAIM=66666666-…  COLLIDER=77777777-…  NOPENDING=88888888-…
--
-- REAL-SCHEMA NOTE: auth.users enforces email uniqueness (Supabase users_email_partial_key), so two
-- auth users CANNOT share an email. The email-reclaim collision is therefore staged at the PROFILES
-- level (idx_profiles_email_active = unique(lower(email)) WHERE deleted_at IS NULL) — exactly where
-- cancel_account_deletion's "clear deleted_at" collides: RECLAIM holds dup@ then is soft-deleted
-- (freeing the active partial index), and COLLIDER — a DISTINCT auth user — has its PROFILE email
-- moved onto dup@, becoming the active holder. Clearing RECLAIM's deleted_at then re-collides.

BEGIN;

-- auth.users inserts fire the handle_new_user trigger → active profiles (email from auth.users).
INSERT INTO auth.users (id, email) VALUES
  ('55555555-5555-5555-5555-555555555555', 'happy@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'dup@example.com'),
  ('88888888-8888-8888-8888-888888888888', 'nopending@example.com');

-- HAPPY: soft-deleted, in grace, pending request.
UPDATE profiles SET deleted_at = now() - interval '1 day' WHERE id = '55555555-5555-5555-5555-555555555555';
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES ('55555555-5555-5555-5555-555555555555', now() - interval '1 day', now() + interval '6 days', '55555555-5555-5555-5555-555555555555', 'pending', 'pending');

-- RECLAIM: soft-deleted FIRST (frees dup@ from the active partial index), pending request.
UPDATE profiles SET deleted_at = now() - interval '1 day' WHERE id = '66666666-6666-6666-6666-666666666666';
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES ('66666666-6666-6666-6666-666666666666', now() - interval '1 day', now() + interval '6 days', '66666666-6666-6666-6666-666666666666', 'pending', 'pending');
-- COLLIDER is a DISTINCT auth user (own unique email — real auth.users forbids a 2nd dup@ row). With
-- RECLAIM soft-deleted, move COLLIDER's PROFILE email onto dup@ → now the active holder of dup@.
INSERT INTO auth.users (id, email) VALUES ('77777777-7777-7777-7777-777777777777', 'collider@example.com');
UPDATE profiles SET email = 'dup@example.com' WHERE id = '77777777-7777-7777-7777-777777777777';

-- NOPENDING: already-resolved request (no pending row).
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES ('88888888-8888-8888-8888-888888888888', now() - interval '2 days', now() + interval '5 days', '88888888-8888-8888-8888-888888888888', 'cancelled', 'cancelled_by_recovery');

-- ============================================================================
-- (1) HAPPY: clear deleted_at + cancel request, atomically.
-- ============================================================================
DO $$
DECLARE v_ret uuid;
BEGIN
  SELECT public.cancel_account_deletion('55555555-5555-5555-5555-555555555555') INTO v_ret;
  IF v_ret IS DISTINCT FROM '55555555-5555-5555-5555-555555555555'::uuid THEN
    RAISE EXCEPTION '(1) happy cancel returned %, expected HAPPY id', v_ret;
  END IF;
  IF (SELECT deleted_at FROM profiles WHERE id = '55555555-5555-5555-5555-555555555555') IS NOT NULL THEN
    RAISE EXCEPTION '(1) HAPPY deleted_at not cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM account_deletion_requests
     WHERE profile_id = '55555555-5555-5555-5555-555555555555'
       AND status = 'cancelled' AND stripe_cancellation_status = 'cancelled_by_recovery'
  ) THEN
    RAISE EXCEPTION '(1) HAPPY request not cancelled / stripe not marked';
  END IF;
  RAISE NOTICE '(1) OK  happy cancel: deleted_at cleared + request cancelled atomically';
END $$;

-- ============================================================================
-- (2) LOAD-BEARING — email-reclaim collision rolls BOTH writes back (no strand).
-- ============================================================================
DO $$
BEGIN
  BEGIN
    PERFORM public.cancel_account_deletion('66666666-6666-6666-6666-666666666666');
    RAISE EXCEPTION '(2) expected a unique_violation (reclaimed email) but cancel succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- expected: clearing deleted_at collides with the reclaimed active email
  END;
  -- NEITHER write may persist:
  IF NOT EXISTS (
    SELECT 1 FROM account_deletion_requests
     WHERE profile_id = '66666666-6666-6666-6666-666666666666' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION '(2) STRAND: request not left pending after a rolled-back cancel';
  END IF;
  IF (SELECT deleted_at FROM profiles WHERE id = '66666666-6666-6666-6666-666666666666') IS NULL THEN
    RAISE EXCEPTION '(2) STRAND: deleted_at cleared despite the rolled-back cancel';
  END IF;
  RAISE NOTICE '(2) OK  email-reclaim collision rolled BOTH back — user stays cleanly pending (no strand)';
END $$;

-- ============================================================================
-- (3) No pending request → NULL (caller maps to 404).
-- ============================================================================
DO $$
DECLARE v_ret uuid;
BEGIN
  SELECT public.cancel_account_deletion('88888888-8888-8888-8888-888888888888') INTO v_ret;
  IF v_ret IS NOT NULL THEN
    RAISE EXCEPTION '(3) expected NULL for no-pending-request, got %', v_ret;
  END IF;
  RAISE NOTICE '(3) OK  no pending request → NULL (route → 404)';
END $$;

DO $$ BEGIN
  RAISE NOTICE '==> CANCEL ATOMICITY PASSED: clear+cancel atomic; email-reclaim rolls both back; no-pending → NULL';
END $$;

-- Roll the whole rehearsal back: every seeded row + every mutation is discarded, so this leaves no
-- residue in a live DB and can be re-run. (CI runs on a throwaway DB, so rollback vs commit is moot
-- there; the assertions above are the gate.)
ROLLBACK;
