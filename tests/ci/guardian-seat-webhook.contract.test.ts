/**
 * A seat bought before any student is linked, through the REAL webhook handler (real signature
 * verification): recorded once, never an entitlement before it is claimed, exactly one after.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §1, §6 ("Webhook replay: seat recorded once, no entitlement before claim, exactly one
 *        after"); 20261205000000_guardian_seats.sql] | @implemented [2026-11-19]
 *
 * plain English: the event ledger, the seat writes and the entitlement write are substituted
 * and recorded; everything between them is the production handler.
 *   W1  a paid seat subscription: the seat is recorded, no entitlement is written
 *   W2  the same event delivered twice: the ledger refuses the replay, the seat is recorded once
 *   W3  the subscription ends with the seat unclaimed: the seat is cancelled, no entitlement
 *   W4  once claimed (the item names the student, who is linked): exactly one entitlement
 *   W5  a seat that is not yet paid (incomplete): nothing recorded, nothing written
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_test_guardian_seat";
const GUARDIAN = "66666666-6666-4666-8666-666666666666";
const STUDENT = "77777777-7777-4777-8777-777777777777";

const ledger = vi.hoisted(() => ({ seen: new Set<string>() }));
const seatMocks = vi.hoisted(() => ({
  recordGuardianSeat: vi.fn(async () => ({})),
  markGuardianSeatCancelled: vi.fn(async () => undefined),
}));
const accountMocks = vi.hoisted(() => ({
  upsertEntitlement: vi.fn(async () => ({})),
  mapStripeStatusToEntitlement: vi.fn((s: string) => ({
    tier: s === "active" ? "premium" : "free",
    status: s,
  })),
  getAllGuardianStudentLinks: vi.fn(async () => [] as unknown[]),
}));
const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  customersRetrieve: vi.fn(async () => ({
    id: "cus_seat",
    address: { country: "US" },
  })),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_seat_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      customers: { retrieve: stripeApi.customersRetrieve },
      subscriptions: { retrieve: stripeApi.subscriptionsRetrieve },
    }),
    getExpectedLivemode: () => false,
  };
});
// The event ledger: a second insert of the same id is the primary-key violation the handler
// reads as a replay.
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: async (row: { id: string }) => {
        if (ledger.seen.has(row.id)) {
          return {
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "stripe_webhook_events_pkey"',
              details: null,
            },
          };
        }
        ledger.seen.add(row.id);
        return { error: null };
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock("../../server/lib/guardian-seats", () => seatMocks);
vi.mock("../../server/lib/account", () => ({
  setProfileCountryCode: vi.fn(async () => undefined),
  upsertEntitlement: accountMocks.upsertEntitlement,
  mapStripeStatusToEntitlement: accountMocks.mapStripeStatusToEntitlement,
  getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: vi.fn(async () => ["US"]),
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    evaluateEntitlementActive: vi.fn(async () => ({ ok: true, active: false })),
  },
}));
vi.mock("../../server/lib/lifecycle-email", () => ({
  defaultLifecycleDeps: () => ({}),
  fireLifecycle: vi.fn(),
  sendEntitledEvents: vi.fn(),
}));
vi.mock("../../server/lib/analytics/funnel-events", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/lib/analytics/funnel-events")
  >()),
  fireUpgraded: vi.fn(),
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload, "utf8"),
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

/** The seat subscription as Stripe returns it; `student` set once the seat is claimed. */
function seatSubscription(status: string, student: string | null = null) {
  return {
    id: "sub_seat",
    object: "subscription",
    customer: "cus_seat",
    status,
    cancel_at_period_end: false,
    metadata: {
      payer_profile_id: GUARDIAN,
      payer_relationship: "guardian",
      purchase_kind: "guardian_seat",
      plan: "monthly",
      ...(student ? { student_profile_id: student } : {}),
    },
    items: {
      data: [
        {
          id: "si_seat",
          price: { id: "price_monthly" },
          metadata: student ? { student_profile_id: student } : {},
          current_period_start: 1_760_000_000,
          current_period_end: 1_762_000_000,
        },
      ],
    },
  };
}

function subscriptionEvent(
  id: string,
  type: string,
  sub: ReturnType<typeof seatSubscription>,
) {
  stripeApi.subscriptionsRetrieve.mockResolvedValue(sub);
  return signed({
    id,
    object: "event",
    type,
    livemode: false,
    data: { object: sub },
  });
}

async function run(event: { body: Buffer; signature: string }) {
  const { processStripeWebhook } =
    await import("../../server/lib/stripe/webhook-handler");
  return processStripeWebhook(event.body, event.signature, "req_seat");
}

beforeEach(() => {
  vi.clearAllMocks();
  ledger.seen.clear();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

describe("a guardian seat through the webhook", () => {
  it("W1 a paid seat is recorded, and no entitlement is written", async () => {
    const outcome = await run(
      subscriptionEvent(
        "evt_w1",
        "customer.subscription.created",
        seatSubscription("active"),
      ),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(seatMocks.recordGuardianSeat).toHaveBeenCalledTimes(1);
    expect(seatMocks.recordGuardianSeat).toHaveBeenCalledWith({
      guardianProfileId: GUARDIAN,
      subscriptionId: "sub_seat",
      itemId: "si_seat",
    });
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("W2 the same event twice: the replay is refused and the seat is recorded once", async () => {
    const event = subscriptionEvent(
      "evt_w2",
      "customer.subscription.created",
      seatSubscription("active"),
    );
    expect(await run(event)).toMatchObject({ ok: true });
    expect(await run(event)).toMatchObject({ ok: true });
    expect(seatMocks.recordGuardianSeat).toHaveBeenCalledTimes(1);
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("W3 the subscription ends unclaimed: the seat is cancelled, no entitlement", async () => {
    await run(
      subscriptionEvent(
        "evt_w3",
        "customer.subscription.deleted",
        seatSubscription("canceled"),
      ),
    );
    expect(seatMocks.markGuardianSeatCancelled).toHaveBeenCalledWith(
      "sub_seat",
    );
    expect(seatMocks.recordGuardianSeat).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });

  it("W4 once claimed: exactly one entitlement, for the student, payer the guardian", async () => {
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_profile_id: STUDENT },
    ]);
    // Before the claim: nothing.
    await run(
      subscriptionEvent(
        "evt_w4a",
        "customer.subscription.created",
        seatSubscription("active"),
      ),
    );
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
    // The claim names the student; Stripe sends the update.
    await run(
      subscriptionEvent(
        "evt_w4b",
        "customer.subscription.updated",
        seatSubscription("active", STUDENT),
      ),
    );
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledTimes(1);
    expect(accountMocks.upsertEntitlement).toHaveBeenCalledWith(
      STUDENT,
      expect.objectContaining({
        tier: "premium",
        payer_profile_id: GUARDIAN,
        stripe_subscription_id: "sub_seat",
      }),
    );
  });

  it("W5 a seat that is not yet paid records nothing", async () => {
    await run(
      subscriptionEvent(
        "evt_w5",
        "customer.subscription.created",
        seatSubscription("incomplete"),
      ),
    );
    expect(seatMocks.recordGuardianSeat).not.toHaveBeenCalled();
    expect(seatMocks.markGuardianSeatCancelled).not.toHaveBeenCalled();
    expect(accountMocks.upsertEntitlement).not.toHaveBeenCalled();
  });
});
