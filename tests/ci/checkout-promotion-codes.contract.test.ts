/**
 * Checkout shows the promotion-code field — on both purchase paths, and without `discounts`.
 *
 * @spec [Doc-09_V1.0 §5.4 (promotional pricing is a first-class Stripe mechanism Lyceon may
 *        activate), §5.6 (a promotional tier needs no Doc 09 amendment to permit);
 *        SCL-072 (the refund comparison uses the CHARGED amount, never list price);
 *        owner brief 2026-10-01] | @implemented [2026-10-01]
 *
 * plain English: drives the REAL `/api/billing/checkout` route through the same supertest +
 * mocked-Stripe seam the idempotency suite uses, and asserts on the params actually handed to
 * `checkout.sessions.create`. Expected outcome: `allow_promotion_codes: true` on both the
 * self-pay and the guardian path, and `discounts` on neither.
 *
 * WHY THIS ASSERTS ON THE CALL AND NOT ON THE SOURCE TEXT. The obvious cheap test is
 * `expect(billingSource).toContain("allow_promotion_codes")`, and this repo has already been
 * bitten by that shape: an assertion a sibling can satisfy is not an assertion. Every one of the
 * forty-odd lines of annotation above the parameter contains the string, so a source grep would
 * stay green with the parameter itself deleted. The mock's recorded call arguments cannot.
 *
 * WHY THE TWO PATHS SHARE ONE TEST BODY, which the brief asked to be told either way. Both paths
 * build ONE `sessionParams` literal (`server/routes/billing-routes.ts:481`) and pass it to ONE
 * `checkout.sessions.create` (`:649`); they diverge only in `line_items`, the two `metadata` bags,
 * the success/cancel URL and `client_reference_id`. So the brief's first two cases collapse — but
 * NOT into one assertion. They collapse into one helper asserted twice, plus a third case that
 * pins the shared-call-site claim itself (`both paths reach the same create`), because that claim
 * is what makes "one edit" safe and it is the thing that would silently stop being true if
 * somebody split the paths later.
 *
 * THE `discounts` CASE IS LOAD-BEARING AND NOT DECORATIVE. Stripe rejects a session carrying both
 * `allow_promotion_codes` and `discounts`, and the pinned SDK does not encode that: both are
 * declared as independent optional fields (stripe@20.4.1,
 * `types/Checkout/SessionsResource.d.ts:20` and `:119`), so `tsc` would accept both and the
 * failure would arrive as a runtime rejection on a real purchase. This test is the only guard.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import type Stripe from "stripe";

const STUDENT_A = "11111111-1111-4111-8111-111111111111";
const GUARDIAN = "33333333-3333-4333-8333-333333333333";

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

const stripeMocks = vi.hoisted(() => ({
  checkoutCreate: vi.fn(async () => ({ id: "cs_test_1" })),
  promotionCodesList: vi.fn(
    async (): Promise<{ object: "list"; data: unknown[] }> => ({
      object: "list",
      data: [],
    }),
  ),
  customersCreate: vi.fn(async () => ({ id: "cus_test" })),
  customersRetrieve: vi.fn(async () => ({
    id: "cus_test",
    address: { country: "US" },
  })),
  subscriptionsList: vi.fn(async () => ({
    object: "list",
    data: [],
    has_more: false,
  })),
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
  requireGuardianLinkForUnder13: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => next(),
  requireSupabaseAuth: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ): void => {
    req.user = authState.currentUser;
    req.requestId ??= "req-promo";
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
  setProfileCountryCode: vi.fn(async () => undefined),
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
    checkout: { sessions: { create: stripeMocks.checkoutCreate } },
    promotionCodes: { list: stripeMocks.promotionCodesList },
    prices: { retrieve: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
  }),
  getStripePublishableKey: () => "pk_test_123",
  getPriceId: (p: string) => `price_${p}`,
  getConfiguredPriceId: (p: string) => `price_${p}`,
}));

async function billingApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Record<string, unknown>, _res, next) => {
    req.requestId ??= "req-promo";
    next();
  });
  const billingRoutes = (await import("../../server/routes/billing-routes"))
    .default;
  app.use("/api/billing", billingRoutes);
  return app;
}

/** The params the route actually handed Stripe, from the mock's own record. */
function createdParams(): Stripe.Checkout.SessionCreateParams {
  expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);
  const call = stripeMocks.checkoutCreate.mock.calls[0];
  return call?.[0] as unknown as Stripe.Checkout.SessionCreateParams;
}

