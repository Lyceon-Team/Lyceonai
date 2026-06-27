-- ============================================================================
-- PR-4a.1: ROW_COUNT guard for complete_and_anonymize_account
-- ============================================================================
-- @spec [Doc-01 §40.5, Doc-05E §9] | @implemented [2026-06-27]
-- Counting honesty: the RPC must distinguish "I transitioned this request and
-- ran cascade" from "nothing to do." Without the guard, a non-pending request
-- (already processed) still calls cascade, which returns no_op — but the RPC
-- has already silently no-oped its UPDATE, making the outcome ambiguous.
-- FIX: GET DIAGNOSTICS ROW_COUNT after the pending-UPDATE. Zero rows →
-- return {status:'no_op', reason:'request not pending'} without calling cascade.
-- The RPC is now the single source of truth for its own outcome.
-- LYCEON-MIGRATION-REVIEWED

-- UP
CREATE OR REPLACE FUNCTION public.complete_and_anonymize_account(
  p_request_id  uuid,
  p_profile_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cascade_result jsonb;
  v_rows           int;
BEGIN
  UPDATE public.account_deletion_requests
     SET status        = 'completed',
         completion_at = now()
   WHERE id     = p_request_id
     AND status = 'pending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'request not pending');
  END IF;

  SELECT public.execute_account_deletion_cascade(p_profile_id, 'anonymize')
    INTO v_cascade_result;

  RETURN v_cascade_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_and_anonymize_account(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_and_anonymize_account(uuid, uuid) TO service_role;

-- DOWN (reversible per INV-06)
-- Restore the version without ROW_COUNT guard:
-- See 20260626020000_04a_atomic_complete_and_anonymize.sql
