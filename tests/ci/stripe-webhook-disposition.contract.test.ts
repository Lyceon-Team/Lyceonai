/**
 * Stripe webhook DISPOSITION — Phase 3 §4.2 exit criterion.
 *
 * @spec [Doc-01_V8 §22.1 as amended by SCL-070 (18 subscribed events);
 *        SCL-049 livemode] | @implemented [2026-08-27]
 *
 * plain English: drives the REAL webhook handler once per subscribed event
 * type and prints what the handler does with each. Expected outcome: every one
 * of the 18 events Stripe is configured to deliver has a definite, named
 * disposition — `processed` or `ignored` — and none throws or silently
 * no-ops. Trade-off: the four `processed` events are driven only far enough to
 * establish that they dispatch; their behaviour is asserted in
 * `stripe-webhook.contract.test.ts`, not re-asserted here. Edge case: a
 * subscribed event whose name is absent from the SDK's event union cannot be
 * delivered at all, so the list is cross-checked against the SDK.
 *
 * Why this exists as a gate and not a one-off report: a subscribed-but-
 * unhandled event either throws or silently no-ops, and both stay invisible
 * until money is involved. A printed table that nothing enforces decays the
 * first time the surface changes.
 *
 * Signature verification is the REAL Stripe SDK — signatures generated with
 * `Stripe.webhooks.generateTestHeaderString` and verified by the SDK's own
 * `constructEvent`. Only the database and the Stripe API re-fetch are mocked.
 * Nothing mocks the handler under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_secret_for_disposition_suite";
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

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
}));

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_disposition_suite_placeholder");
  return {
    getStripeClient: () => ({
      // REAL verification — not a stub.
      webhooks: real.webhooks,
      subscriptions: { retrieve: stripeApi.subscriptionsRetrieve },
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
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * The subscribed surface per SCL-070. This list is the Stripe Dashboard
 * endpoint configuration, not a repo constant — it is reproduced here so a
 * drift between what Stripe delivers and what the handler knows is visible in
 * CI rather than in production.
 */
const SUBSCRIBED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.updated",
  "customer.deleted",
  "customer.discount.created",
  "customer.discount.updated",
  "customer.discount.deleted",
  "promotion_code.created",
  "promotion_code.updated",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "refund.created",
  "refund.updated",
  "charge.dispute.created",
] as const;

/** Data object shapes sufficient for the handler to reach its disposition. */
function dataObjectFor(eventType: string): Record<string, unknown> {
  if (eventType.startsWith("checkout.session.")) {
    return {
      id: "cs_test_disposition",
      object: "checkout.session",
      mode: "subscription",
      subscription: "sub_test_disposition",
      client_reference_id: STUDENT_ID,
      metadata: { student_profile_id: STUDENT_ID },
    };
  }
  if (eventType.startsWith("customer.subscription.")) {
    return {
      id: "sub_test_disposition",
      object: "subscription",
      status: "active",
      customer: "cus_test_disposition",
      metadata: { student_profile_id: STUDENT_ID },
      items: {
        object: "list",
        data: [
          {
            id: "si_test_disposition",
            object: "subscription_item",
            current_period_start: 1_756_000_000,
            current_period_end: 1_758_600_000,
            price: { id: "price_test_disposition" },
            metadata: { student_profile_id: STUDENT_ID },
          },
        ],
      },
    };
  }
  return { id: `obj_test_${eventType.replace(/\./g, "_")}`, object: "object" };
}

function signedEvent(eventType: string, index: number) {
  const event = {
    id: `evt_disposition_${index}`,
    object: "event",
    type: eventType,
    livemode: false,
    data: { object: dataObjectFor(eventType) },
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

type Disposition = {
  eventType: string;
  outcome: string;
  threw: boolean;
};

describe("Stripe webhook — disposition of every subscribed event (§4.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    state.expectedLivemode = false;
    dbMocks.insert.mockResolvedValue({ error: null });
    dbMocks.delete.mockResolvedValue({ error: null });
    stripeApi.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_test_disposition",
      object: "subscription",
      status: "active",
      customer: "cus_test_disposition",
      metadata: { student_profile_id: STUDENT_ID },
      items: {
        object: "list",
        data: [
          {
            id: "si_test_disposition",
            object: "subscription_item",
            current_period_start: 1_756_000_000,
            current_period_end: 1_758_600_000,
            price: { id: "price_test_disposition" },
            metadata: { student_profile_id: STUDENT_ID },
          },
        ],
      },
    });
  });

  it("every subscribed event name exists in the pinned SDK's event union", async () => {
    // A name that does not exist cannot be subscribed, and a typo fails
    // silently at the Dashboard rather than loudly here.
    const { readFileSync, existsSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { createRequire } = await import("node:module");
    const nodeRequire = createRequire(import.meta.url);

    // `stripe/types/...` is not an exported subpath, so walk up from the
    // resolved entry point to the package root instead of resolving it.
    let dir = dirname(nodeRequire.resolve("stripe"));
    while (!existsSync(join(dir, "types", "EventTypes.d.ts"))) {
      const parent = dirname(dir);
      expect(parent).not.toBe(dir); // walked to the filesystem root: fail loudly
      dir = parent;
    }
    const union = readFileSync(join(dir, "types", "EventTypes.d.ts"), "utf8");

    const missing = SUBSCRIBED_EVENTS.filter(
      (name) => !union.includes(`'${name}'`),
    );
    expect(missing).toEqual([]);
  });

  it("prints the disposition of all 18 and leaves none undefined", async () => {
    const process_ = await handler();
    const rows: Disposition[] = [];

    for (const [index, eventType] of SUBSCRIBED_EVENTS.entries()) {
      const { body, signature } = signedEvent(eventType, index);
      try {
        const outcome = await process_(
          body,
          signature,
          `req_disposition_${index}`,
        );
        rows.push({
          eventType,
          outcome: outcome.ok ? outcome.status : `REJECTED:${outcome.reason}`,
          threw: false,
        });
      } catch (err: unknown) {
        rows.push({
          eventType,
          outcome: `THREW:${err instanceof Error ? err.message : "unknown"}`,
          threw: true,
        });
      }
    }

    const width = Math.max(...rows.map((r) => r.eventType.length));
    const lines = [
      "",
      `STRIPE WEBHOOK DISPOSITION — ${rows.length} subscribed events`,
      "",
      ...rows.map(
        (r, i) =>
          `  ${String(i + 1).padStart(2)}. ${r.eventType.padEnd(width)}  ${r.outcome}`,
      ),
      "",
      `  processed: ${rows.filter((r) => r.outcome === "processed").length}` +
        `   ignored: ${rows.filter((r) => r.outcome === "ignored").length}` +
        `   threw: ${rows.filter((r) => r.threw).length}`,
      "",
    ];
    // This test's product IS the printed table: §4.2 requires the disposition
    // printed as a runtime artifact, not described.
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));

    expect(rows).toHaveLength(18);
    // The criterion: a definite disposition for every subscribed event.
    expect(rows.filter((r) => r.threw)).toEqual([]);
    for (const row of rows) {
      expect(["processed", "ignored"]).toContain(row.outcome);
    }
  });
});
