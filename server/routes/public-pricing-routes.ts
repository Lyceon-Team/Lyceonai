/**
 * GET /api/public/pricing — the monthly price, for people who are not logged in.
 *
 * @spec [Doc 09 §1.4, §5.1 Stripe is canonical for pricing magnitudes at
 *        runtime; Coding Standards §8.1 thin handler, §8.2 response shape,
 *        §12.1 redacted logging] | @implemented [2026-09-03]
 *
 * plain English: reads one Stripe Price and reports its amount, currency and
 * interval. Expected outcome: the homepage can quote a real number to a
 * stranger. Trade-offs and edge cases are the four notes below.
 *
 * WHY A SECOND ROUTE RATHER THAN AN EXEMPTION. `GET /api/billing/plans` is
 * `requireSupabaseAuth` (`billing-routes.ts:973-974`) and stays that way: an
 * auth exemption added for a marketing page is a gate weakened for every other
 * caller of that route, and it returns all three prices plus configuration
 * state. This returns three fields and nothing that describes the billing
 * setup behind them (owner ruling 2026-09-03).
 *
 * THIS IS THE FIRST UNAUTHENTICATED ROUTE IN THE APP THAT REACHES STRIPE, and
 * the first `/api/public/*` mount. `globalRateLimiter` (`server/index.ts:185`)
 * caps each IP at 1000 requests per 15 minutes, which bounds one caller but not
 * distributed load — a hundred IPs are a hundred separate buckets. What bounds
 * calls to STRIPE is the memo below, and only the memo. It is load-bearing, not
 * an optimisation.
 *
 * THE MEMO IS IN-PROCESS ON PURPOSE. No cache utility exists in this repo and
 * adding one is a dependency-shaped decision, so this holds the result in a
 * module-level variable for 15 minutes (owner-approved TTL). A price change is
 * a deliberate act rather than a live feed, so the window bounds how long a
 * stale figure can be quoted rather than costing accuracy.
 *
 * FAILURES ARE MEMOISED TOO, FOR A SHORTER WINDOW. Caching only successes
 * would mean a Stripe outage put every public request straight through to
 * Stripe — the exact traffic the memo exists to bound, arriving precisely when
 * Stripe is least able to take it. So a failure is held for 60 seconds. The
 * honest bound is therefore ~4 Stripe calls/hour in steady state and at most
 * ~60/hour during a sustained outage, not "~4/hour regardless" — recovery
 * inside a minute is worth more than the tighter number.
 */
import { Request, Response, Router } from "express";
import { getStripeClient, getConfiguredPriceId } from "../lib/stripe/client";
import {
  publicPricingSchema,
  type PublicPricing,
} from "../../packages/shared/src/billing-schema";
import { logger } from "../logger";

const router = Router();

/** The owner-approved TTLs. Successes are cheap to hold; failures are not. */
const SUCCESS_TTL_MS = 15 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;

/**
 * `no_price` is not an error state — it is the answer when
 * `STRIPE_PRICE_PARENT_MONTHLY` is unconfigured. It is memoised on the failure
 * TTL so that configuring the variable takes effect within a minute.
 */
type PricingOutcome =
  | { readonly kind: "price"; readonly pricing: PublicPricing }
  | { readonly kind: "no_price" }
  | { readonly kind: "unavailable" };

type Memo = { readonly expiresAtMs: number; readonly outcome: PricingOutcome };

let memo: Memo | null = null;

/** Test-only reset. Nothing in the request path calls this. */
export function __resetPublicPricingMemoForTests(): void {
  memo = null;
}

/**
 * Read the monthly price from Stripe.
 *
 * The Zod parse is the anti-`$NaN` boundary: Stripe's `unit_amount` is
 * `number | null`, and a price with no amount (a `custom_unit_amount` price,
 * say) must produce "no price" rather than a null that a formatter turns into
 * `$NaN`. `publicPricingSchema` refuses null, zero and a missing key, so an
 * unrenderable amount cannot leave this function as data.
 */
async function readMonthlyPrice(): Promise<PricingOutcome> {
  const priceId = getConfiguredPriceId("monthly");
  if (!priceId) {
    logger.warn(
      "BILLING",
      "public_pricing",
      "STRIPE_PRICE_PARENT_MONTHLY is not configured; serving no price",
      {},
    );
    return { kind: "no_price" };
  }

  const price = await getStripeClient().prices.retrieve(priceId);
  const parsed = publicPricingSchema.safeParse({
    amountCents: price.unit_amount,
    currency: price.currency?.toLowerCase(),
    interval: price.recurring?.interval,
  });

  if (!parsed.success) {
    /**
     * Reached when the configured price is not a simple monthly recurring
     * price — a yearly id in the monthly variable, or a price with no fixed
     * amount. Publishing "per month" beside a yearly amount is a worse outcome
     * than publishing nothing, so this is a refusal rather than a coercion.
     * The Stripe price id is deliberately absent from the log line.
     */
    logger.warn(
      "BILLING",
      "public_pricing",
      "Configured monthly price is not a fixed monthly recurring amount",
      { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
    );
    return { kind: "no_price" };
  }

  return { kind: "price", pricing: parsed.data };
}

async function resolveOutcome(): Promise<PricingOutcome> {
  const now = Date.now();
  if (memo && memo.expiresAtMs > now) {
    return memo.outcome;
  }

  try {
    const outcome = await readMonthlyPrice();
    memo = {
      outcome,
      expiresAtMs:
        now + (outcome.kind === "price" ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
    };
    return outcome;
  } catch (err: unknown) {
    /**
     * Stripe unreachable, or misconfigured credentials. Never a fallback
     * amount: a hardcoded price is two sources for one fact on the page that
     * quotes money to strangers. The message is logged; no request body, no
     * key material, no price id.
     */
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error(
      "BILLING",
      "public_pricing",
      "Failed to read the monthly price from Stripe",
      { message },
    );
    const outcome: PricingOutcome = { kind: "unavailable" };
    memo = { outcome, expiresAtMs: now + FAILURE_TTL_MS };
    return outcome;
  }
}

router.get("/pricing", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const outcome = await resolveOutcome();

  if (outcome.kind === "price") {
    /**
     * A public, shared cache is correct here: the response carries no
     * per-viewer content, and the max-age matches the memo so an edge cache and
     * this process go stale together rather than compounding.
     */
    res.setHeader("Cache-Control", "public, max-age=900");
    return res.json({ data: outcome.pricing });
  }

  res.setHeader("Cache-Control", "public, max-age=60");

  /**
   * THE ONE DEPARTURE FROM THE APPROVED CONTRACT, AND IT IS DELIBERATE.
   * The contract read "404 / { error } when the price is unconfigured or
   * Stripe fails". Both are reported as `{ error }` and both render the card
   * with no price line, so the client contract is unchanged — but they are
   * split across two status codes, because collapsing them makes a
   * misconfiguration and a Stripe outage indistinguishable to anything
   * watching this route, and those need different people woken up.
   */
  if (outcome.kind === "no_price") {
    return res.status(404).json({
      error: {
        message: "No monthly price is available.",
        code: "PRICE_NOT_CONFIGURED",
        requestId,
      },
    });
  }

  return res.status(502).json({
    error: {
      message: "No monthly price is available.",
      code: "PRICE_UNAVAILABLE",
      requestId,
    },
  });
});

export default router;