describe("allow_promotion_codes at Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    stripeMocks.checkoutCreate.mockResolvedValue({ id: "cs_test_1" });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
      has_more: false,
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
    ]);
  }

  it("a student self-pay session enables the promotion-code field", async () => {
    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });
    expect(res.status).toBe(200);

    const params = createdParams();
    // PRESENCE FIRST, non-trivially: prove this really is the self-pay path before asserting
    // anything about it, or a route that 200ed down some other branch would satisfy the claim.
    expect(params.client_reference_id).toBe(STUDENT_A);
    expect(params.metadata?.payer_relationship).toBe("self");
    expect(params.allow_promotion_codes).toBe(true);
  });

  it("a guardian-paid session enables it too, from the same object", async () => {
    asGuardian();
    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });
    expect(res.status).toBe(200);

    const params = createdParams();
    // The guardian path, identified by what actually distinguishes it: the payer in metadata and
    // the DELIBERATELY unset `client_reference_id` (SCL-043).
    expect(params.metadata?.payer_relationship).toBe("guardian");
    expect(params.metadata?.payer_profile_id).toBe(GUARDIAN);
    expect(params.client_reference_id).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
  });

  it("neither path sets `discounts`, which Stripe rejects alongside it", async () => {
    // Self-pay.
    await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });
    const selfPay = createdParams();

    vi.clearAllMocks();
    stripeMocks.checkoutCreate.mockResolvedValue({ id: "cs_test_2" });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
      has_more: false,
    });
    accountMocks.getProfileStripeCustomerId.mockResolvedValue("cus_test");
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({
      ok: true,
      active: false,
    });
    asGuardian();
    await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });
    const guardian = createdParams();

    for (const params of [selfPay, guardian]) {
      // `in`, not a truthiness check: `discounts: []` is still a `discounts` key and Stripe
      // would still reject the pair. Absence is the property, not falsiness.
      expect("discounts" in params).toBe(false);
      // And the flag that makes the pair illegal is present, so this is not passing because
      // neither field is set.
      expect(params.allow_promotion_codes).toBe(true);
    }
  });

  it("no card is asked for when nothing is due, on both paths (owner ruling 2026-10-10)", async () => {
    // `if_required` makes Checkout skip the payment-method step when the total is 0 (a
    // FOUNDING50-style code on Monthly). Asserted on the params actually handed to Stripe.
    await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });
    const selfPay = createdParams();

    vi.clearAllMocks();
    stripeMocks.checkoutCreate.mockResolvedValue({ id: "cs_test_3" });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
      has_more: false,
    });
    accountMocks.getProfileStripeCustomerId.mockResolvedValue("cus_test");
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({
      ok: true,
      active: false,
    });
    asGuardian();
    await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_A });
    const guardian = createdParams();

    // Presence first: these are the two real paths, and both are subscription sessions (the
    // only mode Stripe accepts this parameter in).
    expect(selfPay.metadata?.payer_relationship).toBe("self");
    expect(guardian.metadata?.payer_relationship).toBe("guardian");
    for (const params of [selfPay, guardian]) {
      expect(params.mode).toBe("subscription");
      expect(params.payment_method_collection).toBe("if_required");
      // The promotion-code field is still shown: a $0 total only exists if a code can apply.
      expect(params.allow_promotion_codes).toBe(true);
    }
  });

  it("both paths reach ONE create call site, which is what makes it one parameter", async () => {
    // The claim the single edit rests on. If somebody later gives the guardian path its own
    // `checkout.sessions.create`, this reddens before the flag silently goes missing from it.
    const source = (await import("node:fs")).readFileSync(
      "server/routes/billing-routes.ts",
      "utf8",
    );
    const createCalls = source.match(/stripe\.checkout\.sessions\.create\(/g);
    expect(createCalls).toHaveLength(1);
    // One params object, built once, for both branches.
    const paramsLiterals = source.match(
      /const sessionParams: Stripe\.Checkout\.SessionCreateParams = \{/g,
    );
    expect(paramsLiterals).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// /upgrade?promo=<CODE> (owner brief 2026-10-10): look the code up by name, pre-apply it as
// `discounts`, fall back silently to the code field.
// ---------------------------------------------------------------------------------------------

const NOW_S = Math.floor(Date.now() / 1000);
function promotionCode(over: Record<string, unknown> = {}) {
  return {
    id: "promo_founding50",
    object: "promotion_code",
    code: "FOUNDING50",
    active: true,
    expires_at: null,
    max_redemptions: null,
    times_redeemed: 0,
    ...over,
  };
}

describe("a promo link pre-applies a usable code, and falls back to the code field otherwise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    stripeMocks.checkoutCreate.mockResolvedValue({ id: "cs_test_1" });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
      has_more: false,
    });
    stripeMocks.promotionCodesList.mockResolvedValue({
      object: "list",
      data: [],
    });
  });

  async function checkoutWith(body: Record<string, unknown>) {
    return request(await billingApp())
      .post("/api/billing/checkout")
      .send(body);
  }

  it("a valid code is looked up by name and applied as discounts, without the code field", async () => {
    stripeMocks.promotionCodesList.mockResolvedValue({
      object: "list",
      data: [promotionCode()],
    });
    const res = await checkoutWith({ plan: "monthly", promo: "FOUNDING50" });
    expect(res.status).toBe(200);

    expect(stripeMocks.promotionCodesList).toHaveBeenCalledWith({
      code: "FOUNDING50",
      active: true,
      limit: 1,
    });
    const params = createdParams();
    expect(params.client_reference_id).toBe(STUDENT_A);
    expect(params.discounts).toEqual([{ promotion_code: "promo_founding50" }]);
    // Stripe rejects the pair, so the field is OMITTED, not set false.
    expect("allow_promotion_codes" in params).toBe(false);
    // Still no card when nothing is due.
    expect(params.payment_method_collection).toBe("if_required");
  });

  it.each([
    ["unknown", []],
    ["expired", [promotionCode({ expires_at: NOW_S - 60 })]],
    ["used up", [promotionCode({ max_redemptions: 50, times_redeemed: 50 })]],
    ["inactive", [promotionCode({ active: false })]],
  ])(
    "an %s code falls back silently to the normal checkout with the code field",
    async (_label, data) => {
      stripeMocks.promotionCodesList.mockResolvedValue({
        object: "list",
        data,
      });
      const res = await checkoutWith({ plan: "monthly", promo: "FOUNDING50" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kind: "checkout_session" });
      const params = createdParams();
      expect(params.allow_promotion_codes).toBe(true);
      expect("discounts" in params).toBe(false);
    },
  );

  it("a failed lookup also falls back, rather than failing the purchase", async () => {
    stripeMocks.promotionCodesList.mockRejectedValue(new Error("stripe down"));
    const res = await checkoutWith({ plan: "monthly", promo: "FOUNDING50" });
    expect(res.status).toBe(200);
    expect(createdParams().allow_promotion_codes).toBe(true);
  });

  it("a code Stripe refuses at creation is retried once with the code field, under its own key", async () => {
    stripeMocks.promotionCodesList.mockResolvedValue({
      object: "list",
      data: [promotionCode()],
    });
    stripeMocks.checkoutCreate
      .mockRejectedValueOnce(
        Object.assign(new Error("This promotion code cannot be redeemed"), {
          type: "StripeInvalidRequestError",
          rawType: "invalid_request_error",
        }),
      )
      .mockResolvedValueOnce({ id: "cs_test_retry" });
    const res = await checkoutWith({ plan: "monthly", promo: "FOUNDING50" });
    expect(res.status).toBe(200);

    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(2);
    const calls = stripeMocks.checkoutCreate.mock.calls as unknown as [
      Stripe.Checkout.SessionCreateParams,
      { idempotencyKey: string },
    ][];
    const [first, second] = calls;
    expect(first?.[0].discounts).toEqual([
      { promotion_code: "promo_founding50" },
    ]);
    expect("discounts" in (second?.[0] ?? {})).toBe(false);
    expect(second?.[0].allow_promotion_codes).toBe(true);
    // Different requests, different keys: the retry is not read as "already in flight".
    expect(first?.[1].idempotencyKey).toMatch(/:promo_founding50$/);
    expect(second?.[1].idempotencyKey).not.toBe(first?.[1].idempotencyKey);
  });

  it("no promo means no lookup and the field exactly as before", async () => {
    const res = await checkoutWith({ plan: "monthly" });
    expect(res.status).toBe(200);
    expect(stripeMocks.promotionCodesList).not.toHaveBeenCalled();
    expect(createdParams().allow_promotion_codes).toBe(true);
  });

  it("a code that is not code-shaped is refused by the schema (the page never sends one)", async () => {
    const res = await checkoutWith({ plan: "monthly", promo: "50% OFF!" });
    expect(res.status).toBe(400);
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });
});
