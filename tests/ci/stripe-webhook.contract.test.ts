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
}));

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsResume: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_contract_suite_placeholder");
  return {
    getStripeClient: () => ({
      // REAL verification — not a stub.
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        update: stripeApi.subscriptionsUpdate,
        resume: stripeApi.subscriptionsResume,
      },
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

vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  // The INV-03-08 country gate runs on checkout.session.completed. These
  // suites are not about the gate, so the Tier-1 list is seeded eligible;
  // denial has its own suite (tests/ci/stripe-country-gate.contract.test.ts).
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
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
    /** INV-03-08 billing country; `null` exercises the unknown verdict. */
    country?: string | null;
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
        // INV-03-08: a COMPLETED session carries the billing address the
        // customer typed during Checkout. Eligible by default here so this
        // suite keeps testing what it is about; the country gate's own denial
        // cases live in tests/ci/stripe-country-gate.contract.test.ts.
        customer_details: {
          address: {
            country: overrides.country === undefined ? "US" : overrides.country,
          },
        },
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
    // The shape Stripe actually returns from API version 2025-03-31.basil
    // onward: `current_period_start` / `current_period_end` were REMOVED from
    // the Subscription and added to SubscriptionItem. This fixture previously
    // carried them at the top level, which no live retrieve has produced since
    // that version — it encoded a shape Stripe no longer sends.
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_1",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: "si_test_1",
            price: { id: "price_monthly" },
            current_period_start: 1_760_000_000,
            current_period_end: 1_762_000_000,
          },
        ],
      },
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

  // -------------------------------------------------------------------
  // Period bounds — Stripe API 2025-03-31.basil moved them onto the item
  // -------------------------------------------------------------------

  it("derives period bounds from the subscription item when the subscription carries no top-level period fields", async () => {
    const START = 1_770_000_000;
    const END = 1_772_592_000;

    const retrieved = {
      id: "sub_test_1",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: "si_test_1",
            price: { id: "price_monthly" },
            current_period_start: START,
            current_period_end: END,
          },
        ],
      },
    };

    // The premise of the test, asserted rather than assumed: this payload has
    // NO top-level period fields. If a future edit reintroduces them, the test
    // would silently stop proving what it claims to prove.
    expect(retrieved).not.toHaveProperty("current_period_start");
    expect(retrieved).not.toHaveProperty("current_period_end");

    stripeApi.subscriptionsRetrieve.mockResolvedValue(retrieved);

    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());
    await process_(body, signature);

    // Both halves: present AND correct. `not.toBeNull()` alone would pass on
    // any date the code invented.
    expect(accountMocks.upsertEntitlement.mock.calls[0][1]).toMatchObject({
      current_period_start: new Date(START * 1000).toISOString(),
      current_period_end: new Date(END * 1000).toISOString(),
      stripe_price_id: "price_monthly",
    });
  });

  it("fails closed rather than guessing when several items name no matching student", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_1",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: "si_other_a",
            price: { id: "price_a" },
            current_period_start: 1,
            current_period_end: 2,
            metadata: {
              student_profile_id: "11111111-1111-1111-1111-111111111111",
            },
          },
          {
            id: "si_other_b",
            price: { id: "price_b" },
            current_period_start: 3,
            current_period_end: 4,
            metadata: {
              student_profile_id: "22222222-2222-2222-2222-222222222222",
            },
          },
        ],
      },
    });

    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());
    await expect(process_(body, signature)).rejects.toThrow(
      /no subscription item resolves to the subject student/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("treats a duplicate event id as already processed and does not double-write", async () => {
    dbMocks.insert.mockResolvedValueOnce({
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "stripe_webhook_events_pkey"',
      },
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
  // --- post-audit: Zod parse at the Stripe boundary ---------------------------

  it("rejects a signed payload whose object shape does not match (Zod boundary parse)", async () => {
    const process_ = await handler();
    // Correctly signed, but `subscription` is a number and `id` is missing —
    // a valid signature proves Stripe sent it, not that the shape is usable.
    const { body, signature } = signedRequest({
      id: "evt_badshape_1",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          object: "checkout.session",
          mode: "subscription",
          subscription: 12345,
          metadata: { student_profile_id: STUDENT_ID },
        },
      },
    });

    await expect(process_(body, signature)).rejects.toThrow(
      /failed shape validation/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    expect(dbMocks.delete).toHaveBeenCalledTimes(1); // gate released for retry
  });

  it("rejects a re-fetched subscription that lacks a status rather than writing a partial row", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_1",
      // no `status` at all
      items: { data: [] },
    });

    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());

    await expect(process_(body, signature)).rejects.toThrow(
      /failed shape validation/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("normalises absent period fields to null instead of undefined", async () => {
    // Unchanged in intent, moved to the level that now carries the fields: an
    // item with no period must still normalise to null rather than letting
    // `undefined` reach the write. This is the behaviour that kept the
    // 2026-08-26 defect to NULL bounds instead of a malformed row.
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_1",
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ id: "si_test_1", price: { id: "price_monthly" } }] },
      // period fields absent — on the item, where Stripe now carries them
    });

    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());
    await process_(body, signature);

    expect(accountMocks.upsertEntitlement.mock.calls[0][1]).toMatchObject({
      current_period_start: null,
      current_period_end: null,
      stripe_price_id: "price_monthly",
    });
  });

  // --- post-audit: the 23505 gate checks WHICH constraint ----------------------

  it("treats a 23505 on a different constraint as an error, not a replay", async () => {
    dbMocks.insert.mockResolvedValueOnce({
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "some_future_constraint"',
      },
    });

    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());

    await expect(process_(body, signature)).rejects.toThrow(
      /unexpected unique violation/,
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  // --- post-audit: payer identifiers are digested in logs ---------------------

  it("never passes a raw profile id or Stripe object id to the logger", async () => {
    const { logger } = await import("../../server/logger");
    const process_ = await handler();
    const { body, signature } = signedRequest(checkoutEvent());
    await process_(body, signature);

    const emitted = JSON.stringify(
      (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls,
    );
    expect(emitted).not.toContain(STUDENT_ID);
    expect(emitted).not.toContain("sub_test_1");
    expect(emitted).toContain("studentProfileRef");
  });
});
