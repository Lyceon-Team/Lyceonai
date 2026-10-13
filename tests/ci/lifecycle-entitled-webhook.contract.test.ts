/**
 * `lyceon.entitled` from the Stripe grant paths: only when an entitlement goes from not active to
 * active, to the student and the payer.
 *
 * @spec [owner ruling (Karl, 2026-10-12) item 2: "in the Stripe webhook grant path, when an
 *       entitlement goes from not active to active, set entitled = "true" and send
 *       lyceon.entitled to the student's contact, and to the payer's contact if a guardian
 *       paid"; SCL-029 (one predicate, `entitlement_active`)] | @implemented [2026-10-12]
 *
 * plain English: the REAL webhook handler (real signature verification) with the account writes,
 * the predicate and the lifecycle send substituted. The predicate is answered per profile in
 * order (before the upsert, after it), so each case states the transition it is about:
 *   E1  self-paid checkout, not active → active: one send, student only (payer null)
 *   E2  a renewal (already active): nothing
 *   E3  a write that leaves it inactive (canceled): nothing
 *   E4  the predicate unreadable or throwing: nothing — and the grant is still written
 *   E5  a guardian subscription for two students: one send per student, payer = the guardian
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_lifecycle_entitled";
const STUDENT = "44444444-4444-4444-8444-444444444441";
const STUDENT_B = "44444444-4444-4444-8444-444444444442";
const GUARDIAN = "55555555-5555-4555-8555-555555555555";

const accountMocks = vi.hoisted(() => ({
  upsertEntitlement: vi.fn(async () => ({})),
  mapStripeStatusToEntitlement: vi.fn((s: string) => ({
    tier: s === "active" ? "premium" : "free",
    status: s,
  })),
  getAllGuardianStudentLinks: vi.fn(async () => [] as unknown[]),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  customersRetrieve: vi.fn(async () => ({
    id: "cus_1",
    address: { country: "US" },
  })),
}));
/** Per profile: the answers `entitlement_active` gives, in order (before, after). */
const predicate = vi.hoisted(() => ({
  answers: new Map<
    string,
    ({ ok: true; active: boolean } | { ok: false } | "throw")[]
  >(),
}));
const lifecycle = vi.hoisted(() => ({
  sendEntitledEvents: vi.fn(async () => ["sent"]),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_lifecycle_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      customers: { retrieve: stripeApi.customersRetrieve },
      subscriptions: { retrieve: stripeApi.subscriptionsRetrieve },
    }),
    getExpectedLivemode: () => false,
  };
});
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: async () => ({ error: null }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock("../../server/lib/account", () => ({
  setProfileCountryCode: vi.fn(async () => undefined),
  upsertEntitlement: accountMocks.upsertEntitlement,
  mapStripeStatusToEntitlement: accountMocks.mapStripeStatusToEntitlement,
  getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: vi.fn(async () => ["US"]),
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    evaluateEntitlementActive: vi.fn(async (profileId: string) => {
      const next = predicate.answers.get(profileId)?.shift();
      if (next === "throw") throw new Error("rpc down");
      return next ?? { ok: true, active: false };
    }),
  },
}));
vi.mock("../../server/lib/lifecycle-email", () => ({
  defaultLifecycleDeps: () => ({}),
  fireLifecycle: (_l: string, _p: string, task: () => Promise<unknown>) => {
    void task();
  },
  sendEntitledEvents: lifecycle.sendEntitledEvents,
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ACTIVE = { ok: true, active: true } as const;
const INACTIVE = { ok: true, active: false } as const;

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

function checkout(id: string) {
  return signed({
    id,
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_1",
        object: "checkout.session",
        mode: "subscription",
        subscription: "sub_1",
        client_reference_id: STUDENT,
        metadata: { student_profile_id: STUDENT },
        customer_details: { address: { country: "US" } },
        payment_status: "paid",
      },
    },
  });
}

function selfPaidSubscription(status: string) {
  stripeApi.subscriptionsRetrieve.mockResolvedValue({
    id: "sub_1",
    customer: "cus_1",
    status,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "si_1",
          price: { id: "price_monthly" },
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_000_000,
        },
      ],
    },
  });
}

