-- ============================================================================
-- legal_acceptance_outbox — durable consent-recording queue (decoupling foundation)
-- ============================================================================
-- @spec [contracts/auth-standard-flow.contract.md AS-1/§3 | Doc-01_V8 §5 Identity audit trail]
-- @implemented [2026-06-18]
--
-- *** ALREADY APPLIED TO PRODUCTION (project hncolwkccbbjkfithhlo) on 2026-06-18 via Supabase
--     apply_migration `create_legal_acceptance_outbox`. This file is the repo governance record. ***
--
-- plain English: decouples legal-acceptance recording from session survival. When the direct write
-- to public.legal_acceptances fails, the auth finalize enqueues the consent intent here (NEVER
-- throwing into the auth path — a successful login keeps its session regardless), and a best-effort
-- drain retries it to completion on the user's next authenticated /api/profile hydration. Same
-- discipline as notification_outbox: service-role-only, RLS enabled, append + mark-processed.
--
-- ROLLBACK (reversible): DROP TABLE public.legal_acceptance_outbox;  (DOWN block at foot)
-- ACTIVATION (owner): git mv into supabase/migrations/, regenerate
--   scripts/ci/genesis-schema.expected.sql from the fresh-apply harness. Prod already has it.
--   LYCEON-MIGRATION-REVIEWED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.legal_acceptance_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payload      jsonb NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Cheap lookup for the opportunistic drain: only the user's still-pending rows.
CREATE INDEX IF NOT EXISTS idx_legal_acceptance_outbox_unprocessed
  ON public.legal_acceptance_outbox (user_id) WHERE processed_at IS NULL;

ALTER TABLE public.legal_acceptance_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_acceptance_outbox FROM PUBLIC;
GRANT ALL ON public.legal_acceptance_outbox TO service_role;  -- no anon/authenticated policy = deny

-- ============================================================================
-- DOWN (reversible)
-- ============================================================================
-- DROP TABLE IF EXISTS public.legal_acceptance_outbox;
