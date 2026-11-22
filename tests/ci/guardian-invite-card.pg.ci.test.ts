/**
 * Card on file for a guardian invite, against real Postgres: save a card, the teen joins, the
 * card is charged once; and every way it must not be.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 3, 9; SCL-286;
 *        supabase/migrations/20261207000000_guardian_invite_card.sql] | @implemented [2026-11-22]
 *
 * plain English: the database is real (bootstrapped from supabase/migrations); the invite routes,
 * the /join routes and the Stripe webhook handler are the production code; only Stripe's API and
 * the email transport are stubbed and recorded. Webhook events are signed with Stripe's own
 * helper and go through `processStripeWebhook`, so the idempotency ledger is real too.
 *
 *   Save      SV1-SV5  the setup session (mode, Customer, currency, metadata), the consent row,
 *                      denials (no consent box, a linked guardian, someone else's invite)
 *   Webhook   WH1-WH4  a setup session records the card, creates no subscription and writes no
 *                      entitlement; a replay and a stale session settle; an infrastructure
 *                      failure is retried
 *   Charge    CH1-CH9  save -> claim -> subscription -> entitlement (end to end through the real
 *                      webhook); exactly one subscription for concurrent claims; a decline and
 *                      authentication_required; already funded; no active link, no charge;
 *                      cancelled invite; an interrupted charge retried under the same key;
 *                      an ineligible country
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
import { Client } from "pg";
import Stripe from "stripe";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  pgConnConfig,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  guardianInviteLinkResponseSchema,
  guardianInvitesResponseSchema,
  joinClaimResponseSchema,
} from "../../packages/shared/src/guardian-invite-schema";
import { guardianInviteCardResponseSchema } from "../../packages/shared/src/guardian-invite-card-schema";

const DB_NAME = "guardian_invite_card_ci";
const WEBHOOK_SECRET = "whsec_test_guardian_invite_card";
const GUARDIAN = "c1111111-1111-4111-8111-111111111111";
const GUARDIAN_LINKED = "c2222222-2222-4222-8222-222222222222";
const STUDENT = "d1111111-1111-4111-8111-111111111111";
const STUDENT_B = "d2222222-2222-4222-8222-222222222222";
const PRICES = {
  monthly: "price_monthly_test",
  quarterly: "price_quarterly_test",
  yearly: "price_yearly_test",
} as const;

let pg: Client;
const session = vi.hoisted(() => ({ id: null as string | null }));
const mail = vi.hoisted(() => ({
  sent: [] as { kind: string; inviteId: string; studentProfileId?: string }[],
}));
const stripeApi = vi.hoisted(() => ({
  pricesRetrieve: vi.fn(),
  customersCreate: vi.fn(),
  customersRetrieve: vi.fn(),
  checkoutCreate: vi.fn(),
  setupIntentsRetrieve: vi.fn(),
  subscriptionsCreate: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

vi.mock("../../server/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const StripeSdk = (await import("stripe")).default;
  const real = new StripeSdk("sk_test_guardian_invite_card_placeholder");
  return {
    ...actual,
    getStripeClient: () => ({
      webhooks: real.webhooks,
      prices: { retrieve: stripeApi.pricesRetrieve },
      customers: {
        create: stripeApi.customersCreate,
        retrieve: stripeApi.customersRetrieve,
      },
      checkout: { sessions: { create: stripeApi.checkoutCreate } },
      setupIntents: { retrieve: stripeApi.setupIntentsRetrieve },
      subscriptions: {
        create: stripeApi.subscriptionsCreate,
        list: stripeApi.subscriptionsList,
        retrieve: stripeApi.subscriptionsRetrieve,
      },
    }),
    getExpectedLivemode: () => false,
  };
});

vi.mock("../../server/lib/entitlement-runtime-config", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTier1Countries: vi.fn(async () => ["US", "CA", "GB"]),
}));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (session.id === null) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const r = await pg.query(
        `SELECT id, email, role::text AS role, is_under_13, profile_completed_at
           FROM public.profiles WHERE id = $1`,
        [session.id],
      );
      const p = r.rows[0];
      (req as express.Request & { user?: unknown }).user = {
        id: p.id,
        email: p.email,
        role: p.role,
        isGuardian: p.role === "guardian",
        isAdmin: false,
        is_under_13: p.is_under_13,
        profile_completed_at: p.profile_completed_at
          ? new Date(p.profile_completed_at).toISOString()
          : null,
      };
      next();
    },
  };
});
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_q: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "test-csrf-token",
}));
vi.mock(
  "../../server/lib/notifications/direct-sends",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const ok = { ok: true, value: { providerMessageId: "msg_1" } };
    return {
      ...actual,
      sendGuardianTeenInviteEmail: async () => ok,
      sendGuardianInviteChargedEmail: async (i: { inviteId: string }) => {
        mail.sent.push({ kind: "charged", inviteId: i.inviteId });
        return ok;
      },
      sendGuardianInviteChargeFailedEmail: async (i: {
        inviteId: string;
        studentProfileId: string;
      }) => {
        mail.sent.push({
          kind: "charge_failed",
          inviteId: i.inviteId,
          studentProfileId: i.studentProfileId,
        });
        return ok;
      },
      sendGuardianInviteAlreadyFundedEmail: async (i: { inviteId: string }) => {
        mail.sent.push({ kind: "already_funded", inviteId: i.inviteId });
        return ok;
      },
    };
  },
);
vi.mock("../../server/lib/notifications/dispatch", () => ({
  dispatchQueuedMessages: async () => ({ selected: 0, sent: 0, failed: 0 }),
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function app(): Promise<express.Express> {
  const inviteRoutes = (
    await import("../../server/routes/guardian-invite-routes")
  ).default;
  const joinRoutes = (await import("../../server/routes/join-routes")).default;
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "req-card";
    next();
  });
  a.use("/api/guardian/invites", requireSupabaseAuth, inviteRoutes);
  a.use("/api/join", joinRoutes);
  return a;
}

async function webhook(event: Record<string, unknown>): Promise<{
  ok: boolean;
  status?: string;
}> {
  const { processStripeWebhook } =
    await import("../../server/lib/stripe/webhook-handler");
  const payload = JSON.stringify({
    object: "event",
    livemode: false,
    ...event,
  });
  return (await processStripeWebhook(
    Buffer.from(payload, "utf8"),
    Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
    "req-webhook",
  )) as { ok: boolean; status?: string };
}

/** Start an emailed invite as `guardian`; its id and the token the guardian was handed. */
async function startInvite(
  guardian = GUARDIAN,
): Promise<{ id: string; token: string }> {
  session.id = guardian;
  const res = await request(await app())
    .post("/api/guardian/invites")
    .send({ email: "teen@example.test", acceptParentGuardianTerms: true });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const body = guardianInviteLinkResponseSchema.parse(res.body);
  return {
    id: body.data.invite.id,
    token: body.data.url.split("/join/")[1]!,
  };
}