async function run(event: { body: Buffer; signature: string }) {
  const { processStripeWebhook } =
    await import("../../server/lib/stripe/webhook-handler");
  const outcome = await processStripeWebhook(
    event.body,
    event.signature,
    "req_lifecycle",
  );
  await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget task start
  return outcome;
}

beforeEach(() => {
  vi.clearAllMocks();
  predicate.answers.clear();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

describe("lyceon.entitled on the grant paths", () => {
  it("E1 self-paid, not active → active: one send for the student, no payer", async () => {
    selfPaidSubscription("active");
    predicate.answers.set(STUDENT, [INACTIVE, ACTIVE]);
    const outcome = await run(checkout("evt_e1"));
    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(lifecycle.sendEntitledEvents).toHaveBeenCalledTimes(1);
    expect(lifecycle.sendEntitledEvents).toHaveBeenCalledWith(
      { studentProfileId: STUDENT, payerProfileId: null },
      expect.anything(),
    );
  });

  it("E2 a renewal (already active before the write): nothing", async () => {
    selfPaidSubscription("active");
    predicate.answers.set(STUDENT, [ACTIVE, ACTIVE]);
    await run(checkout("evt_e2"));
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(lifecycle.sendEntitledEvents).not.toHaveBeenCalled();
  });

  it("E3 a write that leaves it inactive (canceled): nothing", async () => {
    selfPaidSubscription("canceled");
    predicate.answers.set(STUDENT, [INACTIVE, INACTIVE]);
    await run(checkout("evt_e3"));
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(lifecycle.sendEntitledEvents).not.toHaveBeenCalled();
  });

  it("E4 the predicate unreadable or throwing: nothing is sent, and the grant is still written", async () => {
    for (const before of [{ ok: false } as const, "throw" as const]) {
      vi.clearAllMocks();
      selfPaidSubscription("active");
      predicate.answers.set(STUDENT, [before, ACTIVE]);
      const outcome = await run(
        checkout(`evt_e4_${String(before === "throw")}`),
      );
      expect(outcome).toMatchObject({ ok: true, status: "processed" });
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
      expect(lifecycle.sendEntitledEvents).not.toHaveBeenCalled();
    }
  });

  it("E5 a guardian subscription for two students: one send per student, the guardian as payer", async () => {
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      {
        student_profile_id: STUDENT,
        guardian_profile_id: GUARDIAN,
        status: "active",
      },
      {
        student_profile_id: STUDENT_B,
        guardian_profile_id: GUARDIAN,
        status: "active",
      },
    ]);
    const item = (id: string, student: string) => ({
      id,
      object: "subscription_item",
      current_period_start: 1_760_000_000,
      current_period_end: 1_762_000_000,
      price: { id: "price_guardian" },
      metadata: { student_profile_id: student },
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_g",
      object: "subscription",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { payer_profile_id: GUARDIAN },
      items: {
        object: "list",
        data: [item("si_a", STUDENT), item("si_b", STUDENT_B)],
      },
    });
    predicate.answers.set(STUDENT, [INACTIVE, ACTIVE]);
    predicate.answers.set(STUDENT_B, [INACTIVE, ACTIVE]);
    const outcome = await run(
      signed({
        id: "evt_e5",
        object: "event",
        type: "customer.subscription.updated",
        livemode: false,
        data: {
          object: {
            id: "sub_g",
            object: "subscription",
            metadata: { payer_profile_id: GUARDIAN },
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(2);
    expect(lifecycle.sendEntitledEvents.mock.calls.map((c) => c[0])).toEqual([
      { studentProfileId: STUDENT, payerProfileId: GUARDIAN },
      { studentProfileId: STUDENT_B, payerProfileId: GUARDIAN },
    ]);
  });
});
