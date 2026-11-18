-- ===========================================================================
-- The sign-up channel allowlist gains youtube and x.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [SCL-278 (Karl, 2026-11-14): "YouTube on the sign-up attribution allowlist: yes, add it
--       (and `x`, as ruled earlier). That way Shorts sign-ups get credited to YouTube."; amends
--       SCL-257 item 2's channel list] | @implemented [2026-11-14]
--
-- plain English: profiles.signup_channel accepted reddit, tiktok, instagram, facebook, email,
-- direct and other (20261121000000_landing_new_students_signup_channel.sql). A visit tagged
-- utm_source=youtube (the worked-example Shorts link) or x / twitter was stored as `other`. This
-- replaces the CHECK with the same list plus youtube and x, matching SIGNUP_CHANNELS in
-- packages/shared/src/signup-attribution.ts. Nothing else changes: the campaign check, the
-- set-once and under-13 guard (profiles_signup_attribution_guard) and the column comments stay.
--
-- edge cases: only widens, so every stored value still passes; rows already stored as `other`
-- stay `other` (first touch is set once and is not re-derived). Idempotent: DROP ... IF EXISTS,
-- then ADD.
--
-- rollback (only if no row holds youtube or x; the set-once guard keeps a stored value, so
-- check first: SELECT count(*) FROM public.profiles WHERE signup_channel IN ('youtube', 'x');):
--   ALTER TABLE public.profiles DROP CONSTRAINT profiles_signup_channel_check;
--   ALTER TABLE public.profiles ADD CONSTRAINT profiles_signup_channel_check CHECK (
--     signup_channel IS NULL OR signup_channel IN
--       ('reddit', 'tiktok', 'instagram', 'facebook', 'email', 'direct', 'other'));
-- ===========================================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_signup_channel_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_signup_channel_check CHECK (
    signup_channel IS NULL OR signup_channel IN
      ('reddit', 'tiktok', 'instagram', 'facebook', 'youtube', 'x', 'email', 'direct', 'other'));
