-- ============================================================================
-- PR-4a Item 1: Atomic mark-completed + anonymize cascade RPC
-- ============================================================================
-- @spec [Doc-01 §40.5, Doc-05E §8 step 5 + §9] | @implemented [2026-06-26]
-- Codex REJECT Item 1: mark-completed (step 4) and cascade (step 5) were separate
-- Supabase calls. If cascade failed after mark-completed committed, the row was
-- stranded 'completed' with un-anonymized data and the cron (selects 'pending'
-- only) would NEVER retry — silent permanent failure.
-- FIX: this RPC does mark-completed → cascade('anonymize') in ONE transaction.
-- If cascade RAISEs, the status update rolls back with it → row stays 'pending'
-- → retried next cron. Hardcodes 'anonymize' internally (anonymize-by-construction
-- preserved — no mode parameter exposed).
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
BEGIN
  -- Mark completed — unlocks cascade's status guard (requires 'completed').
  -- Both this UPDATE and the cascade below run in the same implicit transaction.
  -- If cascade RAISEs, this UPDATE rolls back → row stays 'pending' → retryable.
  UPDATE public.account_deletion_requests
     SET status        = 'completed',
         completion_at = now()
   WHERE id     = p_request_id
     AND status = 'pending';

  -- Cascade with hardcoded 'anonymize' — no mode parameter, no DEFAULT trap.
  SELECT public.execute_account_deletion_cascade(p_profile_id, 'anonymize')
    INTO v_cascade_result;

  RETURN v_cascade_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_and_anonymize_account(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_and_anonymize_account(uuid, uuid) TO service_role;

-- DOWN (reversible per INV-06)
-- DROP FUNCTION IF EXISTS public.complete_and_anonymize_account(uuid, uuid);
