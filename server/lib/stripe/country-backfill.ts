/**
 * @spec [Doc-03_V3 §4.6, §12.3; INV-03-08; closure plan W3-3 §3.3]
 * @implemented 2026-09-25
 *
 * plain English: turns what Stripe says about each already-entitled student's
 * billing country into the SQL that records it on their profile — for the
 * students who were granted before the grant path started writing
 * `profiles.country_code`. Pure: the caller does the Stripe reads, this decides.
 *
 * expected outcome: one guarded UPDATE per student whose country can be
 * established AND is Tier-1, and a named reason for every student it cannot
 * fill. Nothing is written by this module or its script — the owner applies.
 *
 * trade-offs / edge cases:
 *  - SOURCE ORDER: `Customer.address.country` first — the same field the
 *    INV-03-08 grant gate reads, and the one that stays current through the
 *    Portal. The completed Checkout Session's `customer_details` address is
 *    the fallback, for customers created before 2026-09-02, when Checkout
 *    started copying the address onto the Customer.
 *  - A country that is not Tier-1 is NOT written. It would make the crisis
 *    resolver fall back to the default anyway, and recording it as if it were
 *    a served country would hide an entitlement that should not exist (the
 *    SCL-047 egress case). It is reported instead.
 *  - The UPDATE is guarded by `country_code IS NULL`, so it never overwrites a
 *    value the live grant path has written since the export was taken.
 */
import { evaluateCountryEligibility } from "./country-eligibility";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CountryBackfillInput = {
  profileId: string;
  /** `Customer.address.country`, or null when the Customer has no address. */
  customerCountry: string | null;
  /** The completed Checkout Session's `customer_details.address.country`. */
  sessionCountry: string | null;
};

export type CountryBackfillPlan = {
  updates: Array<{
    profileId: string;
    country: string;
    source: "customer" | "checkout_session";
  }>;
  unresolved: Array<{
    profileId: string;
    reason: "no_address" | "ineligible_country";
    country: string | null;
  }>;
  sql: string[];
};

export function planCountryBackfill(
  inputs: readonly CountryBackfillInput[],
  tier1: readonly string[],
): CountryBackfillPlan {
  if (!tier1.every((c) => /^[A-Za-z]{2}$/.test(c.trim()))) {
    throw new Error(
      "planCountryBackfill: tier1 must be ISO 3166-1 alpha-2 codes",
    );
  }
  const plan: CountryBackfillPlan = { updates: [], unresolved: [], sql: [] };

  for (const input of inputs) {
    if (!UUID.test(input.profileId)) {
      throw new Error("planCountryBackfill: profileId is not a uuid");
    }
    const source: "customer" | "checkout_session" | null = input.customerCountry
      ? "customer"
      : input.sessionCountry
        ? "checkout_session"
        : null;
    if (source === null) {
      plan.unresolved.push({
        profileId: input.profileId,
        reason: "no_address",
        country: null,
      });
      continue;
    }
    const raw =
      source === "customer" ? input.customerCountry : input.sessionCountry;
    const verdict = evaluateCountryEligibility(raw, tier1);
    if (verdict.verdict !== "eligible") {
      plan.unresolved.push({
        profileId: input.profileId,
        reason: "ineligible_country",
        country: verdict.verdict === "ineligible" ? verdict.country : null,
      });
      continue;
    }
    // Both interpolated values are validated above: a uuid, and a code taken
    // from the Tier-1 list itself — nothing else reaches the statement.
    plan.updates.push({
      profileId: input.profileId,
      country: verdict.country,
      source,
    });
    plan.sql.push(
      `UPDATE public.profiles SET country_code = '${verdict.country}' ` +
        `WHERE id = '${input.profileId}' AND country_code IS NULL;`,
    );
  }

  return plan;
}
