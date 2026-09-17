-- ===========================================================================
-- DELETION PHASE 2 — did the do-not-contact request actually land?
-- ===========================================================================
-- @spec [Doc-01_V8 §5 (the deletion record is the evidence of what was asked and what was done);
--        SCL-085 PROPOSED (the evidence bundle keyed by log_id); SCL-089 as amended 2026-09-16
--        (alert-and-retry on a vendor call that fails without failing the deletion);
--        SCL-090 PROPOSED as ruled 2026-09-17; owner follow-up 2026-09-17 "Replace Bespoke
--        Suppression With Resend's" §3] | @implemented [2026-09-17]
--
-- plain English: the do-not-contact list itself is Resend's. This migration adds nothing that
-- stores an address or a hash of one — the only thing it adds is the answer to "did our call to
-- Resend succeed", so a call that failed can be retried and one that succeeded is never repeated.
--
-- WHAT THIS REPLACES. An earlier cut of Phase 2 built a local `deletion_suppression` table
-- holding an HMAC of the address under a dedicated secret, plus a dispatcher check that compared
-- every outgoing message against it. That duplicated a capability the team already pays for:
-- Resend's suppression list is enforced on every send the team makes, on every domain and
-- subdomain, whether the send arrives by REST or through SMTP — which is why it also covers
-- Supabase Auth's own mail. Two enforcement points can only disagree, and hashing locally
-- protected nothing, because the provider holds the plaintext either way. That table was never
-- applied to production; this file takes its place in the apply order.
--
-- WHY A STATUS COLUMN AND NOT A SECOND TABLE. One nullable column on the row that already
-- records the request. `suppression_requested` (live since 20260917000000) is what the person
-- asked for; `suppression_status` is what we managed to do about it. A separate table would need
-- its own primary key, its own foreign key and its own place in the structural rules for one
-- text value about a row that already exists.
--
-- THE THREE STATES, AND WHY THERE IS NO 'cleared'.
--   NULL            the call has not been made (or was never asked for)
--   'applied'       Resend accepted the suppression
--   'failed_manual' the call failed, and it is known to have failed
-- The retry sweep selects `suppression_requested = true AND status = 'completed' AND
-- suppression_status IS DISTINCT FROM 'applied'`, so it re-attempts BOTH a known failure and a
-- row that never got a status at all — which is the case where the outcome write itself could
-- not land. Only 'applied' is excluded.
--
-- A subject who later re-consents has their entry REMOVED at Resend, and this column STAYS
-- 'applied'. That is what makes lifting a suppression durable: the one value the sweep skips is
-- the one a successful suppression leaves behind, so the next nightly pass cannot silently
-- re-suppress somebody who just asked to be contacted again. A 'cleared' state would also mean
-- the settings route writing to the evidence side, which the two-universe rule (plan v4 §2)
-- exists to prevent. The re-consent is recorded in `audit_logs` instead, where an action taken
-- by an identified live account belongs.
--
-- WHY `failed_manual` AND NOT A NEW VOCABULARY. It is the word `deletion_billing_record` already
-- uses for the same situation — a vendor call that must not fail the deletion, pages when it
-- fails, and is retried from the evidence side until it succeeds. One word, one meaning.
--
-- trade-offs: `subject_email` is the only address a retry has, so a row still `failed_manual`
-- when the 24-month sweep NULLs that column stops being retryable. Two years of daily failures
-- is a standing page, not something to keep racing.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
ALTER TABLE public.deletion_request_log
  ADD COLUMN IF NOT EXISTS suppression_status text;

-- Separate from the ADD so a re-run cannot duplicate the constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.deletion_request_log'::regclass
       AND conname  = 'deletion_request_log_suppression_status_check'
  ) THEN
    ALTER TABLE public.deletion_request_log
      ADD CONSTRAINT deletion_request_log_suppression_status_check
      CHECK (suppression_status IS NULL
             OR suppression_status IN ('applied', 'failed_manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.deletion_request_log.suppression_status IS
  'Outcome of the Resend suppression call for a request whose suppression_requested is true. '
  'NULL = not attempted. applied = Resend accepted it. failed_manual = the call failed and the '
  'executor''s retry sweep re-attempts it each pass, as it does a row left NULL. Stays applied '
  'after a subject re-consents and the entry is removed at Resend, so the sweep cannot silently '
  're-suppress them.';

-- No index, deliberately, and for the same reason `deletion_billing_record.final_status` has
-- none: the retry sweep reads a table whose rows are one-per-deletion-request, and a seq scan
-- over that once a night costs less than an index nobody else can use.

-- ---------------------------------------------------------------------------
-- 2. The one writer
-- ---------------------------------------------------------------------------
-- THE DATABASE STAYS THE AUTHORITY ON WHAT THE PERSON ASKED FOR. The WHERE clause carries
-- `suppression_requested = true`, so no caller — not a bug, not a future script — can record a
-- suppression outcome against somebody who never requested one. `IS DISTINCT FROM 'applied'`
-- makes the call idempotent and non-clobbering, exactly as resolve_deletion_billing_record's
-- `AND final_status = 'failed_manual'` does: a success can never be overwritten by a later
-- failure, and a repeated success is a no-op. Returns the row count rather than raising, so a
-- caller that has already committed a deletion is never handed an exception.
CREATE OR REPLACE FUNCTION public.record_deletion_suppression_outcome(
  p_log_id uuid,
  p_status text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_status NOT IN ('applied', 'failed_manual') THEN
    RAISE EXCEPTION 'record_deletion_suppression_outcome: % is not a suppression status', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.deletion_request_log
     SET suppression_status = p_status
   WHERE log_id = p_log_id
     AND suppression_requested = true
     AND suppression_status IS DISTINCT FROM 'applied';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.record_deletion_suppression_outcome(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_deletion_suppression_outcome(uuid, text) TO service_role;

COMMIT;
