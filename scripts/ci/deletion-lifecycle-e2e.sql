-- ============================================================================
-- Flag-on end-to-end chain for the §40 account-deletion lifecycle
-- ============================================================================
-- @spec [Doc-01_V8 §40.2.1 request | §40.5 hard delete | §40.4 recovery/cancel]
-- The unit suite proves each route function maps to the right RPC (mocked); the deidentify +
-- cancel rehearsals prove single RPCs on real schema. NOTHING yet proves the RPCs COMPOSE into the
-- whole lifecycle with the staged migration applied (the "flag-on" path — the RPCs only exist once
-- the migration is applied, which the flag gates). This drives all three chains the UI triggers,
-- end to end, through the real RPCs:
--   CHAIN 1: request (POST /api/account/delete) -> soft-delete + pending row + token
--            -> T+7 cron (select due + deidentify_user + mark completed) -> anonymized;
--   CHAIN 2: request -> restore_account_deletion(token) (the /account/recover page) -> restored;
--   CHAIN 3: request -> cancel_account_deletion(profile) (in-app cancel) -> restored.
-- Any assertion failure RAISEs (psql -v ON_ERROR_STOP=1 => non-zero exit).
-- Pre-req: genesis pipeline + 20260621000000_account_deletion_lifecycle.sql applied.
-- ============================================================================

\set ON_ERROR_STOP on
\set UA 'a1111111-1111-1111-1111-111111111111'
\set UB 'b2222222-2222-2222-2222-222222222222'
\set UC 'c3333333-3333-3333-3333-333333333333'

BEGIN;
-- auth.users inserts fire handle_new_user -> active profiles; give each full PII.
INSERT INTO auth.users (id, email) VALUES
  (:'UA', 'a@e2e.test'), (:'UB', 'b@e2e.test'), (:'UC', 'c@e2e.test');
UPDATE profiles SET full_name='A Name', display_name='A', date_of_birth='2008-01-01',
       stripe_customer_id='cus_a', guardian_email='ga@e2e.test' WHERE id = :'UA';
UPDATE profiles SET full_name='B Name', display_name='B', date_of_birth='2008-02-02',
       stripe_customer_id='cus_b', guardian_email='gb@e2e.test' WHERE id = :'UB';
UPDATE profiles SET full_name='C Name', display_name='C', date_of_birth='2008-03-03',
       stripe_customer_id='cus_c', guardian_email='gc@e2e.test' WHERE id = :'UC';
COMMIT;

-- ============================================================================
-- CHAIN 1 — request -> T+7 cron -> anonymize
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  -- POST /api/account/delete -> performDeletionRequestV2 -> this RPC
  SELECT * INTO r FROM public.request_account_deletion(
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-111111111111', 'hash_a', 7);
  IF r.scheduled_hard_delete_at IS NULL THEN
    RAISE EXCEPTION 'C1: request returned no schedule';
  END IF;
  IF (SELECT deleted_at FROM profiles WHERE id='a1111111-1111-1111-1111-111111111111') IS NULL THEN
    RAISE EXCEPTION 'C1: deleted_at not set by request (soft-delete missing)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM account_deletion_requests
     WHERE profile_id='a1111111-1111-1111-1111-111111111111'
       AND status='pending' AND recovery_token_hash='hash_a'
  ) THEN
    RAISE EXCEPTION 'C1: pending request / token not stored';
  END IF;
  RAISE NOTICE 'C1.1 OK  request -> soft-delete + pending row + token';
END $$;

-- time passes to T+7 (the request becomes due for the §40.5 cron)
UPDATE account_deletion_requests SET scheduled_hard_delete_at = now() - interval '1 minute'
 WHERE profile_id = :'UA' AND status = 'pending';

