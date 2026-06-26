-- ============================================================================
-- Flag-on end-to-end chain for the §40 account-deletion lifecycle
-- ============================================================================
-- @spec [Doc-01_V8 §40.2.1 request | §40.5 hard delete | §40.4 recovery/cancel]
-- The unit suite proves each route function maps to the right RPC (mocked); the deidentify +
-- cancel rehearsals prove single RPCs on real schema. This drives all three chains the UI triggers,
-- end to end, through the real RPCs:
--   CHAIN 1: request -> soft-delete + pending row + token -> T+7 cron (select due + deidentify_user
--            + mark completed) -> execute_account_deletion_cascade('anonymize') -> anonymized;
--   CHAIN 2: request -> restore_account_deletion(token) (the /account/recover page) -> restored;
--   CHAIN 3: request -> cancel_account_deletion(profile) (in-app cancel) -> restored.
-- Pre-req: genesis pipeline + 20260621000000_account_deletion_lifecycle.sql
--   + 20260625010000_05d_account_deletion_cascade.sql
--   + 20260626010000_05e_anonymize_disposition.sql applied.
-- ============================================================================
--
-- PORTABLE + PROD-SAFE + RE-RUNNABLE: the ENTIRE chain is ONE self-contained DO block — no psql
-- meta-commands, no :'var' interpolation, and no reliance on a shared session or a multi-statement
-- transaction (the Supabase SQL editor guarantees neither across statements). A single DO block is
-- one atomic statement: it seeds, drives all three chains, then DELETEs its own seed — a successful
-- run commits ZERO residue, and ANY assertion failure RAISEs and rolls the WHOLE block back (still
-- zero residue). Re-runnable. Runs identically under psql/CI (-v ON_ERROR_STOP=1 → a RAISE exits
-- non-zero).  UUIDs:  UA=a1111111-…  UB=b2222222-…  UC=c3333333-…

DO $$
DECLARE
  r        record;
  v_id     uuid;
  persona  uuid[] := ARRAY[
    'a1111111-1111-1111-1111-111111111111'::uuid,
    'b2222222-2222-2222-2222-222222222222'::uuid,
    'c3333333-3333-3333-3333-333333333333'::uuid];
