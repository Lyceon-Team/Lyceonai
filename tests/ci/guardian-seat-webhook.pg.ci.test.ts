/**
 * A seat bought before any student is linked, through the REAL webhook handler (real signature
 * verification) against REAL Postgres: recorded once, never an entitlement before it is claimed,
 * exactly one after.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §1, §6 ("Webhook replay: seat recorded once, no entitlement before claim, exactly one
 *        after"); 20261205000000_guardian_seats.sql] | @implemented [2026-11-19]
 *
 * plain English: Stripe is the only thing substituted (its API calls, never its signature
 * check), plus the email and analytics transports. The event ledger, the seat writes, the link
 * and the entitlement writer are the production code over a database built from
 * supabase/migrations, and every assertion reads rows back from it — so a replay is refused by
 * the ledger's real primary key, and "exactly one entitlement" is a count of real rows.
 * (guardian-schema-truth-gate: a guardian test may not mock the query layer.)
 *   W1  a paid seat subscription: the seat row exists, unassigned; no entitlement row
 *   W2  the same event delivered twice: one ledger row, one seat row
 *   W3  the subscription ends with the seat unclaimed: the seat is cancelled; no entitlement
 *   W4  once claimed (the item names the student, who is linked): exactly one entitlement row
 *   W5  a seat that is not yet paid (incomplete): no seat row, no entitlement row
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import Stripe from "stripe";
import type { Client } from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "guardian_seat_webhook_ci";
const WEBHOOK_SECRET = "whsec_test_guardian_seat";
const GUARDIAN = "e6666666-6666-4666-8666-666666666666";
const STUDENT = "e7777777-7777-4777-8777-777777777777";

let pg: Client;

const stripeApi = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
}));

vi.mock("../../server/lib/stripe/client", async () => {
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_seat_placeholder");
  return {
    getStripeClient: () => ({
      webhooks: real.webhooks,
      customers: {
        retrieve: async () => ({ id: "cus_seat", address: { country: "US" } }),
      },
      subscriptions: { retrieve: stripeApi.subscriptionsRetrieve },
    }),
    getExpectedLivemode: () => false,
  };
});
// The seam, not a substitute: a real pg.Client is behind it.
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: async () => ["US"],
}));
// Transports: lifecycle email and product analytics.
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
      object: "list",
      data: [
        {
          id: "si_seat",
          object: "subscription_item",
          price: { id: "price_monthly" },
          metadata: student ? { student_profile_id: student } : {},
          current_period_start: 1_780_000_000,
          current_period_end: 1_782_600_000,
        },
      ],
    },
  };
}

function signedEvent(
  id: string,
  type: string,
  sub: ReturnType<typeof seatSubscription>,
): { body: Buffer; signature: string } {
  stripeApi.subscriptionsRetrieve.mockResolvedValue(sub);
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    livemode: false,
    data: { object: sub },
  });
  return {
    body: Buffer.from(payload, "utf8"),
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

async function run(event: { body: Buffer; signature: string }) {
  const { processStripeWebhook } =
    await import("../../server/lib/stripe/webhook-handler");
  return processStripeWebhook(event.body, event.signature, "req_seat");
}

async function seats(): Promise<
  { status: string; student: string | null; item: string | null }[]
> {
  const r = await pg.query(
    `SELECT status, student_profile_id AS student, stripe_subscription_item_id AS item
       FROM public.guardian_seats WHERE stripe_subscription_id = 'sub_seat'`,
  );
  return r.rows;
}

async function seatEntitlements(): Promise<
  { profile: string; tier: string; payer: string | null }[]
> {
  const r = await pg.query(
    `SELECT profile_id AS profile, tier, payer_profile_id AS payer
       FROM public.entitlements WHERE stripe_subscription_id = 'sub_seat'`,
  );
  return r.rows;
}

describe.skipIf(!PG_AVAILABLE)(
  "a guardian seat through the webhook (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, role, dob] of [
        [GUARDIAN, "guardian", "1980-01-01"],
        [STUDENT, "student", "2009-01-01"],
      ] as const) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
           VALUES ($1, $2, $3, 'Pat', $4::date, now())`,
          [id, `${id}@example.test`, role, dob],
        );
      }
    }, 240_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      await pg.query(`DELETE FROM public.entitlements`);
      await pg.query(`DELETE FROM public.guardian_seats`);
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.stripe_webhook_events`);
    });

    it("W1 a paid seat is recorded, and no entitlement is written", async () => {
      const outcome = await run(
        signedEvent(
          "evt_w1",
          "customer.subscription.created",
          seatSubscription("active"),
        ),
      );
      expect(outcome).toMatchObject({ ok: true });
      expect(await seats()).toEqual([
        { status: "unassigned", student: null, item: "si_seat" },
      ]);
      expect(await seatEntitlements()).toEqual([]);
    });

    it("W2 the same event twice: the replay is refused and the seat is recorded once", async () => {
      const event = signedEvent(
        "evt_w2",
        "customer.subscription.created",
        seatSubscription("active"),
      );
      expect(await run(event)).toMatchObject({ ok: true });
      expect(await run(event)).toMatchObject({ ok: true });
      const ledger = await pg.query(
        `SELECT count(*)::int AS n FROM public.stripe_webhook_events WHERE id = 'evt_w2'`,
      );
      expect(ledger.rows[0].n).toBe(1);
      expect(await seats()).toHaveLength(1);
      expect(await seatEntitlements()).toEqual([]);
    });

    it("W3 the subscription ends unclaimed: the seat is cancelled, no entitlement", async () => {
      await run(
        signedEvent(
          "evt_w3a",
          "customer.subscription.created",
          seatSubscription("active"),
        ),
      );
      await run(
        signedEvent(
          "evt_w3b",
          "customer.subscription.deleted",
          seatSubscription("canceled"),
        ),
      );
      expect(await seats()).toEqual([
        { status: "cancelled", student: null, item: "si_seat" },
      ]);
      expect(await seatEntitlements()).toEqual([]);
    });

    it("W4 once claimed: exactly one entitlement, for the student, payer the guardian", async () => {
      // Before the claim: nothing.
      await run(
        signedEvent(
          "evt_w4a",
          "customer.subscription.created",
          seatSubscription("active"),
        ),
      );
      expect(await seatEntitlements()).toEqual([]);
      // The claim links the pair and names the student on Stripe; Stripe sends the update.
      await pg.query(
        `SELECT public.create_active_guardian_link_audited($1, $2, 'req_w4')`,
        [GUARDIAN, STUDENT],
      );
      await run(
        signedEvent(
          "evt_w4b",
          "customer.subscription.updated",
          seatSubscription("active", STUDENT),
        ),
      );
      expect(await seatEntitlements()).toEqual([
        { profile: STUDENT, tier: "premium", payer: GUARDIAN },
      ]);
    });

    it("W5 a seat that is not yet paid records nothing", async () => {
      await run(
        signedEvent(
          "evt_w5",
          "customer.subscription.created",
          seatSubscription("incomplete"),
        ),
      );
      expect(await seats()).toEqual([]);
      expect(await seatEntitlements()).toEqual([]);
    });
  },
);