DO $$
DECLARE v_id uuid;
BEGIN
  -- executeDueDeletions: select due pending, deidentify, mark completed
  SELECT id INTO v_id FROM account_deletion_requests
   WHERE status='pending' AND scheduled_hard_delete_at <= now()
     AND profile_id='a1111111-1111-1111-1111-111111111111';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'C1: cron selector did not pick the due request';
  END IF;
  PERFORM public.deidentify_user('a1111111-1111-1111-1111-111111111111',
    'deleted_a1111111-1111-1111-1111-111111111111@deleted.lyceon.ai');
  UPDATE account_deletion_requests SET status='completed', completion_at=now() WHERE id=v_id;

  IF (SELECT full_name FROM profiles WHERE id='a1111111-1111-1111-1111-111111111111') IS NOT NULL
     OR (SELECT stripe_customer_id FROM profiles WHERE id='a1111111-1111-1111-1111-111111111111') IS NOT NULL
     OR (SELECT email FROM profiles WHERE id='a1111111-1111-1111-1111-111111111111')
          <> 'deleted_a1111111-1111-1111-1111-111111111111@deleted.lyceon.ai' THEN
    RAISE EXCEPTION 'C1: profile not anonymized after T+7 cron';
  END IF;
  RAISE NOTICE 'C1.2 OK  T+7 cron -> deidentify anonymized the eligible user';
END $$;

-- ============================================================================
-- CHAIN 2 — request -> token recovery (/account/recover) -> restored
-- ============================================================================
DO $$
BEGIN
  PERFORM public.request_account_deletion(
    'b2222222-2222-2222-2222-222222222222',
    'b2222222-2222-2222-2222-222222222222', 'hash_b', 7);
  IF (SELECT deleted_at FROM profiles WHERE id='b2222222-2222-2222-2222-222222222222') IS NULL THEN
    RAISE EXCEPTION 'C2: B not soft-deleted by request';
  END IF;
  IF public.restore_account_deletion('hash_b')
       IS DISTINCT FROM 'b2222222-2222-2222-2222-222222222222'::uuid THEN
    RAISE EXCEPTION 'C2: token recovery did not return B';
  END IF;
  IF (SELECT deleted_at FROM profiles WHERE id='b2222222-2222-2222-2222-222222222222') IS NOT NULL THEN
    RAISE EXCEPTION 'C2: B deleted_at not cleared by recovery';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account_deletion_requests
                  WHERE profile_id='b2222222-2222-2222-2222-222222222222' AND status='cancelled') THEN
    RAISE EXCEPTION 'C2: B request not cancelled by recovery';
  END IF;
  RAISE NOTICE 'C2 OK  request -> token recovery -> restored (deleted_at cleared, request cancelled)';
END $$;

-- ============================================================================
-- CHAIN 3 — request -> in-app cancel (cancel_account_deletion) -> restored
-- ============================================================================
DO $$
BEGIN
  PERFORM public.request_account_deletion(
    'c3333333-3333-3333-3333-333333333333',
    'c3333333-3333-3333-3333-333333333333', 'hash_c', 7);
  IF public.cancel_account_deletion('c3333333-3333-3333-3333-333333333333')
       IS DISTINCT FROM 'c3333333-3333-3333-3333-333333333333'::uuid THEN
    RAISE EXCEPTION 'C3: in-app cancel did not return C';
  END IF;
  IF (SELECT deleted_at FROM profiles WHERE id='c3333333-3333-3333-3333-333333333333') IS NOT NULL THEN
    RAISE EXCEPTION 'C3: C deleted_at not cleared by in-app cancel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account_deletion_requests
                  WHERE profile_id='c3333333-3333-3333-3333-333333333333' AND status='cancelled') THEN
    RAISE EXCEPTION 'C3: C request not cancelled by in-app cancel';
  END IF;
  RAISE NOTICE 'C3 OK  request -> in-app cancel -> restored (deleted_at cleared, request cancelled)';
END $$;

\echo '==> DELETION LIFECYCLE E2E PASSED: request->cron->anonymize; request->token-recover->restored; request->in-app-cancel->restored'
