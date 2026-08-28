/**
 * §4.8 guardian-paid checkout — line items, and the N-row entitlement write.
 *
 * @spec [SCL-043 payer identity; SCL-045 one item per student; Charter §6]
 * @implemented [2026-08-27]
 *
 * plain English: proves a guardian paying for two students produces two line
 * items each naming its own student, and that the webhook then writes two
 * entitlement rows keyed to their own subscription items. Expected outcome: N
 * students in, N rows out, nobody else touched. Trade-off: the Stripe API and
 * the database are stubbed; the line-item builder is pure so it is tested
 * directly, and the write path runs through the REAL handler. Edge cases: a
 * guardian with no links, a duplicate link, and — the one that matters — items
 * arriving with NO metadata, which is what happens if Checkout does not
 * propagate `line_items[].metadata`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { buildGuardianLineItems } from "../../server/lib/stripe/guardian-checkout";

const WEBHOOK_SECRET = "whsec_test_secret_for_guardian_checkout";
const GUARDIAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STUDENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRICE = "price_guardian_test";

function link(studentProfileId: string, createdAt: string) {
  return {
    id: `dddddddd-dddd-4ddd-8ddd-${studentProfileId.slice(-12)}`,
    guardian_profile_id: GUARDIAN,
    student_profile_id: studentProfileId,
    status: "active" as const,
    initiated_by: "guardian" as const,
    initiated_at: createdAt,
    accepted_at: createdAt,
    accepted_by_profile_id: studentProfileId,
    revoked_at: null,
    revoked_by_profile_id: null,
    revocation_reason: null,
    created_at: createdAt,
  };
}

describe("buildGuardianLineItems (§4.8)", () => {
  it("produces one item per linked student, each naming its own student", () => {
    const plan = buildGuardianLineItems(
      [
        link(STUDENT_A, "2026-01-01T00:00:00Z"),
        link(STUDENT_B, "2026-02-01T00:00:00Z"),
      ],
      PRICE,
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lineItems).toEqual([
      {
        price: PRICE,
        quantity: 1,
        metadata: { student_profile_id: STUDENT_A },
      },
      {
        price: PRICE,
        quantity: 1,
        metadata: { student_profile_id: STUDENT_B },
      },
    ]);
  });

  it("refuses a guardian with no active links rather than charging for nothing", () => {
    const plan = buildGuardianLineItems([], PRICE);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("no active linked students");
  });

  it("collapses a duplicated student rather than creating two items for one person", () => {
    // Two items for one student would collide on entitlements_profile_id_unique
    // at write time — after the money moved.
    const plan = buildGuardianLineItems(
      [
        link(STUDENT_A, "2026-01-01T00:00:00Z"),
        link(STUDENT_A, "2026-03-01T00:00:00Z"),
      ],
      PRICE,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lineItems).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The webhook half: N items -> N entitlement rows.
// ---------------------------------------------------------------------------

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
  getEntitlementsBySubscriptionId: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(async () => []),
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
  const real = new StripeSdk("sk_test_guardian_checkout_placeholder");
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
  // The country gate now runs on checkout.session.completed. These suites are
  // about disputes/refunds/guardian writes, so the Tier-1 list is seeded
  // eligible here — the gate has its OWN suite
  // (tests/ci/stripe-country-gate.contract.test.ts) where denial is the subject.
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function item(id: string, studentProfileId: string | null) {
  return {
    id,
    object: "subscription_item",
    current_period_start: 1_756_000_000,
    current_period_end: 1_758_600_000,
    price: { id: PRICE },
    metadata: studentProfileId ? { student_profile_id: studentProfileId } : {},
  };
}

function signedSubscriptionEvent() {
  const event = {
    id: "evt_guardian_sub",
    object: "event",
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: "sub_guardian_1",
        object: "subscription",
        // SUBSCRIPTION metadata names the PAYER, not any one student (SCL-043).
        metadata: { payer_profile_id: GUARDIAN },
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

describe("a guardian subscription writes one entitlement row per student", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    // Charter §6 (Codex HIGH-3): the writer authorises every item subject
    // against the payer's ACTIVE links, read server-side. Both students are
    // linked here; the refusal case has its own test below.
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      link(STUDENT_A, "2026-01-01T00:00:00Z"),
      link(STUDENT_B, "2026-02-01T00:00:00Z"),
    ]);
  });

  it("writes TWO rows for two students, each keyed to its own item", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_guardian_1",
      object: "subscription",
      status: "active",
      // SCL-043 / Charter §6: the RETRIEVED subscription names the payer, and
      // the writer resolves that payer's active links server-side.
      metadata: { payer_profile_id: GUARDIAN },
      items: {
        object: "list",
        data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
      },
    });

    const process_ = await handler();
    const { body, signature } = signedSubscriptionEvent();
    const outcome = await process_(body, signature, "req_guardian");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(2);
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_A,
      expect.objectContaining({
        tier: "premium",
        stripe_subscription_item_id: "si_a",
      }),
    );
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_B,
      expect.objectContaining({
        tier: "premium",
        stripe_subscription_item_id: "si_b",
      }),
    );
  });

  /**
   * CHARTER §6 — Codex HIGH-3. The writer previously entitled whatever uuid an
   * item carried, without ever asking whether the payer was linked to that
   * student. `getAllGuardianStudentLinks` existed and was not called.
   *
   * ALL OR NOTHING: the authorised sibling must NOT be written either. Writing
   * the students who did resolve would grant paid access off a payload we have
   * just established we cannot trust.
   */
  it("REFUSES the whole event when an item names a student the payer is not linked to", async () => {
    const UNLINKED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_guardian_1",
      object: "subscription",
      status: "active",
      metadata: { payer_profile_id: GUARDIAN },
      items: {
        object: "list",
        data: [item("si_a", STUDENT_A), item("si_x", UNLINKED)],
      },
    });
    // The server-read link set does NOT contain UNLINKED.
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      link(STUDENT_A, "2026-01-01T00:00:00Z"),
    ]);

    const process_ = await handler();
    const { body, signature } = signedSubscriptionEvent();

    await expect(
      process_(body, signature, "req_guardian_unlinked"),
    ).rejects.toThrow(/not actively linked/);

    // Both halves: the refusal AND the absence of a partial write.
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("REFUSES when the subscription names no payer at all", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_guardian_1",
      object: "subscription",
      status: "active",
      // No payer_profile_id: nothing to resolve links against, so nothing can
      // be authorised. Refuse rather than fall back to trusting the metadata.
      items: {
        object: "list",
        data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
      },
    });

    const process_ = await handler();
    const { body, signature } = signedSubscriptionEvent();

    await expect(
      process_(body, signature, "req_guardian_nopayer"),
    ).rejects.toThrow(/carries no payer_profile_id/);
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  /**
   * REPLACES the hollow test Codex found (HIGH-7). The previous version
   * supplied bare items AND payer-only subscription metadata, so it never
   * reached the N-row branch at all — it passed through the single-subject
   * failure path, and deleting the writer's zero-write guard left it GREEN
   * while it was cited as the reason guardian work could ship ahead of the
   * metadata probe.
   *
   * This drives the ACTUAL seam: the subscription IS guardian-paid (so the
   * dispatcher takes the item path) and the items are bare (so the writer's own
   * guard is what must refuse). Proven by deleting that guard and observing the
   * failure.
   */
  it("grants NOTHING when items carry no student metadata — the unverified-propagation case", async () => {
    // If Checkout does not propagate `line_items[].metadata` onto the
    // SubscriptionItem — the one mechanism §4.8's plan could not verify without
    // a Stripe key — items arrive bare. The requirement is that this grants
    // nothing rather than granting the WRONG student.
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_guardian_1",
      object: "subscription",
      status: "active",
      // Guardian-paid, so the dispatcher takes the ITEM path even though no
      // item names a student — which is what puts the writer's zero-candidate
      // guard on the execution path instead of the single-subject resolver.
      metadata: { payer_profile_id: GUARDIAN },
      items: {
        object: "list",
        data: [item("si_a", null), item("si_b", null)],
      },
    });

    const process_ = await handler();
    const { body, signature } = signedSubscriptionEvent();

    // The writer's own guard is what refuses here — named in the assertion so
    // this cannot silently start passing through some other failure path.
    await expect(
      process_(body, signature, "req_guardian_bare"),
    ).rejects.toThrow(/none carries student_profile_id/);
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("a PAUSED guardian subscription writes every student to free", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_guardian_1",
      object: "subscription",
      status: "active",
      // SCL-043 / Charter §6: the RETRIEVED subscription names the payer, and
      // the writer resolves that payer's active links server-side.
      metadata: { payer_profile_id: GUARDIAN }, // Stripe still says active while collection is paused
      pause_collection: { behavior: "keep_as_draft", resumes_at: null },
      items: {
        object: "list",
        data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
      },
    });

    const process_ = await handler();
    const { body, signature } = signedSubscriptionEvent();
    await process_(body, signature, "req_guardian_paused");

    // The fan-out consequence, made visible: one chargeback on the guardian's
    // invoice suspends every student on it. Argued in the 4.8 plan §7a.
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(2);
    for (const student of [STUDENT_A, STUDENT_B]) {
      expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
        student,
        expect.objectContaining({ tier: "free" }),
      );
    }
  });
});
