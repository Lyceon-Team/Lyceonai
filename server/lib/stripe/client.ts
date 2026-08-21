/**
 * @spec [Doc-01_V8 §22.3; SCL-042 Stripe-native supremacy; SCL-049 livemode] @implemented 2026-08-20
 *
 * plain English: the single Stripe SDK factory and the single source of the
 * environment's expected Stripe mode. Rebuilt in Phase C, not patched — the
 * previous module invented a `STRIPE_SECRET_KEY_LIVE` / `_TEST` fallback pair
 * that appears in no spec section and in no environment inventory
 * (STRIPE_GROUNDING_AUDIT G-24). That fallback is gone; the seven variables the
 * owner confirmed exist are the only ones read.
 *
 * expected outcome: `getStripeClient()` returns a configured Stripe client, and
 * `getExpectedLivemode()` returns the boolean the webhook handler asserts
 * `event.livemode` against.
 *
 * trade-offs / edge cases:
 *  - `getExpectedLivemode()` THROWS when `STRIPE_ENV` is unset rather than
 *    defaulting. A missing mode selector means the environment cannot assert
 *    mode at all, and a silent default is exactly the blindness SCL-049 exists
 *    to close. Fail closed, loudly.
 *  - `STRIPE_ENV` is only a real control once it is scoped per environment in
 *    Vercel. Today it is scoped All Environments, so every environment computes
 *    the same expected mode. This module is defence in depth; the configuration
 *    is the control. See SCL-049 and docs/plans/Stripe_Phase_C_Preflight.md §3.
 *  - No `apiVersion` is pinned: the SDK's bundled default governs. Pinning is
 *    desirable but is a deliberate, separately-verified change — guessing a
 *    version string here would break every call.
 */
import Stripe from "stripe";

export type StripeMode = "live" | "test";

/**
 * The environment's declared Stripe mode. Throws when unset — see module header.
 */
export function getStripeMode(): StripeMode {
  const raw = process.env.STRIPE_ENV;
  if (!raw) {
    throw new Error(
      "STRIPE_ENV is not configured. The webhook livemode assertion (SCL-049) " +
        "cannot run without an explicit per-environment mode.",
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "live") return "live";
  if (normalized === "test") return "test";
  throw new Error(
    `STRIPE_ENV must be "live" or "test"; received an unrecognised value of length ${raw.length}.`,
  );
}

/**
 * The boolean `event.livemode` must equal for this environment to accept an event.
 */
export function getExpectedLivemode(): boolean {
  return getStripeMode() === "live";
}

function requireSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  return key;
}

/**
 * Construct a Stripe client. Not cached: the key is read per call so a rotation
 * takes effect without a redeploy.
 */
export function getStripeClient(): Stripe {
  return new Stripe(requireSecretKey());
}

/**
 * The publishable key, for the client bundle. Public by design.
 */
export function getStripePublishableKey(): string {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error("STRIPE_PUBLISHABLE_KEY is not configured.");
  }
  return key;
}

/**
 * Canonical Stripe Price ID per billing period.
 *
 * NOTE the `PARENT_` variable names encode a payer assumption SCL-043 breaks —
 * the same three prices serve student, guardian, and third-party payers, and all
 * three resolve to the single entitlement tier `premium` (SCL-052). Renaming is
 * an owner action because it touches Vercel configuration; proposal recorded in
 * docs/plans/Stripe_Phase_C_Preflight.md §6. This reads the current names.
 */
export const BILLING_PERIODS = ["monthly", "quarterly", "yearly"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

const PRICE_ENV_VAR: Record<BillingPeriod, string> = {
  monthly: "STRIPE_PRICE_PARENT_MONTHLY",
  quarterly: "STRIPE_PRICE_PARENT_QUARTERLY",
  yearly: "STRIPE_PRICE_PARENT_YEARLY",
};

export function getPriceId(period: BillingPeriod): string {
  const varName = PRICE_ENV_VAR[period];
  const value = process.env[varName];
  if (!value) {
    throw new Error(`${varName} is not configured.`);
  }
  if (!value.startsWith("price_")) {
    throw new Error(`${varName} is not a Stripe Price ID.`);
  }
  return value;
}

export function getConfiguredPriceId(period: BillingPeriod): string | null {
  const value = process.env[PRICE_ENV_VAR[period]];
  return value && value.startsWith("price_") ? value : null;
}
