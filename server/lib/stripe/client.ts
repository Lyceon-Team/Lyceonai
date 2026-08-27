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
 *  - **The mode is derived from the secret key in use, not declared separately.**
 *    An earlier revision read a `STRIPE_ENV` variable. That was two independent
 *    sources with no coupling: a misconfigured environment could hold a live key
 *    and declare `test`, and the assertion would agree with the declaration
 *    while the key told the truth. `STRIPE_ENV` has since been deleted from
 *    Vercel, which would have made the declaration `undefined` at runtime. The
 *    key prefix is the only fact that cannot disagree with the key.
 *  - `getExpectedLivemode()` THROWS when the key is missing or its prefix is
 *    unrecognised, rather than defaulting. An environment that cannot determine
 *    its own mode must not accept webhooks at all. Fail closed, loudly.
 *  - Scoping the key per environment in Vercel remains the control (SCL-049);
 *    this derivation removes the second, contradictable source but does not by
 *    itself separate environments. See docs/plans/Stripe_Phase_C_Preflight.md §3.
 *  - No `apiVersion` is pinned: the SDK's bundled default governs. Pinning is
 *    desirable but is a deliberate, separately-verified change — guessing a
 *    version string here would break every call.
 */
import Stripe from "stripe";

export type StripeMode = "live" | "test";

function requireSecretKeyRaw(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  return key;
}

/**
 * The Stripe mode of the key this process is actually using.
 *
 * Derived from the key prefix — Stripe secret keys are `sk_live_…` / `sk_test_…`
 * and restricted keys are `rk_live_…` / `rk_test_…`. There is no separate
 * declaration to contradict it.
 *
 * Throws on an unrecognised prefix: an environment that cannot determine its own
 * mode has no safe default.
 */
export function getStripeMode(): StripeMode {
  const key = requireSecretKeyRaw();
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  throw new Error(
    "STRIPE_SECRET_KEY has an unrecognised prefix; expected sk_live_, sk_test_, " +
      "rk_live_, or rk_test_. Cannot determine the Stripe mode, so no webhook " +
      "can be accepted.",
  );
}

/**
 * The boolean `event.livemode` must equal for this environment to accept an event.
 */
export function getExpectedLivemode(): boolean {
  return getStripeMode() === "live";
}

/**
 * Construct a Stripe client. Not cached: the key is read per call so a rotation
 * takes effect without a redeploy.
 */
export function getStripeClient(): Stripe {
  return new Stripe(requireSecretKeyRaw());
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
