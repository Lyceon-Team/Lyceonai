/**
 * Refund handling — full revokes, partial does not, compared against the
 * CHARGED amount.
 *
 * @spec [SCL-048 refunds as amended by SCL-072] | @implemented [2026-08-27]
 *
 * plain English: proves a fully refunded payment removes premium access, a
 * partial one does not, and a discounted subscription refunded in full is
 * recognised as full rather than partial. Expected outcome: access follows the
 * money. Trade-off: the decision function is tested directly as well as through
 * the handler, because the list-price-versus-charged-amount distinction is
 * arithmetic and deserves to be pinned without webhook scaffolding around it.
 * Edge case: two partial refunds that together cover the charge.
 *
 * Both halves are asserted: an outcome status alone would pass on a handler
 * that returned `processed` and wrote nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { decideRefundRevocation } from "../../server/lib/stripe/refund";

const WEBHOOK_SECRET = "whsec_test_secret_for_refund_suite";
const STUDENT_ID = "77777777-7777-4777-8777-777777777777";

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
  getEntitlementsBySubscriptionId: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(async () => []),
}));

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsResume: vi.fn(),
  subscriptionsList: vi.fn(),
  chargesRetrieve: vi.fn(),
  // Codex HIGH-5: refunds/disputes now resolve charge -> payment intent ->
  // invoice payment -> invoice -> subscription. Exact provenance, not a walk of
  // the Customer's subscriptions.
  invoicePaymentsList: vi.fn(async () => ({
    object: "list",
    data: [{ invoice: "in_test_1" }],
  })),
  invoicesRetrieve: vi.fn(async () => ({
    id: "in_test_1",
    parent: { subscription_details: { subscription: "sub_test_1" } },
  })),
  // INV-03-08 now gates EVERY grant, so the writer reads the payer\'s
  // Customer. Eligible by default here; denial has its own suites.
  customersRetrieve: vi.fn(async () => ({
    id: "cus_test_1",
    address: { country: "US" },
  })),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_refund_suite_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks, // REAL verification
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        list: stripeApi.subscriptionsList,
        update: stripeApi.subscriptionsUpdate,
        resume: stripeApi.subscriptionsResume,
      },
      charges: { retrieve: stripeApi.chargesRetrieve },
      customers: { retrieve: stripeApi.customersRetrieve },
      invoicePayments: { list: stripeApi.invoicePaymentsList },
      invoices: { retrieve: stripeApi.invoicesRetrieve },
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
  // The country gate now runs on checkout.session.completed. These suites are
  // about disputes/refunds/guardian writes, so the Tier-1 list is seeded
  // eligible here — the gate has its OWN suite
  // (tests/ci/stripe-country-gate.contract.test.ts) where denial is the subject.
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload, "utf8"),
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

function refundEvent(status: string, id = `evt_refund_${status}`) {
  return {
    id,
    object: "event",
    type: "refund.updated",
    livemode: false,
    data: {
      object: {
        id: "re_test_1",
        object: "refund",
        status,
        charge: "ch_test_1",
      },
    },
  };
}

/** Set what the charge says was charged and refunded. */
function chargeIs(amount: number, amountRefunded: number) {
  stripeApi.chargesRetrieve.mockResolvedValue({
    id: "ch_test_1",
    payment_intent: "pi_test_1",
    object: "charge",
    customer: "cus_test_1",
    amount,
    amount_refunded: amountRefunded,
  });
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

describe("decideRefundRevocation — the charged-amount rule (SCL-072)", () => {
  it("revokes on a full refund of the charged amount", () => {
    // Codex M-4: this previously used 4900/4900, the LIST price, so it could
    // not distinguish "compared against the charged amount" from "compared
    // against a hard-coded 4900" — the exact substitution that once passed as
    // a plant. An amount that is deliberately NOT the list price makes the
    // claim falsifiable.
    expect(decideRefundRevocation("succeeded", 3175, 3175)).toMatchObject({
      revoke: true,
    });
  });

  it("does NOT revoke on a partial refund", () => {
    expect(decideRefundRevocation("succeeded", 4900, 2000)).toMatchObject({
      revoke: false,
    });
  });

  it("treats a DISCOUNTED subscription refunded in full as full, not partial", () => {
    // The defect SCL-072 exists to prevent: list price 4900, charged 2450 after
    // a 50% coupon, refunded 2450. Compared against the list price this reads
    // as partial and access survives a complete refund. Compared against the
    // charged amount — which is what the charge object carries — it is full.
    expect(decideRefundRevocation("succeeded", 2450, 2450)).toMatchObject({
      revoke: true,
    });
  });

  it("does not revoke while the cumulative total is one unit short", () => {
    // The boundary, stated as a boundary. This is the COMPARISON only —
    // accumulation across two events is proved through the handler below,
    // because that is where "cumulative" is a claim about Stripe rather than
    // about arithmetic.
    expect(decideRefundRevocation("succeeded", 4900, 4899)).toMatchObject({
      revoke: false,
    });
    expect(decideRefundRevocation("succeeded", 4900, 4900)).toMatchObject({
      revoke: true,
    });
  });

  it("never revokes on a refund that has not succeeded", () => {
    for (const status of ["pending", "failed", "requires_action", null]) {
      expect(decideRefundRevocation(status, 4900, 4900)).toMatchObject({
        revoke: false,
      });
    }
  });

  it("fails safe on a zero-amount charge rather than reading it as fully refunded", () => {
    expect(decideRefundRevocation("succeeded", 0, 0)).toMatchObject({
      revoke: false,
    });
  });
});

describe("refund.updated through the real handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    chargeIs(4900, 4900);
    stripeApi.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [{ id: "sub_test_1", object: "subscription" }],
    });
    accountMocks.getEntitlementsBySubscriptionId.mockResolvedValue([
      { profile_id: STUDENT_ID, stripe_subscription_id: "sub_test_1" },
    ]);
  });

  it("a succeeded FULL refund revokes premium access", async () => {
    const process_ = await handler();
    const { body, signature } = signed(refundEvent("succeeded"));

    const outcome = await process_(body, signature, "req_refund_full");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(STUDENT_ID, {
      tier: "free",
      status: "canceled",
    });
  });

  it("revokes on a DISCOUNTED subscription refunded in full — through the handler", async () => {
    // This test exists because a plant proved the others could not catch the
    // defect: every one of them used charge amount 4900, so substituting a
    // hard-coded list price of 4900 for the charged amount changed nothing and
    // the plant passed. A handler test only pins the charged-amount rule when
    // the charged amount DIFFERS from any plausible list price.
    //
    // List price 4900, charged 2450 after a 50% coupon, refunded 2450 in full.
    chargeIs(2450, 2450);

    const process_ = await handler();
    const { body, signature } = signed(refundEvent("succeeded"));

    const outcome = await process_(body, signature, "req_refund_discounted");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(STUDENT_ID, {
      tier: "free",
      status: "canceled",
    });
  });

  it("a succeeded PARTIAL refund writes nothing", async () => {
    chargeIs(4900, 1000);

    const process_ = await handler();
    const { body, signature } = signed(refundEvent("succeeded"));

    const outcome = await process_(body, signature, "req_refund_partial");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("a PENDING refund writes nothing — creation is not the revoking transition", async () => {
    const process_ = await handler();
    const { body, signature } = signed(refundEvent("pending"));

    const outcome = await process_(body, signature, "req_refund_pending");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});

/**
 * Codex HIGH-5 (durability), HIGH-4 (fan-out) and M-4 (real accumulation).
 */
describe("refund durability, fan-out and accumulation (Codex HIGH-5, HIGH-4, M-4)", () => {
  const STUDENT_B = "66666666-6666-4666-8666-666666666666";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    stripeApi.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [{ id: "sub_test_1", object: "subscription" }],
    });
    accountMocks.getEntitlementsBySubscriptionId.mockResolvedValue([
      { profile_id: STUDENT_ID, stripe_subscription_id: "sub_test_1" },
    ]);
  });

  /**
   * HIGH-5. The revocation must survive the NEXT subscription lifecycle event.
   * Writing only local `free`/`canceled` while the Stripe subscription stayed
   * active meant a later `customer.subscription.updated` re-derived premium
   * over it, because `entitlements` is last-writer-wins on `profile_id`. The
   * marker therefore has to live on Stripe's object, which is the mechanism
   * already ruled for disputes (SCL-073 option B).
   */
  it("pauses collection on a full refund, so a later re-derivation cannot restore premium", async () => {
    chargeIs(4900, 4900);
    const process_ = await handler();
    const { body, signature } = signed(refundEvent("succeeded"));

    await process_(body, signature, "req_refund_durable");

    expect(stripeApi.subscriptionsUpdate).toHaveBeenCalledWith("sub_test_1", {
      pause_collection: { behavior: "keep_as_draft" },
    });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "free", status: "canceled" }),
    );
  });

  it("pauses BEFORE the local write, so a failed write leaves a safe state", async () => {
    chargeIs(4900, 4900);
    const order: string[] = [];
    stripeApi.subscriptionsUpdate.mockImplementation(async () => {
      order.push("pause");
      return {};
    });
    accountMocks.upsertEntitlement.mockImplementation(async () => {
      order.push("local_write");
      return {};
    });

    const process_ = await handler();
    const { body, signature } = signed(refundEvent("succeeded"));
    await process_(body, signature, "req_refund_order");

    expect(order).toEqual(["pause", "local_write"]);
  });

  it("does NOT pause on a partial refund — a partial refund does not revoke", async () => {
    chargeIs(4900, 2000);
    const process_ = await handler();
    const { body, signature } = signed(refundEvent("succeeded"));

    await process_(body, signature, "req_refund_partial");

    expect(stripeApi.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("revokes EVERY student on a fully refunded guardian invoice", async () => {
    chargeIs(9800, 9800);
    accountMocks.getEntitlementsBySubscriptionId.mockResolvedValue([
      { profile_id: STUDENT_ID, stripe_subscription_id: "sub_test_1" },
      { profile_id: STUDENT_B, stripe_subscription_id: "sub_test_1" },
    ]);

    const process_ = await handler();
    const { body, signature } = signed(refundEvent("succeeded"));
    await process_(body, signature, "req_refund_fanout");

    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(2);
    for (const student of [STUDENT_ID, STUDENT_B]) {
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        student,
        expect.objectContaining({ tier: "free", status: "canceled" }),
      );
    }
  });

  /**
   * M-4. The real accumulation claim: TWO refund events arrive, and only the
   * second revokes. The previous test asserted 4900/4900 twice against the pure
   * function, which demonstrated the comparison but never that a first partial
   * leaves access intact while a second completes the revocation.
   */
  it("accumulates across two refund EVENTS — first partial grants nothing, second revokes", async () => {
    const process_ = await handler();

    // Event 1: 2000 of 4900 refunded so far.
    chargeIs(4900, 2000);
    const first = signed(refundEvent("succeeded", "evt_refund_part_1"));
    await process_(first.body, first.signature, "req_refund_acc_1");

    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    expect(stripeApi.subscriptionsUpdate).not.toHaveBeenCalled();

    // Event 2: a SECOND refund brings the cumulative total to the full charge.
    // `amount_refunded` is cumulative on the charge, which is why the handler
    // does not sum refunds itself — this proves that reliance is sound.
    chargeIs(4900, 4900);
    const second = signed(refundEvent("succeeded", "evt_refund_part_2"));
    await process_(second.body, second.signature, "req_refund_acc_2");

    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "free", status: "canceled" }),
    );
  });
});
