-- ============================================================================
-- handle_new_user — canonical @supabase/ssr profile-creation trigger (G1)
-- ============================================================================
-- @spec [contracts/auth-login-e2e.contract.md AL-2/AL-4 | Doc-01_V8 Part I Identity Model
--   (one profiles row per authenticated user) |
--   docs/SpecAudit/50-auth-entitlement/auth-ssr-gap-analysis.md G1]
-- @implemented [2026-06-19]
--
-- plain English: the SINGLE, canonical mechanism that creates exactly one public.profiles row for
-- every auth.users insert, atomically, inside the same transaction GoTrue uses to create the user.
-- This is the Supabase-documented pattern (handle_new_user + on_auth_user_created). Before this, the
-- email-signup path only UPDATEd a row it ASSUMED a trigger had created — but no such trigger existed
-- in prod, so 54/116 users had no profile and every legal-acceptance write FK-failed (total signup
-- outage). With this trigger the profile always exists before any app row that references it.
--
-- DESIGN:
--   * SECURITY DEFINER + SET search_path = '' (canonical hardening): runs as the function owner so it
--     may insert past profiles' service-role-only RLS; the empty search_path forces fully-qualified
--     names (no search-path injection).
--   * display_name falls back display_name -> full_name -> name -> email-localpart so Google OAuth
--     identities (which carry full_name/name, not display_name) keep a sensible name — matches the
--     old ensureProfileForAuthUser fallback the trigger now replaces.
--   * role is CLAMPED: a self-asserted 'admin' in user_metadata can NEVER mint an admin profile
--     (server-authoritative role rule). Only 'guardian' is honored from metadata; everything else
--     becomes 'student'. profile-complete finalization sets the durable role later.
--   * ON CONFLICT (id) DO NOTHING: idempotent (resume / replay safe).
--   * Same-email-second-identity is prevented upstream by Supabase native identity-linking
--     (dashboard "link identities" ON, Karl-2), so the genesis idx_profiles_email_active unique
--     index is never hit by this trigger. If linking were OFF a 2nd identity on the same email would
--     raise 23505 here and abort the auth.users insert; linking is the documented precondition.
--   * age_years / is_under_13 stay NULL at creation (no date_of_birth yet) and are maintained by the
--     existing profiles_set_age trigger when DOB is set at profile-complete.
--
-- ROLLBACK (reversible): DOWN block drops the trigger then the function. No data destroyed.
--   LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',  -- Google OAuth sets full_name / name, not display_name
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    CASE WHEN NEW.raw_user_meta_data->>'role' = 'guardian' THEN 'guardian' ELSE 'student' END::public.profile_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;

-- ============================================================================
-- DOWN (reversible)
-- ============================================================================
-- BEGIN;
--   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--   DROP FUNCTION IF EXISTS public.handle_new_user();
-- COMMIT;
