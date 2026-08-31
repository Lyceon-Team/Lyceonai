/**
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4; §36.4; Coding Standards §7.2, §17]
 * @implemented [2026-08-31]
 *
 * plain English: pins the billing checkout contract itself — the one shape both
 * the route and the client speak. Expected outcome: each of the two purchase
 * outcomes is accepted, and the flattened optional-url shape that predated the
 * discriminator is refused. Trade-off: these assert the schema rather than any
 * one caller, which is the point — the schema is what stops the two callers
 * drifting apart. Edge case: `requestId` rides along on the wire and must not
 * become part of the contract.
 */
import { describe, expect, it } from "vitest";
import {
  billingCheckoutOutcomeSchema,
  billingCheckoutRequestSchema,
  billingPeriodSchema,
} from "../billing-schema";

const STUDENT = "22222222-2222-4222-8222-222222222222";

describe("billingCheckoutOutcomeSchema — one discriminated shape, both branches", () => {
  it("accepts the FIRST-purchase outcome, which redirects to Stripe Checkout", () => {
    const parsed = billingCheckoutOutcomeSchema.safeParse({
      kind: "checkout_session",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      sessionId: "cs_test_1",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.kind).toBe("checkout_session");
  });

  it("accepts the ADD-ITEM outcome, which has no url because there is no redirect", () => {
    const parsed = billingCheckoutOutcomeSchema.safeParse({
      kind: "item_added",
      subscriptionItemId: "si_second_child",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.kind).toBe("item_added");
  });

  /**
   * The regression that motivated the discriminator. Before it, the contract was
   * effectively "a url, maybe", and the client acted on that: it read
   * `payload.url` on both branches and reported a charged add-item purchase as a
   * failure. A shape carrying only a url is no longer a valid outcome.
   */
  it("REFUSES the flattened optional-url shape that has no discriminator", () => {
    const parsed = billingCheckoutOutcomeSchema.safeParse({
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses an add-item outcome that names no subscription item", () => {
    expect(
      billingCheckoutOutcomeSchema.safeParse({ kind: "item_added" }).success,
    ).toBe(false);
  });

  it("refuses a checkout_session whose url is absent, rather than redirecting to nothing", () => {
    expect(
      billingCheckoutOutcomeSchema.safeParse({
        kind: "checkout_session",
        sessionId: "cs_test_1",
      }).success,
    ).toBe(false);
  });

  it("strips requestId — diagnostic on the wire, not part of the contract", () => {
    const parsed = billingCheckoutOutcomeSchema.safeParse({
      kind: "item_added",
      subscriptionItemId: "si_1",
      requestId: "req-abc",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ kind: "item_added", subscriptionItemId: "si_1" });
  });
});

describe("billingCheckoutRequestSchema — selection, not authorisation", () => {
  it("accepts a guardian naming the student they selected", () => {
    const parsed = billingCheckoutRequestSchema.safeParse({
      plan: "monthly",
      student_profile_id: STUDENT,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a student purchase that names nobody", () => {
    const parsed = billingCheckoutRequestSchema.safeParse({ plan: "yearly" });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.student_profile_id).toBeUndefined();
  });

  /**
   * `.strict()` is the reason a client cannot smuggle a price, a payer id, or an
   * entitlement claim into the route. Charter §6: the body selects; it never
   * grants.
   */
  it("REJECTS unknown keys rather than ignoring them", () => {
    for (const smuggled of [
      { plan: "monthly", price_id: "price_free" },
      { plan: "monthly", payer_profile_id: STUDENT },
      { plan: "monthly", tier: "premium" },
    ]) {
      expect(billingCheckoutRequestSchema.safeParse(smuggled).success).toBe(false);
    }
  });

  it("rejects a student_profile_id that is not a uuid", () => {
    expect(
      billingCheckoutRequestSchema.safeParse({
        plan: "monthly",
        student_profile_id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects a plan outside the canonical billing periods", () => {
    expect(billingCheckoutRequestSchema.safeParse({ plan: "weekly" }).success).toBe(
      false,
    );
    expect(billingPeriodSchema.options).toEqual([
      "monthly",
      "quarterly",
      "yearly",
    ]);
  });
});
