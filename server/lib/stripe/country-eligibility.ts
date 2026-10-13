/**
 * Tier-1 country eligibility — the one chokepoint.
 *
 * @spec [INV-03-08 Tier 1 country gating (Doc 03 §2156, heading verified);
 *        SCL-046 as amended 2026-08-27] | @implemented [2026-08-27]
 *
 * plain English: decides whether a billing country is allowed to hold premium.
 * Expected outcome: one function, one list, one answer — so the rule cannot
 * drift between the places that ask it. Trade-off: the Tier-1 list is read from
 * `entitlement_runtime_config` rather than hard-coded, so changing it is an
 * operator action rather than a deploy; the cost is that a missing config row
 * has to mean something, and it means FAIL CLOSED. Edge cases: an unknown
 * country (nobody has told us yet) is deliberately NOT the same as an
 * ineligible one, and the two must not share a branch.
 *
 * WHY THIS IS OURS AND NOT STRIPE'S. Four Stripe surfaces were evaluated and
 * all four fail — see `tests/ci/stripe-country-control-survey.contract.test.ts`,
 * which prints the survey and fails if Stripe ever ships the native control:
 *
 *   shipping_address_collection.allowed_countries  shipping only; and no
 *                                                  shipping address is collected
 *   automatic_tax (Stripe Tax)                     collects an address, restricts
 *                                                  nothing; unregistered country
 *                                                  is charged zero tax, not refused
 *   payment_method_configuration                   selects METHODS, not countries
 *   Radar rules + country Value Lists              blocks one PAYMENT at one
 *                                                  moment; INV-03-08 gates LISA
 *                                                  ACCESS on every request
 *
 * Radar is the closest and still wrong: it cannot gate a free-tier student, a
 * student entitled before any rule existed, or the SCL-043 guardian case where
 * the payer's country is not the student's. It is worth having as defence in
 * depth. It cannot be the control.
 *
 * WHERE THIS RUNS, AND THE TIMING PROBLEM. The gate cannot live wholly at
 * session creation, because at that moment there is no billing address to gate
 * on — the customer types it DURING Checkout. The SDK says so itself:
 * `customer_details.address` is "The customer's address after a completed
 * Checkout Session". So:
 *
 *   session creation            gate on a country we ALREADY know (returning
 *                               payer). Unknown -> cannot decide, must not block.
 *   checkout.session.completed  the DERIVATION point: read the billing country,
 *                               persist it, and refuse entitlement if ineligible.
 *   customer.updated            egress: the Portal lets the customer change the
 *                               billing address, so eligibility can lapse later.
 *
 * That is three call sites for one rule, which is exactly why the rule lives
 * here as one function rather than being written three times.
 *
 * WHICH OF THE THREE ARE ACTUALLY WIRED (2026-08-28). Stated plainly, because
 * this module previously described three call sites and had NONE — Codex
 * HIGH-1 called that "a fail-open money path", and it was right: a control
 * that is only described is worse than an absent one, because its presence
 * suggests the rule is enforced.
 *
 *   checkout.session.completed   WIRED. `server/lib/stripe/webhook-handler.ts`,
 *                                inside the `checkout.session.completed`
 *                                branch. THIS IS THE CONTROL. Both `ineligible`
 *                                and `unknown` deny.
 *   session creation             NOT WIRED. Optional defence in depth only —
 *                                it can refuse a country we ALREADY know, which
 *                                is nobody today (`profiles.country_code` is
 *                                null on 0 of 115 rows). Adding it would change
 *                                no outcome until that column is populated.
 *   customer.updated             WIRED since (SCL-047): `handleCustomerUpdated`
 *                                sets cancel_at_period_end when the billing
 *                                country leaves Tier-1. Access runs to period
 *                                end. (This line said NOT WIRED until
 *                                2026-09-25, after the handler had landed.)
 *
 * `profiles.country_code` IS WRITTEN since 2026-09-25 (closure plan W3-3): the
 * entitlement writers in `webhook-handler.ts` record the country this gate
 * approved, on every grant, and the crisis resources are chosen from it.
 *
 * The gate is INERT UNTIL THE OWNER APPLIES `docs/plans/Owner_DML_tier_1_countries.sql`,
 * and inert means DENY. That is the fail-closed default ruled on 2026-08-27,
 * not an oversight.
 */

/** Config key holding the Tier-1 ISO 3166-1 alpha-2 list. */
export const TIER1_CONFIG_KEY = "tier_1_countries";

export type CountryEligibility =
  | { readonly verdict: "eligible"; readonly country: string }
  | { readonly verdict: "ineligible"; readonly country: string }
  | { readonly verdict: "unknown"; readonly reason: string };

