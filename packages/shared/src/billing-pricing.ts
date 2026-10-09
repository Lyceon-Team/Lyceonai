/**
 * @spec [Doc 09 §1.4, §5.1 Stripe is canonical for pricing magnitudes at
 *        runtime; Coding Standards §3.4, §4.1, §11.1, §17]
 * @implemented 2026-09-27
 *
 * plain English: given the live Stripe amounts, work out the per-month
 * equivalent of a plan and how much it saves against the live monthly price.
 * Expected outcome: every number a price card displays is a function of the
 * amounts Stripe returned this request. Trade-off: when an amount is missing the
 * answer is `null`, and the caller renders nothing — there is no default.
 *
 * WHY THIS EXISTS AT ALL. `/upgrade` printed "$59.99" as the monthly price and
 * "$99.99 / month equivalent" directly beneath it, and "33.3% off" on a
 * quarterly that was 17% off the live monthly. The headline came from Stripe;
 * the equivalent and the percentage came from a hardcoded `fallbackPlans` table
 * that nobody updated when the prices changed — and could not have, because the
 * route never sent those two fields, so the fallback was not a fallback but the
 * only source. One fact, two sources, and the page contradicted itself one line
 * apart (owner report 2026-09-27).
 *
 * A DERIVATION IS NOT DATA. Neither value is transmitted. Sending a computed
 * `savingsPercent` alongside the amounts it is computed from would recreate the
 * defect one layer up: two representations of one fact, free to drift the moment
 * one is updated and the other is not. Both are computed here, at render, from
 * the amounts themselves.
 *
 * trade-offs / edge cases:
 *  - A week or day interval has no whole number of months, so
 *    `equivalentMonthlyCents` is null rather than an approximation. No Lyceon
 *    price uses one; a card would render its headline amount and no equivalent.
 *  - The monthly plan's own equivalent is itself — reporting it would print the
 *    same number twice — so `equivalentMonthlyCents` is null for a one-month
 *    interval and `savingsPercent` is null for the plan it is measured against.
 *  - `savingsPercent` is computed from the UNROUNDED per-month figure, so the
 *    percentage does not inherit a rounding error from the number displayed
 *    next to it.
 *  - A plan priced above monthly yields a negative percentage. It is returned as
 *    computed and not clamped: callers show a saving only when it is positive,
 *    and silently swallowing an inverted price would hide a misconfiguration.
 */
import type { BillingPlanMetadata } from "./billing-schema";

/** Months in one billing interval, or null when it is not a whole number. */
export function monthsInInterval(
  interval: BillingPlanMetadata["interval"],
  intervalCount: BillingPlanMetadata["intervalCount"],
): number | null {
  if (!interval || !intervalCount || intervalCount < 1) return null;
  if (interval === "month") return intervalCount;
  if (interval === "year") return intervalCount * 12;
  return null;
}

export type BillingPlanPricing = {
  /** `unit_amount ÷ months`, rounded to the cent. Null for a 1-month interval. */
  readonly equivalentMonthlyCents: number | null;
  /** Percent saved against the live monthly price. Null when not computable. */
  readonly savingsPercent: number | null;
};

/**
 * Derive the display figures for one plan against the live monthly price.
 *
 * `monthlyAmountCents` is the monthly plan's OWN live amount, from the same
 * response. Passing null (monthly unconfigured, or Stripe silent) removes the
 * basis for a percentage, so none is returned.
 */
export function deriveBillingPlanPricing(
  plan: Pick<
    BillingPlanMetadata,
    "amountCents" | "interval" | "intervalCount"
  >,
  monthlyAmountCents: number | null,
): BillingPlanPricing {
  const months = monthsInInterval(plan.interval, plan.intervalCount);
  const amount = plan.amountCents;

  if (amount === null || months === null) {
    return { equivalentMonthlyCents: null, savingsPercent: null };
  }

  // Unrounded, so the percentage below does not inherit the display rounding.
  const perMonth = amount / months;

  const equivalentMonthlyCents = months === 1 ? null : Math.round(perMonth);

  const savingsPercent =
    months === 1 || monthlyAmountCents === null || monthlyAmountCents <= 0
      ? null
      : (1 - perMonth / monthlyAmountCents) * 100;

  return { equivalentMonthlyCents, savingsPercent };
}

/** The monthly plan's live amount from a plans response, or null. */
export function monthlyAmountFrom(
  plans: readonly Pick<BillingPlanMetadata, "plan" | "amountCents">[],
): number | null {
  return plans.find((p) => p.plan === "monthly")?.amountCents ?? null;
}

/**
 * Which plan genuinely costs least per month, or null when nothing can be ranked.
 *
 * "Best value" is a CLAIM, and it was hardcoded to `plan === "yearly"`. That is
 * true of today's prices and is not guaranteed by anything: reprice the yearly
 * above the quarterly per month and the badge keeps pointing at the worse deal,
 * with the live figures printed underneath contradicting it. Same defect as the
 * stale equivalent — an assertion about prices that does not read the prices.
 *
 * Ties return null: two plans at the same per-month rate have no best, and
 * picking one arbitrarily would be a coin toss presented as advice.
 */
export function bestValuePlan(
  plans: readonly Pick<
    BillingPlanMetadata,
    "plan" | "amountCents" | "interval" | "intervalCount"
  >[],
): BillingPlanMetadata["plan"] | null {
  const ranked = plans
    .map((p) => {
      const months = monthsInInterval(p.interval, p.intervalCount);
      return p.amountCents !== null && months !== null
        ? { plan: p.plan, perMonth: p.amountCents / months }
        : null;
    })
    .filter((r): r is { plan: BillingPlanMetadata["plan"]; perMonth: number } =>
      r !== null,
    )
    .sort((a, b) => a.perMonth - b.perMonth);

  if (ranked.length < 2) return null;
  const [first, second] = ranked;
  if (!first || !second) return null;
  return first.perMonth < second.perMonth ? first.plan : null;
}
