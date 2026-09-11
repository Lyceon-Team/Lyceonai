/**
 * One resolver for "what does this profile's billing state mean on screen".
 *
 * @spec [Doc 01 V8 §20–§24 entitlements; §31.1–§31.3 guardian derivation;
 *        SCL-029 the platform predicate is the one definition of "entitled";
 *        Charter §7 one fact, one source] | @implemented [2026-09-03]
 *
 * plain English: turns the two facts a profile's entitlement row carries —
 * `status` and `tier` — into the three answers every billing surface asks.
 * Expected outcome: the guardian branch of `GET /api/billing/status` and the
 * self-pay branch produce the SAME verdict from the same inputs, because they
 * call this and nothing else.
 *
 * THE RULE, STATED ONCE (owner ruling 2026-09-03).
 * `entitlement_active(profile_id)` — `status IN ('active','past_due','trialing')`,
 * verified against the live function body — is the STANDING-GOOD predicate: is
 * billing in good order? `entitlements.tier` is the PRODUCT: what was bought.
 * Both are needed and neither is redundant. A surface consults both THROUGH
 * THIS FUNCTION, never one branch through one and the other branch through the
 * other. That split is precisely the defect this closes: `billing-routes.ts`
 * applied `tier === "premium"` on the self-pay branch and applied no tier check
 * at all on the guardian branch, so one route's two arms could disagree about
 * one student.
 *
 * NOT A GATE. Access is decided server-side by the SQL predicate on every
 * request. This is presentation: which control a surface offers, and what it
 * says. Nothing here authorises anything.
 *
 * trade-offs: takes plain values rather than reading the row itself, so it is
 * pure, synchronous, and testable without a database — and so the caller that
 * already holds the row does not pay for a second read.
 *
 * edge cases: `"missing"` (no entitlement row at all) is a first-class input,
 * not an absent one; it is the state of every profile that has never bought
 * anything, and it must resolve to "offer a purchase", never to "reactivate".
 */
import type { EntitlementStatus, EntitlementTier } from "./account";

/**
 * Statuses that mean a payment needs the customer's attention.
 *
 * `past_due` is IN the standing-good set — SCL-029 rules a student mid-retry
 * entitled, "a student whose card is mid-retry does not lose their tutor" — so
 * it is simultaneously entitled and worth mentioning. That combination is the
 * whole reason this returns three independent booleans rather than one enum:
 * the guardian lockout existed because one surface treated "worth mentioning"
 * as "not entitled".
 */
const PAYMENT_ATTENTION_STATUSES: ReadonlySet<string> = new Set([
  "past_due",
  "unpaid",
]);

/**
 * Statuses that mean a subscription EXISTED and no longer grants access.
 *
 * The distinction that matters commercially: someone in this set can very often
 * reactivate in the Customer Portal for less than a fresh subscription costs,
 * and `evaluateSubjectPurchaseEligibility` will happily let us sell them a
 * SECOND one — none of these is in the platform predicate. Offering checkout
 * here is the wrong outcome; offering the portal is the right one.
 *
 * `incomplete` is deliberately absent: it means a first payment was never
 * completed, so there is nothing to reactivate and checkout is correct.
 */
const LAPSED_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

export type EntitlementDisplay = {
  /** Does this profile have the paid product right now? */
  readonly effectiveAccess: boolean;
  /** Is there a payment problem worth telling them about? */
  readonly needsPaymentUpdate: boolean;
  /** Did a subscription exist and stop granting access? */
  readonly lapsed: boolean;
};

export type EntitlementDisplayInput = {
  /**
   * The SQL predicate's verdict for this profile — `entitlement_active()` via
   * `EntitlementService`, NEVER re-derived here from `status`.
   *
   * @spec [SP25-001 — one evaluator; the divergent TS predicate was deleted]
   *
   * This parameter exists so that adding a product check did not smuggle a
   * second standing-good predicate back in. `status` below is presentation
   * metadata: it says WHICH kind of not-good, never WHETHER.
   */
  readonly standingGood: boolean;
  readonly tier: EntitlementTier | "free" | null;
  readonly status: EntitlementStatus | "missing" | null;
};

/**
 * The one derivation. Both branches of `/api/billing/status` call this.
 *
 * `effectiveAccess` requires BOTH facts: the predicate said billing is in good
 * standing, AND the row names the premium product. A row that is `active` on
 * the `free` tier is billing-healthy and grants nothing, which is exactly why
 * the predicate alone cannot answer this question — and why the guardian branch,
 * which consulted only the predicate, could disagree with the self-pay branch,
 * which consulted only a TS mirror of it plus tier.
 */
export function resolveEntitlementDisplay(
  input: EntitlementDisplayInput,
): EntitlementDisplay {
  const status = input.status ?? "missing";
  const tier = input.tier ?? "free";

  return {
    effectiveAccess: input.standingGood && tier === "premium",
    needsPaymentUpdate: PAYMENT_ATTENTION_STATUSES.has(status),
    lapsed: LAPSED_STATUSES.has(status),
  };
}
