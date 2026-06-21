-- ============================================================================
-- account deletion lifecycle — §40.5 hard-delete RPC + §40.2.1/§40.3/§40.4
-- soft-delete + token recovery  (READY-TO-APPLY; OWNER-RUN; consuming code is
-- flag-gated OFF until this is applied — see ACCOUNT_DELETION_LIFECYCLE_V2)
-- ============================================================================
-- @spec [Doc-01_V8 §40 Account deletion lifecycle: §40.2.1 request flow, §40.3 soft-delete
--   state behavior, §40.4 recovery during grace, §40.5 hard delete at T+7]
-- @implemented [2026-06-21]
-- plain English: the deletion lifecycle has been only PARTIALLY live. PR #403 fixed the
--   self-serve /delete INSERT (canonical schedule + actor) and pointed the cron at
--   scheduled_hard_delete_at <= now(). But:
--     (1) the cron calls deidentify_user(...) — a function that DID NOT EXIST anywhere in
--         supabase/ (genesis or migrations), so the T+7 hard-delete erased nothing and the
--         request stuck at status='pending' (GAP-HY-15: erasure never completed).
--     (2) §40.2.1/§40.3/§40.4 soft-delete-lock + email-link recovery were unbuilt.
--   This migration ships the DB half of the completion, owner-applied, with a reversible DOWN.
--
-- WHY migrations-pending/ (owner-run): same discipline as 20260617000000_notification_outbox.sql
--   and 20260617130000_guardian_linked_emit.sql — CI fresh-apply + genesis-schema.expected.sql
--   snapshot scope to supabase/migrations/*.sql only, so staging here keeps those gates green/
--   un-drifted until deliberate activation. To activate:
--     1. git mv supabase/migrations-pending/20260621000000_account_deletion_lifecycle.sql supabase/migrations/
--     2. regenerate scripts/ci/genesis-schema.expected.sql from the fresh-apply harness
--     3. apply to the Supabase project
--     4. set ACCOUNT_DELETION_LIFECYCLE_V2=true so the consuming server code goes live atomically
--   Depends only on public.profiles + public.account_deletion_requests (both genesis/applied).
--
-- DEFERRED (flagged, not in this migration — tracked GAP-HY-15 / registry):
--   * deidentify_user feature-table cascade (tutor_conversations/messages, etc. per Doc 03A V2
--     retention + anonymization_retention_days) — owner ruling 2026-06-20 "core anonymization
--     first". This RPC anonymizes the profiles PII row ONLY; the destructive feature-table delete
--     list must trace to Doc 03A retention before it is added.
--   * Stripe subscription cancellation + stripeCancellationQueue (§40.2.1 Phase 2) — no Stripe
--     cancel helper exists yet; stripe_cancellation_status stays 'pending' until that lands.
--   * MFA re-auth on the recovery link (§40.4 step 1) — recovery here is token-gated only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- UP
-- ----------------------------------------------------------------------------

-- §40.5 step 3 — CORE anonymization of the identity row. SECURITY DEFINER (service-role-only
-- privileged write across the deleting user's row); takes the anonymized email as a param so the
-- caller owns the address format (server passes buildDeletedEmail(profile_id)). Idempotent: a second
-- run over an already-anonymized row is a no-op-equivalent overwrite. NOTE: setting date_of_birth
-- NULL fires the genesis profiles_set_age trigger, which nulls the derived age_years/is_under_13.
CREATE OR REPLACE FUNCTION public.deidentify_user(target_user_id uuid, deleted_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles
     SET email              = deleted_email,
         full_name          = NULL,
         display_name        = 'Deleted User',
         stripe_customer_id  = NULL,
         guardian_email      = NULL,
         date_of_birth       = NULL,
         updated_at          = now()
   WHERE id = target_user_id;
  -- DEFERRED cascade (GAP-HY-15, Doc 03A V2 retention sign-off required): hard-delete feature-level
  -- rows where retention is not required; retain anonymized analytics per
  -- account_deletion_runtime_config.anonymization_retention_days. Not added until the delete list
  -- is traced to Doc 03A — leaving it out keeps this RPC non-destructive beyond the PII row.
END;
$$;
REVOKE ALL ON FUNCTION public.deidentify_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deidentify_user(uuid, text) TO service_role;

-- §40.4 recovery-link storage. Token is stored HASHED (sha256 hex) — the raw token lives only in
-- the recovery email; a leaked DB row cannot reconstruct a working link. Partial index mirrors
-- idx_account_deletion_pending (only pending rows are recoverable).
ALTER TABLE public.account_deletion_requests
  ADD COLUMN IF NOT EXISTS recovery_token_hash       text,
  ADD COLUMN IF NOT EXISTS recovery_token_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_account_deletion_recovery_token
  ON public.account_deletion_requests (recovery_token_hash)
  WHERE status = 'pending';

-- §40.2.1 Phase 1 — the atomic request transaction (soft-delete the profile + insert the request
-- row + persist the recovery-token hash) as ONE plpgsql transaction, so a partial failure cannot
-- leave deleted_at set with no request (or vice-versa). Idempotent: an existing pending request is
-- returned unchanged (no duplicate row, no re-stamping deleted_at). SECURITY DEFINER; service-role.
CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_profile_id          uuid,
  p_actor_id            uuid,
  p_recovery_token_hash text,
  p_grace_days          integer DEFAULT 7
)
RETURNS TABLE (requested_at timestamptz, scheduled_hard_delete_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now   timestamptz := now();
  v_sched timestamptz := now() + make_interval(days => p_grace_days);
BEGIN
  -- Idempotency: surface the existing pending request rather than creating a second one.
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests adr
     WHERE adr.profile_id = p_profile_id AND adr.status = 'pending'
  ) THEN
    RETURN QUERY
      SELECT adr.requested_at, adr.scheduled_hard_delete_at
        FROM public.account_deletion_requests adr
       WHERE adr.profile_id = p_profile_id AND adr.status = 'pending'
       LIMIT 1;
    RETURN;
  END IF;

  UPDATE public.profiles SET deleted_at = v_now, updated_at = v_now WHERE id = p_profile_id;

  INSERT INTO public.account_deletion_requests
    (profile_id, requested_at, scheduled_hard_delete_at, actor_profile_id, status,
     stripe_cancellation_status, recovery_token_hash, recovery_token_expires_at)
  VALUES
    (p_profile_id, v_now, v_sched, p_actor_id, 'pending',
     'pending', p_recovery_token_hash, v_sched);

  RETURN QUERY SELECT v_now, v_sched;
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid, uuid, text, integer) TO service_role;

-- §40.4 recovery during grace — restore by recovery-token hash. Clears deleted_at (re-activates the
-- account), cancels the request, and marks stripe_cancellation_status='cancelled_by_recovery'
-- (§40.2.1 recovery edge cases). Returns the restored profile_id, or NULL if the token is unknown /
-- expired / already-resolved. The deleted_at clear can hit idx_profiles_email_active if the email
-- was re-registered during grace; that unique_violation surfaces to the caller as a distinct failure
-- (route maps it to 409) rather than a 500 — a known §40.4 hardening edge (email reclaim).
CREATE OR REPLACE FUNCTION public.restore_account_deletion(p_recovery_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  SELECT adr.profile_id INTO v_profile_id
    FROM public.account_deletion_requests adr
   WHERE adr.recovery_token_hash    = p_recovery_token_hash
     AND adr.status                 = 'pending'
     AND adr.recovery_token_expires_at > now()
   LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles SET deleted_at = NULL, updated_at = now() WHERE id = v_profile_id;

  UPDATE public.account_deletion_requests
     SET status                     = 'cancelled',
         stripe_cancellation_status = 'cancelled_by_recovery'
   WHERE recovery_token_hash = p_recovery_token_hash
     AND status              = 'pending';

  RETURN v_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_account_deletion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_account_deletion(text) TO service_role;

-- §40.4 in-app cancel — the AUTHENTICATED symmetric twin of restore_account_deletion. Keyed by the
-- signed-in profile_id (the route has req.user.id) instead of a recovery token, but otherwise the same
-- single-transaction shape: clear profiles.deleted_at AND cancel the pending request atomically, so a
-- partial failure can never leave the user cancelled-but-still-soft-locked (the strand the §40.3 lock
-- exists to prevent). If the freed email was re-registered during grace, clearing deleted_at raises
-- 23505 on idx_profiles_email_active and the WHOLE function rolls back — the request stays 'pending'
-- (recoverable), never stranded as cancelled. Returns the restored profile_id, or NULL if there was no
-- pending request to cancel (caller maps NULL -> 404, 23505 -> 409).
CREATE OR REPLACE FUNCTION public.cancel_account_deletion(p_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id uuid;
BEGIN
  SELECT adr.id INTO v_request_id
    FROM public.account_deletion_requests adr
   WHERE adr.profile_id = p_profile_id
     AND adr.status = 'pending'
   LIMIT 1;

  IF v_request_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Lift the soft-delete lock first; a 23505 here aborts the whole function (both writes roll back).
  UPDATE public.profiles SET deleted_at = NULL, updated_at = now() WHERE id = p_profile_id;

  UPDATE public.account_deletion_requests
     SET status                     = 'cancelled',
         stripe_cancellation_status = 'cancelled_by_recovery'
   WHERE id = v_request_id;

  RETURN p_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- DOWN (fully reversible per migrations-pending discipline / INV-06)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.cancel_account_deletion(uuid);
-- DROP FUNCTION IF EXISTS public.restore_account_deletion(text);
-- DROP FUNCTION IF EXISTS public.request_account_deletion(uuid, uuid, text, integer);
-- DROP FUNCTION IF EXISTS public.deidentify_user(uuid, text);
-- DROP INDEX  IF EXISTS public.idx_account_deletion_recovery_token;
-- ALTER TABLE public.account_deletion_requests
--   DROP COLUMN IF EXISTS recovery_token_expires_at,
--   DROP COLUMN IF EXISTS recovery_token_hash;
