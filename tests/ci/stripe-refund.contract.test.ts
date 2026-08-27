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
  getEntitlementBySubscriptionId: vi.fn(),
}));

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsList: vi.fn(),
  chargesRetrieve: vi.fn(),
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
      },
      charges: { retrieve: stripeApi.chargesRetrieve },
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
  getEntitlementBySubscriptionId: accountMocks.getEntitlementBySubscriptionId,
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
    expect(decideRefundRevocation("succeeded", 4900, 4900)).toMatchObject({
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

  it("treats two partials that together cover the charge as full", () => {
    // `amount_refunded` is cumulative on the charge, so this is handled by
    // construction rather than by summing refunds ourselves.
    expect(decideRefundRevocation("succeeded", 4900, 4900)).toMatchObject({
      revoke: true,
    });
    expect(decideRefundRevocation("succeeded", 4900, 4899)).toMatchObject({
      revoke: false,
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
    accountMocks.getEntitlementBySubscriptionId.mockResolvedValue({
      profile_id: STUDENT_ID,
      stripe_subscription_id: "sub_test_1",
    });
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
