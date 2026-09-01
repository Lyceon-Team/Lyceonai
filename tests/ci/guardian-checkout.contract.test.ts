/**
 * §4.8 guardian-paid purchase — PER STUDENT, and the item-level entitlement write.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4; §36.4; SCL-043 payer identity;
 *        SCL-045 one SubscriptionItem per student; Charter §6]
 * @implemented [2026-08-27] | @revised [2026-08-28 — owner ruling: per-student]
 *
 * plain English: proves a guardian buys for ONE selected student at a time, that
 * a student they are not linked to is refused, and that the webhook writes one
 * entitlement row per funded item. Expected outcome: the guardian is charged for
 * the child they chose and nobody else. Trade-off: the Stripe API and the
 * database are stubbed; the selection rule is pure so it is tested directly, and
 * the write path runs through the REAL handler.
 *
 * Edge cases that carry the ruling: NO student selected (must refuse rather than
 * default, even with exactly one link — that is how cover-all would creep back),
 * a student already funded, and items arriving with no metadata.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  resolveGuardianPurchaseSubject,
  subscriptionAlreadyFundsStudent,
} from "../../server/lib/stripe/guardian-checkout";

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

/**
 * OWNER RULING 2026-08-28 — guardian purchase is PER STUDENT, selected by the
 * guardian. These tests replace the cover-all-links suite: that behaviour
 * charged a guardian for every linked child the moment they pressed Subscribe,
 * was never ruled, and is now reversed.
 */
describe("resolveGuardianPurchaseSubject (§20, §31.4, §36.4)", () => {
  const links = [
    link(STUDENT_A, "2026-01-01T00:00:00Z"),
    link(STUDENT_B, "2026-02-01T00:00:00Z"),
  ];

  it("returns the selected student when the guardian is actively linked to them", () => {
    const subject = resolveGuardianPurchaseSubject(links, STUDENT_B);
    expect(subject.ok).toBe(true);
    if (!subject.ok) return;
    expect(subject.studentProfileId).toBe(STUDENT_B);
  });

  it("refuses a student the guardian is NOT linked to — the request selects, the server authorises", () => {
    const stranger = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const subject = resolveGuardianPurchaseSubject(links, stranger);
    expect(subject.ok).toBe(false);
    if (subject.ok) return;
    expect(subject.code).toBe("STUDENT_NOT_LINKED");
  });

  it("refuses when no student is selected, rather than defaulting to one", () => {
    // The load-bearing case. If this ever starts returning a student, the
    // cover-all default has been reintroduced by another name: a guardian would
    // be charged for a child they never chose.
    const subject = resolveGuardianPurchaseSubject(links, undefined);
    expect(subject.ok).toBe(false);
    if (subject.ok) return;
    expect(subject.code).toBe("STUDENT_NOT_SELECTED");
  });

  it("refuses to default even when the guardian has exactly ONE link", () => {
    const subject = resolveGuardianPurchaseSubject(
      [link(STUDENT_A, "2026-01-01T00:00:00Z")],
      undefined,
    );
    expect(subject.ok).toBe(false);
    if (subject.ok) return;
    expect(subject.code).toBe("STUDENT_NOT_SELECTED");
  });

  it("refuses a guardian with no active links rather than charging for nobody", () => {
    const subject = resolveGuardianPurchaseSubject([], STUDENT_A);
    expect(subject.ok).toBe(false);
    if (subject.ok) return;
    expect(subject.code).toBe("NO_ACTIVE_LINKED_STUDENTS");
  });
});

describe("subscriptionAlreadyFundsStudent", () => {
  it("detects a student already funded by an item, so nobody is billed twice", () => {
    const items = [
      { metadata: { student_profile_id: STUDENT_A } },
      { metadata: { student_profile_id: STUDENT_B } },
    ];
    expect(subscriptionAlreadyFundsStudent(items, STUDENT_A)).toBe(true);
    expect(
      subscriptionAlreadyFundsStudent(
        items,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ),
    ).toBe(false);
  });

  it("treats an item with no metadata as funding nobody", () => {
    expect(
      subscriptionAlreadyFundsStudent([{ metadata: null }], STUDENT_A),
    ).toBe(false);
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
  // INV-03-08 now gates EVERY grant, so the writer reads the payer\'s
  // Customer. Eligible by default here; denial has its own suites.
  customersRetrieve: vi.fn(async () => ({ id: "cus_test_1", address: { country: "US" } })),
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
      customer: "cus_test_1",
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
   * THE SEPARATION THE GUARDIAN PATH EXISTS FOR, PROVED SEQUENTIALLY.
   *
   * @spec [Doc 01 V8 §20 "Who pays"; §31.1 "Guardians do NOT have their own
   *        entitlement"; §31.4; §36.4; SCL-043 payer identity;
   *        SCL-045 one SubscriptionItem per student]
   *
   * The Stripe Customer is the GUARDIAN; the entitlement is the STUDENT's. The
   * existing sibling test writes both students in ONE event, which cannot
   * distinguish "each item wrote its own row" from "the last write won". This
   * one buys for A, then later adds B, and asserts A is still premium on A's own
   * item afterwards.
   *
   * Two distinct failures are in scope and both are caught here: keying the row
   * to the PAYER (the guardian would hold the entitlement and neither child
   * would), and letting the second purchase overwrite or drop the first.
   */
  it("keys entitlement to the STUDENT, not the paying guardian, and A survives B being added", async () => {
    const process_ = await handler();

    // ---- FIRST PURCHASE: only student A is funded ----------------------
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_guardian_1",
      object: "subscription",
      // The Customer is the GUARDIAN's. Nothing about that makes the guardian
      // the entitled party.
      customer: "cus_test_1",
      status: "active",
      metadata: { payer_profile_id: GUARDIAN },
      items: { object: "list", data: [item("si_a", STUDENT_A)] },
    });

    const first = signedSubscriptionEvent();
    const firstOutcome = await process_(first.body, first.signature, "req_a");

    expect(firstOutcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT_A,
      expect.objectContaining({
        tier: "premium",
        stripe_subscription_item_id: "si_a",
      }),
    );
    // The payer holds NO entitlement row of their own (§31.1).
    const payerWrites = accountMocks.upsertEntitlement.mock.calls.filter(
      (c: unknown[]) => c[0] === GUARDIAN,
    );
    expect(payerWrites).toEqual([]);

    // ---- LATER: the guardian adds student B to the SAME subscription ----
    accountMocks.upsertEntitlement.mockClear();
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_guardian_1",
      object: "subscription",
      customer: "cus_test_1",
      status: "active",
      metadata: { payer_profile_id: GUARDIAN },
      items: {
        object: "list",
        data: [item("si_a", STUDENT_A), item("si_b", STUDENT_B)],
      },
    });

    const second = signedSubscriptionEvent();
    const secondOutcome = await process_(second.body, second.signature, "req_b");

    expect(secondOutcome).toMatchObject({ ok: true, status: "processed" });

    // A SURVIVES: still premium, still keyed to A's own item — not dropped, and
    // not re-pointed at B's item.
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
    // Still nothing on the payer after a second purchase.
    expect(
      accountMocks.upsertEntitlement.mock.calls.filter(
        (c: unknown[]) => c[0] === GUARDIAN,
      ),
    ).toEqual([]);
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
      customer: "cus_test_1",
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
      customer: "cus_test_1",
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
      customer: "cus_test_1",
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
      customer: "cus_test_1",
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
