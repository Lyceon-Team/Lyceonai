/**
 * One rule, both routes: nobody buys a subscription for a student who has one.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; SCL-029 the platform entitlement predicate
 *        is the one definition of "entitled"; Charter §7 one fact, one source]
 * @implemented [2026-09-02]
 *
 * plain English: refuses a checkout whose SUBJECT already holds an active
 * entitlement. Expected outcome: a student cannot come to hold two concurrent
 * subscriptions, whichever route the purchase starts from.
 *
 * WHAT WENT WRONG WITHOUT IT. The guardian route refused an already-covered
 * student; the self-pay route refused nothing. Student `3f18cbe2` bought on
 * 2026-08-15 (`sub_1U4bqZ…`) and again on 2026-08-26 (`sub_1U8pin…`). Both are
 * live and both bill yearly. Only the second reaches the entitlement row —
 * `upsertEntitlement` keys on `profile_id` with `onConflict`, so the second
 * purchase overwrote the first, which has billed unreferenced ever since.
 *
 * IT IS THE SUBJECT'S ENTITLEMENT, NEVER THE PAYER'S. A guardian who already
 * has premium access — derived from one linked student under §31.3's fold —
 * must still be able to buy for a second student who has none. So this asks
 * `isEntitlementActiveForProfile` about the STUDENT being bought for, which is
 * a per-profile question and does not consult the fold.
 *
 * WHY IT IS NOT THE GUARDIAN ROUTE'S EXISTING CHECK, LIFTED.
 * `subscriptionAlreadyFundsStudent` asks a different question of a different
 * source: "does THIS guardian's subscription already carry an item for this
 * student?" — a fact about Stripe, answerable before any webhook has landed.
 * This asks "does this student hold an entitlement, from anyone?" — a fact
 * about our database, true only after the webhook writes. Both are kept,
 * because the item check closes the window in which the row does not yet
 * exist. Two questions, two sources, one answer each: that is not the
 * duplication Charter §7 forbids.
 */
import { EntitlementService } from "../../services/entitlement-service";

export type PurchaseEligibility =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "STUDENT_ALREADY_FUNDED" | "ENTITLEMENT_UNREADABLE";
      readonly reason: string;
    };

/**
 * Is this student free to be subscribed for?
 *
 * Refuses on `active`, `past_due` AND `trialing` — the platform predicate's
 * whole set, verified against the live `entitlement_active` body on
 * 2026-09-02, not a narrower one chosen here.
 *
 * ON `past_due` SPECIFICALLY, because it is the one that looks arguable.
 * SCL-029 rules that a `past_due` student is ENTITLED: "a student whose card is
 * mid-retry does not lose their tutor", and the invariant's purpose is
 * "preventing unpaid access, not penalizing payment retry". So they still have
 * everything they paid for, and a second subscription would not fix the failing
 * card — it would leave the first one retrying and start charging twice. The
 * remedy for `past_due` is the Customer Portal, which is exactly what
 * `needsPaymentUpdate` already routes them to. Refusing here does not penalise
 * them; it declines to sell them something they already own.
 *
 * ON A SUBSCRIPTION WITH `cancel_at` SET, the other arguable case: blocked. It
 * is active today and the student keeps access until it lapses, so buying now
 * creates a SECOND concurrent subscription rather than replacing the first —
 * double billing for the whole overlap. Un-cancelling in the portal is the
 * cheaper, reversible action. Once it genuinely lapses the entitlement leaves
 * the predicate's set and this returns `ok`, so re-subscribing later is
 * unaffected. (Note that `entitlements.cancel_at_period_end` is a boolean and
 * Stripe's `cancel_at` is a date; neither is consulted here, and neither needs
 * to be — `status` alone decides, from one predicate.)
 */
export async function evaluateSubjectPurchaseEligibility(
  subjectProfileId: string,
): Promise<PurchaseEligibility> {
  const verdict =
    await EntitlementService.evaluateEntitlementActive(subjectProfileId);

  if (!verdict.ok) {
    /**
     * FAIL CLOSED TOWARDS NOT CHARGING. This is the opposite direction from
     * `isEntitlementActiveForProfile`, and deliberately so: there an unreadable
     * answer must deny ACCESS, here it must deny a CHARGE. Treating "cannot
     * tell" as "not entitled" would let a transient RPC failure re-open the
     * exact gap this guard closes, and the cost of that is a real second
     * subscription billing a real card.
     */
    return {
      ok: false,
      code: "ENTITLEMENT_UNREADABLE",
      reason:
        "We could not confirm this account's subscription status just now. Please try again in a moment.",
    };
  }

  if (verdict.active) {
    return {
      ok: false,
      code: "STUDENT_ALREADY_FUNDED",
      reason: "This student already has an active subscription.",
    };
  }

  return { ok: true };
}
