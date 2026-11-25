-- ============================================================================
-- Billing lapse: the past_due grace deadline, and a once-only ledger for the lapse emails.
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see the rollback block below.
--
-- @spec [Doc 01 §21 (`past_due`: "Access continues for grace_period_days_past_due (default 7);
--       transitions to free after"), §22.1 (`invoice.payment_failed` → past_due grace), §23 (the
--       grace period and the day 0/3/6/8 emails); owner brief "Founding lapse flow" (Karl,
--       2026-11-24) and its rulings 1-8; SCL-289] | @implemented [2026-11-24]
--
-- plain English: `entitlement_active` counted `past_due` as entitled with no end, and
-- `entitlements.grace_period_ends_at` had no writer. From here:
--   1. `past_due` is entitled only until `grace_period_ends_at`. A `past_due` row whose deadline
--      is still NULL keeps Pro (ruling 2) until the daily billing-lapse job sets it to the earliest
--      unpaid invoice + 7 days. The deadline is written by the webhook on the first failed payment
--      (only when NULL) and by that job, and cleared when the subscription is active again
--      (rulings 1 and 6). It lives in the database; the client never sees or sets it.
--   2. `billing_lapse_notices` records each lapse email once per subscription and milestone, so a
--      rerun of the job or a redelivered webhook never sends a second one. A send claims its row
--      first and releases it if the send fails, so the next run can try again.
-- Nothing else changes: `active` and `trialing` are entitled as before, and every other reader
-- (`guardian_view_decision`, the tutor and the server's EntitlementService) calls this function,
-- so all of them follow the deadline with no change of their own.
--
-- rollback (by hand, in this order):
--   CREATE OR REPLACE FUNCTION public.entitlement_active(p_profile_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
--     SELECT EXISTS (SELECT 1 FROM public.entitlements e
--      WHERE e.profile_id = p_profile_id AND e.status IN ('active','past_due','trialing'));
--   $$;
--   DROP TRIGGER IF EXISTS entitlements_sync_tutor_conversations ON public.entitlements;
--   CREATE TRIGGER entitlements_sync_tutor_conversations
--     AFTER INSERT OR UPDATE OF status ON public.entitlements
--     FOR EACH ROW EXECUTE FUNCTION public.sync_tutor_conversations_on_entitlement_change();
--   DROP TABLE IF EXISTS public.billing_lapse_notices;
--   -- grace_period_ends_at values written meanwhile are harmless once the old body is back.
-- ============================================================================

BEGIN;

-- 1. The entitlement predicate honours the grace deadline.
CREATE OR REPLACE FUNCTION public.entitlement_active(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements e
     WHERE e.profile_id = p_profile_id
       AND (e.status IN ('active', 'trialing')
            OR (e.status = 'past_due'
                AND (e.grace_period_ends_at IS NULL OR e.grace_period_ends_at > now())))
  );
$$;
REVOKE ALL ON FUNCTION public.entitlement_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.entitlement_active(uuid) TO service_role;

-- 2. The tutor-severance trigger follows the predicate's new input.
--    20260922010000 fires `sync_tutor_conversations_on_entitlement_change` on `UPDATE OF status`
--    because the predicate read `status` and nothing else, and says THE COLUMN LIST IS COUPLED TO
--    THE PREDICATE'S BODY. The predicate now also reads `grace_period_ends_at`, so the trigger
--    fires on it too: clearing the deadline (paid) restores the tutor history at once. The
--    deadline PASSING is not a write, so the daily billing-lapse job rewrites each expired
--    deadline to itself (`touchExpiredDeadline`), and this trigger stamps the conversations then.
--    Test C1.7 (tests/ci/tutor-lapse-severance.pg.ci.test.ts) asserts the pair.
DROP TRIGGER IF EXISTS entitlements_sync_tutor_conversations ON public.entitlements;
CREATE TRIGGER entitlements_sync_tutor_conversations
  AFTER INSERT OR UPDATE OF status, grace_period_ends_at ON public.entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tutor_conversations_on_entitlement_change();

-- 3. The once-only ledger for the lapse emails.
CREATE TABLE public.billing_lapse_notices (
  stripe_subscription_id text        NOT NULL,
  notice                 text        NOT NULL CHECK (notice IN (
                           'card_needed_14', 'card_needed_7', 'card_needed_2',
                           'payment_failed_1', 'payment_failed_2', 'payment_failed_3',
                           'access_ended')),
  ref                    text        NOT NULL,
  claimed_at             timestamptz NOT NULL DEFAULT now(),
  sent_at                timestamptz NULL,
  PRIMARY KEY (stripe_subscription_id, notice, ref)
);
COMMENT ON TABLE public.billing_lapse_notices IS
  'Billing lapse emails (SCL-289): one row per subscription, notice and reference (the invoice date for card_needed_*, the invoice id for payment_failed_*, the subscription for access_ended). Inserted to claim a send, deleted if the send fails, sent_at set once it went. No address, no name, no amount.';
ALTER TABLE public.billing_lapse_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_lapse_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.billing_lapse_notices TO service_role;

COMMIT;
