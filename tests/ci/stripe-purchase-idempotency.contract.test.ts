/**
 * Two rapid identical purchase attempts produce ONE subscription.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; Coding Standards §4.2 mutations are
 *        idempotent] | @implemented [2026-09-02]
 *
 * plain English: proves the deterministic idempotency key actually reaches
 * Stripe, and that it is composed so two legitimately different purchases never
 * collapse into one.
 *
 * WHAT THIS CLOSES THAT THE DURABLE GUARD CANNOT.
 * `evaluateSubjectPurchaseEligibility` refuses a student who already holds an
 * entitlement. Between `checkout.sessions.create` returning and
 * `checkout.session.completed` writing that row, `entitlement_active()` is
 * still false — so a double-submit passes the guard and, without a key,
 * creates a second Checkout Session and a second subscription. Self-pay has no
 * other cover in that window at all.
 *
 * EVERY CASE ASSERTS STATE, NOT A STATUS CODE. What matters is how many times
 * Stripe was asked to create something and with which key, so every assertion
 * is on `checkoutCreate.mock.calls` — a 200 that quietly created two sessions
 * would pass a response-code test and fail these.
 *
 * THE MOCK MODELS STRIPE'S ACTUAL BEHAVIOUR, not a convenient stand-in: a
 * repeated key returns the cached response, and a repeated key with different
 * params raises `idempotency_error`. A mock that ignored the key would make
 * every case below vacuous.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";

const STUDENT_A = "11111111-1111-4111-8111-111111111111";
const GUARDIAN = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

const authState = vi.hoisted(() => ({
  currentUser: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "student",
    email: "student@test.com",
  } as Record<string, unknown>,
}));

const accountMocks = vi.hoisted(() => ({
  getEntitlementForProfile: vi.fn(async () => null),
  getProfileStripeCustomerId: vi.fn(async () => "cus_test"),
  setProfileStripeCustomerId: vi.fn(async () => undefined),
  getAllGuardianStudentLinks: vi.fn(async () => []),
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
}));

const entitlementMocks = vi.hoisted(() => ({
  evaluateEntitlementActive: vi.fn(async () => ({
    ok: true as const,
    active: false,
  })),
  isEntitlementActiveForProfile: vi.fn(async () => false),
  canAccessFeature: vi.fn(async () => false),
}));

/**
 * A Stripe stand-in that HONOURS the idempotency key, because the property
 * under test is what the key does.
 */
const stripeState = vi.hoisted(() => ({
  /** key -> the params it was first used with, and the object returned. */
  seen: new Map<string, { params: string; result: { id: string } }>(),
  counter: 0,
}));

const stripeMocks = vi.hoisted(() => ({
  checkoutCreate: vi.fn(),
  subscriptionItemsCreate: vi.fn(),
  customersCreate: vi.fn(async () => ({ id: "cus_test" })),
  customersRetrieve: vi.fn(async () => ({
    id: "cus_test",
    address: { country: "US" },
  })),
  subscriptionsList: vi.fn(async () => ({ object: "list", data: [] })),
}));

vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ): void => next(),
  generateToken: () => "test-csrf-token",
}));
vi.mock("../../server/middleware/supabase-auth", () => ({
  requireSupabaseAuth: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ): void => {
    req.user = authState.currentUser;
    req.requestId ??= "req-idem";
    next();
  },
  sendUnauthenticated: (res: {
    status: (n: number) => { json: (b: unknown) => unknown };
  }) => res.status(401).json({ error: "Authentication required" }),
  requireRequestUser: (req: { user?: unknown }) => req.user,
  getSupabaseAdmin: vi.fn(() => ({})),
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    evaluateEntitlementActive: entitlementMocks.evaluateEntitlementActive,
    isEntitlementActiveForProfile:
      entitlementMocks.isEntitlementActiveForProfile,
    canAccessFeature: entitlementMocks.canAccessFeature,
  },
}));
vi.mock("../../server/lib/account", () => ({
  getEntitlementForProfile: accountMocks.getEntitlementForProfile,
  getProfileStripeCustomerId: accountMocks.getProfileStripeCustomerId,
  setProfileStripeCustomerId: accountMocks.setProfileStripeCustomerId,
  getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
  resolveLinkedPairPremiumAccessForGuardian:
    accountMocks.resolveLinkedPairPremiumAccessForGuardian,
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
    checkout: { sessions: { create: stripeMocks.checkoutCreate } },
    prices: { retrieve: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
  }),
  getStripePublishableKey: () => "pk_test_123",
  getPriceId: (p: string) => `price_${p}`,
  getConfiguredPriceId: (p: string) => `price_${p}`,
}));

/** Stripe's real semantics: same key + same params -> cached; same key + different params -> error. */
function idempotentCreate(prefix: string) {
  return async (
    params: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ) => {
    const key = options?.idempotencyKey;
    if (!key) {
      stripeState.counter += 1;
      return { id: `${prefix}_nokey_${stripeState.counter}` };
    }
    const fingerprint = JSON.stringify(params);
    const prior = stripeState.seen.get(key);
    if (prior) {
      if (prior.params !== fingerprint) {
        throw Object.assign(new Error("Keys for idempotent requests..."), {
          type: "idempotency_error",
        });
      }
      return prior.result;
    }
    stripeState.counter += 1;
    const result = { id: `${prefix}_${stripeState.counter}` };
    stripeState.seen.set(key, { params: fingerprint, result });
    return result;
  };
}

