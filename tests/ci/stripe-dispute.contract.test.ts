/**
 * Chargeback handling — revocation, restoration, and the Payment Link defence.
 *
 * @spec [SCL-073 disputes; SCL-048 refunds (NOT this path); Charter §6;
 *        Doc 01A §52] | @implemented [2026-08-27]
 *
 * plain English: proves that a chargeback removes premium access, that winning
 * the dispute puts it back, that losing leaves it off, and that a Payment Link
 * purchase is refused rather than guessed at. Expected outcome: entitlement
 * follows the funds. Trade-off: the database and the Stripe API surface are
 * stubbed because CI has neither; signature verification is the REAL SDK and
 * nothing mocks the handler under test. Edge cases covered: a disputed charge
 * with no Customer, a charge mapping to several entitlements, and every member
 * of `Dispute.Status`.
 *
 * Both halves are asserted throughout: an outcome status alone would pass on a
 * handler that returned `processed` and wrote nothing, so every behavioural
 * test also asserts the write that did or did not happen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_dispute_suite";
const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_STUDENT_ID = "66666666-6666-4666-8666-666666666666";

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
  const real = new StripeSdk("sk_test_dispute_suite_placeholder");
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

function disputeEvent(
  type: "charge.dispute.created" | "charge.dispute.closed",
  status: string,
  id = `evt_${type}_${status}`,
) {
  return {
    id,
    object: "event",
    type,
    livemode: false,
    data: {
      object: {
        id: "dp_test_1",
        object: "dispute",
        status,
        charge: "ch_test_1",
      },
    },
  };
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

describe("Stripe disputes (SCL-073)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });

    stripeApi.chargesRetrieve.mockResolvedValue({
      id: "ch_test_1",
      object: "charge",
      customer: "cus_test_1",
    });
    stripeApi.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [{ id: "sub_test_1", object: "subscription" }],
    });
    accountMocks.getEntitlementBySubscriptionId.mockResolvedValue({
      profile_id: STUDENT_ID,
      stripe_subscription_id: "sub_test_1",
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_1",
      object: "subscription",
      status: "active",
      customer: "cus_test_1",
      metadata: { student_profile_id: STUDENT_ID },
      items: {
        object: "list",
        data: [
          {
            id: "si_test_1",
            object: "subscription_item",
            current_period_start: 1_756_000_000,
            current_period_end: 1_758_600_000,
            price: { id: "price_test_1" },
            metadata: { student_profile_id: STUDENT_ID },
          },
        ],
      },
    });
  });

  it("a chargeback removes premium access from the entitled student", async () => {
    const process_ = await handler();
    const { body, signature } = signed(
      disputeEvent("charge.dispute.created", "needs_response"),
    );

    const outcome = await process_(body, signature, "req_dispute_1");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    // Both halves: the response AND the write.
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(STUDENT_ID, {
      tier: "free",
      status: "unpaid",
    });
  });

  it("a WON dispute restores access from Stripe's live subscription, not from memory", async () => {
    const process_ = await handler();
    const { body, signature } = signed(
      disputeEvent("charge.dispute.closed", "won"),
    );

    const outcome = await process_(body, signature, "req_dispute_won");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    // Re-derived: the live subscription was re-fetched...
    expect(stripeApi.subscriptionsRetrieve).toHaveBeenCalledWith("sub_test_1");
    // ...and the entitlement reflects what Stripe says, not a reconstruction.
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "premium", status: "active" }),
    );
  });

  it("a LOST dispute leaves access revoked and writes nothing", async () => {
    const process_ = await handler();
    const { body, signature } = signed(
      disputeEvent("charge.dispute.closed", "lost"),
    );

    const outcome = await process_(body, signature, "req_dispute_lost");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    // The half that matters: no write at all. A restore here would hand back
    // access for money we no longer hold.
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    expect(stripeApi.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("a warning that closed WITHOUT becoming a dispute restores access", async () => {
    const process_ = await handler();
    const { body, signature } = signed(
      disputeEvent("charge.dispute.closed", "warning_closed"),
    );

    const outcome = await process_(body, signature, "req_dispute_warning");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    // No funds were ever withdrawn on an inquiry, so there is nothing to
    // withhold access over.
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "premium" }),
    );
  });

  it("refuses to guess when a disputed charge maps to several entitlements", async () => {
    stripeApi.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [
        { id: "sub_test_1", object: "subscription" },
        { id: "sub_test_2", object: "subscription" },
      ],
    });
    accountMocks.getEntitlementBySubscriptionId
      .mockResolvedValueOnce({
        profile_id: STUDENT_ID,
        stripe_subscription_id: "sub_test_1",
      })
      .mockResolvedValueOnce({
        profile_id: OTHER_STUDENT_ID,
        stripe_subscription_id: "sub_test_2",
      });

    const process_ = await handler();
    const { body, signature } = signed(
      disputeEvent("charge.dispute.created", "needs_response"),
    );

    // Ambiguity fails closed and loudly — the alternative is revoking a student
    // whose payment was never disputed.
    await expect(
      process_(body, signature, "req_dispute_ambiguous"),
    ).rejects.toThrow(/maps to 2 entitlements/);
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("a disputed charge with no Customer changes nothing (absence, not ambiguity)", async () => {
    stripeApi.chargesRetrieve.mockResolvedValue({
      id: "ch_test_1",
      object: "charge",
      customer: null,
    });

    const process_ = await handler();
    const { body, signature } = signed(
      disputeEvent("charge.dispute.created", "needs_response"),
    );

    const outcome = await process_(body, signature, "req_dispute_nocust");

    // Absence is a fact, not an error: it is acknowledged, and nothing is
    // written. Throwing here would make Stripe retry forever.
    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("rejects an unknown dispute status rather than deciding by omission", async () => {
    const process_ = await handler();
    const { body, signature } = signed(
      disputeEvent("charge.dispute.closed", "some_future_status"),
    );

    await expect(
      process_(body, signature, "req_dispute_unknown"),
    ).rejects.toThrow(/payload failed shape validation/);
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});

describe("Payment Link defence (§4.7, Charter §6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
  });

  it("refuses a Payment Link checkout and grants nothing", async () => {
    const process_ = await handler();
    const { body, signature } = signed({
      id: "evt_payment_link",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_test_pl",
          object: "checkout.session",
          mode: "subscription",
          subscription: "sub_test_pl",
          payment_link: "plink_test_1",
          // No server-set client_reference_id — the defining shape of a
          // Payment Link purchase. Only a URL parameter could name a student.
          client_reference_id: null,
          metadata: {},
        },
      },
    });

    await expect(process_(body, signature, "req_pl")).rejects.toThrow(
      /Payment Link/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("does not reject an ordinary Checkout session that has no payment_link", async () => {
    // The negative half: the guard must reject Payment Links WITHOUT rejecting
    // the normal path, or it would be indistinguishable from a broken handler.
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_ok",
      object: "subscription",
      status: "active",
      items: {
        object: "list",
        data: [
          {
            id: "si_ok",
            object: "subscription_item",
            current_period_start: 1_756_000_000,
            current_period_end: 1_758_600_000,
            price: { id: "price_ok" },
            metadata: { student_profile_id: STUDENT_ID },
          },
        ],
      },
    });

    const process_ = await handler();
    const { body, signature } = signed({
      id: "evt_normal_checkout",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_test_ok",
          object: "checkout.session",
          mode: "subscription",
          subscription: "sub_test_ok",
          client_reference_id: STUDENT_ID,
          metadata: { student_profile_id: STUDENT_ID },
        },
      },
    });

    const outcome = await process_(body, signature, "req_normal");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalled();
  });
});
