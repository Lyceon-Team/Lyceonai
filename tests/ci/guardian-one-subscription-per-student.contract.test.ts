/**
 * ONE GUARDIAN CUSTOMER, ONE SUBSCRIPTION PER STUDENT.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4; §36.4; SCL-045 one SubscriptionItem
 *        per student; Charter §6 metadata identifies, it does not authorise;
 *        owner ruling 2026-09-29]
 * @implemented [2026-09-29]
 *
 * plain English: proves the properties the add-item deletion was for. Expected
 * outcome: a guardian funding two students holds two independent subscriptions —
 * separately identified, separately cancellable — and no production code can
 * create a subscription item instead of charging at Checkout.
 *
 * WHAT THIS REPLACED, AND WHY IT IS A SEPARATE FILE. A guardian's second purchase
 * used to call `subscriptionItems.create` on their existing subscription. With
 * `proration_behavior` unset, Stripe's `create_prorations` default put the amount
 * on the NEXT invoice, so the student was entitled immediately and the guardian
 * was charged up to three months later — with no Checkout page, no price shown,
 * no receipt and no Billing Terms acceptance, since
 * `consent_collection.terms_of_service` exists only on a Checkout Session
 * (observed in production 2026-09-29 05:28:25Z: one
 * `customer.subscription.updated`, no `checkout.session.completed`).
 *
 * `stripe-lifecycle-gate.contract.test.ts` owns the same webhook entry point but
 * its fixture is SELF-PAY shaped — subscription metadata names the student and no
 * payer — and a guardian-paid subscription is the opposite: its metadata names the
 * payer, `isGuardianPaid` routes it to the item writer, and the write is
 * authorised against `guardian_links`. Rather than bend one fixture to serve both
 * and have neither describe a real response, this file owns the guardian shape
 * and builds it from what the route actually sends: `subscription_data.metadata`
 * with `payer_profile_id`, `student_profile_id` and `payer_relationship`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEBHOOK_SECRET = "whsec_guardian_one_sub_per_student";
const GUARDIAN_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_A = "22222222-2222-4222-8222-222222222222";
const STUDENT_B = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({ expectedLivemode: false }));
const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(async () => ({
    error: null as { code?: string; message?: string } | null,
  })),
  delete: vi.fn(async () => ({ error: null })),
}));
const accountMocks = vi.hoisted(() => ({
  upsertEntitlement: vi.fn(async () => ({})),
  setProfileCountryCode: vi.fn(async () => undefined),
  mapStripeStatusToEntitlement: vi.fn((s: string) => ({
    tier: s === "active" ? "premium" : "free",
    status: s,
  })),
  getEntitlementsBySubscriptionId: vi.fn(async () => []),
  getAllGuardianStudentLinks: vi.fn(async () => [
    { student_profile_id: STUDENT_A },
    { student_profile_id: STUDENT_B },
  ]),
}));
const configMocks = vi.hoisted(() => ({
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsResume: vi.fn(),
  subscriptionItemsUpdate: vi.fn(),
  chargesRetrieve: vi.fn(),
  customersRetrieve: vi.fn(async () => ({
    id: "cus_guardian",
    address: { country: "US" },
  })),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_guardian_one_sub_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: stripeApi.subscriptionsRetrieve,
        list: stripeApi.subscriptionsList,
        update: stripeApi.subscriptionsUpdate,
        resume: stripeApi.subscriptionsResume,
      },
      subscriptionItems: { update: stripeApi.subscriptionItemsUpdate },
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
  setProfileCountryCode: accountMocks.setProfileCountryCode,
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

const REPO_ROOT = resolve(__dirname, "../..");

/**
 * One guardian-paid subscription, shaped as the route causes Stripe to create
 * it: `subscription_data.metadata` carries the payer and the ONE student, and
 * the single item carries the student too (written by
 * `propagateSubjectToBareItem`, since Checkout does not propagate
 * `line_items[].metadata`).
 */
