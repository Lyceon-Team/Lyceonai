-- ===========================================================================
-- Smart landing: new students land on Home; the sign-up channel on the profile.
--
-- @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
--       2026-10-28) items 1 and 2; Public Disclosure Doctrine rule 7 (under-13 users are excluded
--       from all marketing and analytics data); SCL recorded with this change]
--       | @implemented [2026-10-28]
--
-- plain English:
--  1. `landing_rotation_open(profile, now)`: true once the student's first QOTD day after the
--     day they onboarded has started, i.e. `qotd_day(now) > qotd_day(profile_completed_at)`.
--     False for a profile that has not onboarded (or does not exist). The server asks it before
--     the landing does anything else (no resume, no claim), so a new student always lands on
--     Home and nothing is written to `landing_windows` or `landing_shows` for that period. The
--     QOTD day is the one rule everywhere (`qotd_day`, 04:00 UTC from its cutover).
--  2. `profiles.signup_channel` (reddit, tiktok, instagram, facebook, email, direct, other) and
--     `profiles.signup_campaign` (a short lowercase token; the server writes only allowlisted
--     names): the first touch, coarse, no URL. The server writes them once, on an account that
--     has not onboarded (server/lib/signup-attribution.ts).
--  3. One guard trigger on profiles, `profiles_zz_signup_attribution` (named to run after
--     `profiles_set_age`, which computes `is_under_13` in the same statement):
--       - an under-13 profile never holds either value: they are cleared, on any write;
--       - otherwise each is set once: a stored value cannot be changed or removed.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Deploy order: either. Code first: the landing's rotation read fails and the open answers Home
-- (the route's fail-safe) until the function exists; the attribution write fails and is logged,
-- and the signup goes on. Migration first: nothing reads or writes the new objects yet.
--
-- rollback:
--   DROP TRIGGER IF EXISTS profiles_zz_signup_attribution ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_signup_attribution_guard();
--   DROP FUNCTION IF EXISTS public.landing_rotation_open(uuid, timestamptz);
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS signup_campaign,
--     DROP COLUMN IF EXISTS signup_channel;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. New students land on Home
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.landing_rotation_open(
  p_profile_id uuid,
  p_now        timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT public.qotd_day(p_now) > public.qotd_day(p.profile_completed_at)
       FROM public.profiles p
      WHERE p.id = p_profile_id
        AND p.profile_completed_at IS NOT NULL),
    false);
$fn$;

COMMENT ON FUNCTION public.landing_rotation_open(uuid, timestamptz) IS
  'Smart landing (Karl, 2026-10-28): true once the first QOTD day after the day the student onboarded has started. Until then the student lands on Home and the landing records nothing.';

REVOKE ALL ON FUNCTION public.landing_rotation_open(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landing_rotation_open(uuid, timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The sign-up channel and campaign
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN signup_channel text,
  ADD COLUMN signup_campaign text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_signup_channel_check CHECK (
    signup_channel IS NULL OR signup_channel IN
      ('reddit', 'tiktok', 'instagram', 'facebook', 'email', 'direct', 'other')),
  ADD CONSTRAINT profiles_signup_campaign_check CHECK (
    signup_campaign IS NULL OR signup_campaign ~ '^[a-z0-9_]{1,40}$');

COMMENT ON COLUMN public.profiles.signup_channel IS
  'Karl, 2026-10-28: the first-touch channel from the landing URL''s UTM (coarse, allowlisted; no URL). Written once by the server before onboarding; never held for an under-13 profile.';
COMMENT ON COLUMN public.profiles.signup_campaign IS
  'Karl, 2026-10-28: the first-touch utm_campaign when it is an allowlisted name (packages/shared/src/signup-attribution.ts), else null. Written once with signup_channel; never held for an under-13 profile.';

-- ---------------------------------------------------------------------------
-- 3. The guard: cleared for under-13, otherwise set once
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_signup_attribution_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.is_under_13 IS TRUE THEN
    NEW.signup_channel := NULL;
    NEW.signup_campaign := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.signup_channel IS NOT NULL
       AND NEW.signup_channel IS DISTINCT FROM OLD.signup_channel THEN
      RAISE EXCEPTION 'profiles.signup_channel is set once'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.signup_campaign IS NOT NULL
       AND NEW.signup_campaign IS DISTINCT FROM OLD.signup_campaign THEN
      RAISE EXCEPTION 'profiles.signup_campaign is set once'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER profiles_zz_signup_attribution
  BEFORE INSERT OR UPDATE OF signup_channel, signup_campaign, date_of_birth, is_under_13
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_signup_attribution_guard();

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_set_age'
  ) THEN
    RAISE EXCEPTION 'profiles_set_age is missing: the under-13 clear depends on running after it';
  END IF;
  -- BEFORE triggers run in name order: the trigger that runs the guard must sort after
  -- profiles_set_age, or the under-13 clear would see the age before it is computed.
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgfoid = 'public.profiles_signup_attribution_guard()'::regprocedure
       AND tgname::text COLLATE "C" <= 'profiles_set_age'
  ) THEN
    RAISE EXCEPTION 'the attribution guard would run before profiles_set_age';
  END IF;
END
$chk$;

COMMIT;
