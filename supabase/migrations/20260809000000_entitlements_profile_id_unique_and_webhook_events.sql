-- @spec [Doc-01_V8 §20–§24; genesis.sql:168–181 | STRIPE-001]
-- @implemented 2026-08-09
-- plain English: two schema additions required for the entitlement write path to function:
--   1. UNIQUE(profile_id) on entitlements — the upsert onConflict target.
--   2. stripe_webhook_events table — idempotency gate for webhook processing.
-- Both are genesis-true (added to genesis in the same change).
-- NOTE: Karl applies migrations — this is UNAPPLIED until reviewed.

-- LYCEON-MIGRATION-REVIEWED

-- == ROLLBACK ==
-- ALTER TABLE public.entitlements DROP CONSTRAINT IF EXISTS entitlements_profile_id_unique;
-- DROP TABLE IF EXISTS public.stripe_webhook_events;

-- 1. Add UNIQUE constraint on entitlements.profile_id so the PostgREST upsert
--    (onConflict: "profile_id") can target it. Without this, the first real
--    subscription webhook would error with "there is no unique or exclusion
--    constraint matching the ON CONFLICT specification".
ALTER TABLE public.entitlements
  ADD CONSTRAINT entitlements_profile_id_unique UNIQUE (profile_id);

-- 2. Stripe webhook idempotency gate. The handler inserts the event id before
--    processing; a 23505 (unique_violation) on replay means "already processed".
--    Rollback deletes the row on handler failure so the event can be retried.
CREATE TABLE public.stripe_webhook_events (
  id         TEXT PRIMARY KEY,           -- Stripe event id (evt_...)
  type       TEXT NOT NULL,              -- Stripe event type
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.stripe_webhook_events IS 'Idempotency gate for Stripe webhook processing (STRIPE-001)';