function guardianSubscription(args: {
  readonly id: string;
  readonly itemId: string;
  readonly studentProfileId: string;
  readonly status: string;
  readonly priceId?: string;
}) {
  return {
    id: args.id,
    object: "subscription",
    status: args.status,
    customer: "cus_guardian",
    cancel_at_period_end: false,
    metadata: {
      payer_profile_id: GUARDIAN_ID,
      student_profile_id: args.studentProfileId,
      payer_relationship: "guardian",
      plan: "monthly",
    },
    items: {
      object: "list",
      data: [
        {
          id: args.itemId,
          object: "subscription_item",
          metadata: { student_profile_id: args.studentProfileId },
          price: { id: args.priceId ?? "price_monthly" },
          current_period_start: 1_780_000_000,
          current_period_end: 1_782_600_000,
        },
      ],
    },
  };
}

function signedSubscriptionEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  subscription: ReturnType<typeof guardianSubscription>,
) {
  const event = {
    id: `evt_${type}_${subscription.id}`,
    object: "event",
    type,
    livemode: false,
    data: { object: subscription },
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

/** Every (profileId, fields) pair `upsertEntitlement` was called with. */
function writes(): ReadonlyArray<{
  profileId: string;
  fields: Record<string, unknown>;
}> {
  return accountMocks.upsertEntitlement.mock.calls.map(
    (c: readonly unknown[]) => ({
      profileId: c[0] as string,
      fields: c[1] as Record<string, unknown>,
    }),
  );
}

describe("guardian purchases: one subscription per student", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    configMocks.getTier1Countries.mockResolvedValue(["US", "CA", "GB"]);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_A },
      { student_profile_id: STUDENT_B },
    ]);
    accountMocks.mapStripeStatusToEntitlement.mockImplementation(
      (s: string) => ({
        tier: s === "active" ? "premium" : "free",
        status: s,
      }),
    );
    stripeApi.customersRetrieve.mockResolvedValue({
      id: "cus_guardian",
      address: { country: "US" },
    });
  });

  /**
   * CLAIM 2. `subscriptionItems.create` is reachable from NO production path.
   *
   * Static, over the tracked production tree, because the claim is about what
   * exists rather than what one request happened to do. Scoped to `.create`
   * deliberately: `subscriptionItems.update` is the item-metadata write that
   * Checkout makes necessary, and `subscriptionItems.del` is account deletion.
   * An assertion that reddened against those two would be a broken assertion,
   * not a strict one.
   */
  it("calls subscriptionItems.create from no production file", () => {
    const productionFiles = [
      "server/routes/billing-routes.ts",
      "server/lib/stripe/webhook-handler.ts",
      "server/lib/stripe/guardian-checkout.ts",
      "server/lib/stripe/guardian-subscriptions.ts",
      "server/lib/stripe/purchase-idempotency.ts",
      "server/lib/stripe/purchase-eligibility.ts",
      "server/lib/stripe/entitlement-paths.ts",
      "server/lib/account-deletion-execute.ts",
    ];

    // Presence before absence: prove the sweep is reading real files that DO
    // contain the neighbouring calls, or "no matches" would pass for the wrong
    // reason on a mistyped path.
    const corpus = productionFiles.map((f) => ({
      file: f,
      text: readFileSync(resolve(REPO_ROOT, f), "utf8"),
    }));
    expect(
      corpus.some((c) => /subscriptionItems\.update\(/.test(c.text)),
      "the sweep found no subscriptionItems.update — is it reading the right files?",
    ).toBe(true);
    expect(
      corpus.some((c) => /subscriptionItems\.del\(/.test(c.text)),
      "the sweep found no subscriptionItems.del — is it reading the right files?",
    ).toBe(true);

    const offenders = corpus
      .filter((c) => /subscriptionItems\s*\.\s*create\s*\(/.test(c.text))
      .map((c) => c.file);
    expect(
      offenders,
      `subscriptionItems.create is back in production: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * CLAIM 3. Two students produce two DISTINCT `stripe_subscription_id` values.
   *
   * Each subscription's own event is delivered, and each writes its own student
   * against its own subscription id. A single subscription carrying both — the
   * old add-item shape — would write one id twice.
   */
  it("writes two distinct stripe_subscription_id values for two students", async () => {
    const subA = guardianSubscription({
      id: "sub_for_student_a",
      itemId: "si_a",
      studentProfileId: STUDENT_A,
      status: "active",
    });
    const subB = guardianSubscription({
      id: "sub_for_student_b",
      itemId: "si_b",
      studentProfileId: STUDENT_B,
      status: "active",
    });

    const process = await handler();
    stripeApi.subscriptionsRetrieve.mockResolvedValueOnce(subA);
    const a = signedSubscriptionEvent("customer.subscription.updated", subA);
    expect(await process(a.body, a.signature)).toMatchObject({
      ok: true,
      status: "processed",
    });

    stripeApi.subscriptionsRetrieve.mockResolvedValueOnce(subB);
    const b = signedSubscriptionEvent("customer.subscription.updated", subB);
    expect(await process(b.body, b.signature)).toMatchObject({
      ok: true,
      status: "processed",
    });

    const rows = writes();
    expect(rows.length).toBe(2);
    const byStudent = new Map(rows.map((r) => [r.profileId, r.fields]));
    expect(byStudent.get(STUDENT_A)?.stripe_subscription_id).toBe(
      "sub_for_student_a",
    );
    expect(byStudent.get(STUDENT_B)?.stripe_subscription_id).toBe(
      "sub_for_student_b",
    );
    expect(
      new Set(rows.map((r) => r.fields.stripe_subscription_id)).size,
      "both students were written against the same subscription",
    ).toBe(2);
  });

  /**
   * CLAIM 5. Each entitlement carries its OWN `stripe_subscription_item_id`.
   *
   * SCL-045's key. Asserted alongside claim 3 rather than folded into it,
   * because a bug that wrote one shared item id would still produce two distinct
   * subscription ids.
   */
  it("writes each student's own stripe_subscription_item_id", async () => {
    const subA = guardianSubscription({
      id: "sub_for_student_a",
      itemId: "si_a",
      studentProfileId: STUDENT_A,
      status: "active",
    });
    const subB = guardianSubscription({
      id: "sub_for_student_b",
      itemId: "si_b",
      studentProfileId: STUDENT_B,
      status: "active",
    });

    const process = await handler();
    stripeApi.subscriptionsRetrieve.mockResolvedValueOnce(subA);
    const a = signedSubscriptionEvent("customer.subscription.updated", subA);
    await process(a.body, a.signature);
    stripeApi.subscriptionsRetrieve.mockResolvedValueOnce(subB);
    const b = signedSubscriptionEvent("customer.subscription.updated", subB);
    await process(b.body, b.signature);

    const byStudent = new Map(writes().map((r) => [r.profileId, r.fields]));
    expect(byStudent.get(STUDENT_A)?.stripe_subscription_item_id).toBe("si_a");
    expect(byStudent.get(STUDENT_B)?.stripe_subscription_item_id).toBe("si_b");
  });

  /**
   * CLAIM 5, ON THE ONE SHAPE THAT CAN DISPROVE IT — a TWO-ITEM subscription.
   *
   * A PLANT EXPOSED THIS TEST, NOT THE CODE. Replacing `item.id` with
   * `items[0]!.id` in the writer left the suite green, because every fixture
   * above gives each subscription exactly one item and the two expressions are
   * then the same value. The claim "each entitlement carries its OWN
   * `stripe_subscription_item_id`" was passing for the wrong reason.
   *
   * Two-item subscriptions are not hypothetical: the deleted add-item path
   * created them, and `sub_1UB8p5DPtjyWEVqErGBHVFQF` in production still carries
   * two. So this pins SCL-045's key on the only shape where getting it wrong is
   * visible — which is also the shape the writer must keep handling for data
   * that already exists.
   */
  it("writes a per-item id on a legacy subscription carrying two students", async () => {
    const legacy = {
      id: "sub_legacy_two_items",
      object: "subscription",
      status: "active",
      customer: "cus_guardian",
      cancel_at_period_end: false,
      metadata: {
        payer_profile_id: GUARDIAN_ID,
        student_profile_id: STUDENT_A,
        payer_relationship: "guardian",
        plan: "monthly",
      },
      items: {
        object: "list",
        data: [
          {
            id: "si_legacy_a",
            object: "subscription_item",
            metadata: { student_profile_id: STUDENT_A },
            price: { id: "price_yearly" },
            current_period_start: 1_780_000_000,
            current_period_end: 1_782_600_000,
          },
          {
            id: "si_legacy_b",
            object: "subscription_item",
            metadata: { student_profile_id: STUDENT_B },
            price: { id: "price_quarterly" },
            current_period_start: 1_780_000_000,
            current_period_end: 1_782_600_000,
          },
        ],
      },
    };

    const process = await handler();
    stripeApi.subscriptionsRetrieve.mockResolvedValueOnce(legacy);
    const ev = signedSubscriptionEvent(
      "customer.subscription.updated",
      legacy as ReturnType<typeof guardianSubscription>,
    );
    expect(await process(ev.body, ev.signature)).toMatchObject({
      ok: true,
      status: "processed",
    });

    const byStudent = new Map(writes().map((r) => [r.profileId, r.fields]));
    expect(byStudent.size).toBe(2);
    expect(byStudent.get(STUDENT_A)?.stripe_subscription_item_id).toBe(
      "si_legacy_a",
    );
    expect(byStudent.get(STUDENT_B)?.stripe_subscription_item_id).toBe(
      "si_legacy_b",
    );
    // Both on ONE subscription here — which is why the ITEM id is the key.
    expect(byStudent.get(STUDENT_A)?.stripe_subscription_id).toBe(
      "sub_legacy_two_items",
    );
    expect(byStudent.get(STUDENT_B)?.stripe_subscription_id).toBe(
      "sub_legacy_two_items",
    );
    // The price rides the item too, so two students on one subscription do not
    // collapse onto one plan.
    expect(byStudent.get(STUDENT_A)?.stripe_price_id).toBe("price_yearly");
    expect(byStudent.get(STUDENT_B)?.stripe_price_id).toBe("price_quarterly");
  });

  /**
   * CLAIM 4. Cancelling one student's subscription leaves the other's
   * entitlement ALONE.
   *
   * This holds by a property of the writer — it iterates the items of the
   * subscription the event names — rather than by an explicit guard, which is
   * exactly why it needs pinning: nothing in the code says "do not touch the
   * others", so a future change that resolved students from the CUSTOMER instead
   * of the subscription would break it silently.
   *
   * Asserted both ways: student A is revoked to `free`, and student B is not
   * written at all. Checking only the first would pass for a writer that revoked
   * everybody.
   */
  it("revokes only the cancelled subscription's student", async () => {
    const subA = guardianSubscription({
      id: "sub_for_student_a",
      itemId: "si_a",
      studentProfileId: STUDENT_A,
      status: "canceled",
    });

    const process = await handler();
    stripeApi.subscriptionsRetrieve.mockResolvedValueOnce(subA);
    const ev = signedSubscriptionEvent("customer.subscription.deleted", subA);
    expect(await process(ev.body, ev.signature)).toMatchObject({
      ok: true,
      status: "processed",
    });

    const rows = writes();
    expect(rows.length).toBe(1);
    expect(rows[0]?.profileId).toBe(STUDENT_A);
    expect(rows[0]?.fields.tier).toBe("free");
    expect(
      rows.some((r) => r.profileId === STUDENT_B),
      "cancelling one student's subscription touched the other student",
    ).toBe(false);
  });

  /**
   * THE AUTHORISATION HALF, KEPT VISIBLE. Metadata identifies; `guardian_links`
   * authorises (Charter §6). A subscription naming a student the guardian is no
   * longer linked to must write NOTHING, even though its metadata looks correct —
   * otherwise the new per-student subscription would be a way to keep entitling a
   * student whose link was revoked.
   */
  it("writes nothing when the payer is not linked to the subscription's student", async () => {
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT_A },
    ]);
    const subB = guardianSubscription({
      id: "sub_for_student_b",
      itemId: "si_b",
      studentProfileId: STUDENT_B,
      status: "active",
    });

    const process = await handler();
    stripeApi.subscriptionsRetrieve.mockResolvedValueOnce(subB);
    const ev = signedSubscriptionEvent("customer.subscription.updated", subB);

    await expect(process(ev.body, ev.signature)).rejects.toThrow();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});
