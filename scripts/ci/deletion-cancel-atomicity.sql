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
-- Any assertion failure RAISEs (psql -v ON_ERROR_STOP=1 => non-zero exit).
-- Pre-req: genesis pipeline + 20260621000000_account_deletion_lifecycle.sql applied.
-- ============================================================================

\set ON_ERROR_STOP on
\set HAPPY     '55555555-5555-5555-5555-555555555555'
\set RECLAIM   '66666666-6666-6666-6666-666666666666'
\set COLLIDER  '77777777-7777-7777-7777-777777777777'
\set NOPENDING '88888888-8888-8888-8888-888888888888'

BEGIN;

-- auth.users inserts fire the handle_new_user trigger → active profiles (email from auth.users).
INSERT INTO auth.users (id, email) VALUES
  (:'HAPPY',    'happy@example.com'),
  (:'RECLAIM',  'dup@example.com'),
  (:'NOPENDING','nopending@example.com');

-- HAPPY: soft-deleted, in grace, pending request.
UPDATE profiles SET deleted_at = now() - interval '1 day' WHERE id = :'HAPPY';
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES (:'HAPPY', now() - interval '1 day', now() + interval '6 days', :'HAPPY', 'pending', 'pending');

-- RECLAIM: soft-deleted FIRST (frees its email from the partial unique index), pending request.
UPDATE profiles SET deleted_at = now() - interval '1 day' WHERE id = :'RECLAIM';
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES (:'RECLAIM', now() - interval '1 day', now() + interval '6 days', :'RECLAIM', 'pending', 'pending');
-- COLLIDER then registers with RECLAIM's freed email → now the active holder of dup@example.com.
INSERT INTO auth.users (id, email) VALUES (:'COLLIDER', 'dup@example.com');

-- NOPENDING: already-resolved request (no pending row).
INSERT INTO account_deletion_requests
  (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status, stripe_cancellation_status)
VALUES (:'NOPENDING', now() - interval '2 days', now() + interval '5 days', :'NOPENDING', 'cancelled', 'cancelled_by_recovery');

COMMIT;

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

\echo '==> CANCEL ATOMICITY PASSED: clear+cancel atomic; email-reclaim rolls both back; no-pending → NULL'