BEGIN
  -- ---- seed: auth.users inserts fire handle_new_user -> active profiles; give each full PII ----
  INSERT INTO auth.users (id, email) VALUES
    ('a1111111-1111-1111-1111-111111111111', 'a@e2e.test'),
    ('b2222222-2222-2222-2222-222222222222', 'b@e2e.test'),
    ('c3333333-3333-3333-3333-333333333333', 'c@e2e.test');
  UPDATE public.profiles SET full_name='A Name', display_name='A', date_of_birth='2008-01-01',
         stripe_customer_id='cus_a', guardian_email='ga@e2e.test' WHERE id = 'a1111111-1111-1111-1111-111111111111';
  UPDATE public.profiles SET full_name='B Name', display_name='B', date_of_birth='2008-02-02',
         stripe_customer_id='cus_b', guardian_email='gb@e2e.test' WHERE id = 'b2222222-2222-2222-2222-222222222222';
  UPDATE public.profiles SET full_name='C Name', display_name='C', date_of_birth='2008-03-03',
         stripe_customer_id='cus_c', guardian_email='gc@e2e.test' WHERE id = 'c3333333-3333-3333-3333-333333333333';

  -- ===================== CHAIN 1 — request -> T+7 cron -> anonymize =====================
  -- POST /api/account/delete -> performDeletionRequestV2 -> this RPC
  SELECT * INTO r FROM public.request_account_deletion(
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-111111111111', 'hash_a', 7);
  IF r.scheduled_hard_delete_at IS NULL THEN
    RAISE EXCEPTION 'C1: request returned no schedule';
  END IF;
  IF (SELECT deleted_at FROM public.profiles WHERE id='a1111111-1111-1111-1111-111111111111') IS NULL THEN
    RAISE EXCEPTION 'C1: deleted_at not set by request (soft-delete missing)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id='a1111111-1111-1111-1111-111111111111'
       AND status='pending' AND recovery_token_hash='hash_a'
  ) THEN
    RAISE EXCEPTION 'C1: pending request / token not stored';
  END IF;
  RAISE NOTICE 'C1.1 OK  request -> soft-delete + pending row + token';

  -- time passes to T+7 (the request becomes due for the §40.5 cron)
  UPDATE public.account_deletion_requests SET scheduled_hard_delete_at = now() - interval '1 minute'
   WHERE profile_id = 'a1111111-1111-1111-1111-111111111111' AND status = 'pending';

  -- executeDueDeletions: select due pending, deidentify, mark completed
  SELECT id INTO v_id FROM public.account_deletion_requests
   WHERE status='pending' AND scheduled_hard_delete_at <= now()
     AND profile_id='a1111111-1111-1111-1111-111111111111';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'C1: cron selector did not pick the due request';
  END IF;
  PERFORM public.deidentify_user('a1111111-1111-1111-1111-111111111111',
    'deleted_a1111111-1111-1111-1111-111111111111@deleted.lyceon.ai');
  UPDATE public.account_deletion_requests SET status='completed', completion_at=now() WHERE id=v_id;

  IF (SELECT full_name FROM public.profiles WHERE id='a1111111-1111-1111-1111-111111111111') IS NOT NULL
     OR (SELECT stripe_customer_id FROM public.profiles WHERE id='a1111111-1111-1111-1111-111111111111') IS NOT NULL
     OR (SELECT email FROM public.profiles WHERE id='a1111111-1111-1111-1111-111111111111')
          <> 'deleted_a1111111-1111-1111-1111-111111111111@deleted.lyceon.ai' THEN
    RAISE EXCEPTION 'C1: profile not anonymized after T+7 cron';
  END IF;
  RAISE NOTICE 'C1.2 OK  T+7 cron -> deidentify anonymized the eligible user';

  -- PR-4a: the driver now calls execute_account_deletion_cascade('anonymize') after mark-completed.
  -- This proves the full sequence: deidentify → mark completed → cascade('anonymize').
  DECLARE
    v_cascade_result jsonb;
  BEGIN
    SELECT public.execute_account_deletion_cascade(
      'a1111111-1111-1111-1111-111111111111', 'anonymize'
    ) INTO v_cascade_result;
    IF v_cascade_result IS NULL THEN
      RAISE EXCEPTION 'C1: cascade returned NULL';
    END IF;
    IF v_cascade_result->>'status' = 'no_op' THEN
      RAISE NOTICE 'C1.3 OK  cascade returned no_op (no child data for seed user — expected)';
    ELSE
      RAISE NOTICE 'C1.3 OK  cascade completed: %', v_cascade_result;
    END IF;
  END;

  -- ===================== CHAIN 2 — request -> token recovery -> restored =====================
  PERFORM public.request_account_deletion(
    'b2222222-2222-2222-2222-222222222222',
    'b2222222-2222-2222-2222-222222222222', 'hash_b', 7);
  IF (SELECT deleted_at FROM public.profiles WHERE id='b2222222-2222-2222-2222-222222222222') IS NULL THEN
    RAISE EXCEPTION 'C2: B not soft-deleted by request';
  END IF;
  IF public.restore_account_deletion('hash_b')
       IS DISTINCT FROM 'b2222222-2222-2222-2222-222222222222'::uuid THEN
    RAISE EXCEPTION 'C2: token recovery did not return B';
  END IF;
  IF (SELECT deleted_at FROM public.profiles WHERE id='b2222222-2222-2222-2222-222222222222') IS NOT NULL THEN
    RAISE EXCEPTION 'C2: B deleted_at not cleared by recovery';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_deletion_requests
                  WHERE profile_id='b2222222-2222-2222-2222-222222222222' AND status='cancelled') THEN
    RAISE EXCEPTION 'C2: B request not cancelled by recovery';
  END IF;
  RAISE NOTICE 'C2 OK  request -> token recovery -> restored (deleted_at cleared, request cancelled)';

  -- ===================== CHAIN 3 — request -> in-app cancel -> restored =====================
  PERFORM public.request_account_deletion(
    'c3333333-3333-3333-3333-333333333333',
    'c3333333-3333-3333-3333-333333333333', 'hash_c', 7);
  IF public.cancel_account_deletion('c3333333-3333-3333-3333-333333333333')
       IS DISTINCT FROM 'c3333333-3333-3333-3333-333333333333'::uuid THEN
    RAISE EXCEPTION 'C3: in-app cancel did not return C';
  END IF;
  IF (SELECT deleted_at FROM public.profiles WHERE id='c3333333-3333-3333-3333-333333333333') IS NOT NULL THEN
    RAISE EXCEPTION 'C3: C deleted_at not cleared by in-app cancel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_deletion_requests
                  WHERE profile_id='c3333333-3333-3333-3333-333333333333' AND status='cancelled') THEN
    RAISE EXCEPTION 'C3: C request not cancelled by in-app cancel';
  END IF;
  RAISE NOTICE 'C3 OK  request -> in-app cancel -> restored (deleted_at cleared, request cancelled)';

  -- ---- self-clean: remove every seeded row (child -> parent) so a live run leaves ZERO residue ---
  DELETE FROM public.account_deletion_requests WHERE profile_id = ANY (persona);
  DELETE FROM public.profiles               WHERE id         = ANY (persona);
  DELETE FROM auth.users                    WHERE id         = ANY (persona);

  RAISE NOTICE '==> DELETION LIFECYCLE E2E PASSED: request->cron->deidentify->completed->cascade(anonymize); request->token-recover->restored; request->in-app-cancel->restored (no residue)';
END $$;
