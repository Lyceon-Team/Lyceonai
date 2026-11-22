/**
 * The sentence a guardian reads before saving a card on an invite: one builder, the ruled words.
 *
 * @spec [owner ruling 2026-11-21 (counsel-approved) 3 ("You'll be charged {price}/{interval} when
 *        your teen joins. Renews until you cancel."), 9; SCL-286; Billing Terms v4 §2.1;
 *        Subscription Auto-Renewal Notice v3 §3.5] | @implemented [2026-11-22]
 *
 * plain English: the builder produces the ruled sentence from a plan's real price and interval,
 * refuses a plan whose price is not known (no card is offered for it), and the published Billing
 * Terms and Auto-Renewal Notice quote the same sentence. The card form renders only this builder's
 * output (`invite-card-on-file.test.tsx`).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { guardianInviteChargeDisclosure } from "../../packages/shared/src/guardian-invite-card-schema";
import type { BillingPlanMetadata } from "../../packages/shared/src/billing-schema";

const ROOT = path.resolve(__dirname, "../..");
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), "utf8");

function plan(over: Partial<BillingPlanMetadata>): BillingPlanMetadata {
  return {
    plan: "monthly",
    label: "Monthly",
    amountCents: 2999,
    currency: "usd",
    intervalLabel: "per month",
    interval: "month",
    intervalCount: 1,
    stripePriceIdConfigured: true,
    ...over,
  };
}

describe("the card-on-file disclosure (ruling 3)", () => {
  it("is the ruled sentence for each interval", () => {
    expect(guardianInviteChargeDisclosure(plan({}))).toBe(
      "You'll be charged $29.99/month when your teen joins. Renews until you cancel.",
    );
    expect(
      guardianInviteChargeDisclosure(
        plan({ plan: "quarterly", amountCents: 7999, intervalCount: 3 }),
      ),
    ).toBe(
      "You'll be charged $79.99/3 months when your teen joins. Renews until you cancel.",
    );
    expect(
      guardianInviteChargeDisclosure(
        plan({ plan: "yearly", amountCents: 19900, interval: "year" }),
      ),
    ).toBe(
      "You'll be charged $199.00/year when your teen joins. Renews until you cancel.",
    );
  });

  it("refuses a plan whose price is not fully known", () => {
    expect(
      guardianInviteChargeDisclosure(plan({ stripePriceIdConfigured: false })),
    ).toBeNull();
    expect(
      guardianInviteChargeDisclosure(plan({ amountCents: null })),
    ).toBeNull();
    expect(guardianInviteChargeDisclosure(plan({ currency: null }))).toBeNull();
    expect(guardianInviteChargeDisclosure(plan({ interval: null }))).toBeNull();
  });

  it("the published Billing Terms and Auto-Renewal Notice quote the same sentence", () => {
    const template =
      "You'll be charged [price]/[interval] when your teen joins. Renews until you cancel.";
    for (const slug of ["billing-terms", "subscription-auto-renewal-notice"]) {
      const manifest = JSON.parse(read(`legal/${slug}/manifest.json`)) as {
        current: string;
      };
      expect(read(`legal/${slug}/${manifest.current}/en.md`), slug).toContain(
        template,
      );
    }
  });
});
