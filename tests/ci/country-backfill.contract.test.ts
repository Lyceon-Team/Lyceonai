/**
 * @spec [Doc-03_V3 §4.6, §12.3; INV-03-08; closure plan W3-3 §3.3]
 * @implemented 2026-09-25
 *
 * plain English: the backfill planner turns Stripe's view of each entitled
 * student's billing country into guarded SQL — and refuses to write anything
 * it cannot justify. It writes nothing itself; the owner applies its output.
 */
import { describe, expect, it } from "vitest";
import { planCountryBackfill } from "../../server/lib/stripe/country-backfill";

const TIER1 = ["US", "CA", "GB", "AU", "NZ", "IE", "SG"];
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

describe("W3-3 — country backfill planner", () => {
  it("prefers the Customer's address, falls back to the Checkout Session's, and reports the rest", () => {
    const plan = planCountryBackfill(
      [
        { profileId: A, customerCountry: "sg", sessionCountry: "US" },
        { profileId: B, customerCountry: null, sessionCountry: "IE" },
        { profileId: C, customerCountry: null, sessionCountry: null },
        { profileId: D, customerCountry: "FR", sessionCountry: null },
      ],
      TIER1,
    );

    expect(plan.updates).toEqual([
      { profileId: A, country: "SG", source: "customer" },
      { profileId: B, country: "IE", source: "checkout_session" },
    ]);
    expect(plan.unresolved).toEqual([
      { profileId: C, reason: "no_address", country: null },
      // Not written: a non-Tier-1 country would only default anyway, and
      // recording it would hide an entitlement that should not exist.
      { profileId: D, reason: "ineligible_country", country: "FR" },
    ]);
    expect(plan.sql).toEqual([
      `UPDATE public.profiles SET country_code = 'SG' WHERE id = '${A}' AND country_code IS NULL;`,
      `UPDATE public.profiles SET country_code = 'IE' WHERE id = '${B}' AND country_code IS NULL;`,
    ]);
  });

  it("every statement is guarded — it never overwrites a country the live path has written", () => {
    const plan = planCountryBackfill(
      [{ profileId: A, customerCountry: "US", sessionCountry: null }],
      TIER1,
    );
    expect(plan.sql[0]).toMatch(/AND country_code IS NULL;$/);
  });

  it("refuses a non-uuid profile id and a malformed Tier-1 list — nothing unvalidated reaches SQL", () => {
    expect(() =>
      planCountryBackfill(
        [
          {
            profileId: "x'; DROP TABLE profiles; --",
            customerCountry: "US",
            sessionCountry: null,
          },
        ],
        TIER1,
      ),
    ).toThrow(/uuid/);
    expect(() =>
      planCountryBackfill(
        [{ profileId: A, customerCountry: "US", sessionCountry: null }],
        ["US'); --"],
      ),
    ).toThrow(/alpha-2/);
  });
});
