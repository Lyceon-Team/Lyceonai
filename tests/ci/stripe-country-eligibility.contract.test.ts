/**
 * Tier-1 country eligibility — the chokepoint's decision rules.
 *
 * @spec [INV-03-08; SCL-046 as amended] | @implemented [2026-08-27]
 *
 * plain English: proves the eligibility rule keeps "we don't know" separate
 * from "not allowed", and that an unseeded config fails closed. Expected
 * outcome: a first-time buyer is never blocked for a country they have not
 * typed yet, and an empty Tier-1 list never reads as "everyone qualifies".
 * Trade-off: pure-function tests, because the rule is pure — the config read
 * and the three call sites are separately covered. Edge cases: casing and
 * whitespace in ISO codes, an empty list, a null country.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateCountryEligibility,
  blocksCheckout,
  deniesEntitlement,
  TIER1_CONFIG_KEY,
} from "../../server/lib/stripe/country-eligibility";

const TIER1 = ["US", "CA", "UK", "AU", "NZ", "IE", "SG"] as const;

describe("evaluateCountryEligibility (INV-03-08)", () => {
  it("admits every Tier-1 country named by the invariant", () => {
    // INV-03-08 verbatim: {US, CA, UK, AU, NZ, IE, SG}
    for (const c of TIER1) {
      expect(evaluateCountryEligibility(c, TIER1)).toMatchObject({
        verdict: "eligible",
      });
    }
  });

  it("refuses a country outside the list", () => {
    expect(evaluateCountryEligibility("FR", TIER1)).toMatchObject({
      verdict: "ineligible",
      country: "FR",
    });
  });

  it("normalises casing and whitespace rather than failing on them", () => {
    expect(evaluateCountryEligibility(" us ", TIER1)).toMatchObject({
      verdict: "eligible",
      country: "US",
    });
  });

  it("treats an UNKNOWN country as unknown, never as ineligible", () => {
    // The distinction that matters: profiles.country_code is null on every
    // existing row, so collapsing unknown into ineligible would revoke everyone.
    const e = evaluateCountryEligibility(null, TIER1);
    expect(e.verdict).toBe("unknown");
    expect(blocksCheckout(e)).toBe(false);
  });

  it("FAILS CLOSED on an unseeded Tier-1 list — empty is not 'everyone'", () => {
    // entitlement_runtime_config holds 0 rows in production today.
    for (const list of [[], null, undefined]) {
      const e = evaluateCountryEligibility("US", list);
      expect(e.verdict).toBe("unknown");
      expect(deniesEntitlement(e)).toBe(true);
      if (e.verdict === "unknown") {
        expect(e.reason).toContain(TIER1_CONFIG_KEY);
      }
    }
  });
});

describe("the two questions the verdict answers differ deliberately", () => {
  it("unknown does NOT block checkout but DOES deny entitlement", () => {
    const unknown = evaluateCountryEligibility(null, TIER1);

    // At session creation the address does not exist yet, so blocking on
    // unknown would refuse every first-time buyer.
    expect(blocksCheckout(unknown)).toBe(false);

    // After checkout the customer HAS supplied an address. Unknown there means
    // the session carried no country or the list is unseeded — a fault, not a
    // fact about the user — and granting access we cannot justify is worse.
    expect(deniesEntitlement(unknown)).toBe(true);
  });

  it("ineligible both blocks and denies", () => {
    const bad = evaluateCountryEligibility("FR", TIER1);
    expect(blocksCheckout(bad)).toBe(true);
    expect(deniesEntitlement(bad)).toBe(true);
  });

  it("eligible does neither", () => {
    const ok = evaluateCountryEligibility("US", TIER1);
    expect(blocksCheckout(ok)).toBe(false);
    expect(deniesEntitlement(ok)).toBe(false);
  });
});
