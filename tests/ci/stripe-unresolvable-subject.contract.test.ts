/**
 * An unresolvable subject settles; a period is never invented.
 *
 * @spec [OWNER RULING 2026-09-01 as extended 2026-09-02 — a denial or an
 *        unresolvable subject is a DECISION and decisions settle at 200;
 *        SCL-043 payer identity; SCL-045 one SubscriptionItem per student]
 * @implemented [2026-09-02]
 *
 * plain English: pins two behaviours that live production objects proved were
 * missing, and one hazard that is real but deliberately not fixed here.
 *
 * THE OBJECTS THESE FIXTURES COME FROM, read from live Stripe. Customer
 * `cus_V4lNXGNkj7FQH3` carries TWO active subscriptions for one student:
 *
 *   sub_1U8pinDPtjyWEVqEAB7wwjn3  { student_profile_id, payer_relationship, plan }
 *   sub_1U4bqZDPtjyWEVqEEZXzvbnh  { profile_id, payer_user_id, payer_role, plan }
 *
 * The second predates SCL-043. Cancelling it in the Customer Portal emitted
 * `customer.subscription.updated`; `resolveStudentProfileId` recognised none of
 * its keys, threw, the route returned 500, and Stripe retried an event no
 * redelivery could ever satisfy.
 *
 * WHY THE FIXTURE USES THE LEGACY KEYS RATHER THAN AN EMPTY OBJECT. `{}` would
 * pass a test that only checks "absent subject". The real object carries FOUR
 * keys, two of which hold the student's uuid under names this system does not
 * read — so the interesting property is that a uuid being PRESENT under the
 * wrong key resolves to nobody. An empty-metadata fixture cannot express that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_unresolvable_subject";
const STUDENT = "3f18cbe2-a999-41d4-852b-2af27e19d04e";

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
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  customersRetrieve: vi.fn(async () => ({
    id: "cus_V4lNXGNkj7FQH3",
    address: { country: "US" },
  })),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_unresolvable_subject_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      subscriptions: { retrieve: stripeApi.subscriptionsRetrieve },
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
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));
vi.mock("../../server/logger", () => ({ logger: loggerMocks }));

/** Verbatim from `sub_1U4bqZDPtjyWEVqEEZXzvbnh`. */
const LEGACY_METADATA = {
  payer_role: "student",
  payer_user_id: STUDENT,
  plan: "yearly",
  profile_id: STUDENT,
};

/** Verbatim from `sub_1U8pinDPtjyWEVqEAB7wwjn3`. */
const CURRENT_METADATA = {
  payer_relationship: "self",
  plan: "yearly",
  student_profile_id: STUDENT,
};

