-- ============================================================================
-- legal_acceptance_outbox — make the durable fallback INDEPENDENT (G3 / Q3=a)
-- ============================================================================
-- @spec [contracts/auth-standard-flow.contract.md AS-1 |
--   docs/SpecAudit/50-auth-entitlement/auth-ssr-gap-analysis.md G3]
-- @implemented [2026-06-19]
--
-- plain English: the outbox is the fail-open durable store for consent intent when the direct write to
-- legal_acceptances can't complete. Originally its user_id FK-referenced public.profiles(id) — the SAME
-- parent legal_acceptances needs — so it could NOT absorb the one failure mode that actually occurred
-- (no profile row): both writes FK-failed together. This drops that FK so the outbox is genuinely
-- independent: it durably holds consent intent keyed by the auth user's uuid even if the profile write
-- has not landed. The drain (legal-acceptance.ts) still upserts into legal_acceptances — which KEEPS
-- its profiles FK — once the profile exists (now guaranteed by the handle_new_user trigger).
--
-- ORDER: applies after the legal_acceptance_outbox table is created (20260618010000, brought under
-- governance in this same change). Fresh-apply creates-with-FK then drops here; prod applies the drop.
--
-- ROLLBACK (reversible): DOWN re-adds the FK (only valid once every outbox user_id has a profiles row).
--   LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

ALTER TABLE public.legal_acceptance_outbox
  DROP CONSTRAINT IF EXISTS legal_acceptance_outbox_user_id_fkey;

COMMENT ON COLUMN public.legal_acceptance_outbox.user_id IS
  'Auth user id (no FK). Independent durable key so consent intent survives even when the profiles row '
  'is not yet present; the drain resolves it into legal_acceptances (which keeps its profiles FK).';

COMMIT;

-- ============================================================================
-- DOWN (reversible — only if every outbox.user_id already has a matching profiles row)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE public.legal_acceptance_outbox
--     ADD CONSTRAINT legal_acceptance_outbox_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
-- COMMIT;
