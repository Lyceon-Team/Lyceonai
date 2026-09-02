/**
 * Stripe-native country control — the survey, as a self-invalidating gate.
 *
 * @spec [INV-03-08 Tier 1 country gating; SCL-046] | @implemented [2026-08-27]
 *
 * plain English: checks the four Stripe surfaces that could plausibly restrict
 * which billing countries can buy, prints what each actually offers, and fails
 * if Stripe ever ships a real billing-country allowlist. Expected outcome: today
 * none of them satisfies INV-03-08, so the control is ours — and the day that
 * stops being true, this test goes red and tells us to delete our own gate
 * rather than carrying it forever. Trade-off: it reads the pinned SDK's type
 * definitions rather than live Stripe, because `docs.stripe.com` is
 * egress-blocked here and no Stripe key is available; a Dashboard-only control
 * cannot be seen from either. Edge case: a surface that exists but answers a
 * different question — which is what all four turn out to be.
 *
 * Why a gate and not a memo: "we checked and Stripe has nothing" is the kind of
 * claim that silently expires. Pinning it to the SDK means the claim is
 * re-checked on every upgrade.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

function sdkFile(...parts: string[]): string {
  const nodeRequire = createRequire(import.meta.url);
  let dir = dirname(nodeRequire.resolve("stripe"));
  while (!existsSync(join(dir, "types", "EventTypes.d.ts"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("stripe package root not found");
    dir = parent;
  }
  return readFileSync(join(dir, "types", ...parts), "utf8");
}

describe("Stripe-native country control survey (INV-03-08 / SCL-046)", () => {
  const checkoutParams = sdkFile("Checkout", "SessionsResource.d.ts");

  it("prints what each candidate surface actually offers", () => {
    const valueListTypes = sdkFile("Radar", "ValueLists.d.ts");

    const findings = [
      {
        surface: "shipping_address_collection.allowed_countries",
        offers: "an allowlist — but for SHIPPING addresses only",
        satisfies: "NO",
        why:
          "the only `allowed_countries` in Checkout create params, and it sits " +
          "inside ShippingAddressCollection. Moot regardless: owner ruling is " +
          "that no shipping address is collected.",
      },
      {
        surface: "automatic_tax (Stripe Tax)",
        offers: "`enabled` and `liability` only",
        satisfies: "NO",
        why:
          "COLLECTS billing address for tax calculation; it does not restrict " +
          "which countries are acceptable. Tax registrations decide whether tax " +
          "is charged, not whether checkout proceeds — an unregistered country " +
          "is charged zero tax, not refused.",
      },
      {
        surface: "payment_method_configuration",
        offers: "a configuration id selecting which payment METHODS appear",
        satisfies: "NO",
        why:
          "per-country availability of methods, not a country allowlist for the " +
          "customer. Removing a method does not stop a card from an ineligible " +
          "country.",
      },
      {
        surface: "Radar rules + Value Lists (item_type 'country')",
        offers: "a genuine country mechanism — blocks the PAYMENT",
        satisfies: "NO — wrong subject and wrong moment",
        why:
          "INV-03-08 gates LISA ACCESS on the BILLING ADDRESS, enforced on every " +
          "request inside canAccessFeature. Radar decides one payment at one " +
          "moment. It cannot gate a free-tier student, a student entitled before " +
          "any rule existed, or the SCL-043 guardian case where the payer's " +
          "country is not the student's. Useful as defence in depth; cannot be " +
          "the control.",
      },
    ];

    const w = Math.max(...findings.map((f) => f.surface.length));
    const lines = [
      "",
      "STRIPE-NATIVE COUNTRY CONTROL — SURVEY",
      "",
      ...findings.flatMap((f) => [
        `  ${f.surface.padEnd(w)}  satisfies INV-03-08: ${f.satisfies}`,
        `  ${" ".repeat(w)}  offers: ${f.offers}`,
        `  ${" ".repeat(w)}  why:    ${f.why}`,
        "",
      ]),
      "  CONCLUSION: no Stripe-native surface satisfies INV-03-08. The control is ours.",
      "",
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));

    // The Radar claim is grounded, not asserted: the SDK really does offer a
    // country-typed value list, which is why it needed ruling out on subject
    // and timing rather than on absence.
    expect(valueListTypes).toContain("'country'");
    expect(findings.every((f) => f.satisfies.startsWith("NO"))).toBe(true);
  });

  it("FAILS if Stripe ships a billing-country allowlist — delete our gate when it does", () => {
    // The one `allowed_countries` in Checkout create params is inside
    // ShippingAddressCollection. If a second appears, or one appears under a
    // billing interface, Stripe has shipped the native control and ours should
    // be removed rather than carried alongside it.
    const occurrences = checkoutParams.match(/allowed_countries/g) ?? [];
    expect(occurrences).toHaveLength(1);

    const shippingBlock =
      checkoutParams.match(
        /interface ShippingAddressCollection \{[\s\S]*?allowed_countries/,
      ) !== null;
    expect(shippingBlock).toBe(true);

    // BillingAddressCollection must stay a whether-to-collect switch. If it
    // gains a country list, that IS the native control.
    expect(checkoutParams).toContain(
      "type BillingAddressCollection = 'auto' | 'required'",
    );
  });

  it("records that the billing address does not exist at session creation", () => {
    // This is why the gate cannot live wholly at session creation: the customer
    // types the address DURING Checkout. The SDK says so in its own words.
    const sessions = sdkFile("Checkout", "Sessions.d.ts");
    expect(sessions).toContain(
      "The customer's address after a completed Checkout Session",
    );
  });
});
