/**
 * Identity + Entitlement runtime contract — rewritten 2026-08-20 for the Phase C
 * rebuild of the billing surface.
 *
 * @spec [Doc-01_V8 §20, §22; SCL-043 payer identity; Charter §6 safety invariants]
 *
 * What changed and why: four tests in the previous version asserted guardian-paid
 * checkout behaviour that Phase C deliberately removed. Guardian billing is
 * blocked on the guardian-link data-layer defect
 * (docs/plans/WS-GL_Guardian_Link_Data_Layer.md) and on SCL-045's item-level
 * entitlement key (DDL queued as D-1). A test that disagrees with the spec is
 * retired, not accommodated. The identity assertion is preserved unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const authState = vi.hoisted(() => ({
  currentUser: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "student",
    email: "student@test.com",
    isGuardian: false,
    isAdmin: false,
  } as any,
}));

const accountMocks = vi.hoisted(() => ({
  getEntitlementForProfile: vi.fn(),
  getProfileStripeCustomerId: vi.fn(),
  setProfileStripeCustomerId: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(async () => []),
}));

const stripeMocks = vi.hoisted(() => ({
  checkoutCreate: vi.fn(async () => ({
    id: "cs_test",
    url: "https://checkout.test/session",
  })),
  customersCreate: vi.fn(async () => ({ id: "cus_test" })),
  pricesRetrieve: vi.fn(async (id: string) => ({
    id,
    unit_amount: 9900,
    currency: "USD",
    recurring: { interval: "month", interval_count: 1 },
  })),
  customersRetrieve: vi.fn(async () => ({
    id: "cus_test",
    // INV-03-08: the payer's billing country, which the add-item path gates on
    // because it never produces a checkout.session.completed.
    address: { country: "US" },
  })),
  subscriptionsList: vi.fn(async () => ({ object: "list", data: [] })),
  subscriptionItemsCreate: vi.fn(async () => ({ id: "si_added" })),
}));

vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../server/middleware/supabase-auth", () => ({
  requireSupabaseAuth: (req: any, res: any, next: any) => {
    if (!authState.currentUser) {
      return res.status(401).json({
        error: "Authentication required",
        message: "You must be signed in to access this resource",
        requestId: req.requestId,
      });
    }
    req.user = authState.currentUser;
    req.requestId ??= "req-identity-entitlement";
    return next();
  },
  requireRequestUser: (req: any, res: any) => {
    if (!req.user?.id) {
      res.status(401).json({
        error: "Authentication required",
        message: "You must be signed in to access this resource",
        requestId: req.requestId,
      });
      return null;
    }
    return req.user;
  },
  getSupabaseAdmin: vi.fn(() => ({})),
  sendUnauthenticated: (res: any, requestId?: string) =>
    res.status(401).json({
      error: "Authentication required",
      message: "You must be signed in to access this resource",
      requestId,
    }),
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../server/lib/account", () => ({
  getEntitlementForProfile: accountMocks.getEntitlementForProfile,
  getProfileStripeCustomerId: accountMocks.getProfileStripeCustomerId,
  setProfileStripeCustomerId: accountMocks.setProfileStripeCustomerId,
  getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
}));

vi.mock("../../server/lib/stripe/client", () => ({
  BILLING_PERIODS: ["monthly", "quarterly", "yearly"],
  getStripeClient: () => ({
    customers: {
      create: stripeMocks.customersCreate,
      retrieve: stripeMocks.customersRetrieve,
    },
    subscriptions: { list: stripeMocks.subscriptionsList },
    subscriptionItems: { create: stripeMocks.subscriptionItemsCreate },
    prices: { retrieve: stripeMocks.pricesRetrieve },
    checkout: { sessions: { create: stripeMocks.checkoutCreate } },
    billingPortal: {
      sessions: { create: vi.fn(async () => ({ url: "https://portal.test" })) },
    },
  }),
  getStripePublishableKey: () => "pk_test_123",
  getPriceId: (p: string) => `price_${p}`,
  getConfiguredPriceId: (p: string) => `price_${p}`,
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.requestId ??= "req-identity-entitlement";
    next();
  });
  return app;
}

async function billingApp() {
  const app = buildApp();
  const billingRoutes = (await import("../../server/routes/billing-routes"))
    .default;
  app.use("/api/billing", billingRoutes);
  return app;
}

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

describe("Identity + Entitlement Runtime Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = {
      id: STUDENT_ID,
      role: "student",
      email: "student@test.com",
      isGuardian: false,
      isAdmin: false,
    } as any;
    accountMocks.getEntitlementForProfile.mockResolvedValue(null);
    accountMocks.getProfileStripeCustomerId.mockResolvedValue(null);
    accountMocks.setProfileStripeCustomerId.mockResolvedValue(undefined);
    stripeMocks.checkoutCreate.mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.test/session",
    });
    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_test" });
  });

  // --- identity (preserved from the previous version, unchanged) ---------------

  it("blocks direct role mutation through PATCH /api/profile and points to support", async () => {
    const app = buildApp();
    const profileRoutes = (await import("../../server/routes/profile-routes"))
      .default;
    const { requireSupabaseAuth } =
      await import("../../server/middleware/supabase-auth");
    app.use("/api/profile", requireSupabaseAuth as any, profileRoutes);

    // The authenticated user is a student; attempt to self-escalate to admin.
    const res = await request(app)
      .patch("/api/profile")
      .send({ role: "admin" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Role changes are support-mediated only",
      message: "Email support@lyceon.ai to request a role review.",
      supportEmail: "support@lyceon.ai",
    });
  });

  // --- guardian billing is explicitly unavailable, not silently wrong ----------

  it("returns an explicit unavailable response for guardian billing status", async () => {
    authState.currentUser = {
      id: "22222222-2222-4222-8222-222222222222",
      role: "guardian",
      email: "guardian@test.com",
      isGuardian: true,
      isAdmin: false,
    } as any;

    const res = await request(await billingApp()).get("/api/billing/status");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("GUARDIAN_BILLING_UNAVAILABLE");
  });

  /**
   * OWNER RULING 2026-08-28 — guardian purchase is PER STUDENT, selected by the
   * guardian. This replaces two earlier assertions, each of which encoded a
   * defect: first a 503 (the feature unbuilt), then one line item per ACTIVE
   * link (charging for children the guardian never chose).
   *
   * Doc 01 V8 supports per-student throughout: §20 and §31.4 say "linked
   * student" singular, and §36.4's unlink prompt — "You are still paying for
   * this student's subscription. Keep or cancel?" — is only answerable if the
   * money was per-student to begin with.
   */
  const GUARDIAN = "22222222-2222-4222-8222-222222222222";
  const STUDENT_A = "33333333-3333-4333-8333-333333333333";
  const STUDENT_B = "44444444-4444-4444-8444-444444444444";

  function asGuardian() {
    authState.currentUser = {
      id: GUARDIAN,
      role: "guardian",
      email: "guardian@test.com",
      isGuardian: true,
      isAdmin: false,
    } as any;
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_A, status: "active" },
      { student_profile_id: STUDENT_B, status: "active" },
    ]);
  }

  it("FIRST purchase: creates a subscription with ONE item for the SELECTED student", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("checkout_session");

    const params = stripeMocks.checkoutCreate.mock.calls[0][0];
    // ONE item, for the student the guardian chose — not one per link.
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].metadata).toEqual({
      student_profile_id: STUDENT_B,
    });
    // SCL-043: the subscription names the payer. It also names the single
    // student, which is the fallback that makes this path independent of the
    // unverified Checkout metadata propagation.
    expect(params.subscription_data.metadata).toMatchObject({
      payer_profile_id: GUARDIAN,
      student_profile_id: STUDENT_B,
      payer_relationship: "guardian",
    });
    expect(params.client_reference_id).toBeUndefined();
  });

  it("SECOND student: adds an ITEM to the existing subscription — not a second subscription", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [
        {
          id: "sub_guardian_existing",
          items: {
            data: [{ id: "si_a", metadata: { student_profile_id: STUDENT_A } }],
          },
        },
      ],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: "item_added",
      subscriptionItemId: "si_added",
    });

    // The mechanic, asserted precisely: an item on the EXISTING subscription,
    // and NO new Checkout Session.
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionItemsCreate).toHaveBeenCalledTimes(1);
    const params = stripeMocks.subscriptionItemsCreate.mock.calls[0][0];
    expect(params.subscription).toBe("sub_guardian_existing");
    expect(params.quantity).toBe(1);
    expect(params.metadata).toEqual({ student_profile_id: STUDENT_B });
    // proration_behavior is NOT set: Stripe's documented default is
    // `create_prorations`, which is the wanted behaviour. Setting it would be
    // overriding a native mechanism with the same value.
    expect(params.proration_behavior).toBeUndefined();
  });

  it("refuses a student the guardian is not linked to, and charges nothing", async () => {
    asGuardian();
    const STRANGER = "55555555-5555-4555-8555-555555555555";

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STRANGER });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STUDENT_NOT_LINKED");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionItemsCreate).not.toHaveBeenCalled();
  });

  it("refuses when the guardian selects nobody — never defaults to a link", async () => {
    asGuardian();

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("STUDENT_NOT_SELECTED");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("refuses to bill twice for a student the subscription already funds", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [
        {
          id: "sub_guardian_existing",
          items: {
            data: [{ id: "si_a", metadata: { student_profile_id: STUDENT_A } }],
          },
        },
      ],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STUDENT_ALREADY_FUNDED");
    expect(stripeMocks.subscriptionItemsCreate).not.toHaveBeenCalled();
  });

  it("denies the add-item path on an ineligible payer country (INV-03-08)", async () => {
    // The add-item path never produces a checkout.session.completed, so without
    // this gate a second child would be entitled with no country decision.
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "FR" },
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COUNTRY_NOT_ELIGIBLE");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionItemsCreate).not.toHaveBeenCalled();
  });

  it("rejects a STUDENT who tries to name another student as the subject", async () => {
    // Rejected, not ignored: a student who believes they bought for someone
    // else must be told they did not.
    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("STUDENT_CANNOT_SELECT_SUBJECT");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("refuses a guardian with no active links rather than charging for nothing", async () => {
    authState.currentUser = {
      id: "22222222-2222-4222-8222-222222222222",
      role: "guardian",
      email: "guardian@test.com",
      isGuardian: true,
      isAdmin: false,
    } as any;
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([]);

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_ACTIVE_LINKED_STUDENTS");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  // --- the subject comes from the session, never the body ----------------------

  it("binds the Checkout Session to the authenticated student, not to anything in the body", async () => {
    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });

    expect(res.status).toBe(200);
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);

    const args = stripeMocks.checkoutCreate.mock.calls[0][0] as any;
    expect(args.client_reference_id).toBe(STUDENT_ID);
    expect(args.metadata.student_profile_id).toBe(STUDENT_ID);
    expect(args.subscription_data.metadata.student_profile_id).toBe(STUDENT_ID);
    expect(args.mode).toBe("subscription");
  });

  it("rejects checkout bodies carrying client-controlled billing or identity fields", async () => {
    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({
        plan: "monthly",
        student_profile_id: "33333333-3333-4333-8333-333333333333",
        priceId: "price_attacker",
        tier: "premium",
      });

    expect(res.status).toBe(400);
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  // --- fail closed --------------------------------------------------------------

  it("fails closed when the entitlement read throws — never free-tier success, never paid", async () => {
    accountMocks.getEntitlementForProfile.mockRejectedValueOnce(
      new Error("db down"),
    );

    const res = await request(await billingApp()).get("/api/billing/status");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("BILLING_STATUS_UNAVAILABLE");
    expect(res.body.effectiveAccess).toBeUndefined();
    expect(res.body.isPaid).toBeUndefined();
  });

  // --- entitled set + live pricing ---------------------------------------------

  it.each([
    ["active", true],
    ["past_due", true],
    ["trialing", true],
    ["canceled", false],
    ["unpaid", false],
  ])(
    "reports effectiveAccess=%s for premium/%s per the canonical entitled set",
    async (status, expected) => {
      accountMocks.getEntitlementForProfile.mockResolvedValueOnce({
        tier: "premium",
        status,
        current_period_end: null,
        stripe_subscription_id: "sub_1",
      });

      const res = await request(await billingApp()).get("/api/billing/status");

      expect(res.status).toBe(200);
      expect(res.body.effectiveAccess).toBe(expected);
    },
  );

  it("reads plan pricing live from Stripe rather than from hardcoded amounts", async () => {
    stripeMocks.pricesRetrieve.mockResolvedValue({
      id: "price_monthly",
      unit_amount: 4242,
      currency: "USD",
      recurring: { interval: "month", interval_count: 1 },
    });

    const res = await request(await billingApp()).get("/api/billing/plans");

    expect(res.status).toBe(200);
    const monthly = res.body.plans.find((p: any) => p.plan === "monthly");
    expect(monthly.amountCents).toBe(4242);
    expect(monthly.currency).toBe("usd");
    expect(monthly.intervalLabel).toBe("per month");
  });
  // --- post-audit: payer identifiers are digested in logs (Charter §6) --------

  it("never passes a raw profile id or Checkout Session id to the logger", async () => {
    const { logger } = await import("../../server/logger");
    await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });

    const emitted = JSON.stringify(
      (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls,
    );
    // On the unaccompanied path the student IS the payer, so the profile id is
    // a payer identifier for a minors' product.
    expect(emitted).not.toContain(STUDENT_ID);
    expect(emitted).not.toContain("cs_test");
    expect(emitted).toContain("studentProfileRef");
  });
});
