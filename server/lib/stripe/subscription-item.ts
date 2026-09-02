/**
 * @spec [Doc-01_V8 §20 as amended by SCL-045 (subscription ITEM is the
 *        entitlement key); Doc-01_V8 §22 Stripe webhook handling]
 * @implemented [2026-08-26]
 *
 * plain English: resolve the one subscription item that funds a given student,
 * and read everything entitlement needs from THAT item — its price and its
 * billing period.
 *
 * Why this exists as a single accessor rather than two field reads:
 *
 * Stripe removed `current_period_start` / `current_period_end` from the
 * Subscription object in API version `2025-03-31.basil` and added them to
 * SubscriptionItem. stripe-node's own CHANGELOG for 18.0.0 (2025-04-01) records
 * both halves under "Breaking changes due to changes in the Stripe API":
 *
 *   * Remove support for `current_period_end` and `current_period_start` on `Subscription`
 *   * Add support for `current_period_end` and `current_period_start` on `SubscriptionItem`
 *
 * This repo pins `stripe@20.4.1`, whose bundled API version is
 * `2026-02-25.clover`, and `client.ts` deliberately pins no `apiVersion`, so the
 * bundled default governs every `subscriptions.retrieve` this handler makes.
 * Reading the period from the Subscription therefore yields `undefined` — which
 * the boundary schema correctly normalised to `null`, writing NULL period bounds
 * onto a live entitlement row rather than failing loudly.
 *
 * SCL-045 independently requires item-level access: "One SubscriptionItem per
 * entitled student, each carrying `metadata.student_profile_id` ... Entitlement
 * is keyed on the subscription **item**, not the subscription." The period fix
 * and the multi-student key are the same access path, so it is built once here
 * instead of twice at two call sites.
 *
 * expected outcome: for a given student, the item that funds them, with a price
 * id and period bounds taken from the same object.
 *
 * trade-offs / edge cases:
 *  - Individual billing is the one-item case, not a separate path (SCL-045). A
 *    single item with no metadata resolves for whichever student the webhook
 *    subject named; that is today's production shape.
 *  - Ambiguity is NOT resolved by guessing. Several items with none matching the
 *    student returns null, and the caller fails closed. Silently taking
 *    `data[0]` there would bill one student's period onto another's entitlement.
 *  - Period fields stay `nullish` in the schema rather than required. Stripe
 *    types them non-null on the item, but a boundary must not throw on a shape
 *    Stripe may vary; the caller decides what a missing period means.
 */
import { z } from "zod";

/** A single subscription item, carrying its own price, period and metadata. */
export const stripeSubscriptionItemSchema = z.object({
  id: z.string().min(1),
  price: z.object({ id: z.string() }).nullish(),
  current_period_start: z.number().int().nullish(),
  current_period_end: z.number().int().nullish(),
  metadata: z
    .object({ student_profile_id: z.string().uuid().optional() })
    .passthrough()
    .nullish(),
});

export type StripeSubscriptionItem = z.infer<
  typeof stripeSubscriptionItemSchema
>;

/** What entitlement reads off the resolved item. */
export type ResolvedEntitlementItem = {
  itemId: string;
  priceId: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
};

function toResolved(item: StripeSubscriptionItem): ResolvedEntitlementItem {
  return {
    itemId: item.id,
    priceId: item.price?.id ?? null,
    currentPeriodStart: item.current_period_start ?? null,
    currentPeriodEnd: item.current_period_end ?? null,
  };
}

/**
 * The item funding `studentProfileId`, or null when it cannot be determined.
 *
 * Resolution order, and the order is the contract:
 *   1. the item whose `metadata.student_profile_id` names this student (SCL-045)
 *   2. otherwise the sole item, if there is exactly one (individual billing)
 *   3. otherwise null — ambiguous, and the caller must fail closed
 */
export function resolveEntitlementItem(
  items: readonly StripeSubscriptionItem[],
  studentProfileId: string,
): ResolvedEntitlementItem | null {
  const keyed = items.find(
    (item) => item.metadata?.student_profile_id === studentProfileId,
  );
  if (keyed) return toResolved(keyed);

  const [only] = items;
  if (items.length === 1 && only) return toResolved(only);

  return null;
}
