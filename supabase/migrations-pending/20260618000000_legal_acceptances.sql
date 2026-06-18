-- ============================================================================
-- legal_acceptances — MISSING TABLE (live auth-outage fix)
-- ============================================================================
-- @spec [Doc-01_V8 §9 Login and signup flows / §5 Identity audit trail | legal-consent capture]
-- @implemented [2026-06-18]
--
-- *** ALREADY APPLIED TO PRODUCTION (project hncolwkccbbjkfithhlo) on 2026-06-18 as an outage
--     hotfix via Supabase apply_migration `create_legal_acceptances_table`. This file is the repo
--     governance record of that DDL. ***
--
-- plain English: server/lib/legal-acceptance.ts (recordLegalAcceptances), server/routes/profile-routes.ts
-- and server/routes/legal-routes.ts WRITE and READ public.legal_acceptances, but the table was never
-- created — it is absent from genesis, every migration, and the CI snapshot. In production this caused a
-- total login outage: every Google login (the client always appends ?consentSource=…, so the OAuth
-- callback runs recordLegalAcceptances) and every email signup hit `.from("legal_acceptances").upsert(...)`
-- → Postgres 42P01 (relation does not exist) → the OAuth finalize catch ran `signOut`, destroying the
-- session it had just established → the next /api/profile returned 401 (?error=post_auth_finalize).
--
-- The shape below is derived EXACTLY from the code's writes/reads:
--   - recordLegalAcceptances inserts (user_id, doc_key, doc_version, actor_type, minor, consent_source,
--     user_agent, ip_address, accepted_at) with onConflict (user_id, doc_key, doc_version, actor_type);
--   - profile-routes / legal-routes read (doc_key, doc_version, accepted_at, actor_type) by user_id.
-- consent_source values are the canonical ConsentSource union (shared/legal-consent.ts); actor_type is
-- the LegalAcceptanceRecord union. All access is service-role (getSupabaseAdmin) → RLS enabled, no
-- anon/authenticated policy (deny by default), service_role granted.
--
-- ROLLBACK (reversible): DROP TABLE public.legal_acceptances;  (DOWN block at foot)
-- ACTIVATION (owner, genesis-extension step): git mv into supabase/migrations/, regenerate
--   scripts/ci/genesis-schema.expected.sql from the fresh-apply harness, commit. Prod already has it,
--   so activation only aligns the committed genesis snapshot with production. LYCEON-MIGRATION-REVIEWED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_key        text NOT NULL,
  doc_version    text NOT NULL,
  actor_type     text NOT NULL CHECK (actor_type IN ('student','parent')),
  minor          boolean NOT NULL DEFAULT false,
  consent_source text NOT NULL CHECK (consent_source IN ('email_signup_form','google_continue_pre_oauth','google_continue_click')),
  user_agent     text,
  ip_address     text,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_acceptances_unique_doc UNIQUE (user_id, doc_key, doc_version, actor_type)
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON public.legal_acceptances (user_id);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_acceptances FROM PUBLIC;
GRANT ALL ON public.legal_acceptances TO service_role;  -- no anon/authenticated policy = deny by default

-- ============================================================================
-- DOWN (reversible)
-- ============================================================================
-- DROP TABLE IF EXISTS public.legal_acceptances;
