-- ============================================================================
-- profiles auth columns — student_link_code, profile_completed_at, marketing_opt_in (G4)
-- ============================================================================
-- @spec [docs/SpecAudit/50-auth-entitlement/auth-ssr-gap-analysis.md G4 | Doc-01_V8 §9 /
--   §37.1 under-13 gating | guardian linkage]
-- @implemented [2026-06-19]
--
-- plain English: three columns the server reads on EVERY profile hydration but that were absent from
-- the genesis profiles table — so the PostgREST select in ensureProfileForAuthUser (and GET /api/profile)
-- errored ("column does not exist") and threw BEFORE it could create/return a profile. Adding them is
-- the second half of the profile-path fix (the trigger is the first).
--   * student_link_code     — guardian<->student link code (guardian-routes.ts, profile-routes.ts).
--   * profile_completed_at  — load-bearing for the DOB/onboarding soft-gate (RequireRole, login
--                             redirect, oauth-callback profileNeedsCompletion). NULL until completion.
--   * marketing_opt_in      — captured on the profile form.
-- Shapes match the pre-baseline legacy definitions
-- (_legacy-migrations/.../20260102_guardian_link_code.sql, 20260202_profile_completion_fields.sql)
-- so the live code's reads/writes line up exactly.
--
-- ROLLBACK (reversible): DOWN drops the indexes + columns. Additive; no data destroyed on apply.
--   LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_link_code    text,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_in     boolean NOT NULL DEFAULT false;

-- One code per student (partial unique — only non-NULL codes are constrained).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_student_link_code_key
  ON public.profiles (student_link_code) WHERE student_link_code IS NOT NULL;

-- Onboarding-state lookups.
CREATE INDEX IF NOT EXISTS idx_profiles_completed_at
  ON public.profiles (profile_completed_at);

COMMIT;

-- ============================================================================
-- DOWN (reversible)
-- ============================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS public.idx_profiles_completed_at;
--   DROP INDEX IF EXISTS public.profiles_student_link_code_key;
--   ALTER TABLE public.profiles
--     DROP COLUMN IF EXISTS marketing_opt_in,
--     DROP COLUMN IF EXISTS profile_completed_at,
--     DROP COLUMN IF EXISTS student_link_code;
-- COMMIT;