function signedLifecycle(
  eventId: string,
  subscriptionId: string,
  metadata: Record<string, string>,
) {
  const event = {
    id: eventId,
    object: "event",
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        customer: "cus_V4lNXGNkj7FQH3",
        status: "active",
        metadata,
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

function retrieved(
  subscriptionId: string,
  metadata: Record<string, string>,
  item: {
    id: string;
    current_period_start?: number;
    current_period_end?: number;
  },
) {
  return {
    id: subscriptionId,
    object: "subscription",
    customer: "cus_V4lNXGNkj7FQH3",
    status: "active",
    cancel_at_period_end: false,
    metadata,
    items: {
      object: "list",
      data: [
        {
          ...item,
          object: "subscription_item",
          price: { id: "price_1SnWvoDPtjyWEVqEohJvlvvq" },
          metadata: {},
        },
      ],
    },
  };
}

async function handler() {
  return (await import("../../server/lib/stripe/webhook-handler"))
    .processStripeWebhook;
}

describe("lifecycle events that name nobody, and periods we did not receive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
  });

  /**
   * THE PRODUCTION FAILURE. Plant: restore the `StripePayloadShapeError` throw
   * in `resolveStudentProfileId` and this rejects instead of settling.
   */
  it("SETTLES a subscription whose metadata predates SCL-043, instead of retrying forever", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      retrieved("sub_1U4bqZDPtjyWEVqEEZXzvbnh", LEGACY_METADATA, {
        id: "si_V4lNoXQKTLopUH",
        current_period_start: 1_786_778_256,
        current_period_end: 1_818_314_256,
      }),
    );
    const process_ = await handler();
    const { body, signature } = signedLifecycle(
      "evt_legacy_orphan",
      "sub_1U4bqZDPtjyWEVqEEZXzvbnh",
      LEGACY_METADATA,
    );

    const outcome = await process_(body, signature, "req_legacy_orphan");

    expect(outcome).toMatchObject({ ok: true, status: "unresolvable_subject" });
  });

  /**
   * THE HALF THAT MATTERS MORE THAN SETTLING. Settling at 200 while quietly
   * writing something would be worse than the 500 it replaces — and the
   * tempting "fix" for this event (teach it to read `profile_id`) would make it
   * resolve to a student whose GOOD entitlement it would then overwrite with
   * `canceled`. Nothing is written, and nothing is even read for a profile.
   */
  it("writes nothing at all for the orphan — no upsert, no entitlement lookup", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      retrieved("sub_1U4bqZDPtjyWEVqEEZXzvbnh", LEGACY_METADATA, {
        id: "si_V4lNoXQKTLopUH",
        current_period_start: 1_786_778_256,
        current_period_end: 1_818_314_256,
      }),
    );
    const process_ = await handler();
    const { body, signature } = signedLifecycle(
      "evt_legacy_no_write",
      "sub_1U4bqZDPtjyWEVqEEZXzvbnh",
      LEGACY_METADATA,
    );

    await process_(body, signature, "req_legacy_no_write");

    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    expect(accountMocks.getEntitlementsBySubscriptionId).not.toHaveBeenCalled();
  });

  /**
   * The skip is legible, and it names the subscription — but never a profile
   * id. The metadata KEYS are logged because they are what tells a pre-SCL-043
   * subscription apart from a current one that has genuinely lost its subject;
   * the VALUES are two copies of a student's uuid and are not logged.
   */
  it("logs the skip with the subscription and the metadata keys, and no profile id", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      retrieved("sub_1U4bqZDPtjyWEVqEEZXzvbnh", LEGACY_METADATA, {
        id: "si_V4lNoXQKTLopUH",
      }),
    );
    const process_ = await handler();
    const { body, signature } = signedLifecycle(
      "evt_legacy_logged",
      "sub_1U4bqZDPtjyWEVqEEZXzvbnh",
      LEGACY_METADATA,
    );

    await process_(body, signature, "req_legacy_logged");

    const call = loggerMocks.warn.mock.calls.find((c) =>
      String(c[2]).includes("SETTLED WITHOUT WRITING"),
    );
    expect(call).toBeTruthy();
    const fields = call?.[3] as Record<string, unknown>;
    expect(fields.metadataKeys).toEqual([
      "payer_role",
      "payer_user_id",
      "plan",
      "profile_id",
    ]);
    expect(JSON.stringify(fields)).not.toContain(STUDENT);
  });

  /**
   * ABSENCE AND A GUESS ARE DIFFERENT ANSWERS.
   *
   * The row for student `3f18cbe2` in production carries
   * `current_period_end = 2027-09-02 09:51:10.059762` — microsecond precision,
   * so not a Stripe epoch, and matching neither subscription's item period
   * (2027-08-26 and 2027-08-15). No code writes that; this pins the property
   * that keeps it that way. A NULL is visibly unknown; a computed date gets
   * trusted for renewal, grace and dunning.
   *
   * Plant: substitute any fallback for `epochToIso(item?.currentPeriodEnd)` —
   * `Date.now()`, a `+ 1 year`, anything — and this goes red.
   */
  it("writes NULL periods when the item carries none, never a computed date", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      retrieved("sub_1U8pinDPtjyWEVqEAB7wwjn3", CURRENT_METADATA, {
        id: "si_V97ymukbvCzxjf",
      }),
    );
    const process_ = await handler();
    const { body, signature } = signedLifecycle(
      "evt_no_period",
      "sub_1U8pinDPtjyWEVqEAB7wwjn3",
      CURRENT_METADATA,
    );

    const outcome = await process_(body, signature, "req_no_period");

    expect(outcome).toMatchObject({ ok: true, status: "processed" });
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT,
      expect.objectContaining({
        current_period_start: null,
        current_period_end: null,
      }),
    );
  });

  /** The periods Stripe DID send arrive unchanged, to whole seconds. */
  it("writes the item's own periods when Stripe sends them", async () => {
    stripeApi.subscriptionsRetrieve.mockResolvedValue(
      retrieved("sub_1U8pinDPtjyWEVqEAB7wwjn3", CURRENT_METADATA, {
        id: "si_V97ymukbvCzxjf",
        current_period_start: 1_787_784_901,
        current_period_end: 1_819_320_901,
      }),
    );
    const process_ = await handler();
    const { body, signature } = signedLifecycle(
      "evt_real_period",
      "sub_1U8pinDPtjyWEVqEAB7wwjn3",
      CURRENT_METADATA,
    );

    await process_(body, signature, "req_real_period");

    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT,
      expect.objectContaining({
        current_period_start: "2026-08-26T22:55:01.000Z",
        current_period_end: "2027-08-26T22:55:01.000Z",
      }),
    );
  });

  /**
   * TWO SUBSCRIPTIONS, ONE STUDENT — the outcome stated and pinned.
   *
   * `upsertEntitlement` keys on `profile_id` alone with `onConflict`, so the
   * entitlements table holds ONE row per student however many subscriptions
   * fund them. Today the pair above is safe by accident: only one of the two is
   * resolvable, so whichever order events arrive in, the orphan settles and
   * only `sub_1U8pin…` ever writes.
   *
   * That is what this pins — and it is a fact about the DATA, not a property of
   * the writer. Two RESOLVABLE subscriptions for one student would be
   * last-writer-wins, and a cancellation on the older one would overwrite the
   * newer one's `active` row. Reported as a hazard; deliberately not fixed
   * here, because keying entitlement on the subscription is a schema change.
   */
  it("is order-independent for this pair: only the resolvable subscription writes", async () => {
    const process_ = await handler();

    for (const [n, [sub, meta, itemId]] of [
      ["sub_1U4bqZDPtjyWEVqEEZXzvbnh", LEGACY_METADATA, "si_V4lNoXQKTLopUH"],
      ["sub_1U8pinDPtjyWEVqEAB7wwjn3", CURRENT_METADATA, "si_V97ymukbvCzxjf"],
      ["sub_1U4bqZDPtjyWEVqEEZXzvbnh", LEGACY_METADATA, "si_V4lNoXQKTLopUH"],
    ].entries()) {
      stripeApi.subscriptionsRetrieve.mockResolvedValue(
        retrieved(sub as string, meta as Record<string, string>, {
          id: itemId as string,
          current_period_start: 1_787_784_901,
          current_period_end: 1_819_320_901,
        }),
      );
      const { body, signature } = signedLifecycle(
        `evt_order_${n}`,
        sub as string,
        meta as Record<string, string>,
      );
      await process_(body, signature, `req_order_${n}`);
    }

    // Three events, one write — from the resolvable subscription only.
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT,
      expect.objectContaining({
        tier: "premium",
        stripe_subscription_id: "sub_1U8pinDPtjyWEVqEAB7wwjn3",
      }),
    );
  });
});
