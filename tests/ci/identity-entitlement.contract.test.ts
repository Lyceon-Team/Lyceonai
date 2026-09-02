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
  resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
}));

/**
 * The one definition of "entitled", mocked at the SERVICE so this suite can
 * drive the verdict. Default `{ok:true, active:false}` — nobody is entitled
 * unless a test says so, which keeps every purchase case here exercising the
 * real route rather than the new guard.
 */
const entitlementMocks = vi.hoisted(() => ({
  evaluateEntitlementActive: vi.fn(async () => ({
    ok: true as const,
    active: false,
  })),
  isEntitlementActiveForProfile: vi.fn(async () => false),
  canAccessFeature: vi.fn(async () => false),
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
  /**
   * DEFAULT: a Customer with NO address.
   *
   * @revised [2026-08-28 — Codex MEDIUM] This previously returned
   * `{address:{country:'US'}}` for every retrieve, including the freshly
   * created `cus_test` of a FIRST purchase. That made the first-purchase test
   * vacuous for the address-timing rule: it could not tell "unknown permitted
   * until Checkout collects an address" from "unknown denied", and so it hid a
   * production 403 that made a guardian's first purchase impossible.
   *
   * No address is the truthful default — a Customer created seconds ago has
   * none. Tests that exercise the ADD-ITEM path override it explicitly.
   */
  customersRetrieve: vi.fn(async () => ({ id: "cus_test" })),
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
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({
      ok: true,
      active: false,
    });
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

  /**
   * REPLACED 2026-08-28 (Codex MEDIUM). This asserted 503
   * GUARDIAN_BILLING_UNAVAILABLE, which was correct only while guardian billing
   * did not exist. With guardian checkout live it pinned a self-contradictory
   * surface: a guardian could POST /checkout and buy, then be told by /status
   * that billing was unavailable.
   */
  it("reports a guardian's DERIVED entitlement, not a row of their own (§31.1)", async () => {
    authState.currentUser = {
      id: "22222222-2222-4222-8222-222222222222",
      role: "guardian",
      email: "guardian@test.com",
      isGuardian: true,
      isAdmin: false,
    } as any;
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      hasPremiumAccess: true,
      hasActiveLink: true,
      studentEntitlementStatus: "active",
    });

    const res = await request(await billingApp()).get("/api/billing/status");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: "premium",
      effectiveAccess: true,
      // Named as derived: a guardian has no entitlement row of their own, and
      // an answer that merely happened to equal the student's would be right by
      // coincidence rather than by derivation.
      source: "guardian_linked_student",
    });
  });

  it("reports free for a guardian whose linked student is not premium", async () => {
    authState.currentUser = {
      id: "22222222-2222-4222-8222-222222222222",
      role: "guardian",
      email: "guardian@test.com",
      isGuardian: true,
      isAdmin: false,
    } as any;
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      hasPremiumAccess: false,
      hasActiveLink: true,
      studentEntitlementStatus: "canceled",
    });

    const res = await request(await billingApp()).get("/api/billing/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: "free", effectiveAccess: false });
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

  /**
   * The regression Codex HIGH-3 found, pinned. A brand-new guardian Customer
   * has NO address, so `unknown` must NOT refuse here: Checkout collects the
   * address, and `checkout.session.completed` gates before any entitlement is
   * written. The default `customersRetrieve` mock returns no address precisely
   * so this test exercises that case rather than a convenient US one.
   */
  it("FIRST purchase with an UNKNOWN country: creates a subscription with ONE item for the SELECTED student", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
    });
    stripeMocks.customersRetrieve.mockResolvedValue({ id: "cus_test" });

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

  /**
   * ONE FACT, ONE SOURCE — the money path this closes.
   *
   * @spec [INV-03-08; Charter §7] | @implemented [2026-09-02]
   *
   * Stripe collects the billing address per PAYMENT METHOD and does not write
   * it back to the Customer unless asked, so `Customer.address` was `null` on
   * every customer this account has. `assertCountryEligibleForGrant` reads
   * exactly that field, so from 2026-08-28 — when the Customer-level gate
   * landed — every grant denied with verdict `unknown` and held for an
   * operator. Guardian `c6d3fc60` paid $0.99 on 2026-09-02 and got nothing: the
   * session gate passed them on `customer_details.address.country = "US"` and
   * the grant gate refused them on `Customer.address = null`, seconds apart.
   *
   * `customer_update.address = "auto"` is what makes the two agree, and it can
   * only be pinned here — the effect itself happens inside Stripe.
   */
  /**
   * THE DOUBLE-PURCHASE GAP, CLOSED.
   *
   * @spec [Doc 01 V8 §20 "Who pays"; SCL-029] | @implemented [2026-09-02]
   *
   * The guardian route refused an already-covered student; the self-pay route
   * refused nothing. Student `3f18cbe2` bought on 2026-08-15 (`sub_1U4bqZ…`)
   * and again on 2026-08-26 (`sub_1U8pin…`); both are live, both bill yearly,
   * and only the second reaches the entitlement row because `upsertEntitlement`
   * keys on `profile_id` with `onConflict`. The first has billed unreferenced
   * ever since.
   *
   * THE ASSERTION THAT MATTERS IS THE SECOND ONE. Returning 409 while still
   * calling Stripe would be a weaker property — the point is that no second
   * subscription comes into existence, so the Checkout Session must never be
   * created. The Customer must not be created either: the guard runs before
   * `getStripeClient()` on this path.
   */
  it("refuses a self-pay student who already holds an active entitlement, creating NO Stripe object", async () => {
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({
      ok: true,
      active: true,
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STUDENT_ALREADY_FUNDED");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    expect(stripeMocks.customersCreate).not.toHaveBeenCalled();
  });

  /**
   * The guard asks about the SUBJECT, so a student with nothing proceeds
   * exactly as before. Without this the refusal could be unconditional and the
   * suite would still look green on the case above.
   */
  it("lets a self-pay student with no entitlement through to Checkout", async () => {
    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });

    expect(res.status).toBe(200);
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);
  });

  /**
   * SERVER-SIDE ONLY. The client may hide the button; that is UX, never the
   * control. This request carries no client state at all — it is the raw POST a
   * curl or a devtools replay would send — and it is refused on the server's own
   * read of the entitlement predicate.
   */
  it("refuses the raw request too, with no client involved", async () => {
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({
      ok: true,
      active: true,
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .set("Content-Type", "application/json")
      .send({ plan: "yearly" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STUDENT_ALREADY_FUNDED");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  /**
   * AN UNREADABLE ANSWER MUST NOT CHARGE. The access evaluator collapses an RPC
   * error into "not entitled", which here would mean "go ahead and bill them" —
   * a transient failure silently re-opening the gap. The purchase guard fails
   * the other way, which is why `evaluateEntitlementActive` exists alongside it.
   */
  it("refuses rather than charging when the entitlement read fails", async () => {
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({ ok: false });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ENTITLEMENT_UNREADABLE");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("tells Stripe to save the billing address onto the Customer, so the grant gate has something to read", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
    });
    stripeMocks.customersRetrieve.mockResolvedValue({ id: "cus_test" });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    const params = stripeMocks.checkoutCreate.mock.calls[0][0];
    expect(params.customer_update).toEqual({ address: "auto" });
    // The parameter is only accepted alongside an existing `customer`.
    expect(params.customer).toBeTruthy();
  });

  it("SECOND student: adds an ITEM to the existing subscription — not a second subscription", async () => {
    asGuardian();
    // The add-item path REQUIRES a known eligible country: it grants
    // entitlement with no later Checkout gate to catch an unknown one.
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
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

  /**
   * ONE RULE, BOTH ROUTES — the guardian half, asked about the SELECTED
   * STUDENT. A guardian may hold premium access derived from child A under
   * §31.3's fold; that must never stop them buying for child B. So the guard
   * reads the student's own entitlement, which is a per-profile question and
   * does not consult the fold.
   */
  it("refuses a guardian buying for a student who already holds an entitlement, creating NO Stripe object", async () => {
    asGuardian();
    entitlementMocks.evaluateEntitlementActive.mockResolvedValue({
      ok: true,
      active: true,
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STUDENT_ALREADY_FUNDED");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionItemsCreate).not.toHaveBeenCalled();
  });

  /**
   * THE ADD-ITEM PATH IS UNAFFECTED — confirmed, not assumed.
   *
   * That path exists to add a student who has NO entitlement, so the new guard
   * returns `ok` and the item is created exactly as before. This drives the
   * real add-item branch (an existing active subscription, an eligible payer
   * country) and asserts the item is still created, so a guard that refused too
   * broadly would fail here rather than passing quietly.
   */
  it("leaves the add-item path working for a student with no entitlement", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
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

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("item_added");
    expect(stripeMocks.subscriptionItemsCreate).toHaveBeenCalledTimes(1);
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
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
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

  it("REFUSES a first purchase from a KNOWN ineligible country", async () => {
    // `blocksCheckout` semantics: unknown proceeds, a positive ineligible does not.
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
    });
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
  });

  it("REFUSES the add-item path on an UNKNOWN country — no later gate would catch it", async () => {
    // The asymmetry that makes the two branches different verdicts, pinned.
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
    stripeMocks.customersRetrieve.mockResolvedValue({ id: "cus_test" });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COUNTRY_NOT_ELIGIBLE");
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
