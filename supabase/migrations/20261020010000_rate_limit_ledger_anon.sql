-- ===========================================================================
-- Anonymous rate-limit buckets: the Doc 01A §41 ledger, keyed on a keyed hash of the caller's IP
-- for public endpoints that have no authenticated caller.
--
-- @spec [SCL-202 (docs/SpecAudit/SPEC_CHANGES_LOG.md): "For public endpoints with no
--       authenticated caller, the RateLimitLedger keys a bucket on HMAC-SHA256(server_secret,
--       client_ip) instead of profile_id. The raw IP is never stored or logged. Rows expire with
--       their window ... Doc 01A remains the canonical limiter"; Doc 01A §41, §44; plan R19, Q2;
--       owner Step 0 decisions 2026-10-05 (build SCL-202 as written; stats count the first submit
--       per hashed IP per day)] | @implemented [2026-10-05]
--
-- plain English: rate_limit_ledger keys every bucket on profile_id (NOT NULL, FK, part of the
-- PK), so an anonymous caller has no bucket there, and tests/ci/rate-limit-sql.contract.test.ts
-- pins that shape. This adds a SIBLING table with the same columns and the same atomic
-- single-statement check-and-increment, keyed on subject_hmac (32 bytes, HMAC-SHA256 computed by
-- the server; the IP itself never reaches the database). The bucket definitions, the 429 /
-- Retry-After / X-RateLimit-* response and the TypeScript wrapper are the canonical ones,
-- shared with the profile-keyed ledger.
--
-- Expiry: sweep_rate_limit_ledger_anon() deletes every row whose window has ended, so a row
-- lives no longer than its window (SCL-202). The QOTD cron calls it daily. It is a separate
-- function so sweep_operational_log_retention (and the mutations pinned to it) are untouched.
--
-- Buckets (merged into rate_limit_runtime_config.bucket_definitions):
--   qotd_read_ip    120 per hour  — public QOTD reads.
--   qotd_submit_ip   30 per hour  — public QOTD submits (after Turnstile).
--   qotd_stat_ip      1 per day   — whether a submit is COUNTED in the day's stats. The server
--                                   passes the America/Chicago day as the window, so "first
--                                   submit per hashed IP per QOTD day" is exact.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limit_ledger_anon (
  subject_hmac bytea       NOT NULL CHECK (octet_length(subject_hmac) = 32),
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  used_count   integer     NOT NULL DEFAULT 0,
  limit_count  integer     NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_hmac, bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_ratelimit_anon_window_end
  ON public.rate_limit_ledger_anon (window_end);

COMMENT ON TABLE public.rate_limit_ledger_anon IS
  'SCL-202: Doc 01A §41 ledger for public endpoints with no authenticated caller. subject_hmac = HMAC-SHA256(server secret, client IP); the raw IP is never stored. Rows are deleted once their window ends (sweep_rate_limit_ledger_anon).';

ALTER TABLE public.rate_limit_ledger_anon ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_ledger_anon FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limit_ledger_anon TO service_role;

-- Same body as public.rate_limit_check_and_increment (genesis), keyed on subject_hmac.
CREATE OR REPLACE FUNCTION public.rate_limit_check_and_increment_anon(
  p_subject_hmac bytea, p_bucket_key text, p_cost integer,
  p_window_start timestamptz, p_window_end timestamptz, p_limit integer
) RETURNS TABLE (allowed boolean, remaining integer, used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_used integer;
BEGIN
  INSERT INTO public.rate_limit_ledger_anon AS l
    (subject_hmac, bucket_key, window_start, window_end, used_count, limit_count)
  VALUES (p_subject_hmac, p_bucket_key, p_window_start, p_window_end, p_cost, p_limit)
  ON CONFLICT (subject_hmac, bucket_key, window_start) DO UPDATE
    SET used_count = l.used_count + p_cost, updated_at = now()
    WHERE l.used_count + p_cost <= p_limit
  RETURNING l.used_count INTO v_used;

  IF FOUND THEN
    allowed := TRUE; used := v_used; remaining := p_limit - v_used; RETURN NEXT; RETURN;
  END IF;

  SELECT l.used_count INTO v_used FROM public.rate_limit_ledger_anon AS l
   WHERE l.subject_hmac = p_subject_hmac AND l.bucket_key = p_bucket_key
     AND l.window_start = p_window_start;
  allowed := FALSE; used := COALESCE(v_used, 0);
  remaining := GREATEST(p_limit - COALESCE(v_used, 0), 0);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_rate_limit_ledger_anon()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_ledger_anon WHERE window_end <= now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_check_and_increment_anon(bytea, text, integer, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_rate_limit_ledger_anon() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_check_and_increment_anon(bytea, text, integer, timestamptz, timestamptz, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_rate_limit_ledger_anon() TO service_role;

UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'qotd_read_ip',   jsonb_build_object('limit', 120, 'window_seconds', 3600),
      'qotd_submit_ip', jsonb_build_object('limit', 30,  'window_seconds', 3600),
      'qotd_stat_ip',   jsonb_build_object('limit', 1,   'window_seconds', 86400)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $rl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
    WHERE key = 'bucket_definitions'
      AND value ? 'qotd_read_ip' AND value ? 'qotd_submit_ip' AND value ? 'qotd_stat_ip'
  ) THEN
    RAISE EXCEPTION 'anon ledger migration: the bucket_definitions row is missing, so the qotd_* buckets were not seeded and every public QOTD request would be refused';
  END IF;
END
$rl$;

COMMIT;
