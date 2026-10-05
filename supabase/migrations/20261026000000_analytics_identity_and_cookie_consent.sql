-- ===========================================================================
-- Analytics identity on the profile, and the cookie consent log.
--
-- @spec [Doc 07A V1.0 §7.1 (analytics_user_id: "Computed ONCE ... stored as an immutable column on
--       the user record"), §6.2 (user_signed_up.signup_source enum); SCL-201 IS 6 (signup_source
--       from first-touch UTM, set server-side); Doc 10 §9.11 ("consent log with timestamp + cookie
--       category granularity for audit purposes"); SCL-202 (public endpoints rate-limited by the
--       anonymous ledger); plan R11, F10, F11; owner Step 0 decisions 2026-10-05 (Wave 1C)]
--       | @implemented [2026-10-05]
--
-- plain English:
--  1. profiles.analytics_user_id — the HMAC-derived opaque id (Doc 07A §7.1), written by the
--     server ONCE, when onboarding completes and user_signed_up is emitted. NULL before that.
--     Unique. A trigger refuses any change once it is set, so "immutable" is a property of the
--     database, not a promise of the writer.
--  2. profiles.signup_source — the visitor's first-touch channel (the five Doc 07A §6.2 values),
--     written by the server at account creation. Set-once by the same trigger.
--  3. cookie_consent_log — one row per cookie choice: a random consent id (the one in the
--     visitor's consent cookie), whether analytics was accepted, the banner text version, where
--     the choice was made, and the server's timestamp. No user id, no IP: the record evidences a
--     choice, it does not identify who made it. Written only by the server (service_role).
--  4. cookie_consent_ip — a rate-limit bucket on the anonymous ledger for the public write.
--
-- edge cases: existing profiles keep NULL in both columns (no backfill — signup_source is
-- unknowable after the fact, and analytics_user_id is written by the emission that needs it).
-- Account deletion deletes the profile row, so both columns go with it.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS analytics_user_id uuid,
  ADD COLUMN IF NOT EXISTS signup_source text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_analytics_user_id_key UNIQUE (analytics_user_id);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_signup_source_check
  CHECK (signup_source IS NULL
         OR signup_source IN ('direct', 'referral', 'paid_ad', 'organic_search', 'unknown'));

COMMENT ON COLUMN public.profiles.analytics_user_id IS
  'Doc 07A §7.1: HMAC-SHA256(ANALYTICS_SALT, profile id), UUID-shaped. Written once by the server at onboarding completion; immutable (profiles_analytics_fields_set_once).';
COMMENT ON COLUMN public.profiles.signup_source IS
  'Doc 07A §6.2 / SCL-201 IS 6: first-touch channel at account creation. Written once by the server.';

-- Set-once: NULL -> value is allowed; value -> anything else is refused.
CREATE OR REPLACE FUNCTION public.profiles_analytics_fields_set_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.analytics_user_id IS NOT NULL
     AND NEW.analytics_user_id IS DISTINCT FROM OLD.analytics_user_id THEN
    RAISE EXCEPTION 'profiles.analytics_user_id is immutable once set (Doc 07A §7.1)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.signup_source IS NOT NULL
     AND NEW.signup_source IS DISTINCT FROM OLD.signup_source THEN
    RAISE EXCEPTION 'profiles.signup_source is immutable once set (SCL-201 IS 6)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_analytics_fields_set_once() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_analytics_fields_set_once ON public.profiles;
CREATE TRIGGER profiles_analytics_fields_set_once
  BEFORE UPDATE OF analytics_user_id, signup_source ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_analytics_fields_set_once();

CREATE TABLE IF NOT EXISTS public.cookie_consent_log (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consent_id     uuid        NOT NULL,
  analytics      boolean     NOT NULL,
  banner_version text        NOT NULL CHECK (banner_version ~ '^[0-9]+$'),
  source         text        NOT NULL CHECK (source IN ('banner', 'settings')),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_log_consent_id
  ON public.cookie_consent_log (consent_id, recorded_at);

COMMENT ON TABLE public.cookie_consent_log IS
  'Doc 10 §9.11: cookie consent log (timestamp + category + banner version). consent_id is the random id in the visitor''s consent cookie; no user id and no IP are stored.';

ALTER TABLE public.cookie_consent_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cookie_consent_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.cookie_consent_log TO service_role;

UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'cookie_consent_ip', jsonb_build_object('limit', 30, 'window_seconds', 3600)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $cc$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
    WHERE key = 'bucket_definitions' AND value ? 'cookie_consent_ip'
  ) THEN
    RAISE EXCEPTION 'cookie consent migration: the bucket_definitions row is missing, so cookie_consent_ip was not seeded and every consent write would be refused';
  END IF;
END
$cc$;

COMMIT;
