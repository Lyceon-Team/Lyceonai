/**
 * A DENIAL IS A DECISION — cancel, refund, settle.
 *
 * @spec [INV-03-08 (Doc 03 §2156, heading verified); SCL-046; SCL-048 as
 *        amended by SCL-072 (full-vs-partial on the CHARGED amount);
 *        Doc-01_V8 §22 Stripe webhook handling]
 * @implemented [2026-09-01 — SCL-DRAFT-B-denial-is-a-decision]
 *
 * plain English: proves that an ineligible-country payer is cancelled, refunded
 * in full, entitled to nothing, and that the webhook SETTLES.
 *
 * THE DEFECT. The country gate threw. A throw is a 500. Stripe retries a 500 —
 * forever, because no redelivery makes a French billing address Tier-1. Money
 * captured, no entitlement, no terminal state, permanently failing endpoint.
 *
 * Every test here asserts BOTH HALVES: what the handler returned AND what it
 * did to state. A denial that settled by GRANTING would be the same money path
 * with a cheerful status code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_denial_remediation";
const STUDENT_ID = "77777777-7777-4777-8777-777777777777";
const SUB_ID = "sub_denial";
const INVOICE_ID = "in_denial";
const PI_ID = "pi_denial";
const CHARGE_ID = "ch_denial";
const CHARGE_AMOUNT = 4900;

const state = vi.hoisted(() => ({ expectedLivemode: false }));
const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(async () => ({
    error: null as { code?: string; message?: string } | null,
  })),
  delete: vi.fn(async () => ({ error: null })),
}));
const accountMocks = vi.hoisted(() => ({
  upsertEntitlement: vi.fn(async () => ({})),
  mapStripeStatusToEntitlement: vi.fn((s: string) => ({
    tier: s === "active" ? "premium" : "free",
    status: s,
  })),
  getEntitlementsBySubscriptionId: vi.fn(async () => []),
  getAllGuardianStudentLinks: vi.fn(async () => []),
}));
const configMocks = vi.hoisted(() => ({ getTier1Countries: vi.fn() }));
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsCancel: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsResume: vi.fn(),
  subscriptionsList: vi.fn(),
  chargesRetrieve: vi.fn(),
  customersRetrieve: vi.fn(),
  invoicePaymentsList: vi.fn(),
  invoicesRetrieve: vi.fn(),
  paymentIntentsRetrieve: vi.fn(),
  refundsCreate: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_denial_remediation_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        list: stripeApi.subscriptionsList,
        update: stripeApi.subscriptionsUpdate,
        resume: stripeApi.subscriptionsResume,
        cancel: stripeApi.subscriptionsCancel,
      },
      charges: { retrieve: stripeApi.chargesRetrieve },
      customers: { retrieve: stripeApi.customersRetrieve },
      invoicePayments: { list: stripeApi.invoicePaymentsList },
      invoices: { retrieve: stripeApi.invoicesRetrieve },
      paymentIntents: { retrieve: stripeApi.paymentIntentsRetrieve },
      refunds: { create: stripeApi.refundsCreate },
    }),
    getExpectedLivemode: () => state.expectedLivemode,
  };
});
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: dbMocks.insert,
      delete: () => ({ eq: dbMocks.delete }),
    }),
  },
}));
vi.mock("../../server/lib/account", () => ({
  upsertEntitlement: accountMocks.upsertEntitlement,
  mapStripeStatusToEntitlement: accountMocks.mapStripeStatusToEntitlement,
  getEntitlementsBySubscriptionId: accountMocks.getEntitlementsBySubscriptionId,
  getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: configMocks.getTier1Countries,
}));
vi.mock("../../server/logger", () => ({ logger: loggerMock }));

function signed(event: Record<string, unknown>): {
  body: Buffer;
  signature: string;
} {
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload, "utf8"),
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

function checkoutEvent(
  country: string | null,
  eventId = "evt_denial_1",
  type = "checkout.session.completed",
): Record<string, unknown> {
  return {
    id: eventId,
    object: "event",
    type,
    livemode: false,
    data: {
      object: {
        id: "cs_denial",
        object: "checkout.session",
        mode: "subscription",
        subscription: SUB_ID,
        client_reference_id: STUDENT_ID,
        metadata: { student_profile_id: STUDENT_ID },
        customer_details: { address: { country } },
        payment_status: "paid",
      },
    },
  };
}

/** The refund event Stripe sends US back once we create the refund. */
function refundEvent(eventId: string): Record<string, unknown> {
  return {
    id: eventId,
    object: "event",
    type: "refund.updated",
    livemode: false,
    data: {
      object: {
        id: "re_denial",
        object: "refund",
        status: "succeeded",
        charge: CHARGE_ID,
      },
    },
  };
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

/** Live, payable, traceable to a charge — the shape a real denial arrives on. */
function liveSubscription(): Record<string, unknown> {
  return {
    id: SUB_ID,
    object: "subscription",
    customer: "cus_denial",
    status: "active",
    latest_invoice: INVOICE_ID,
    items: {
      object: "list",
      data: [
        {
          id: "si_denial",
          object: "subscription_item",
          current_period_start: 1_756_000_000,
          current_period_end: 1_758_600_000,
          price: { id: "price_denial" },
          metadata: { student_profile_id: STUDENT_ID },
        },
      ],
    },
  };
}

describe("INV-03-08 country denial is remediated, not retried", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);

    stripeApi.subscriptionsRetrieve.mockResolvedValue(liveSubscription());
    stripeApi.subscriptionsCancel.mockResolvedValue({
      id: SUB_ID,
      status: "canceled",
    });
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_denial",
      address: { country: "FR" },
    });
    stripeApi.invoicePaymentsList.mockResolvedValue({
      data: [
        {
          id: "inpay_denial",
          // `invoice` is what the REVERSE walk reads
          // (`resolveEntitlementsForCharge`); `payment` is what the FORWARD
          // walk reads. One object satisfies both, which is the point of
          // reusing the chain rather than inventing a second one.
          invoice: INVOICE_ID,
          payment: { type: "payment_intent", payment_intent: PI_ID },
        },
      ],
    });
    stripeApi.invoicesRetrieve.mockResolvedValue({
      id: INVOICE_ID,
      parent: { subscription_details: { subscription: SUB_ID } },
    });
    stripeApi.paymentIntentsRetrieve.mockResolvedValue({
      id: PI_ID,
      latest_charge: CHARGE_ID,
    });
    stripeApi.chargesRetrieve.mockResolvedValue({
      id: CHARGE_ID,
      amount: CHARGE_AMOUNT,
      amount_refunded: 0,
      payment_intent: PI_ID,
      customer: "cus_denial",
    });
    stripeApi.refundsCreate.mockResolvedValue({
      id: "re_denial",
      amount: CHARGE_AMOUNT,
    });
  });

  // ---- The defect ---------------------------------------------------------

  it("SETTLES the event instead of throwing — no permanent Stripe retry loop", async () => {
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    const outcome = await process_(body, signature, "req_settle");

    // The response half. `ok: true` is what the route turns into 200.
    expect(outcome).toMatchObject({ ok: true, status: "remediated" });
    // The state half. A settled event that ENTITLED the payer would be worse
    // than the loop it replaced.
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("cancels the subscription with NO cancellation date, and refunds the FULL charge", async () => {
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    await process_(body, signature, "req_full");

    // Empty params: `SubscriptionCancelParams` has no date field at all
    // (SubscriptionsResource.d.ts:2054-2074); scheduling one is
    // `subscriptions.update({ cancel_at })`, a different call.
    expect(stripeApi.subscriptionsCancel).toHaveBeenCalledWith(SUB_ID, {});

    // No `amount` — RefundsResource.d.ts:125 makes the PARTIAL refund the
    // optional case, so omitting it is the full one.
    expect(stripeApi.refundsCreate).toHaveBeenCalledTimes(1);
    const [params, options] = stripeApi.refundsCreate.mock.calls[0]!;
    expect(params).toMatchObject({ payment_intent: PI_ID });
    expect(params).not.toHaveProperty("amount");
    expect(options).toMatchObject({
      idempotencyKey: `inv-03-08-country-denial-refund:${SUB_ID}`,
    });
  });

  /**
   * ORDER, BY INVOCATION AND NOT BY OCCURRENCE.
   *
   * Reusing the pattern `stripe-dispute.contract.test.ts` already established
   * for pause-before-local-write rather than inventing a second one. Asserting
   * only that both were CALLED would stay green if the refund moved ahead of
   * the cancel — and that ordering is load-bearing: refunding first leaves a
   * live subscription that generates the next invoice while the refund is in
   * flight, so a cancel failure after it means we refunded a customer we are
   * still billing.
   */
  it("cancels BEFORE it refunds — invocation order, not just occurrence", async () => {
    const order: string[] = [];
    stripeApi.subscriptionsCancel.mockImplementation(async () => {
      order.push("cancel");
      return { id: SUB_ID, status: "canceled" };
    });
    stripeApi.refundsCreate.mockImplementation(async () => {
      order.push("refund");
      return { id: "re_denial", amount: CHARGE_AMOUNT };
    });

    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));
    await process_(body, signature, "req_order");

    expect(order[0]).toBe("cancel");
    expect(order).toContain("refund");
    expect(order.indexOf("cancel")).toBeLessThan(order.indexOf("refund"));
  });

  // ---- Idempotency --------------------------------------------------------

  /**
   * The replay that MATTERS. A redelivery of the same event id never reaches
   * dispatch — the `stripe_webhook_events` gate stops it — so replaying that
   * would prove nothing. The real case is two DIFFERENT events describing one
   * purchase: `checkout.session.completed` and
   * `checkout.session.async_payment_succeeded` both carry the same session and
   * both run the same gate.
   *
   * Two independent mechanisms have to hold, and this asserts both:
   *   the Stripe idempotency key   identical across the two calls, because it
   *                                is keyed on the SUBSCRIPTION, not the event
   *   the `amount_refunded` check  the second pass reads a charge that is now
   *                                fully refunded and does not call at all
   */
  it("does not refund twice when a second event describes the same purchase", async () => {
    const process_ = await handler();

    const first = signed(checkoutEvent("FR", "evt_denial_a"));
    await process_(first.body, first.signature, "req_replay_1");
    expect(stripeApi.refundsCreate).toHaveBeenCalledTimes(1);

    // Stripe's state after the first pass: cancelled, and fully refunded.
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      ...liveSubscription(),
      status: "canceled",
    });
    stripeApi.chargesRetrieve.mockResolvedValue({
      id: CHARGE_ID,
      amount: CHARGE_AMOUNT,
      amount_refunded: CHARGE_AMOUNT,
      payment_intent: PI_ID,
      customer: "cus_denial",
    });

    const second = signed(
      checkoutEvent(
        "FR",
        "evt_denial_b",
        "checkout.session.async_payment_succeeded",
      ),
    );
    const outcome = await process_(
      second.body,
      second.signature,
      "req_replay_2",
    );

    expect(outcome).toMatchObject({ ok: true, status: "remediated" });
    // NO second refund and NO second cancel.
    expect(stripeApi.refundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeApi.subscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("keys the refund on the SUBSCRIPTION, so two events produce one Stripe key", async () => {
    // The other half of the replay defence, asserted on its own so that
    // switching the key to the EVENT id fails here even if the
    // `amount_refunded` pre-check still happens to cover the case above.
    const process_ = await handler();

    const a = signed(checkoutEvent("FR", "evt_key_a"));
    await process_(a.body, a.signature, "req_key_1");

    stripeApi.chargesRetrieve.mockResolvedValue({
      id: CHARGE_ID,
      amount: CHARGE_AMOUNT,
      amount_refunded: 0,
      payment_intent: PI_ID,
      customer: "cus_denial",
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      ...liveSubscription(),
      status: "canceled",
    });

    const b = signed(
      checkoutEvent(
        "FR",
        "evt_key_b",
        "checkout.session.async_payment_succeeded",
      ),
    );
    await process_(b.body, b.signature, "req_key_2");

    expect(stripeApi.refundsCreate).toHaveBeenCalledTimes(2);
    const keyA = stripeApi.refundsCreate.mock.calls[0]![1].idempotencyKey;
    const keyB = stripeApi.refundsCreate.mock.calls[1]![1].idempotencyKey;
    expect(keyA).toBe(keyB);
    expect(keyA).not.toContain("evt_");
  });

  // ---- Our own refund webhooks come back ----------------------------------

  /**
   * THE SEAM BETWEEN THIS FIX AND THE EXISTING REFUND HANDLER, end to end.
   *
   * Creating the refund makes Stripe send US `refund.created` and
   * `refund.updated`. `handleRefundUpdated` looks for an entitlement to revoke
   * and finds NONE, because the denial wrote none. If that path errored, the
   * retry loop would be rebuilt one hop away: the checkout event settles, and
   * the refund event we caused loops instead.
   *
   * `refund.created` is `ignored` in `event-surface.ts` and never reaches
   * dispatch; `refund.updated` does, walks the provenance chain to a
   * subscription that underwrites zero entitlement rows, and returns — a fact,
   * not an error.
   */
  it("denial -> refund -> OUR OWN refund webhook is a clean NO-OP, not an error", async () => {
    const process_ = await handler();

    const denial = signed(checkoutEvent("FR", "evt_e2e_denial"));
    const denialOutcome = await process_(
      denial.body,
      denial.signature,
      "req_e2e_1",
    );
    expect(denialOutcome).toMatchObject({ ok: true, status: "remediated" });
    expect(stripeApi.refundsCreate).toHaveBeenCalledTimes(1);

    // Stripe now tells us about the refund we just made. The charge is fully
    // refunded, so `decideRefundRevocation` would say REVOKE — and there is
    // nothing to revoke.
    stripeApi.chargesRetrieve.mockResolvedValue({
      id: CHARGE_ID,
      amount: CHARGE_AMOUNT,
      amount_refunded: CHARGE_AMOUNT,
      payment_intent: PI_ID,
      customer: "cus_denial",
    });
    accountMocks.getEntitlementsBySubscriptionId.mockResolvedValue([]);

    const ours = signed(refundEvent("evt_e2e_refund"));
    const refundOutcome = await process_(
      ours.body,
      ours.signature,
      "req_e2e_2",
    );

    // No error, no retry, no state change.
    expect(refundOutcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    // And it did NOT pause a subscription it never entitled anyone through.
    expect(stripeApi.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  // ---- Refund failure -----------------------------------------------------

  it("a FAILED refund still settles — the subscription stays cancelled and Stripe does not retry", async () => {
    stripeApi.refundsCreate.mockRejectedValue(
      new Error("charge_already_refunded"),
    );
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    const outcome = await process_(body, signature, "req_refund_fail");

    expect(outcome).toMatchObject({ ok: true, status: "remediated" });
    // The cancel happened first, which is why a failed refund is survivable:
    // the customer is not billed again while an operator fixes it.
    expect(stripeApi.subscriptionsCancel).toHaveBeenCalledWith(SUB_ID, {});
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("logs a FAILED refund under its own code, distinguishable from the success path", async () => {
    // An operator has to be able to find the charges that still owe money. If
    // both paths logged the same line, the failures would be invisible in the
    // noise of the successes.
    stripeApi.refundsCreate.mockRejectedValue(new Error("card_declined"));
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));
    await process_(body, signature, "req_refund_fail_log");

    const failureCodes = loggerMock.error.mock.calls.map((c) => c[1]);
    expect(failureCodes).toContain("COUNTRY_DENIAL_REFUND_FAILED");

    const successCodes = loggerMock.warn.mock.calls.map((c) => c[1]);
    expect(successCodes).not.toContain("COUNTRY_DENIAL_REFUNDED");
  });

  // ---- Partial-refund semantics (SCL-048 / SCL-072) ------------------------

  /**
   * The refund is full by construction, and is CHECKED anyway against the same
   * basis SCL-048 as amended by SCL-072 uses: the CHARGED amount and the
   * charge's cumulative `amount_refunded`, never a list price.
   *
   * A refund that read as partial would be the worst of both worlds — the
   * customer still out of pocket, and under SCL-048 nothing revoked either.
   */
  it("alerts when the refund reads as PARTIAL against the charged amount", async () => {
    stripeApi.refundsCreate.mockResolvedValue({ id: "re_short", amount: 100 });
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    const outcome = await process_(body, signature, "req_partial");

    expect(outcome).toMatchObject({ ok: true, status: "remediated" });
    const codes = loggerMock.error.mock.calls.map((c) => c[1]);
    expect(codes).toContain("COUNTRY_DENIAL_REFUND_PARTIAL");
  });

  it("counts a PRE-EXISTING partial refund toward fullness — the SCL-072 cumulative basis", async () => {
    // Half already returned; refunding the rest is a FULL refund of the
    // charge. Comparing this refund's own amount against `charge.amount` would
    // wrongly read it as partial and alert on a correct outcome.
    stripeApi.chargesRetrieve.mockResolvedValue({
      id: CHARGE_ID,
      amount: CHARGE_AMOUNT,
      amount_refunded: 2400,
      payment_intent: PI_ID,
      customer: "cus_denial",
    });
    stripeApi.refundsCreate.mockResolvedValue({
      id: "re_rest",
      amount: CHARGE_AMOUNT - 2400,
    });
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    await process_(body, signature, "req_cumulative");

    const codes = loggerMock.error.mock.calls.map((c) => c[1]);
    expect(codes).not.toContain("COUNTRY_DENIAL_REFUND_PARTIAL");
    const ok = loggerMock.warn.mock.calls.map((c) => c[1]);
    expect(ok).toContain("COUNTRY_DENIAL_REFUNDED");
  });

  // ---- Provenance ---------------------------------------------------------

  it("refunds NOTHING when the charge cannot be traced, and says so", async () => {
    // Where provenance cannot be established, change nothing and surface it.
    // Refunding "the charge we think it was" is the guess this vertical
    // refuses everywhere else, and doing it on a money path would be worse.
    stripeApi.invoicePaymentsList.mockResolvedValue({ data: [] });
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    const outcome = await process_(body, signature, "req_untraceable");

    expect(outcome).toMatchObject({ ok: true, status: "remediated" });
    expect(stripeApi.refundsCreate).not.toHaveBeenCalled();
    // Cancelled anyway: stopping the billing does not depend on finding the
    // charge, and leaving it live would keep invoicing an ineligible payer.
    expect(stripeApi.subscriptionsCancel).toHaveBeenCalled();
    const codes = loggerMock.error.mock.calls.map((c) => c[1]);
    expect(codes).toContain("COUNTRY_DENIAL_REFUND_UNTRACEABLE");
  });

  it("refuses to guess when an invoice maps to SEVERAL PaymentIntents", async () => {
    stripeApi.invoicePaymentsList.mockResolvedValue({
      data: [
        {
          id: "ip_1",
          invoice: INVOICE_ID,
          payment: { type: "payment_intent", payment_intent: "pi_1" },
        },
        {
          id: "ip_2",
          invoice: INVOICE_ID,
          payment: { type: "payment_intent", payment_intent: "pi_2" },
        },
      ],
    });
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    await process_(body, signature, "req_ambiguous");

    expect(stripeApi.refundsCreate).not.toHaveBeenCalled();
    const codes = loggerMock.error.mock.calls.map((c) => c[1]);
    expect(codes).toContain("COUNTRY_DENIAL_REFUND_UNTRACEABLE");
  });

  // ---- A genuine failure must still retry ---------------------------------

  /**
   * The catch is narrow ON PURPOSE. Settling the country verdict is right;
   * settling a parse failure or a database outage would hide a real defect
   * behind a 200 and lose the event. `CountryDenialError` only.
   */
  it("still THROWS on a non-country failure in the same branch — the catch is narrow", async () => {
    configMocks.getTier1Countries.mockResolvedValue(["FR"]);
    // Eligible country, so the country gate passes; the subscription then
    // fails to parse. That is a genuine shape failure and Stripe must retry.
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_denial",
      address: { country: "FR" },
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      object: "subscription",
      status: "active",
    });
    const process_ = await handler();
    const { body, signature } = signed(checkoutEvent("FR"));

    await expect(process_(body, signature, "req_narrow")).rejects.toThrow(
      /failed shape validation/,
    );
    expect(stripeApi.subscriptionsCancel).not.toHaveBeenCalled();
    expect(stripeApi.refundsCreate).not.toHaveBeenCalled();
  });
});
