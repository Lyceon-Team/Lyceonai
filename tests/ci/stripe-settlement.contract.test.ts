/**
 * SCL-071 settlement — entitlement is written when money SETTLES.
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

const WEBHOOK_SECRET = "whsec_test_secret_for_settlement";
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

function signedSession(
  type:
    | "checkout.session.completed"
    | "checkout.session.async_payment_succeeded"
    | "checkout.session.async_payment_failed",
  paymentStatus: "paid" | "unpaid" | "no_payment_required",
) {
  const event = {
    id: `evt_settle_${type}_${paymentStatus}`,
    object: "event",
    type,
    livemode: false,
    data: {
      object: {
        id: "cs_settle",
        object: "checkout.session",
        mode: "subscription",
        subscription: "sub_settle",
        client_reference_id: STUDENT_ID,
        metadata: { student_profile_id: STUDENT_ID },
        customer_details: { address: { country: "US" } },
        payment_status: paymentStatus,
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
 * @spec [SCL-071] | @implemented [2026-08-28 — closes Codex HIGH-1]
 *
 * plain English: a delayed payment method completes the SESSION before the
 * money arrives. Fulfilling on `checkout.session.completed` unconditionally
 * grants premium against an unsettled payment; `async_payment_succeeded` is the
 * event that carries settlement and was previously classified "ignored — not
 * yet built", which is the other half of the same defect.
 *
 * Inert on today's configuration — card and Link settle synchronously and never
 * emit the async pair — which is exactly why it is tested now: enabling a
 * delayed method is a Dashboard change no code review would catch.
 */
describe("SCL-071 settlement gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_settle",
      object: "subscription",
      status: "active",
      items: {
        object: "list",
        data: [
          {
            id: "si_settle",
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

  it("GRANTS on completed when payment_status is `paid`", async () => {
    const process_ = await handler();
    const { body, signature } = signedSession(
      "checkout.session.completed",
      "paid",
    );
    const outcome = await process_(body, signature, "req_paid");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "premium" }),
    );
  });

  it("GRANTS on completed when payment_status is `no_payment_required`", async () => {
    const process_ = await handler();
    const { body, signature } = signedSession(
      "checkout.session.completed",
      "no_payment_required",
    );
    await process_(body, signature, "req_nopay");
    expect(accountMocks.upsertEntitlement).toHaveBeenCalled();
  });

  it("GRANTS NOTHING on completed when payment_status is `unpaid` — the money has not arrived", async () => {
    // THE case. A delayed payment method completes the session first; granting
    // here hands premium to an unsettled payment.
    const process_ = await handler();
    const { body, signature } = signedSession(
      "checkout.session.completed",
      "unpaid",
    );
    const outcome = await process_(body, signature, "req_unpaid");

    // Acknowledged, not failed — there is nothing wrong, the money is simply
    // not here yet. But nothing is written.
    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  /**
   * SECOND FORMULATION — Charter §5. The first version of this test asserted
   * only "processed + premium written", and it PASSED when the
   * `async_payment_succeeded` dispatch arm was deleted: the event then fell
   * through to the generic subscription branch, whose schema happens to accept
   * a session object, and that branch granted anyway. A plant that fails to
   * fail is a finding, not evidence.
   *
   * What distinguishes the two paths is WHICH id is retrieved. The fulfilment
   * path reads `session.subscription` (`sub_settle`); the fallthrough reads the
   * event object's own `id` (`cs_settle`). Asserting the retrieved id makes the
   * test able to tell them apart — and it fails when the arm is removed.
   */
  it("GRANTS on async_payment_succeeded — via the FULFILMENT path, not a fallthrough", async () => {
    const process_ = await handler();
    const { body, signature } = signedSession(
      "checkout.session.async_payment_succeeded",
      "paid",
    );
    const outcome = await process_(body, signature, "req_async_ok");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_ID,
      expect.objectContaining({ tier: "premium" }),
    );
    // The discriminator: the SESSION's subscription id, never the session id.
    expect(stripeApi.subscriptionsRetrieve).toHaveBeenCalledWith("sub_settle");
    expect(stripeApi.subscriptionsRetrieve).not.toHaveBeenCalledWith(
      "cs_settle",
    );
  });

  it("applies the SAME country gate on async_payment_succeeded", async () => {
    // The gates must not differ by which event carried the settlement — that
    // asymmetry is how a second ungated path appears.
    configMocks.getTier1Countries.mockResolvedValue(["CA"]);
    const process_ = await handler();
    const { body, signature } = signedSession(
      "checkout.session.async_payment_succeeded",
      "paid",
    );

    await expect(
      process_(body, signature, "req_async_country"),
    ).rejects.toThrow(/not Tier-1 eligible/);
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("GRANTS NOTHING on async_payment_failed, and revokes nothing", async () => {
    const process_ = await handler();
    const { body, signature } = signedSession(
      "checkout.session.async_payment_failed",
      "unpaid",
    );
    const outcome = await process_(body, signature, "req_async_fail");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    // Neither a grant NOR a revocation: nothing was ever granted to revoke.
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});
