/**
 * Reads the public monthly price. The homepage's only source for a price.
 *
 * @spec [Doc 09 §1.4, §5.1 Stripe canonical for pricing magnitudes;
 *        Coding Standards §7.1 parse at every boundary, §11.2 no ad-hoc fetch
 *        in components] | @implemented [2026-09-03]
 *
 * plain English: asks the server what a month costs, and returns null when
 * there is no answer. Expected outcome: the card renders a real number or no
 * number. Trade-off: a null is indistinguishable to the caller between "not
 * configured" and "Stripe is down" — deliberately, because the card does the
 * same thing in both cases and giving a visitor a reason for a missing price
 * would leak billing configuration state.
 *
 * PLAIN `fetch`, NOT `csrfFetch`. This is an unauthenticated GET; there is no
 * session to send and no mutation to protect. `csrfFetch` would fetch a CSRF
 * token first, which is a second request and a cookie for a visitor who has
 * neither.
 *
 * THE PARSE IS THE POINT. `publicPricingSchema` refuses a null, zero or absent
 * `amountCents`, so `$NaN` has no path to the DOM. Returning `null` on a failed
 * parse rather than falling back to a constant is the rule this page exists
 * under: a hardcoded price is a second source for a fact Stripe owns.
 */
import {
  publicPlanPricesResponseSchema,
  publicPricingResponseSchema,
  type PublicPlanPrice,
  type PublicPricing,
} from "../../../packages/shared/src/billing-schema";

export async function getPublicMonthlyPrice(): Promise<PublicPricing | null> {
  const response = await fetch("/api/public/pricing");
  if (!response.ok) {
    return null;
  }
  const parsed = publicPricingResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.data : null;
}

/**
 * Formats an amount for display. Returns null rather than a string when the
 * price is absent, so a caller cannot accidentally render "null" or "$NaN" —
 * the absence has to be handled as an absence.
 */
export function formatMonthlyPrice(
  pricing: PublicPricing | null,
): string | null {
  if (!pricing) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: pricing.currency.toUpperCase(),
  }).format(pricing.amountCents / 100);
}

/**
 * Reads the three plans' public price tags for `/parent`.
 *
 * @spec [Doc 09 §1.4, §5.1; owner brief 2026-11-22 (prices load live; skeleton while loading;
 *        tiles hidden on failure)] | @implemented [2026-11-22]
 *
 * plain English: asks the server for every plan's price, and returns null when there is no
 * answer, so the page hides its price tiles instead of showing a remembered number. Same
 * posture as `getPublicMonthlyPrice`: plain `fetch`, parse at the boundary, no fallback.
 */
export async function getPublicPlanPrices(): Promise<
  readonly PublicPlanPrice[] | null
> {
  const response = await fetch("/api/public/pricing/plans");
  if (!response.ok) {
    return null;
  }
  const parsed = publicPlanPricesResponseSchema.safeParse(
    await response.json(),
  );
  return parsed.success ? parsed.data.data.plans : null;
}

/** "$29.99", in the price's own currency. */
export function formatPlanAmount(
  amountCents: number,
  currency: string,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

/**
 * The yearly plan's "Best value · save N%" and "about $X a month", computed from the live
 * monthly and yearly prices.
 *
 * N is rounded DOWN, so the label never claims a cent more saving than the prices give
 * (29.6% reads "save 29%", not "save 30%"). Returns null when either price is absent, the
 * currencies differ, or the yearly plan saves nothing — then the card shows no saving rather
 * than an invented or zero one.
 */
export function yearlySavings(
  plans: readonly PublicPlanPrice[],
): { readonly savePercent: number; readonly aboutPerMonth: string } | null {
  const monthly = plans.find((p) => p.plan === "monthly");
  const yearly = plans.find((p) => p.plan === "yearly");
  if (!monthly || !yearly || monthly.currency !== yearly.currency) return null;
  const savePercent = Math.floor(
    (1 - yearly.amountCents / (monthly.amountCents * 12)) * 100,
  );
  if (savePercent < 1) return null;
  return {
    savePercent,
    aboutPerMonth: formatPlanAmount(
      Math.round(yearly.amountCents / 12),
      yearly.currency,
    ),
  };
}
