/**
 * Guardian-paid checkout — one subscription, one item per entitled student.
 *
 * @spec [SCL-043 payer identity; SCL-045 one SubscriptionItem per student;
 *        Doc 01 V8 §31.3; Charter §6] | @implemented [2026-08-27]
 *
 * plain English: builds the Checkout line items for a guardian paying for their
 * linked students — one line per student, each stamped with that student's
 * profile id. Expected outcome: N items for N students, and the webhook can
 * tell which item entitles whom. Trade-off: the student list is read from
 * `guardian_links` server-side and never taken from the request, so a guardian
 * cannot name a student they are not linked to; the cost is that a guardian
 * cannot choose a SUBSET of their students in one checkout, which is called out
 * as an open question rather than silently decided. Edge case: a guardian with
 * no active links cannot check out at all, which is correct — there is nobody
 * to entitle.
 *
 * CHARTER §6 — NO CALLER-SUPPLIED VALUE GATES ENTITLEMENT. The request carries
 * only a plan. Every `student_profile_id` stamped onto a line item comes from
 * an ACTIVE row in `guardian_links` read on the server. A guardian who posts a
 * student id they are not linked to changes nothing, because the request's
 * student ids are never read.
 *
 * UNVERIFIED, AND DELIBERATELY NOT WORKED AROUND: whether Checkout propagates
 * `line_items[].metadata` onto the resulting SubscriptionItem. The pinned SDK
 * exposes the parameter (`Checkout/SessionsResource.d.ts`,
 * `line_items[].metadata?: Stripe.MetadataParam`) but type definitions cannot
 * say what the API does with it, `docs.stripe.com` is egress-blocked from this
 * environment, and `STRIPE_BILLING_DIAGNOSTICS` is absent so the probe cannot be
 * run. §3 of the 4.8 plan is that probe.
 *
 * THE FAILURE MODE IF IT DOES NOT PROPAGATE IS SAFE, WHICH IS WHY THIS SHIPS
 * AHEAD OF THE PROBE: items would arrive carrying no `student_profile_id`, and
 * `resolveEntitlementItem` returns null for a multi-item subscription with no
 * match, so `writeEntitlementsFromSubscription` fails closed and grants NOTHING.
 * It cannot grant the WRONG student — that is the outcome worth ruling out.
 */
import type { GuardianLink } from "../../../packages/shared/src/guardian-link-schema";

/** One Checkout line item, stamped with the student it entitles. */
export type GuardianLineItem = {
  readonly price: string;
  readonly quantity: 1;
  readonly metadata: { readonly student_profile_id: string };
};

export type GuardianCheckoutPlan =
  | { readonly ok: true; readonly lineItems: readonly GuardianLineItem[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the line items for a guardian's checkout.
 *
 * Pure and deterministic: same links and price in, same items out, in the
 * reader's `created_at` order. No IO, so the link read has exactly one owner.
 *
 * @param activeLinks  ACTIVE guardian links, read server-side
 * @param priceId      the price for the chosen plan
 */
export function buildGuardianLineItems(
  activeLinks: readonly GuardianLink[],
  priceId: string,
): GuardianCheckoutPlan {
  if (activeLinks.length === 0) {
    return {
      ok: false,
      reason:
        "guardian has no active linked students, so there is nobody to entitle. " +
        "Not an error state to paper over: a subscription with zero items is " +
        "not a thing Stripe will create, and charging a guardian for nothing " +
        "would be worse than refusing.",
    };
  }

  const seen = new Set<string>();
  const lineItems: GuardianLineItem[] = [];

  for (const link of activeLinks) {
    const studentProfileId = link.student_profile_id;
    if (!studentProfileId) continue;

    // A duplicate would create two items entitling one student, and after
    // migration 20260827010000 the second would collide on
    // `entitlements_profile_id_unique` at write time — a failure discovered
    // after the money moved. `unique_active_link` should already prevent this;
    // the guard is here because "should" is not a constraint we control from
    // this side of the call.
    if (seen.has(studentProfileId)) continue;
    seen.add(studentProfileId);

    lineItems.push({
      price: priceId,
      quantity: 1,
      metadata: { student_profile_id: studentProfileId },
    });
  }

  if (lineItems.length === 0) {
    return {
      ok: false,
      reason:
        "guardian has links but none names a student profile — a shape the " +
        "schema should make impossible, so it fails closed rather than " +
        "creating an empty subscription.",
    };
  }

  return { ok: true, lineItems };
}