/**
 * Decide eligibility for a billing country against the Tier-1 list.
 *
 * Pure, deterministic, no IO — the caller supplies the list so this can be
 * tested without a database and so the config read has exactly one owner.
 *
 * ABSENCE IS NOT INELIGIBILITY. A country we have never been told is `unknown`,
 * not `ineligible`: today `profiles.country_code` is null on every row, so
 * treating unknown as ineligible would revoke every existing user at once.
 * `unknown` is a fact about our records; `ineligible` is a fact about the user.
 *
 * A MISSING OR EMPTY LIST FAILS CLOSED. An empty Tier-1 list is not "everyone
 * is allowed" — it is a configuration that has not been made, and answering
 * `eligible` from it would turn an unseeded table into an open door.
 */
export function evaluateCountryEligibility(
  country: string | null | undefined,
  tier1: readonly string[] | null | undefined,
): CountryEligibility {
  if (!tier1 || tier1.length === 0) {
    return {
      verdict: "unknown",
      reason:
        `Tier-1 list is absent or empty (config key \`${TIER1_CONFIG_KEY}\`). ` +
        "An unseeded list is a configuration that has not been made, not a " +
        "decision that everyone qualifies — so this fails closed rather than " +
        "answering 'eligible'.",
    };
  }

  if (!country) {
    return {
      verdict: "unknown",
      reason:
        "no billing country recorded. Not the same as ineligible: at session " +
        "creation the customer has not typed an address yet, and " +
        "`profiles.country_code` is null on every existing row.",
    };
  }

  const normalised = country.trim().toUpperCase();
  const allowed = tier1.map((c) => c.trim().toUpperCase());

  return allowed.includes(normalised)
    ? { verdict: "eligible", country: normalised }
    : { verdict: "ineligible", country: normalised };
}

/** The country a grant-time check assumes when Stripe provides none (owner ruling 2026-10-10). */
export const DEFAULT_BILLING_COUNTRY = "US";

/** Where the country a grant was decided on came from. Never carries the country itself. */
export type BillingCountrySource = "provided" | "default_us";

/**
 * The billing country a GRANT-TIME check evaluates: Stripe's when it gave one, else US.
 *
 * @spec [INV-03-08 (Doc 03 §2156); owner ruling (Karl) 2026-10-10: "when a completed Checkout
 *       session has no billing country, default it to US. A country Stripe does provide always
 *       wins." Ruled alongside `payment_method_collection: "if_required"` (no card, and so no
 *       address, on a $0 FOUNDING50 checkout) and in place of `billing_address_collection:
 *       "required"` (no extra personal information at checkout); SCL-228 (OPEN): Karl confirmed
 *       2026-10-10 that this overrides INV-03-08 where Stripe provides no billing country]
 *       | @implemented [2026-10-10]
 *
 * plain English: a present country always wins and is returned as `provided` (trimmed; the
 * verdict still comes from `evaluateCountryEligibility`, so a non-Tier-1 country is denied
 * exactly as before). An absent or blank one becomes `US` with source `default_us`, so the two
 * can be told apart in logs and the default is never stored as if somebody had given it.
 *
 * WHAT THIS DOES NOT DEFAULT. An unseeded Tier-1 list still answers `unknown` and still denies:
 * the default is for a missing COUNTRY, never for a missing CONFIGURATION. Session creation
 * (`blocksCheckout`) and `customer.updated` egress do not use it either: neither grants.
 */
export function resolveBillingCountry(country: string | null | undefined): {
  country: string;
  source: BillingCountrySource;
} {
  const given = country?.trim();
  return given
    ? { country: given, source: "provided" }
    : { country: DEFAULT_BILLING_COUNTRY, source: "default_us" };
}

/**
 * Should this eligibility verdict BLOCK a purchase at session creation?
 *
 * Only a positive `ineligible` blocks. `unknown` must not: blocking on unknown
 * would refuse every first-time buyer, since the billing address does not exist
 * until Checkout completes.
 */
export function blocksCheckout(e: CountryEligibility): boolean {
  return e.verdict === "ineligible";
}

/**
 * Should this eligibility verdict DENY entitlement after Checkout completes?
 *
 * `unknown` denies. Since the owner ruling of 2026-10-10 the grant-time callers pass the
 * country through `resolveBillingCountry` first, so a session with NO country is evaluated as
 * `US` rather than arriving here as `unknown`; what still reaches `unknown` is an unseeded
 * Tier-1 list (and a deleted Customer, which carries no address at all). Those are
 * configuration or integration faults rather than facts about the user, and they deny: after
 * payment, refusing to decide is itself a decision, and the safe one is not to grant access we
 * cannot justify.
 */
export function deniesEntitlement(e: CountryEligibility): boolean {
  return e.verdict !== "eligible";
}
