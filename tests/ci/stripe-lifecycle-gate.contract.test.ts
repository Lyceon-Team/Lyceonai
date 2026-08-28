/**
 * INV-03-08 on EVERY grant, and SCL-047 country egress.
 *
 * @spec [INV-03-08 (Doc 03 §2156, heading verified); SCL-046 as amended
 *        2026-08-27] | @implemented [2026-08-28 — closes Codex HIGH-1]
 *
 * plain English: proves the country rule actually RUNS. Codex found
 * `evaluateCountryEligibility` had no application call site at all — "a
 * fail-open money path" — so entitlement was granted with no country decision
 * while the module's presence suggested otherwise. Expected outcome: an
 * ineligible or unknown billing country denies entitlement at
 * `checkout.session.completed`, and an eligible one grants.
 *
 * Trade-off: this tests the WIRING through the real handler, not the pure rule
 * — that already has its own suite
 * (`tests/ci/stripe-country-eligibility.contract.test.ts`). A green rule with
 * no caller is exactly the defect being closed, so the rule's own tests could
 * not have caught it and neither could a unit test of the rule here.
 *
 * BOTH HALVES ARE ASSERTED. A denial that returned an error while still writing
 * the entitlement would be the same money path with a louder log, so every
 * denial case asserts `upsertEntitlement` was NOT called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_lifecycle";
const STUDENT_ID = "88888888-8888-4888-8888-888888888888";

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
const configMocks = vi.hoisted(() => ({
  getTier1Countries: vi.fn(),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsResume: vi.fn(),
  subscriptionsList: vi.fn(),
  chargesRetrieve: vi.fn(),
  // INV-03-08 now gates EVERY grant, so the writer reads the payer\'s
  // Customer. Eligible by default here; denial has its own suites.
  customersRetrieve: vi.fn(async () => ({
    id: "cus_test_1",
    address: { country: "US" },
  })),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_country_gate_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        list: stripeApi.subscriptionsList,
        update: stripeApi.subscriptionsUpdate,
        resume: stripeApi.subscriptionsResume,
      },
      charges: { retrieve: stripeApi.chargesRetrieve },
      customers: { retrieve: stripeApi.customersRetrieve },
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
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function signedSubscriptionEvent(
  type: "customer.subscription.created" | "customer.subscription.updated",
) {
  const event = {
    id: `evt_lifecycle_${type}`,
    object: "event",
    type,
    livemode: false,
    data: {
      object: {
        id: "sub_lifecycle",
        object: "subscription",
        status: "active",
        customer: "cus_lifecycle",
        metadata: { student_profile_id: STUDENT_ID },
      },
    },
  };
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload, "utf8"),
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

function signedCustomerUpdated(country: string | null) {
  const event = {
    id: `evt_customer_updated_${country ?? "none"}`,
    object: "event",
    type: "customer.updated",
    livemode: false,
    data: {
      object: {
        id: "cus_lifecycle",
        object: "customer",
        address: country === null ? null : { country },
      },
    },
  };
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload, "utf8"),
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

/**
 * @spec [INV-03-08; SCL-046; SCL-047] | @implemented [2026-08-28 — closes Codex HIGH-2]
 *
 * plain English: Codex found SIX granting paths with no country gate, because
 * the gate was wired at ONE event. These tests pin the gate at the WRITER, so a
 * new granting path inherits it rather than having to remember it.
 */
describe("INV-03-08 gates every subscription-lifecycle grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_lifecycle",
      address: { country: "US" },
    });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_lifecycle",
      object: "subscription",
      status: "active",
      customer: "cus_lifecycle",
      metadata: { student_profile_id: STUDENT_ID },
      items: {
        object: "list",
        data: [
          {
            id: "si_lifecycle",
            object: "subscription_item",
            current_period_start: 1_756_000_000,
            current_period_end: 1_758_600_000,
            price: { id: "price_test" },
            metadata: { student_profile_id: STUDENT_ID },
          },
        ],
      },
    });
  });

  for (const type of [
    "customer.subscription.created",
    "customer.subscription.updated",
  ] as const) {
    it(`GRANTS on ${type} when the payer country is eligible`, async () => {
      const process_ = await handler();
      const { body, signature } = signedSubscriptionEvent(type);
      await process_(body, signature, `req_ok_${type}`);
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        STUDENT_ID,
        expect.objectContaining({ tier: "premium" }),
      );
    });

    it(`REFUSES ${type} when the payer country is INELIGIBLE — the ungated path Codex found`, async () => {
      stripeApi.customersRetrieve.mockResolvedValue({
        id: "cus_lifecycle",
        address: { country: "FR" },
      });
      const process_ = await handler();
      const { body, signature } = signedSubscriptionEvent(type);

      await expect(
        process_(body, signature, `req_bad_${type}`),
      ).rejects.toThrow(/not Tier-1 eligible/);
      expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    });
  }

  it("does NOT gate a write that moves a student to free — refusing to revoke would leave premium in place", async () => {
    // The asymmetry that keeps the gate safe. If a country check could block a
    // REVOCATION, an unknown country would preserve access rather than remove it.
    stripeApi.customersRetrieve.mockResolvedValue({ id: "cus_lifecycle" });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_lifecycle",
      object: "subscription",
      status: "canceled",
      customer: "cus_lifecycle",
      metadata: { student_profile_id: STUDENT_ID },
      items: { object: "list", data: [] },
    });

    const process_ = await handler();
    const { body, signature } = signedSubscriptionEvent(
      "customer.subscription.updated",
    );
    await process_(body, signature, "req_revoke_ungated");

    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "free" }),
    );
  });
});

/**
 * @spec [SCL-047 owner ruling option (b)] | @implemented [2026-08-28]
 *
 * The event that was ignored, so a payer could change their Portal billing
 * address out of Tier-1 and keep renewing forever.
 */
describe("SCL-047 country egress on customer.updated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    stripeApi.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [{ id: "sub_lifecycle", object: "subscription" }],
    });
  });

  it("sets cancel_at_period_end when the billing country leaves Tier-1", async () => {
    const process_ = await handler();
    const { body, signature } = signedCustomerUpdated("FR");
    await process_(body, signature, "req_egress");

    expect(stripeApi.subscriptionsUpdate).toHaveBeenCalledWith(
      "sub_lifecycle",
      {
        cancel_at_period_end: true,
      },
    );
    // NO immediate cut: the ruling is access to period end, and the transition
    // to free arrives on the lifecycle event at that point — one writer.
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("does NOTHING when the country is still Tier-1", async () => {
    const process_ = await handler();
    const { body, signature } = signedCustomerUpdated("CA");
    await process_(body, signature, "req_no_egress");
    expect(stripeApi.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("does NOTHING on an ABSENT address — an absence is not a move", async () => {
    // `unknown` must not trigger egress: a customer who never supplied an
    // address has not moved anywhere, and cancelling on an absence would
    // revoke for a fact we do not have.
    const process_ = await handler();
    const { body, signature } = signedCustomerUpdated(null);
    await process_(body, signature, "req_absent");
    expect(stripeApi.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});
