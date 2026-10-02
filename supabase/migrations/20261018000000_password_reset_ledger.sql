-- ===========================================================================
-- PASSWORD-RESET THROTTLE ON THE RATE-LIMIT LEDGER (register F-46)
-- ===========================================================================
-- @spec [Doc 01 §12.1 step 2 ("Rate-limited via RateLimitLedger bucket password_reset:{email}
--        (default: 3/hour)"); Doc 01A §39.2 / §46 (`password_reset_requests_hourly`), §41 (the
--        ledger table), §47 (a bucket missing from bucket_definitions is a blocking condition);
--        Brief 12 ruling 1 (owner, 2026-10-02)] | @implemented [2026-10-02]
--
-- plain English: two objects.
--   1. The bucket `password_reset_requests_hourly`: 3 per hour (Doc 01 §12.1's default).
--   2. `password_reset_subject(email)`: the profile an email address belongs to, or NULL. The
--      reset route keys the ledger on that profile, so the count follows the ACCOUNT behind the
--      address, across requests, browsers and IPs.
--
-- WHY A PROFILE AND NOT THE ADDRESS ITSELF. Doc 01 §12.1 says "per email"; Doc 01A §41 locks the
-- ledger to `profile_id UUID NOT NULL REFERENCES profiles(id)`, the whole ledger's primary key.
-- An address that belongs to no account has no row to count against without changing that
-- canonical table, which no ruling authorises. Every address that CAN receive a reset belongs to
-- a profile, so counting per profile is counting per email for every email a reset can reach.
-- An unknown address sends nothing (Supabase does not mail an address with no account) and the
-- route answers it exactly as it answers a known one, so it gains nothing from being uncounted.
--
-- Matching: `lower(email) = lower(btrim(p_email))`, the same fold as `idx_profiles_email_active`.
-- A live profile wins over a soft-deleted one; among soft-deleted rows (the active index does
-- not make them unique), the newest. Returns an id only — never an email.
--
-- Grants: service_role only. `anon` and `authenticated` must not be able to ask "does this
-- address have an account?", which is exactly the question this answers.
--
-- Idempotent: CREATE OR REPLACE, and the bucket is merged into the existing object.
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.password_reset_subject(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
    FROM public.profiles p
   WHERE lower(p.email) = lower(btrim(p_email))
   ORDER BY (p.deleted_at IS NULL) DESC, p.created_at DESC
   LIMIT 1
$$;

COMMENT ON FUNCTION public.password_reset_subject(text) IS
  'F-46 / Doc 01 §12.1: the profile an email belongs to (live first), for keying the password_reset_requests_hourly ledger bucket. Returns an id only. service_role only: it answers "does this address have an account?".';

REVOKE ALL ON FUNCTION public.password_reset_subject(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_reset_subject(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_reset_subject(text) TO service_role;

UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'password_reset_requests_hourly', jsonb_build_object('limit', 3, 'window_seconds', 3600)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $rl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
    WHERE key = 'bucket_definitions' AND value ? 'password_reset_requests_hourly'
  ) THEN
    RAISE EXCEPTION 'password reset migration: the bucket_definitions row is missing, so password_reset_requests_hourly was not seeded and every reset would be refused';
  END IF;
END
$rl$;

COMMIT;