let sessionSeq = 0;
/** POST /card as the guardian; the setup session id Stripe "created". */
async function openCardPage(
  inviteId: string,
  plan: "monthly" | "quarterly" | "yearly" = "monthly",
  guardian = GUARDIAN,
): Promise<{ res: request.Response; sessionId: string }> {
  sessionSeq += 1;
  const sessionId = `cs_test_setup_${sessionSeq}`;
  stripeApi.checkoutCreate.mockResolvedValueOnce({
    id: sessionId,
    url: `https://checkout.stripe.test/${sessionId}`,
  });
  session.id = guardian;
  const res = await request(await app())
    .post(`/api/guardian/invites/${inviteId}/card`)
    .send({ plan, acceptBillingTerms: true });
  return { res, sessionId };
}

/** The completed setup session, delivered through the real webhook. */
async function completeSetup(input: {
  inviteId: string;
  sessionId: string;
  plan?: string;
  eventId?: string;
  paymentMethod?: string;
}): Promise<{ ok: boolean; status?: string }> {
  stripeApi.setupIntentsRetrieve.mockResolvedValueOnce({
    id: `seti_${input.sessionId}`,
    status: "succeeded",
    payment_method: input.paymentMethod ?? "pm_card_visa_test",
  });
  return webhook({
    id: input.eventId ?? `evt_setup_${input.sessionId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        object: "checkout.session",
        mode: "setup",
        payment_status: "no_payment_required",
        setup_intent: `seti_${input.sessionId}`,
        subscription: null,
        customer: "cus_guardian_1",
        metadata: {
          purpose: "guardian_invite_card",
          invite_id: input.inviteId,
          payer_profile_id: GUARDIAN,
          payer_relationship: "guardian",
          plan: input.plan ?? "monthly",
        },
      },
    },
  });
}

async function claim(student: string, token: string): Promise<string> {
  session.id = student;
  const res = await request(await app())
    .post("/api/join/claim")
    .send({ token });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return joinClaimResponseSchema.parse(res.body).data.outcome;
}

async function invite(id: string): Promise<Record<string, unknown>> {
  return (
    await pg.query(`SELECT * FROM public.guardian_invites WHERE id = $1`, [id])
  ).rows[0];
}

async function entitlementOf(
  student: string,
): Promise<Record<string, unknown> | undefined> {
  return (
    await pg.query(`SELECT * FROM public.entitlements WHERE profile_id = $1`, [
      student,
    ])
  ).rows[0];
}

/** A saved card on a fresh invite: the starting point of every charge case. */
async function savedCard(
  plan: "monthly" | "quarterly" | "yearly" = "monthly",
): Promise<{ id: string; token: string }> {
  const inv = await startInvite();
  const { res, sessionId } = await openCardPage(inv.id, plan);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(
    await completeSetup({ inviteId: inv.id, sessionId, plan }),
  ).toMatchObject({ ok: true });
  expect((await invite(inv.id)).charge_status).toBe("card_saved");
  return inv;
}

function createdSubscription(student: string, plan = "monthly") {
  return {
    id: "sub_invite_1",
    object: "subscription",
    customer: "cus_guardian_1",
    status: "active",
    metadata: {
      payer_profile_id: GUARDIAN,
      student_profile_id: student,
      payer_relationship: "guardian",
      plan,
    },
    items: {
      object: "list",
      data: [
        {
          id: "si_invite_1",
          object: "subscription_item",
          current_period_start: 1_764_000_000,
          current_period_end: 1_766_600_000,
          price: { id: PRICES.monthly },
          metadata: { student_profile_id: student },
        },
      ],
    },
  };
}

describe.skipIf(!PG_AVAILABLE)(
  "guardian invite card on file (real Postgres)",
  () => {
    beforeAll(async () => {
      process.env.PUBLIC_SITE_URL = "https://lyceon.test";
      process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "test-hmac-secret-0123456789";
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      process.env.STRIPE_PRICE_PARENT_MONTHLY = PRICES.monthly;
      process.env.STRIPE_PRICE_PARENT_QUARTERLY = PRICES.quarterly;
      process.env.STRIPE_PRICE_PARENT_YEARLY = PRICES.yearly;
      pg = await bootstrapPgDatabase(DB_NAME);
      const people: [string, string, string, string][] = [
        [GUARDIAN, "guardian", "1980-01-01", "Robin Smith"],
        [GUARDIAN_LINKED, "guardian", "1981-01-01", "Sam Lee"],
        [STUDENT, "student", "2009-01-01", "Ari"],
        [STUDENT_B, "student", "2009-02-01", "Bo"],
      ];
      for (const [id, role, dob, name] of people) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
         VALUES ($1, $2, $3, $4, $5::date, now())`,
          [id, `${id}@example.test`, role, name, dob],
        );
      }
    }, 240_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      // clearAllMocks keeps queued *Once values: a case that queues a session it never uses
      // would hand it to the next case. Reset every Stripe stub outright.
      for (const fn of Object.values(stripeApi)) fn.mockReset();
      session.id = null;
      mail.sent.length = 0;
      for (const t of [
        "guardian_invites",
        "guardian_links",
        "entitlements",
        "rate_limit_ledger",
        "notification_events",
        "legal_acceptances",
        "stripe_webhook_events",
      ]) {
        await pg.query(`DELETE FROM public.${t}`);
      }
      await pg.query(`UPDATE public.profiles SET stripe_customer_id = NULL`);
      // Seed the linked guardian's existing link (SV4).
      await pg.query(
        `INSERT INTO public.guardian_links
         (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at,
          accepted_at, accepted_by_profile_id)
       VALUES ($1, $2, 'active', 'student', now(), now(), $2)`,
        [GUARDIAN_LINKED, STUDENT_B],
      );
      stripeApi.pricesRetrieve.mockImplementation(async (id: string) => ({
        id,
        currency: "usd",
        unit_amount: 2999,
        recurring: { interval: "month", interval_count: 1 },
      }));
      stripeApi.customersCreate.mockResolvedValue({ id: "cus_guardian_1" });
      stripeApi.customersRetrieve.mockResolvedValue({
        id: "cus_guardian_1",
        address: { country: "US" },
      });
      stripeApi.subscriptionsList.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
      });
    });

    // ---------------------------------------------------------------- Save --

    it("SV1 a setup-mode Checkout on the guardian's own Customer, in the plan's currency, naming the invite", async () => {
      const inv = await startInvite();
      const { res, sessionId } = await openCardPage(inv.id, "yearly");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        guardianInviteCardResponseSchema.parse(res.body).data.url,
      ).toContain(sessionId);
      expect(stripeApi.checkoutCreate).toHaveBeenCalledTimes(1);
      const [params] = stripeApi.checkoutCreate.mock.calls[0]!;
      expect(params).toMatchObject({
        mode: "setup",
        customer: "cus_guardian_1",
        currency: "usd",
        customer_update: { address: "auto" },
        metadata: {
          purpose: "guardian_invite_card",
          invite_id: inv.id,
          payer_profile_id: GUARDIAN,
          plan: "yearly",
        },
      });
      // Setup mode: no line items, no subscription data, nothing to charge.
      expect(params).not.toHaveProperty("line_items");
      expect(params).not.toHaveProperty("subscription_data");
      expect(stripeApi.pricesRetrieve).toHaveBeenCalledWith(PRICES.yearly);
      expect(stripeApi.subscriptionsCreate).not.toHaveBeenCalled();
      const row = await invite(inv.id);
      expect(row).toMatchObject({
        charge_status: "card_pending",
        card_plan: "yearly",
        card_setup_session_id: sessionId,
      });
      // The guardian's card view shows the pending card.
      session.id = GUARDIAN;
      const list = guardianInvitesResponseSchema.parse(
        (await request(await app()).get("/api/guardian/invites")).body,
      );
      expect(list.data.invites[0]?.card).toEqual({
        plan: "yearly",
        status: "pending",
      });
    });

    it("SV2 the Billing Terms acceptance is recorded before the card page opens", async () => {
      const inv = await startInvite();
      await openCardPage(inv.id);
      const r = await pg.query(
        `SELECT doc_key, consent_source, actor_type, source_reference
         FROM public.legal_acceptances WHERE user_id = $1 AND consent_source = 'guardian_invite_card'`,
        [GUARDIAN],
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({
        doc_key: "billing_terms",
        actor_type: "parent",
        source_reference: inv.id,
      });
    });

    it("SV3 no consent box, no card page", async () => {
      const inv = await startInvite();
      session.id = GUARDIAN;
      const res = await request(await app())
        .post(`/api/guardian/invites/${inv.id}/card`)
        .send({ plan: "monthly" });
      expect(res.status).toBe(400);
      expect(stripeApi.checkoutCreate).not.toHaveBeenCalled();
    });

    it("SV4 a guardian with an active link pays through today's checkout, not here", async () => {
      const inv = await startInvite(GUARDIAN_LINKED);
      const { res } = await openCardPage(inv.id, "monthly", GUARDIAN_LINKED);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("GUARDIAN_HAS_LINKED_STUDENT");
      expect(stripeApi.checkoutCreate).not.toHaveBeenCalled();
      expect(stripeApi.customersCreate).not.toHaveBeenCalled();
    });

    it("SV5 another guardian's invite is not found, and nothing is opened or recorded", async () => {
      const inv = await startInvite();
      const { res } = await openCardPage(inv.id, "monthly", GUARDIAN_LINKED);
      expect(res.status).toBe(404);
      expect(stripeApi.checkoutCreate).not.toHaveBeenCalled();
      const r = await pg.query(
        `SELECT 1 FROM public.legal_acceptances WHERE consent_source = 'guardian_invite_card'`,
      );
      expect(r.rowCount).toBe(0);
    });

    // ------------------------------------------------------------- Webhook --

    it("WH1 a completed setup session records the card, and creates no subscription and no entitlement", async () => {
      const inv = await startInvite();
      const { sessionId } = await openCardPage(inv.id, "quarterly");
      const outcome = await completeSetup({
        inviteId: inv.id,
        sessionId,
        plan: "quarterly",
      });
      expect(outcome).toMatchObject({ ok: true, status: "processed" });
      expect(await invite(inv.id)).toMatchObject({
        charge_status: "card_saved",
        card_plan: "quarterly",
        card_payment_method_id: "pm_card_visa_test",
      });
      expect(stripeApi.subscriptionsCreate).not.toHaveBeenCalled();
      expect(stripeApi.subscriptionsRetrieve).not.toHaveBeenCalled();
      const ent = await pg.query(`SELECT 1 FROM public.entitlements`);
      expect(ent.rowCount).toBe(0);
    });

    it("WH2 a replayed setup event settles without a retry and changes nothing", async () => {
      const inv = await startInvite();
      const { sessionId } = await openCardPage(inv.id);
      await completeSetup({ inviteId: inv.id, sessionId, eventId: "evt_a" });
      const before = await invite(inv.id);
      // A redelivery of the same event is the ledger's; a NEW event for the same session (Stripe
      // can emit more than one) reaches the SQL function, which answers already_recorded.
      expect(
        await completeSetup({ inviteId: inv.id, sessionId, eventId: "evt_a" }),
      ).toMatchObject({ ok: true });
      expect(
        await completeSetup({ inviteId: inv.id, sessionId, eventId: "evt_b" }),
      ).toMatchObject({ ok: true, status: "processed" });
      expect((await invite(inv.id)).card_saved_at).toEqual(
        before.card_saved_at,
      );
    });

    it("WH3 a stale session (an older tab) or a cancelled invite settles and records nothing", async () => {
      const inv = await startInvite();
      const first = await openCardPage(inv.id, "monthly");
      await openCardPage(inv.id, "yearly");
      expect(
        await completeSetup({ inviteId: inv.id, sessionId: first.sessionId }),
      ).toMatchObject({ ok: true, status: "processed" });
      expect((await invite(inv.id)).charge_status).toBe("card_pending");

      const inv2 = await startInvite();
      const s2 = await openCardPage(inv2.id);
      session.id = GUARDIAN;
      await request(await app()).delete(`/api/guardian/invites/${inv2.id}`);
      expect(
        await completeSetup({ inviteId: inv2.id, sessionId: s2.sessionId }),
      ).toMatchObject({ ok: true, status: "processed" });
      expect((await invite(inv2.id)).card_payment_method_id).toBeNull();
    });

    it("WH4 a Stripe failure reading the SetupIntent is NOT swallowed: the event is retried", async () => {
      const inv = await startInvite();
      const { sessionId } = await openCardPage(inv.id);
      stripeApi.setupIntentsRetrieve.mockRejectedValueOnce(
        new Error("stripe unreachable"),
      );
      const { processStripeWebhook } =
        await import("../../server/lib/stripe/webhook-handler");
      const payload = JSON.stringify({
        id: "evt_setup_down",
        object: "event",
        livemode: false,
        type: "checkout.session.completed",
        data: {
          object: {
            id: sessionId,
            object: "checkout.session",
            mode: "setup",
            payment_status: "no_payment_required",
            setup_intent: "seti_down",
            metadata: {
              purpose: "guardian_invite_card",
              invite_id: inv.id,
              payer_profile_id: GUARDIAN,
              plan: "monthly",
            },
          },
        },
      });
      // The handler releases the event's ledger claim and rethrows; the route answers 500 and
      // Stripe redelivers. A lost card must never be acknowledged.
      await expect(
        processStripeWebhook(
          Buffer.from(payload),
          Stripe.webhooks.generateTestHeaderString({
            payload,
            secret: WEBHOOK_SECRET,
          }),
          "req",
        ),
      ).rejects.toThrow("stripe unreachable");
      expect((await invite(inv.id)).charge_status).toBe("card_pending");
      // The retry succeeds.
      expect(
        await completeSetup({
          inviteId: inv.id,
          sessionId,
          eventId: "evt_setup_down",
        }),
      ).toMatchObject({ ok: true });
      expect((await invite(inv.id)).charge_status).toBe("card_saved");
    });

    // -------------------------------------------------------------- Charge --

    it("CH1 save card -> claim -> one off-session subscription -> the webhook writes the student's entitlement", async () => {
      const inv = await savedCard("monthly");
      stripeApi.subscriptionsCreate.mockResolvedValueOnce(
        createdSubscription(STUDENT),
      );
      expect(await claim(STUDENT, inv.token)).toBe("claimed");

      expect(stripeApi.subscriptionsCreate).toHaveBeenCalledTimes(1);
      const [params, options] = stripeApi.subscriptionsCreate.mock.calls[0]!;
      expect(params).toEqual({
        customer: "cus_guardian_1",
        items: [
          {
            price: PRICES.monthly,
            quantity: 1,
            metadata: { student_profile_id: STUDENT },
          },
        ],
        default_payment_method: "pm_card_visa_test",
        off_session: true,
        payment_behavior: "error_if_incomplete",
        metadata: {
          payer_profile_id: GUARDIAN,
          student_profile_id: STUDENT,
          payer_relationship: "guardian",
          plan: "monthly",
        },
      });
      expect(options).toEqual({
        idempotencyKey: `guardian-invite-charge:${inv.id}`,
      });
      expect(await invite(inv.id)).toMatchObject({
        status: "claimed",
        charge_status: "charged",
        stripe_subscription_id: "sub_invite_1",
      });
      expect(mail.sent).toEqual([{ kind: "charged", inviteId: inv.id }]);
      // The guardian never holds an entitlement, and the charge itself wrote none.
      expect(await entitlementOf(GUARDIAN)).toBeUndefined();
      expect(await entitlementOf(STUDENT)).toBeUndefined();

      // The existing webhook path, unchanged, writes the student's entitlement.
      stripeApi.subscriptionsRetrieve.mockResolvedValue(
        createdSubscription(STUDENT),
      );
      expect(
        await webhook({
          id: "evt_sub_created",
          type: "customer.subscription.created",
          data: { object: createdSubscription(STUDENT) },
        }),
      ).toMatchObject({ ok: true, status: "processed" });
      expect(await entitlementOf(STUDENT)).toMatchObject({
        tier: "premium",
        stripe_subscription_id: "sub_invite_1",
      });
      expect(await entitlementOf(GUARDIAN)).toBeUndefined();
    });

    it("CH2 two concurrent claims make exactly one subscription", async () => {
      const inv = await savedCard();
      stripeApi.subscriptionsCreate.mockResolvedValue(
        createdSubscription(STUDENT),
      );
      const outcomes = await Promise.all([
        claim(STUDENT, inv.token),
        claim(STUDENT, inv.token),
      ]);
      expect(outcomes).toEqual(["claimed", "claimed"]);
      expect(stripeApi.subscriptionsCreate).toHaveBeenCalledTimes(1);
    });

    it("CH2b the guard itself, raced on two real connections: exactly one begins", async () => {
      const inv = await savedCard();
      // Claim without the route's charge, so the race is on the SQL guard alone.
      const { hashGuardianInviteToken } =
        await import("../../server/lib/guardian-invites");
      await pg.query(
        `SELECT public.claim_guardian_invite_audited($1, $2, NULL)`,
        [hashGuardianInviteToken(inv.token), STUDENT],
      );
      const a = new Client(pgConnConfig(DB_NAME));
      const b = new Client(pgConnConfig(DB_NAME));
      await a.connect();
      await b.connect();
      try {
        const results = await Promise.all(
          [a, b].map(async (c) => {
            const r = await c.query(
              `SELECT public.begin_guardian_invite_charge_audited($1, $2, NULL) AS r`,
              [inv.id, STUDENT],
            );
            return (r.rows[0].r as { outcome: string }).outcome;
          }),
        );
        expect(results.sort()).toEqual(["begin", "no_card"]);
      } finally {
        await a.end();
        await b.end();
      }
    });

    it.each([
      ["card_declined", "CH3 a declined card"],
      ["authentication_required", "CH4 the bank asks to confirm"],
    ])(
      "%s — %s: the link stays, nothing is charged, the guardian is emailed today's checkout",
      async (code) => {
        const inv = await savedCard();
        stripeApi.subscriptionsCreate.mockRejectedValueOnce(
          Object.assign(new Error("Your card was declined."), {
            type: "StripeCardError",
            statusCode: 402,
            code,
          }),
        );
        expect(await claim(STUDENT, inv.token)).toBe("claimed");
        expect(await invite(inv.id)).toMatchObject({
          status: "claimed",
          charge_status: "payment_failed",
          charge_failure_code: code,
          stripe_subscription_id: null,
        });
        const links = await pg.query(
          `SELECT status FROM public.guardian_links WHERE guardian_profile_id = $1 AND student_profile_id = $2`,
          [GUARDIAN, STUDENT],
        );
        expect(links.rows).toEqual([{ status: "active" }]);
        expect(mail.sent).toEqual([
          {
            kind: "charge_failed",
            inviteId: inv.id,
            studentProfileId: STUDENT,
          },
        ]);
        expect(await entitlementOf(STUDENT)).toBeUndefined();
        // A later retry of the claim charges nothing again.
        expect(await claim(STUDENT, inv.token)).toBe("claimed");
        expect(stripeApi.subscriptionsCreate).toHaveBeenCalledTimes(1);
      },
    );

    it("CH5 the teen is already funded: no charge, the guardian is told", async () => {
      const inv = await savedCard();
      stripeApi.subscriptionsList.mockResolvedValue({
        object: "list",
        has_more: false,
        data: [
          {
            id: "sub_existing",
            status: "active",
            metadata: { student_profile_id: STUDENT },
          },
        ],
      });
      expect(await claim(STUDENT, inv.token)).toBe("claimed");
      expect(stripeApi.subscriptionsCreate).not.toHaveBeenCalled();
      expect((await invite(inv.id)).charge_status).toBe("already_funded");
      expect(mail.sent).toEqual([{ kind: "already_funded", inviteId: inv.id }]);
    });

    it("CH6 no active link, no charge: the guard refuses even a claimed invite with a saved card", async () => {
      const inv = await savedCard();
      const { hashGuardianInviteToken } =
        await import("../../server/lib/guardian-invites");
      await pg.query(
        `SELECT public.claim_guardian_invite_audited($1, $2, NULL)`,
        [hashGuardianInviteToken(inv.token), STUDENT],
      );
      // The link is revoked before the charge begins.
      await pg.query(
        `UPDATE public.guardian_links SET status = 'revoked', revoked_at = now()
        WHERE guardian_profile_id = $1 AND student_profile_id = $2`,
        [GUARDIAN, STUDENT],
      );
      const { chargeGuardianInviteOnClaim } =
        await import("../../server/lib/guardian-invite-card");
      expect(
        await chargeGuardianInviteOnClaim({
          inviteId: inv.id,
          studentProfileId: STUDENT,
        }),
      ).toBe("no_active_link");
      expect(stripeApi.subscriptionsCreate).not.toHaveBeenCalled();
      expect((await invite(inv.id)).charge_status).toBe("card_saved");
      // And another student can never be charged for: the claimant is checked too.
      expect(
        await chargeGuardianInviteOnClaim({
          inviteId: inv.id,
          studentProfileId: STUDENT_B,
        }),
      ).toBe("not_claimed");
      expect(stripeApi.subscriptionsCreate).not.toHaveBeenCalled();
    });

    it("CH7 a cancelled invite with a card is never charged, and the card is left on the Customer", async () => {
      const inv = await savedCard();
      session.id = GUARDIAN;
      await request(await app()).delete(`/api/guardian/invites/${inv.id}`);
      expect(await claim(STUDENT, inv.token)).toBe("cancelled");
      expect(stripeApi.subscriptionsCreate).not.toHaveBeenCalled();
      expect(await invite(inv.id)).toMatchObject({
        status: "cancelled",
        charge_status: "card_saved",
      });
    });

    it("CH8 an interrupted charge is released and retried under the SAME idempotency key", async () => {
      const inv = await savedCard();
      stripeApi.subscriptionsCreate
        .mockRejectedValueOnce(
          Object.assign(new Error("connection reset"), {
            type: "StripeConnectionError",
          }),
        )
        .mockResolvedValueOnce(createdSubscription(STUDENT));
      expect(await claim(STUDENT, inv.token)).toBe("claimed");
      expect((await invite(inv.id)).charge_status).toBe("card_saved");
      expect(mail.sent).toEqual([]);
      expect(await claim(STUDENT, inv.token)).toBe("claimed");
      expect((await invite(inv.id)).charge_status).toBe("charged");
      const keys = stripeApi.subscriptionsCreate.mock.calls.map(
        (c) => (c[1] as { idempotencyKey: string }).idempotencyKey,
      );
      expect(keys).toEqual([
        `guardian-invite-charge:${inv.id}`,
        `guardian-invite-charge:${inv.id}`,
      ]);
    });

    it("CH9 an ineligible billing country is not charged", async () => {
      const inv = await savedCard();
      stripeApi.customersRetrieve.mockResolvedValue({
        id: "cus_guardian_1",
        address: { country: "FR" },
      });
      expect(await claim(STUDENT, inv.token)).toBe("claimed");
      expect(stripeApi.subscriptionsCreate).not.toHaveBeenCalled();
      expect(await invite(inv.id)).toMatchObject({
        charge_status: "not_charged",
        charge_failure_code: "country_ineligible",
      });
    });
  },
);
