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
 *  - The UPDATE is guarded to fire only while the row is still BLANK, so it
 *    never overwrites a value the live grant path has written since the export
 *    was taken.
 *  - BLANK means null, empty or whitespace-only — on both sides. Production
 *    holds at least one `country_code = ''` (2026-09-26); no application path
 *    writes one (the grant path writes a validated Tier-1 code and students
 *    have no UPDATE on `profiles`), so it came from an out-of-band write. A
 *    guard of `IS NULL` alone would skip that student forever. Stripe's side is
 *    read the same way, so an empty address country falls through to the
 *    Checkout Session instead of being evaluated as a country.
 */
import { evaluateCountryEligibility } from "./country-eligibility";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A country value that is null, empty or whitespace-only is no country. */
export function blankToNull(country: string | null | undefined): string | null {
  const trimmed = country?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The SQL twin of `blankToNull`, for the UPDATE guard: true while the stored
 * value is null, empty or whitespace-only.
 */
export const BLANK_COUNTRY_SQL =
  "(country_code IS NULL OR btrim(country_code) = '')";

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
    const customerCountry = blankToNull(input.customerCountry);
    const sessionCountry = blankToNull(input.sessionCountry);
    const source: "customer" | "checkout_session" | null = customerCountry
      ? "customer"
      : sessionCountry
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
    const raw = source === "customer" ? customerCountry : sessionCountry;
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
        `WHERE id = '${input.profileId}' AND ${BLANK_COUNTRY_SQL};`,
    );
  }

  return plan;
}
