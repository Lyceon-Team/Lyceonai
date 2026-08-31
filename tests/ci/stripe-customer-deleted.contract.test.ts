/**
 * A deleted Stripe Customer revokes the entitlement it funded.
 *
 * @spec [SCL-070 amendment; Doc-01_V8 §20–§24 | OWNER RULING 2026-08-31]
 * @implemented [2026-08-31]
 *
 * plain English: `customer.deleted` was subscribed and IGNORED, with a comment
 * that already recorded revoking as the intent and the ruling as open. The
 * matrix could not see it, because completeness only walked HANDLED events — so
 * an event that should change entitlement and did not was invisible by
 * construction. The owner ruled on 2026-08-31: the Customer IS the billing
 * relationship, and without it there is no subscription, no payment method and
 * no way to bill or cancel, so leaving entitlement active grants free premium
 * with no recourse.
 *
 * BOTH HALVES ARE ASSERTED throughout. A revocation that logged loudly and left
 * the row premium would be the same free-access defect with better telemetry, so
 * every case asserts what `upsertEntitlement` was called with — or that it was
 * not called at all.
 *
 * The guardian fan-out is the case that matters: the guardian holds the
 * Customer but owns no entitlement row, so a handler that only looked at the
 * payer's own row would revoke nobody and leave every funded student entitled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_customer_deleted";
const GUARDIAN_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_A = "22222222-2222-4222-8222-222222222222";
const STUDENT_B = "33333333-3333-4333-8333-333333333333";
const STUDENT_SELFPAY = "44444444-4444-4444-8444-444444444444";

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
  getEntitlementForProfile: vi.fn(async () => null),
  getProfileIdByStripeCustomerId: vi.fn(async () => null),
  getProfileStripeCustomerId: vi.fn(async () => null),
}));
const configMocks = vi.hoisted(() => ({ getTier1Countries: vi.fn() }));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsList: vi.fn(),
  customersRetrieve: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_customer_deleted_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        list: stripeApi.subscriptionsList,
        update: stripeApi.subscriptionsUpdate,
      },
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
  getEntitlementForProfile: accountMocks.getEntitlementForProfile,
  getProfileIdByStripeCustomerId: accountMocks.getProfileIdByStripeCustomerId,
  getProfileStripeCustomerId: accountMocks.getProfileStripeCustomerId,
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: configMocks.getTier1Countries,
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function signedCustomerDeleted(customerId: string) {
  const event = {
    id: `evt_customer_deleted_${customerId}`,
    object: "event",
    type: "customer.deleted",
    livemode: false,
    data: { object: { id: customerId, object: "customer" } },
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

function revokedProfileIds(): string[] {
  return accountMocks.upsertEntitlement.mock.calls.map(
    (c) => (c as unknown as [string, unknown])[0],
  );
}

describe("customer.deleted revokes the entitlement the Customer funded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    accountMocks.getProfileIdByStripeCustomerId.mockResolvedValue(null);
    accountMocks.getEntitlementForProfile.mockResolvedValue(null);
    accountMocks.getProfileStripeCustomerId.mockResolvedValue(null);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([]);
    accountMocks.getEntitlementsBySubscriptionId.mockResolvedValue([]);
  });

  /**
   * THE CASE THAT MATTERS. The guardian holds the Customer and owns no
   * entitlement row; the students hold the rows. Revoking only the payer's own
   * row would leave every funded student entitled — free premium with the
   * billing relationship already gone.
   */
  it("revokes every student a guardian-paid subscription funded", async () => {
    accountMocks.getProfileIdByStripeCustomerId.mockResolvedValue(GUARDIAN_ID);
    accountMocks.getEntitlementForProfile.mockImplementation(
      async (profileId: string) =>
        profileId === GUARDIAN_ID
          ? null
          : ({ stripe_subscription_id: "sub_guardian" } as never),
    );
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_A },
      { student_profile_id: STUDENT_B },
    ] as never);
    accountMocks.getEntitlementsBySubscriptionId.mockResolvedValue([
      { profile_id: STUDENT_A },
      { profile_id: STUDENT_B },
    ] as never);

    const { body, signature } = signedCustomerDeleted("cus_guardian");
    await (await handler())(body, signature);

    expect(revokedProfileIds().sort()).toEqual([STUDENT_A, STUDENT_B].sort());
    for (const call of accountMocks.upsertEntitlement.mock.calls) {
      expect((call as unknown as [string, { tier: string; status: string }])[1])
        .toMatchObject({ tier: "free", status: "canceled" });
    }
    // The guardian owns no entitlement row, so nothing is written for them.
    expect(revokedProfileIds()).not.toContain(GUARDIAN_ID);
  });

  /**
   * A linked student who holds their OWN Customer is a payer in their own
   * right — `profiles.stripe_customer_id` is UNIQUE, so that Customer is not
   * this one. Revoking them would cancel access somebody else is still paying
   * for, which is a different defect in the opposite direction.
   */
  it("does not revoke a linked student who pays for themselves", async () => {
    accountMocks.getProfileIdByStripeCustomerId.mockResolvedValue(GUARDIAN_ID);
    accountMocks.getEntitlementForProfile.mockImplementation(
      async (profileId: string) => {
        if (profileId === GUARDIAN_ID) return null;
        if (profileId === STUDENT_SELFPAY)
          return { stripe_subscription_id: "sub_selfpay" } as never;
        return { stripe_subscription_id: "sub_guardian" } as never;
      },
    );
    accountMocks.getProfileStripeCustomerId.mockImplementation(
      async (profileId: string) =>
        profileId === STUDENT_SELFPAY ? ("cus_selfpay" as never) : null,
    );
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_A },
      { student_profile_id: STUDENT_SELFPAY },
    ] as never);
    accountMocks.getEntitlementsBySubscriptionId.mockImplementation(
      async (subscriptionId: string) =>
        subscriptionId === "sub_guardian"
          ? ([{ profile_id: STUDENT_A }] as never)
          : ([{ profile_id: STUDENT_SELFPAY }] as never),
    );

    const { body, signature } = signedCustomerDeleted("cus_guardian");
    await (await handler())(body, signature);

    expect(revokedProfileIds()).toEqual([STUDENT_A]);
    // The self-payer's subscription is never even fanned out.
    const fannedOut =
      accountMocks.getEntitlementsBySubscriptionId.mock.calls.map(
        (c) => (c as unknown as [string])[0],
      );
    expect(fannedOut).toEqual(["sub_guardian"]);
  });

  /**
   * Absence is a FACT, not an error. A Customer no profile holds funded nothing
   * of ours, so nothing changes — as opposed to ambiguity, which fails closed.
   */
  it("changes nothing when no profile holds the deleted Customer", async () => {
    accountMocks.getProfileIdByStripeCustomerId.mockResolvedValue(null);

    const { body, signature } = signedCustomerDeleted("cus_unknown");
    await (await handler())(body, signature);

    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    expect(accountMocks.getAllGuardianStudentLinks).not.toHaveBeenCalled();
  });

  /**
   * REVOCATION IS NOT COUNTRY-GATED, and this proves it rather than asserting
   * it: the Tier-1 list is empty and reading a Customer throws, so any country
   * gate on this path would deny or explode. The revoke still happens.
   */
  it("revokes without consulting the country gate", async () => {
    configMocks.getTier1Countries.mockResolvedValue([]);
    stripeApi.customersRetrieve.mockRejectedValue(
      new Error("customer is deleted; a country gate here could not survive"),
    );
    accountMocks.getProfileIdByStripeCustomerId.mockResolvedValue(GUARDIAN_ID);
    accountMocks.getEntitlementForProfile.mockResolvedValue({
      stripe_subscription_id: "sub_solo",
    } as never);
    accountMocks.getEntitlementsBySubscriptionId.mockResolvedValue([
      { profile_id: GUARDIAN_ID },
    ] as never);

    const { body, signature } = signedCustomerDeleted("cus_guardian");
    await (await handler())(body, signature);

    expect(revokedProfileIds()).toEqual([GUARDIAN_ID]);
    expect(stripeApi.customersRetrieve).not.toHaveBeenCalled();
    expect(configMocks.getTier1Countries).not.toHaveBeenCalled();
  });
});
