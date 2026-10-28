-- ============================================================================
-- Sign-up channel and campaign (SEO-1): which of Lyceon's own social links a sign-up came from.
--
-- @spec [owner brief "One funnel for every social post" (Karl, 2026-10-28) item 1 ("/start passes
--       its UTM to sign-up (signup_channel / signup_campaign, SEO-1)") and item 3 ("sign-ups by
--       signup_channel"); packages/shared/src/analytics-consent-schema.ts signupChannelSchema /
--       signupCampaignSchema (the allowlists below mirror them)] | @implemented [2026-10-28]
--
-- plain English:
--   1. profiles.signup_channel  — reddit, tiktok, instagram, youtube, facebook, x, email or other,
--      from the `utm_source` of the link the visitor arrived by. NULL: no tag (or an account made
--      before this column).
--   2. profiles.signup_campaign — qotd, worked_example or other, from `utm_campaign`.
--   Both are written by the server once, at account creation, beside signup_source
--   (server/lib/analytics/signup-source.ts), and are set-once like it: a trigger refuses any change
--   to a value already set. Only the service role writes profiles (authenticated has SELECT only),
--   so no browser writes them directly; the server re-parses whatever the browser sends against
--   the same allowlists.
--
-- trade-offs: a separate trigger function rather than a new body for
--   profiles_analytics_fields_set_once, so that function (and everything that tests it) is
--   untouched. A value outside the allowlists is refused by the CHECKs; the mapping to `other`
--   happens in the shared derivation before anything is sent.
--
-- edge cases: existing profiles keep NULL (no backfill: where an earlier sign-up came from is not
--   known). Not sent to PostHog; Doc 07A's user_signed_up schema is unchanged. Deletion: the
--   columns live on the profiles row and go with it.
--
-- Mutations: none target an existing function body here; the trigger function is new.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP TRIGGER IF EXISTS profiles_signup_tags_set_once ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_signup_tags_set_once();
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS signup_campaign, DROP COLUMN IF EXISTS signup_channel;
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_channel text,
  ADD COLUMN IF NOT EXISTS signup_campaign text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_signup_channel_check,
  ADD CONSTRAINT profiles_signup_channel_check
  CHECK (signup_channel IS NULL
         OR signup_channel IN ('reddit', 'tiktok', 'instagram', 'youtube', 'facebook', 'x', 'email', 'other'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_signup_campaign_check,
  ADD CONSTRAINT profiles_signup_campaign_check
  CHECK (signup_campaign IS NULL
         OR signup_campaign IN ('qotd', 'worked_example', 'other'));

COMMENT ON COLUMN public.profiles.signup_channel IS
  'SEO-1 (Karl, 2026-10-28): utm_source of the link the account came from, allowlisted; written once by the server at account creation; immutable (profiles_signup_tags_set_once).';
COMMENT ON COLUMN public.profiles.signup_campaign IS
  'SEO-1 (Karl, 2026-10-28): utm_campaign of the link the account came from, allowlisted; written once by the server at account creation; immutable (profiles_signup_tags_set_once).';

CREATE OR REPLACE FUNCTION public.profiles_signup_tags_set_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.signup_channel IS NOT NULL
     AND NEW.signup_channel IS DISTINCT FROM OLD.signup_channel THEN
    RAISE EXCEPTION 'profiles.signup_channel is immutable once set (SEO-1)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.signup_campaign IS NOT NULL
     AND NEW.signup_campaign IS DISTINCT FROM OLD.signup_campaign THEN
    RAISE EXCEPTION 'profiles.signup_campaign is immutable once set (SEO-1)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_signup_tags_set_once() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_signup_tags_set_once ON public.profiles;
CREATE TRIGGER profiles_signup_tags_set_once
  BEFORE UPDATE OF signup_channel, signup_campaign ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_signup_tags_set_once();

COMMIT;
