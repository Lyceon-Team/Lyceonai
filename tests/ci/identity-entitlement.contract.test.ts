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
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type Stripe from "stripe";
import type { SupabaseUser } from "../../server/middleware/supabase-auth";
import request from "supertest";

const authState = vi.hoisted(() => ({
  currentUser: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "student",
    email: "student@test.com",
    isGuardian: false,
    isAdmin: false,
  } as SupabaseUser | null,
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
  portalCreate: vi.fn(
    async (_args: { customer: string; return_url: string }) => ({
      url: "https://portal.test",
    }),
  ),
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
  doubleCsrfProtection: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../server/middleware/supabase-auth", () => ({
  // G2-04: the under-13 link gate on checkout/portal has its own real-PG suite
  // (tests/ci/under-13-link-gate.pg.ci.test.ts); here it passes, like auth above it.
  requireGuardianLinkForUnder13: (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ) => next(),
  // UI-58: `PATCH /api/profile/name` mounts the student-account gate; its denials are proven in
  // tests/ci/profile-name.pg.ci.test.ts. This suite never calls that route.
  requireStudentAccount: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  requireSupabaseAuth: (req: Request, res: Response, next: NextFunction) => {
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
  requireRequestUser: (req: Request, res: Response) => {
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
  // G4-10: the route's G2-02 refusal for an unrecognised role. The status is not what the
  // portal tests assert — they assert that no session is opened.
  sendRoleUnrecognized: (res: express.Response, requestId?: string) =>
    res.status(403).json({
      error: "Account unavailable",
      code: "ROLE_UNRECOGNIZED",
      requestId,
    }),
  sendUnauthenticated: (res: Response, requestId?: string) =>
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
  // W3-3: the grant path now records the billing country on the profile.
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
    prices: { retrieve: stripeMocks.pricesRetrieve },
    checkout: { sessions: { create: stripeMocks.checkoutCreate } },
    billingPortal: {
      sessions: { create: stripeMocks.portalCreate },
    },
  }),
  getStripePublishableKey: () => "pk_test_123",
  getPriceId: (p: string) => `price_${p}`,
  getConfiguredPriceId: (p: string) => `price_${p}`,
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
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
    } as SupabaseUser;
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
    app.use("/api/profile", requireSupabaseAuth, profileRoutes);

    // The authenticated user is a student; attempt to self-escalate to admin.
    const res = await request(app)
      .patch("/api/profile")
      .send({ role: "admin" });

    // G1-02: admin is never self-assignable. The refusal is coded so the client can show the
    // server's own message (AS-3), and still points at support.
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: "ROLE_NOT_SELF_ASSIGNABLE",
        message: "You can sign up as a student or a guardian.",
      },
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
    } as SupabaseUser;
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      hasPremiumAccess: true,
      hasActiveLink: true,
      studentEntitlementStatus: "active",
      // Both facts, because the route now reaches `resolveEntitlementDisplay`
      // with the SAME two inputs the self-pay branch uses (owner ruling
      // 2026-09-03). A fixture carrying only the status would be asserting
      // against a shape the real fold no longer returns.
      studentEntitlementTier: "premium",
      studentStandingGood: true,
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
    } as SupabaseUser;
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      hasPremiumAccess: false,
      hasActiveLink: true,
      studentEntitlementStatus: "canceled",
      studentEntitlementTier: "premium",
      studentStandingGood: false,
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
    } as SupabaseUser;
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
      has_more: false,
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
      has_more: false,
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

  /**
   * CLAIM 1 (owner ruling 2026-09-29). A guardian who ALREADY has a subscription
   * and buys for a new student gets a CHECKOUT SESSION, not a subscription item.
   *
   * This is the defect the ruling closes. The old branch called
   * `subscriptionItems.create` on the existing subscription, which with Stripe's
   * `create_prorations` default put the amount on the NEXT invoice — entitlement
   * now, money up to three months later, no price shown, no receipt, and no
   * Billing Terms consent, since `consent_collection.terms_of_service` exists
   * only on a Checkout Session.
   */
  it("SECOND student: creates a CHECKOUT SESSION, not a subscription item", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_guardian_existing",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
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
    expect(res.body).toMatchObject({ kind: "checkout_session" });
    expect(res.body.url).toBeTruthy();

    // The mechanic, asserted precisely: a Checkout Session for the SELECTED
    // student, on the existing Customer, and its own subscription metadata.
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);
    const params = stripeMocks.checkoutCreate.mock.calls[0][0];
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBeTruthy();
    expect(params.line_items[0].metadata).toEqual({
      student_profile_id: STUDENT_B,
    });
    // Load-bearing, not bookkeeping: this is what the next purchase's
    // already-funded check reads.
    expect(params.subscription_data.metadata).toMatchObject({
      student_profile_id: STUDENT_B,
      payer_relationship: "guardian",
    });
  });

  /**
   * CLAIM 6, the capture half. A REPEAT guardian purchase now collects Billing
   * Terms consent, because it is a Checkout Session like any other.
   *
   * This is the §17602 hole the add-item path left: it authorised a recurring
   * charge and captured no affirmative consent, because
   * `consent_collection.terms_of_service` exists only on a Checkout Session.
   * That the ticked box then becomes a `billing-terms` acceptance row with slug,
   * version and hash is owned by
   * `tests/ci/legal-consent-capture.contract.test.ts` (C4); what could not be
   * asserted before is that a guardian's SECOND purchase reaches that path at
   * all.
   */
  it("collects Billing Terms consent on a REPEAT guardian purchase", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_guardian_existing",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
          items: { object: "list", data: [] },
        },
      ],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    const params = stripeMocks.checkoutCreate.mock.calls[0][0];
    expect(params.consent_collection).toEqual({
      terms_of_service: "required",
    });
  });

  /**
   * CLAIM 3, the Stripe half. Two students produce two DISTINCT subscriptions,
   * so the existing one is never extended and never reused.
   *
   * The distinct `stripe_subscription_id` values land through the webhook, which
   * this route test cannot observe. What it can prove is the input to that: the
   * route asks Stripe for a new subscription rather than naming the existing
   * one anywhere in the call.
   */
  it("never names the guardian's existing subscription when buying for a new student", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_guardian_existing",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
          items: { object: "list", data: [] },
        },
      ],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    const serialised = JSON.stringify(
      stripeMocks.checkoutCreate.mock.calls[0][0],
    );
    expect(serialised).not.toContain("sub_guardian_existing");
  });

  /**
   * THE PRE-WEBHOOK WINDOW, on the Stripe side. A subscription in Stripe already
   * names this student, but no entitlement row exists yet — so
   * `evaluateSubjectPurchaseEligibility` allows and only the subscription-level
   * check can refuse. Without it, this guardian would be sold a second
   * subscription for a student they are already paying for, and because
   * `upsertEntitlement` keys on `profile_id` the first would be left billing
   * unreferenced (student `3f18cbe2`, `sub_1U4bqZ…` and `sub_1U8pin…`).
   */
  it("refuses when an existing SUBSCRIPTION already funds the student, before the webhook has landed", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_already_funds_b",
          status: "active",
          metadata: { student_profile_id: STUDENT_B },
          items: { object: "list", data: [] },
        },
      ],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STUDENT_ALREADY_FUNDED");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  /**
   * AN INCOMPLETE SCAN REFUSES. `has_more` with the page cap exhausted means the
   * subscription that would have refused this purchase may be on a page never
   * read, and "not found in a prefix" is not "does not exist". Five pages are
   * returned, all full and all still claiming more.
   */
  it("refuses with 503 when the guardian's subscriptions cannot be read completely", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: true,
      data: [
        {
          id: "sub_page_filler",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
          items: { object: "list", data: [] },
        },
      ],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SUBSCRIPTION_SCAN_INCOMPLETE");
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    // Walked to the cap rather than giving up on page one.
    expect(stripeMocks.subscriptionsList).toHaveBeenCalledTimes(5);
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
  });

  /**
   * A GUARDIAN WITH AN EXISTING SUBSCRIPTION IS NOT BLOCKED. The entitlement
   * guard asks about the SELECTED STUDENT, so a guardian already paying for one
   * child can still buy for another — and gets a Checkout Session for it. A
   * guard that refused too broadly, or a subscription-level check that matched on
   * the payer rather than the student, would fail here rather than pass quietly.
   */
  it("lets a guardian with an existing subscription buy for a student who has none", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_existing",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
          items: { object: "list", data: [] },
        },
      ],
    });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("checkout_session");
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);
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

  it("refuses to bill twice for a student a subscription already funds", async () => {
    asGuardian();
    stripeMocks.customersRetrieve.mockResolvedValue({
      id: "cus_test",
      address: { country: "US" },
    });
    // The subject now lives on the SUBSCRIPTION, which is where
    // `subscription_data.metadata` puts it and where the check reads it.
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_guardian_existing",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
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
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("REFUSES a purchase from a KNOWN ineligible country", async () => {
    // `blocksCheckout` semantics: unknown proceeds, a positive ineligible does not.
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      data: [],
      has_more: false,
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

  /**
   * ONE VERDICT NOW, AND IT IS `blocksCheckout` — asserted where the asymmetry
   * used to be.
   *
   * Two tests used to sit here pinning the old split: an UNKNOWN country
   * REFUSED the add-item path (`deniesEntitlement`, because that path granted
   * entitlement with no later Checkout gate) while proceeding on a first
   * purchase (`blocksCheckout`, because the billing address does not exist until
   * Checkout collects it). With one write path there is one verdict, so an
   * unknown country PROCEEDS for a repeat purchase too — and this asserts that
   * directly, because it is the behaviour change the ruling accepted rather than
   * an incidental consequence.
   *
   * Nothing is ungated: `checkout.session.completed` applies
   * `deniesEntitlement` to the address Checkout collected, and
   * `remediateCountryDenial` cancels and refunds on denial. The refusal moved;
   * it did not disappear. That settlement half is proved in
   * `tests/ci/stripe-lifecycle-gate.contract.test.ts`, not here — this test
   * owns the session-creation half only.
   */
  it("PROCEEDS on an UNKNOWN country for a guardian who already has a subscription", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_guardian_existing",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
          items: {
            data: [{ id: "si_a", metadata: { student_profile_id: STUDENT_A } }],
          },
        },
      ],
    });
    // No address: the `unknown` verdict.
    stripeMocks.customersRetrieve.mockResolvedValue({ id: "cus_test" });

    const res = await request(await billingApp())
      .post("/api/billing/checkout")
      .send({ plan: "monthly", student_profile_id: STUDENT_B });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("checkout_session");
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);
  });

  it("REFUSES a repeat purchase from a KNOWN ineligible payer country (INV-03-08)", async () => {
    asGuardian();
    stripeMocks.subscriptionsList.mockResolvedValue({
      object: "list",
      has_more: false,
      data: [
        {
          id: "sub_guardian_existing",
          status: "active",
          metadata: { student_profile_id: STUDENT_A },
          items: { object: "list", data: [] },
        },
      ],
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
    } as SupabaseUser;
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

    const args = stripeMocks.checkoutCreate.mock
      .calls[0][0] as Stripe.Checkout.SessionCreateParams;
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

  /**
   * `effectiveAccess` is the CONJUNCTION of two independent facts, and this
   * table is the proof that neither one alone decides it.
   *
   * @spec [SCL-029 the platform predicate; Doc 01 V8 §31.2 the product check;
   *        owner ruling 2026-09-03 "one resolver, both branches"]
   *
   * The version this replaces enumerated statuses and asserted the route's own
   * TS `Set(["active","past_due","trialing"])` mirror of `entitlement_active()`.
   * That mirror is deleted: the standing-good half now comes from the SQL
   * predicate through `EntitlementService`, so mocking the predicate is what
   * proves the route CONSULTS it instead of re-deriving it. `tier` is varied
   * independently because a row that is billing-healthy on the FREE tier grants
   * nothing, and the previous table — every case pinned to `tier: "premium"` —
   * could not have caught a route that ignored tier. The guardian branch did
   * exactly that.
   */
  it.each([
    ["active", true, "premium", true],
    ["past_due", true, "premium", true],
    ["trialing", true, "premium", true],
    ["canceled", false, "premium", false],
    ["unpaid", false, "premium", false],
    // Standing good, wrong product: access is refused, and only the tier half
    // can refuse it.
    ["active", true, "free", false],
  ])(
    "effectiveAccess is predicate(%s)=%s AND tier=%s -> %s",
    async (status, standingGood, tier, expected) => {
      accountMocks.getEntitlementForProfile.mockResolvedValueOnce({
        tier,
        status,
        current_period_end: null,
        stripe_subscription_id: "sub_1",
      });
      entitlementMocks.evaluateEntitlementActive.mockResolvedValueOnce({
        ok: true,
        active: standingGood,
      });

      const res = await request(await billingApp()).get("/api/billing/status");

      expect(res.status).toBe(200);
      expect(res.body.effectiveAccess).toBe(expected);
    },
  );

  /**
   * The ONE ANSWER rule, asserted as one answer.
   *
   * A guardian's derived verdict and the student's own verdict are produced by
   * the same function from the same two facts, so for identical inputs the two
   * branches of this one route must return identical `effectiveAccess`. Before
   * 2026-09-03 they could not: the self-pay branch applied `tier`, the guardian
   * branch applied none, so `tier: "free"` + standing good answered `false` for
   * a student and `true` for their guardian.
   */
  it("answers identically for a student and for their guardian on one row", async () => {
    const row = {
      tier: "free" as const,
      status: "active" as const,
      current_period_end: null,
      stripe_subscription_id: "sub_1",
    };

    accountMocks.getEntitlementForProfile.mockResolvedValueOnce(row);
    entitlementMocks.evaluateEntitlementActive.mockResolvedValueOnce({
      ok: true,
      active: true,
    });
    const studentRes = await request(await billingApp()).get(
      "/api/billing/status",
    );

    authState.currentUser = {
      id: "22222222-2222-4222-8222-222222222222",
      role: "guardian",
      email: "guardian@test.com",
      isGuardian: true,
      isAdmin: false,
    } as SupabaseUser;
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      hasPremiumAccess: false,
      hasActiveLink: true,
      studentEntitlementStatus: row.status,
      studentEntitlementTier: row.tier,
      studentStandingGood: true,
    });
    const guardianRes = await request(await billingApp()).get(
      "/api/billing/status",
    );

    expect(studentRes.status).toBe(200);
    expect(guardianRes.status).toBe(200);
    expect(studentRes.body.effectiveAccess).toBe(false);
    expect(guardianRes.body.effectiveAccess).toBe(
      studentRes.body.effectiveAccess,
    );
  });

  /**
   * The fourth CTA state's two inputs, both of which had no writer before.
   *
   * @spec [owner ruling 2026-09-03 — "a lapsed subscriber with a Customer goes
   *        to the portal, not to checkout"]
   */
  it("reports lapsed and hasBillingAccount so the client can offer the portal", async () => {
    accountMocks.getEntitlementForProfile.mockResolvedValueOnce({
      tier: "premium",
      status: "canceled",
      current_period_end: null,
      stripe_subscription_id: "sub_1",
    });
    entitlementMocks.evaluateEntitlementActive.mockResolvedValueOnce({
      ok: true,
      active: false,
    });
    accountMocks.getProfileStripeCustomerId.mockResolvedValueOnce("cus_test");

    const res = await request(await billingApp()).get("/api/billing/status");

    expect(res.status).toBe(200);
    expect(res.body.effectiveAccess).toBe(false);
    expect(res.body.lapsed).toBe(true);
    expect(res.body.hasBillingAccount).toBe(true);
  });

  it("reports lapsed=false for a profile that has never subscribed", async () => {
    accountMocks.getEntitlementForProfile.mockResolvedValueOnce(null);
    entitlementMocks.evaluateEntitlementActive.mockResolvedValueOnce({
      ok: true,
      active: false,
    });

    const res = await request(await billingApp()).get("/api/billing/status");

    expect(res.status).toBe(200);
    // No row at all is "offer them a purchase", never "offer them the portal".
    expect(res.body.lapsed).toBe(false);
    expect(res.body.hasBillingAccount).toBe(false);
    expect(res.body.stripeStatus).toBe("missing");
  });

  /**
   * G4-09 (G-AUD-26): the billing-status round trip. The route's REAL output, from both
   * branches, parsed by the ONE shared schema every client reader now uses — in its
   * `.strict()` form, so a key the route writes that the schema does not name fails here
   * rather than being stripped silently on the client. Presence first: each branch's
   * distinguishing keys are asserted before the strict parse is trusted.
   */
  it("G4-09: both branches of GET /api/billing/status round-trip the shared schema, strictly", async () => {
    const { billingStatusResponseSchema } =
      await import("../../packages/shared/src/billing-schema");
    const strict = billingStatusResponseSchema.strict();

    accountMocks.getEntitlementForProfile.mockResolvedValueOnce({
      tier: "premium",
      status: "active",
      current_period_end: "2026-10-30T00:00:00.000Z",
      stripe_subscription_id: "sub_1",
    });
    entitlementMocks.evaluateEntitlementActive.mockResolvedValueOnce({
      ok: true,
      active: true,
    });
    accountMocks.getProfileStripeCustomerId.mockResolvedValueOnce("cus_test");
    const studentRes = await request(await billingApp()).get(
      "/api/billing/status",
    );

    authState.currentUser = {
      id: "22222222-2222-4222-8222-222222222222",
      role: "guardian",
      email: "guardian@test.com",
      isGuardian: true,
      isAdmin: false,
    };
    accountMocks.resolveLinkedPairPremiumAccessForGuardian.mockResolvedValue({
      hasPremiumAccess: false,
      hasActiveLink: true,
      studentEntitlementStatus: "canceled",
      studentEntitlementTier: "premium",
      studentStandingGood: false,
    });
    accountMocks.getProfileStripeCustomerId.mockResolvedValueOnce("cus_test");
    const guardianRes = await request(await billingApp()).get(
      "/api/billing/status",
    );

    expect(studentRes.status).toBe(200);
    expect(guardianRes.status).toBe(200);
    expect(studentRes.body.stripeSubscriptionId).toBe("sub_1");
    expect(studentRes.body).not.toHaveProperty("source");
    expect(guardianRes.body.source).toBe("guardian_linked_student");
    expect(guardianRes.body.hasActiveLink).toBe(true);

    const student = strict.safeParse(studentRes.body);
    const guardian = strict.safeParse(guardianRes.body);
    expect(student.success ? null : student.error.issues).toBeNull();
    expect(guardian.success ? null : guardian.error.issues).toBeNull();
    expect(guardian.success && guardian.data.lapsed).toBe(true);
    expect(student.success && student.data.effectiveAccess).toBe(true);
  });

  /**
   * G4-10 (owner ruling 2026-09-30, option (c)): the Linked students & billing page opens the
   * EXISTING portal session, unchanged — one Customer per payer, so one "Manage billing"
   * button covers every student the guardian pays for. This pins what the route still refuses
   * and that nothing the page could send widens what it opens: the session is always for the
   * CALLER's own Customer, never one named in the body.
   */
  describe("G4-10: POST /api/billing/portal still refuses everyone it refused", () => {
    const GUARDIAN = "22222222-2222-4222-8222-222222222222";
    const asRole = (role: string | undefined): void => {
      authState.currentUser = {
        id: GUARDIAN,
        role,
        email: "guardian@test.com",
        isGuardian: role === "guardian",
        isAdmin: role === "admin",
      };
    };

    it("refuses an admin, an unrecognised role and the unauthenticated, opening no session", async () => {
      stripeMocks.portalCreate.mockClear();
      accountMocks.getProfileStripeCustomerId.mockResolvedValue("cus_guardian");

      asRole("admin");
      const admin = await request(await billingApp()).post(
        "/api/billing/portal",
      );
      asRole("superuser");
      const unknownRole = await request(await billingApp()).post(
        "/api/billing/portal",
      );
      asRole(undefined);
      const noRole = await request(await billingApp()).post(
        "/api/billing/portal",
      );
      authState.currentUser = null;
      const anonymous = await request(await billingApp()).post(
        "/api/billing/portal",
      );

      expect(admin.status).toBe(403);
      expect(unknownRole.status).toBeGreaterThanOrEqual(400);
      expect(noRole.status).toBeGreaterThanOrEqual(400);
      expect(anonymous.status).toBe(401);
      expect(stripeMocks.portalCreate).not.toHaveBeenCalled();
    });

    it("opens the guardian's OWN Customer, whatever student the body names", async () => {
      stripeMocks.portalCreate.mockClear();
      accountMocks.getProfileStripeCustomerId.mockReset();
      accountMocks.getProfileStripeCustomerId.mockResolvedValue("cus_guardian");
      asRole("guardian");

      const res = await request(await billingApp())
        .post("/api/billing/portal")
        .send({
          studentId: "99999999-9999-4999-8999-999999999999",
          customer: "cus_someone_else",
        });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe("https://portal.test");
      expect(accountMocks.getProfileStripeCustomerId).toHaveBeenCalledWith(
        GUARDIAN,
      );
      expect(stripeMocks.portalCreate).toHaveBeenCalledTimes(1);
      const args = stripeMocks.portalCreate.mock.calls[0]?.[0];
      expect(args?.customer).toBe("cus_guardian");
      expect(args?.return_url).toMatch(/\/guardian$/);
    });

    it("answers 409 NO_STRIPE_CUSTOMER to a guardian who has never paid", async () => {
      stripeMocks.portalCreate.mockClear();
      accountMocks.getProfileStripeCustomerId.mockReset();
      accountMocks.getProfileStripeCustomerId.mockResolvedValue(null);
      asRole("guardian");

      const res = await request(await billingApp()).post("/api/billing/portal");

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NO_STRIPE_CUSTOMER");
      expect(stripeMocks.portalCreate).not.toHaveBeenCalled();
    });
  });

  it("reads plan pricing live from Stripe rather than from hardcoded amounts", async () => {
    stripeMocks.pricesRetrieve.mockResolvedValue({
      id: "price_monthly",
      unit_amount: 4242,
      currency: "USD",
      recurring: { interval: "month", interval_count: 1 },
    });

    const res = await request(await billingApp()).get("/api/billing/plans");

    expect(res.status).toBe(200);
    const monthly = res.body.plans.find(
      (p: Record<string, unknown>) => p.plan === "monthly",
    );
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
