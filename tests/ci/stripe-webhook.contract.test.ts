/**
 * Stripe webhook handler contract — Phase C.
 *
 * @spec [Doc-01_V8 §22 (verified heading "## **§22 Stripe webhook handling**");
 *        SCL-043 payer identity; SCL-049 livemode; Charter §6]
 *
 * Signature verification is exercised with the REAL Stripe SDK: signatures are
 * generated with `Stripe.webhooks.generateTestHeaderString` and verified by the
 * SDK's own `constructEvent`. Only the Stripe API surface (subscription
 * re-fetch) and the database are mocked. A test that mocked verification would
 * prove nothing about the control it names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_contract_suite";
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({ expectedLivemode: false }));

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(async () => ({ error: null as { code?: string; message?: string } | null })),
  delete: vi.fn(async () => ({ error: null })),
}));

const accountMocks = vi.hoisted(() => ({
  upsertEntitlement: vi.fn(async () => ({})),
  mapStripeStatusToEntitlement: vi.fn((s: string) => ({
    tier: s === "active" ? "premium" : "free",
    status: s,
  })),
}));

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_contract_suite_placeholder");
  return {
    getStripeClient: () => ({
      // REAL verification — not a stub.
      webhooks: real.webhooks,
      subscriptions: { retrieve: stripeApi.subscriptionsRetrieve },
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
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function signedRequest(event: Record<string, unknown>): {
  body: Buffer;
  signature: string;
} {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { body: Buffer.from(payload, "utf8"), signature };
}

function checkoutEvent(
  overrides: {
    id?: string;
    livemode?: boolean;
    metadata?: Record<string, string>;
    clientReferenceId?: string | null;
  } = {},
) {
  return {
    id: overrides.id ?? "evt_checkout_1",
    object: "event",
    type: "checkout.session.completed",
    livemode: overrides.livemode ?? false,
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        mode: "subscription",
        subscription: "sub_test_1",
        client_reference_id:
          overrides.clientReferenceId === undefined
            ? STUDENT_ID
            : overrides.clientReferenceId,
        metadata: overrides.metadata ?? { student_profile_id: STUDENT_ID },
      },
    },
  };
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

describe("Stripe webhook handler contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_1",
      status: "active",
      cancel_at_period_end: false,
      current_period_start: 1_760_000_000,
      current_period_end: 1_762_000_000,
      items: { data: [{ price: { id: "price_monthly" } }] },
    });
  });

  it("rejects a body that was parsed before the handler", async () => {
    const process_ = await handler();
    const outcome = await process_({ not: "a buffer" }, "sig");

    expect(outcome).toMatchObject({ ok: false, reason: "not_raw_body" });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature and never reaches the idempotency gate", async () => {
    const process_ = await handler();
    const { body } = signedRequest(checkoutEvent());

    const outcome = await process_(body, "t=1,v1=deadbeef");

    expect(outcome).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("rejects a livemode mismatch AFTER a valid signature, before the gate (SCL-049)", async () => {
    state.expectedLivemode = false; // this environment serves test mode
    const process_ = await handler();
    const { body, signature } = signedRequest(
      checkoutEvent({ livemode: true }), // a LIVE event arrives
    );

    const outcome = await process_(body, signature);

    expect(outcome).toMatchObject({ ok: false, reason: "livemode_mismatch" });
    // Ordering proof: the signature was valid, so reaching this branch means
    // verification passed and the mode check ran before any processing.
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("accepts a livemode match and writes the entitlement to the student in metadata", async () => {
    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());

    const outcome = await process_(body, signature);

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    const [profileId, patch] = accountMocks.upsertEntitlement.mock.calls[0];
    expect(profileId).toBe(STUDENT_ID);
    expect(patch).toMatchObject({
      tier: "premium",
      status: "active",
      stripe_subscription_id: "sub_test_1",
      stripe_price_id: "price_monthly",
      cancel_at_period_end: false,
    });
  });

  it("persists Stripe's re-fetched status, not the status in the delivered payload", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_1",
      status: "canceled",
      cancel_at_period_end: true,
      items: { data: [] },
    });

    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());
    await process_(body, signature);

    expect(stripeApi.subscriptionsRetrieve).toHaveBeenCalledWith("sub_test_1");
    expect(accountMocks.upsertEntitlement.mock.calls[0][1]).toMatchObject({
      status: "canceled",
      tier: "free",
    });
  });

  it("treats a duplicate event id as already processed and does not double-write", async () => {
    dbMocks.insert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key" },
    });

    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());
    const outcome = await process_(body, signature);

    expect(outcome).toMatchObject({ ok: true, status: "already_processed" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("fails closed when no student subject is present, and releases the gate for retry", async () => {
    const process_ = await handler();
    const { body, signature } = signedRequest(
      checkoutEvent({ metadata: {}, clientReferenceId: null }),
    );

    await expect(process_(body, signature)).rejects.toThrow(
      /student_profile_id/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    expect(dbMocks.delete).toHaveBeenCalledTimes(1); // gate released
  });

  it("rejects a non-UUID subject rather than passing it through", async () => {
    const process_ = await handler();
    const { body, signature } = signedRequest(
      checkoutEvent({
        metadata: { student_profile_id: "'; DROP TABLE entitlements; --" },
        clientReferenceId: null,
      }),
    );

    await expect(process_(body, signature)).rejects.toThrow();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("acknowledges an unhandled event type without claiming the gate", async () => {
    const process_ = await handler();
    const { body, signature } = signedRequest({
      id: "evt_unhandled_1",
      object: "event",
      type: "invoice.payment_succeeded",
      livemode: false,
      data: { object: { id: "in_1" } },
    });

    const outcome = await process_(body, signature);

    expect(outcome).toMatchObject({ ok: true, status: "ignored" });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});