async function billingApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Record<string, unknown>, _res, next) => {
    req.requestId ??= "req-idem";
    next();
  });
  const billingRoutes = (await import("../../server/routes/billing-routes"))
    .default;
  app.use("/api/billing", billingRoutes);
  return app;
}

function keysUsed(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map(
    (c) => (c[1] as { idempotencyKey?: string })?.idempotencyKey ?? "<none>",
  );
}

describe("deterministic idempotency key on purchase creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeState.seen.clear();
    stripeState.counter = 0;
    authState.currentUser = {
      id: STUDENT_A,
      role: "student",
      email: "student@test.com",
    };
    accountMocks.getProfileStripeCustomerId.mockResolvedValue("cus_test");
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([]);
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({
      ok: true,
      active: false,
    });
    stripeMocks.checkoutCreate.mockImplementation(idempotentCreate("cs"));
    stripeMocks.subscriptionItemsCreate.mockImplementation(
      idempotentCreate("si"),
    );
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
    });
  });

  function asGuardian() {
    authState.currentUser = {
      id: GUARDIAN,
      role: "guardian",
      email: "guardian@test.com",
    };
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_A, status: "active" },
      { student_profile_id: STUDENT_B, status: "active" },
    ]);
  }

  /**
   * CASE 1 — the defect. Two identical requests, no webhook in between, so the
   * durable guard says "not entitled" both times. Plant: remove the
   * `idempotencyKey` option from the Checkout call and two sessions appear.
   */
  it("collapses two identical self-pay attempts into ONE session", async () => {
    const app = await billingApp();
    const first = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });
    const second = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The route was entered twice; Stripe created once.
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(2);
    expect(new Set(keysUsed(stripeMocks.checkoutCreate)).size).toBe(1);
    expect(stripeState.counter).toBe(1);
    expect(first.body.sessionId).toBe(second.body.sessionId);
  });

  /**
   * CASE 2 — the worst outcome available if the subject were dropped: one
   * session serving both children. Plant: remove `subjectProfileId` from
   * `checkoutIdempotencyKey` and child B is handed child A's session.
   */
  it("gives two children of one guardian two distinct keys and two sessions", async () => {
    asGuardian();
    const app = await billingApp();
    const a = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });
    const b = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const keys = keysUsed(stripeMocks.checkoutCreate);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toContain(STUDENT_A);
    expect(keys[1]).toContain(STUDENT_B);
    expect(a.body.sessionId).not.toBe(b.body.sessionId);
    expect(stripeState.counter).toBe(2);
  });

  /**
   * CASE 3 — same subject, different plan. Plant: drop `priceId` from the key
   * and the second request is handed the FIRST plan's session, silently
   * selling the wrong plan.
   */
  it("gives the same student on a different plan a distinct key and session", async () => {
    const app = await billingApp();
    const monthly = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });
    const yearly = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "yearly" });

    const keys = keysUsed(stripeMocks.checkoutCreate);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toContain("price_monthly");
    expect(keys[1]).toContain("price_yearly");
    expect(monthly.body.sessionId).not.toBe(yearly.body.sessionId);
    expect(stripeState.counter).toBe(2);
  });

  /**
   * CASE 4 — the key reused with DIFFERENT parameters. This is a designed path,
   * not an exception: the key deliberately omits the payer, so student S
   * self-paying and a guardian buying for S inside one window share a key with
   * differing `metadata`, `client_reference_id` and `success_url`. Stripe
   * answers `idempotency_error`; the route must surface it as a refusal and
   * must NOT retry without the key — that retry is the second subscription.
   */
  it("surfaces an idempotency conflict as a refusal and never creates twice", async () => {
    const app = await billingApp();
    // Student S buys for themselves.
    const selfPay = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });
    expect(selfPay.status).toBe(200);

    // A guardian buys for the SAME student in the same window: same key,
    // different params.
    asGuardian();
    const guardianBuy = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });

    expect(guardianBuy.status).toBe(409);
    expect(guardianBuy.body.error.code).toBe("PURCHASE_IN_FLIGHT");
    // Two attempts reached Stripe; exactly one object exists.
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(2);
    expect(stripeState.counter).toBe(1);
  });

  /**
   * The add-item path carries its own key, on the same rule. Two identical
   * add-item attempts must add ONE item.
   */
  it("collapses two identical add-item attempts into ONE subscription item", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [
        {
          id: "sub_existing",
          status: "active",
          items: { object: "list", data: [] },
        },
      ],
    });
    const app = await billingApp();

    const first = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });
    const second = await request(app)
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(stripeMocks.subscriptionItemsCreate).toHaveBeenCalledTimes(2);
    expect(new Set(keysUsed(stripeMocks.subscriptionItemsCreate)).size).toBe(1);
    expect(stripeState.counter).toBe(1);
    expect(first.body.subscriptionItemId).toBe(second.body.subscriptionItemId);
  });
});
