-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [SCL-045 item-level entitlement key] | @implemented [2026-08-27]
-- Phase 4 item 5.1, moved AHEAD of Phase 3 §4.8 by owner ruling 2026-08-27.
--
-- plain English: entitlement stops being keyed on the Stripe SUBSCRIPTION and
-- becomes keyed on the subscription ITEM, so one guardian's single subscription
-- can entitle several students — one item each. Expected outcome: the UNIQUE
-- that forbade a second row per subscription is gone, and a new UNIQUE on the
-- item id takes its place. Trade-offs and edge cases are spelled out below,
-- including exactly what happens to the one live row.
--
-- WHY THIS MOVED AHEAD OF THE BEHAVIOUR IT SERVES. Phase 4 was sequenced after
-- Phase 3 so schema would follow proven behaviour. §4.8 inverts that:
-- `entitlements_stripe_subscription_id_key` FORECLOSES the behaviour §4.8 would
-- have to prove, because a guardian paying for two students needs two rows
-- against one subscription and that constraint rejects the second outright.
-- Schema cannot follow behaviour that the schema prevents.
--
-- =====================================================================
-- WHAT HAPPENS TO THE ONE LIVE ENTITLEMENT ROW
-- =====================================================================
-- Read from production 2026-08-27, exactly one row exists:
--
--   profile_id              3f18cbe2-a999-41d4-852b-2af27e19d04e
--   tier / status           premium / active
--   stripe_subscription_id  sub_1U8pinDPtjyWEVqEAB7wwjn3
--   stripe_price_id         price_1SnWvoDPtjyWEVqEohJvlvvq
--   current_period_start    NULL
--   current_period_end      NULL
--
-- After this migration that row is UNCHANGED except that it gains a new column
-- holding NULL:
--
--   * It KEEPS its premium/active entitlement. Nothing here touches tier or
--     status, so the student does not lose access for a moment.
--   * It KEEPS `stripe_subscription_id`. Only the UNIQUE constraint on that
--     column is dropped — the column and its value stay, so
--     `getEntitlementBySubscriptionId` still resolves this row.
--   * `stripe_subscription_item_id` is NULL for it. The item id is not
--     derivable in SQL — it requires a Stripe API call — so this migration does
--     NOT invent one. The value arrives on the next
--     `customer.subscription.updated` for that subscription, when the handler
--     re-fetches and writes the resolved item.
--   * NULL does not collide with the new UNIQUE: PostgreSQL treats NULLs as
--     distinct, so any number of rows may carry NULL here. That is deliberate —
--     a NOT NULL would have required backfilling a value we cannot compute, and
--     would have failed this migration on the one row we have.
--
-- The NULL periods are pre-existing and are NOT repaired here: they were caused
-- by the top-level-period defect fixed in #653, and backfilling them is a data
-- operation with its own proof obligation, not a side effect of a schema change.
--
-- =====================================================================
-- WHAT IS DELIBERATELY KEPT
-- =====================================================================
-- `entitlements_profile_id_unique` STAYS. It is the `ON CONFLICT (profile_id)`
-- target of the existing write path (`upsertEntitlement`), and dropping it
-- breaks every entitlement write immediately. It is a unique INDEX in
-- production, not a table constraint — see genesis.sql:187 and PR #659.
--
-- NOTE THE TENSION, recorded rather than silently resolved: with
-- `profile_id` still unique, a student can hold exactly one entitlement row,
-- which is correct. But it also means the guardian case works only because each
-- student gets their OWN row keyed to their OWN item — not because one row
-- describes several students. That is the intended shape; it is written down
-- here so the next reader does not mistake the surviving constraint for an
-- oversight.

BEGIN;

-- 1. Drop the constraint that forecloses guardian-paid checkout.
--    IF EXISTS so a re-run is a no-op rather than an error.
ALTER TABLE public.entitlements
  DROP CONSTRAINT IF EXISTS entitlements_stripe_subscription_id_key;

-- 2. Add the item-level key. Nullable by necessity (see above), UNIQUE so two
--    students can never be attached to the same subscription item.
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id TEXT;

-- Separate statement so the column add and the constraint are independently
-- re-runnable; a partial application leaves a consistent shape either way.
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_stripe_subscription_item_id_key
  ON public.entitlements (stripe_subscription_item_id)
  WHERE stripe_subscription_item_id IS NOT NULL;

-- 3. Lookups by subscription are now one-to-MANY, so they need an index that
--    does not pretend otherwise. The old UNIQUE was doing this work implicitly.
CREATE INDEX IF NOT EXISTS idx_entitlements_stripe_subscription
  ON public.entitlements (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN public.entitlements.stripe_subscription_item_id IS
  'SCL-045: the subscription ITEM this entitlement is keyed to. One item per '
  'entitled student, so one guardian subscription can carry several. NULL on '
  'rows written before 2026-08-27 and backfilled by the next '
  'customer.subscription.updated for that subscription — the item id is not '
  'derivable in SQL.';

COMMIT;

-- =====================================================================
-- CODE THAT MUST CHANGE WITH THIS MIGRATION — named, not left to be found
-- =====================================================================
-- `getEntitlementBySubscriptionId` (server/lib/account.ts) uses `maybeSingle()`,
-- which was correct while `stripe_subscription_id` was UNIQUE and is wrong the
-- moment a guardian subscription backs several rows. It must return a list.
--
-- The dispute and refund paths (`resolveEntitlementForCharge`) fail closed when
-- a charge maps to several entitlements. Before this migration that was
-- ambiguity worth refusing; after it, a guardian's single invoice legitimately
-- covers several students, so "several" becomes the normal case and those paths
-- must act on ALL items on the disputed or refunded invoice.
--
-- Neither change is made in this migration. Both are named in §4.8's plan.
