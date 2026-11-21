/**
 * Parent paid seats against real Postgres: the seat checkout, the invite routes, /join and the
 * claim, through the real migration pipeline, the real routes and the real SQL functions.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §1-§2, §6; supabase/migrations/20261205000000_guardian_seats.sql] | @implemented
 *        [2026-11-19]
 *
 * plain English: the database is real (bootstrapped from supabase/migrations); the routes are
 * the production routers; Stripe, the email transport and the post-claim Stripe step are
 * recorded instead of called (the post-claim step and the webhook are proved in
 * guardian-seat-webhook.pg.ci.test.ts). Every token assertion is made against the token the
 * guardian was actually handed.
 *
 *   Checkout   CK1-CK6  seat mode: refusals before Stripe, the session shape, consent recorded
 *   Invites    IN1-IN5  send / resend / copy / cancel, ownership, the hash is all that is stored
 *   Tokens     TK1-TK2  expired, cancelled, used, unknown, malformed: one answer; never logged
 *   Claim      CL1-CL6  the link + seat in one transaction, idempotent, refusals, already-paid
 *   Limits     RL1-RL2  3 a day per (guardian, address), 10 a day per guardian
 *   Database   DB1-DB5  record once, cancel, link-code path unchanged, privileges, consent CHECK
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
import { createHash } from "node:crypto";
import type { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "guardian_seats_ci";
const GUARDIAN = "c1111111-1111-4111-8111-111111111111";
const GUARDIAN_B = "c2222222-2222-4222-8222-222222222222";
const GUARDIAN_YOUNG = "c3333333-3333-4333-8333-333333333333";
const GUARDIAN_NO_DOB = "c4444444-4444-4444-8444-444444444444";
const STUDENT = "d1111111-1111-4111-8111-111111111111";
const STUDENT_B = "d2222222-2222-4222-8222-222222222222";
const STUDENT_PAID = "d3333333-3333-4333-8333-333333333333";
const STUDENT_KID = "d4444444-4444-4444-8444-444444444444";
const STUDENT_NEW = "d5555555-5555-4555-8555-555555555555";

let pg: Client;
/** When the current case began; audit rows are read from here on. */
let testStart: Date = new Date(0);
const session = vi.hoisted(() => ({ id: null as string | null }));
const sent = vi.hoisted(() => ({
  emails: [] as { token: string; toEmail: string; seatId: string }[],
  ok: true,
}));
const attach = vi.hoisted(() => ({ calls: [] as unknown[] }));
const logs = vi.hoisted(() => ({ lines: [] as string[] }));
const stripeMocks = vi.hoisted(() => ({
  checkoutCreate: vi.fn(async () => ({
    id: "cs_seat",
    url: "https://checkout.stripe.test/cs_seat",
  })),
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
        isAdmin: p.role === "admin",
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
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    sendGuardianSeatInviteEmail: async (input: {
      token: string;
      toEmail: string;
      seatId: string;
    }) => {
      sent.emails.push({
        token: input.token,
        toEmail: input.toEmail,
        seatId: input.seatId,
      });
      return sent.ok
        ? { ok: true, value: { providerMessageId: "msg_1" } }
        : { ok: false, error: { kind: "provider_error", message: "down" } };
    },
  }),
);
vi.mock("../../server/lib/stripe/guardian-seat-attach", () => ({
  attachGuardianSeatStudent: async (input: unknown) => {
    attach.calls.push(input);
  },
}));
vi.mock("../../server/lib/notifications/dispatch", () => ({
  dispatchQueuedMessages: async () => ({ selected: 0, sent: 0, failed: 0 }),
}));
vi.mock("../../server/lib/entitlement-runtime-config", () => ({
  getTier1Countries: async () => ["US"],
}));
vi.mock("../../server/lib/stripe/client", () => ({
  BILLING_PERIODS: ["monthly", "quarterly", "yearly"],
  getStripeClient: () => ({
    customers: {
      create: async () => ({ id: "cus_seat" }),
      retrieve: async () => ({ id: "cus_seat", address: { country: "US" } }),
    },
    subscriptions: {
      list: async () => ({ object: "list", data: [], has_more: false }),
    },
    checkout: { sessions: { create: stripeMocks.checkoutCreate } },
    promotionCodes: { list: async () => ({ object: "list", data: [] }) },
    billingPortal: { sessions: { create: vi.fn() } },
  }),
  getStripePublishableKey: () => "pk_test_123",
  getPriceId: (p: string) => `price_${p}`,
  getConfiguredPriceId: (p: string) => `price_${p}`,
}));
vi.mock("../../server/logger", () => {
  const record =
    () =>
    (...args: unknown[]): void => {
      logs.lines.push(JSON.stringify(args));
    };
  return {
    logger: {
      info: record(),
      warn: record(),
      error: record(),
      debug: record(),
    },
  };
});

async function app(): Promise<express.Express> {
  const guardianSeatRoutes = (
    await import("../../server/routes/guardian-seat-routes")
  ).default;
  const seatJoinRoutes = (await import("../../server/routes/seat-join-routes"))
    .default;
  const billingRoutes = (await import("../../server/routes/billing-routes"))
    .default;
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "req-seat";
    next();
  });
  a.use("/api/guardian/seats", requireSupabaseAuth, guardianSeatRoutes);
  a.use("/api/join", seatJoinRoutes);
  a.use("/api/billing", billingRoutes);
  return a;
}

function sha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A paid, unassigned seat for `guardian`, recorded as the webhook does. */
async function seatFor(guardian: string, sub = "sub_1"): Promise<string> {
  const r = await pg.query(
    `SELECT (public.guardian_seat_record($1, $2, 'si_1')).id AS id`,
    [guardian, sub],
  );
  return r.rows[0].id as string;
}

/** Issue an invite as the guardian and return the token the guardian was handed. */
async function inviteToken(
  guardian: string,
  seatId: string,
  email = "teen@example.test",
): Promise<string> {
  session.id = guardian;
  const res = await request(await app())
    .post(`/api/guardian/seats/${seatId}/invite`)
    .send({ email });
  expect(res.status).toBe(200);
  const last = sent.emails.at(-1);
  expect(last).toBeDefined();
  return last!.token;
}

async function links(): Promise<
  { guardian: string; student: string; initiated_by: string }[]
> {
  const r = await pg.query(
    `SELECT guardian_profile_id AS guardian, student_profile_id AS student, initiated_by
       FROM public.guardian_links WHERE status = 'active'`,
  );
  return r.rows;
}

async function seatRow(seatId: string): Promise<Record<string, unknown>> {
  const r = await pg.query(
    `SELECT * FROM public.guardian_seats WHERE id = $1`,
    [seatId],
  );
  return r.rows[0];
}

describe.skipIf(!PG_AVAILABLE)("guardian paid seats (real Postgres)", () => {
  beforeAll(async () => {
    process.env.PUBLIC_SITE_URL = "https://lyceon.test";
    pg = await bootstrapPgDatabase(DB_NAME);
    const people: [string, string, string | null][] = [
      [GUARDIAN, "guardian", "1980-01-01"],
      [GUARDIAN_B, "guardian", "1981-01-01"],
      [GUARDIAN_YOUNG, "guardian", "2012-01-01"],
      [GUARDIAN_NO_DOB, "guardian", null],
      [STUDENT, "student", "2009-01-01"],
      [STUDENT_B, "student", "2009-02-01"],
      [STUDENT_PAID, "student", "2009-03-01"],
      [STUDENT_KID, "student", "2016-01-01"],
      [STUDENT_NEW, "student", "2009-04-01"],
    ];
    for (const [id, role, dob] of people) {
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        id,
        `${id}@example.test`,
      ]);
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
         VALUES ($1::uuid, $2, $3, 'Pat', $4::date, CASE WHEN $1::uuid = $5::uuid THEN NULL ELSE now() END)`,
        [id, `${id}@example.test`, role, dob, STUDENT_NEW],
      );
    }
    await pg.query(
      `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
      [STUDENT_PAID],
    );
  }, 240_000);

  afterAll(async () => {
    await pg?.end();
  });

  beforeEach(async () => {
    session.id = null;
    sent.emails.length = 0;
    sent.ok = true;
    attach.calls.length = 0;
    logs.lines.length = 0;
    stripeMocks.checkoutCreate.mockClear();
    await pg.query(`DELETE FROM public.guardian_links`);
    await pg.query(`DELETE FROM public.guardian_seats`);
    await pg.query(`DELETE FROM public.rate_limit_ledger`);
    await pg.query(`DELETE FROM public.notification_events`);
    // audit_logs is append-only: each case reads only the rows written since it began.
    testStart = (await pg.query(`SELECT clock_timestamp() AS t`)).rows[0]
      .t as Date;
  });

  // ------------------------------------------------------------------------------------------
  describe("checkout in seat mode", () => {
    const seatCheckout = async (
      who: string,
      body: Record<string, unknown> = {
        plan: "monthly",
        seat: true,
        accept_parent_guardian_terms: true,
      },
    ) => {
      session.id = who;
      return request(await app())
        .post("/api/billing/checkout")
        .send(body);
    };

    it("CK1 a guardian with no linked student gets one seat session: no student anywhere on it", async () => {
      const res = await seatCheckout(GUARDIAN);
      expect(res.status).toBe(200);
      expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);
      const params = stripeMocks.checkoutCreate.mock.calls[0]?.[0] as {
        metadata: Record<string, string>;
        subscription_data: { metadata: Record<string, string> };
        line_items: { metadata?: Record<string, string> }[];
        client_reference_id?: string;
      };
      expect(params.metadata).toEqual({
        payer_profile_id: GUARDIAN,
        payer_relationship: "guardian",
        purchase_kind: "guardian_seat",
        plan: "monthly",
      });
      expect(params.subscription_data.metadata).toEqual(params.metadata);
      expect(params.line_items).toHaveLength(1);
      expect(params.line_items[0]?.metadata).toBeUndefined();
      expect(params.client_reference_id).toBeUndefined();
    });

    it("CK2 the Parent/Guardian Terms acceptance is recorded at seat checkout", async () => {
      await seatCheckout(GUARDIAN);
      const r = await pg.query(
        `SELECT consent_source, actor_type FROM public.legal_acceptances WHERE user_id = $1`,
        [GUARDIAN],
      );
      expect(r.rows).toContainEqual({
        consent_source: "guardian_seat_checkout",
        actor_type: "parent",
      });
    });

    it("CK3 refusals before any Stripe object: no terms, a named student, a student caller", async () => {
      expect(
        (await seatCheckout(GUARDIAN, { plan: "monthly", seat: true })).body
          .error.code,
      ).toBe("PARENT_TERMS_REQUIRED");
      expect(
        (
          await seatCheckout(GUARDIAN, {
            plan: "monthly",
            seat: true,
            accept_parent_guardian_terms: true,
            student_profile_id: STUDENT,
          })
        ).body.error.code,
      ).toBe("SEAT_CANNOT_NAME_STUDENT");
      expect((await seatCheckout(STUDENT)).body.error.code).toBe(
        "SEAT_GUARDIAN_ONLY",
      );
      expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    });

    it("CK4 the 18+ rule: under 18 and no date of birth are refused, as at link redeem", async () => {
      const young = await seatCheckout(GUARDIAN_YOUNG);
      expect(young.status).toBe(403);
      expect(young.body.error.code).toBe("GUARDIAN_UNDER_18");
      const noDob = await seatCheckout(GUARDIAN_NO_DOB);
      expect(noDob.status).toBe(403);
      expect(noDob.body.error.code).toBe("GUARDIAN_DATE_OF_BIRTH_REQUIRED");
      expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    });

    it("CK5 one seat waiting at a time: a second seat checkout is refused", async () => {
      await seatFor(GUARDIAN);
      const res = await seatCheckout(GUARDIAN);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SEAT_ALREADY_WAITING");
      expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled();
    });

    it("CK6 the linked-student checkout is unchanged: no seat flag, no linked student, the same refusal", async () => {
      const res = await seatCheckout(GUARDIAN, { plan: "monthly" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("NO_ACTIVE_LINKED_STUDENTS");
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("invites", () => {
    it("IN1 send: one email with a /join link, only the hash stored, the link returned too", async () => {
      const seatId = await seatFor(GUARDIAN);
      session.id = GUARDIAN;
      const res = await request(await app())
        .post(`/api/guardian/seats/${seatId}/invite`)
        .send({ email: "Teen@Example.test" });
      expect(res.status).toBe(200);
      expect(sent.emails).toHaveLength(1);
      const { token, toEmail } = sent.emails[0]!;
      expect(toEmail).toBe("teen@example.test");
      expect(res.body.url).toBe(`https://lyceon.test/join/${token}`);
      expect(res.body.emailed).toBe(true);
      const row = await seatRow(seatId);
      expect(row.invite_token_hash).toBe(sha256(token));
      expect(JSON.stringify(row)).not.toContain(token);
      const view = await request(await app()).get("/api/guardian/seats");
      expect(view.body.seats).toEqual([
        {
          id: seatId,
          invite: { email: "teen@example.test", expiresAt: expect.any(String) },
          claimRefused: false,
        },
      ]);
    });

    it("IN2 resend: a new token to the same address; the old one stops working", async () => {
      const seatId = await seatFor(GUARDIAN);
      const first = await inviteToken(GUARDIAN, seatId);
      const res = await request(await app())
        .post(`/api/guardian/seats/${seatId}/invite`)
        .send({});
      expect(res.status).toBe(200);
      const second = sent.emails.at(-1)!;
      expect(second.toEmail).toBe("teen@example.test");
      expect(second.token).not.toBe(first);
      const check = async (t: string) =>
        (await request(await app()).get(`/api/join/${t}`)).body;
      expect(await check(first)).toEqual({ valid: false });
      expect(await check(second.token)).toEqual({ valid: true });
    });

    it("IN3 copy link: a new link, nothing sent, the earlier link stops working", async () => {
      const seatId = await seatFor(GUARDIAN);
      const emailed = await inviteToken(GUARDIAN, seatId);
      const res = await request(await app()).post(
        `/api/guardian/seats/${seatId}/invite-link`,
      );
      expect(res.status).toBe(200);
      expect(res.body.emailed).toBe(false);
      expect(sent.emails).toHaveLength(1);
      const copied = String(res.body.url).split("/join/")[1]!;
      expect(
        (await request(await app()).get(`/api/join/${emailed}`)).body,
      ).toEqual({
        valid: false,
      });
      expect(
        (await request(await app()).get(`/api/join/${copied}`)).body,
      ).toEqual({
        valid: true,
      });
    });

    it("IN4 cancel: the link stops working, and Resend then needs an address", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      const del = await request(await app()).delete(
        `/api/guardian/seats/${seatId}/invite`,
      );
      expect(del.status).toBe(204);
      expect(
        (await request(await app()).get(`/api/join/${token}`)).body,
      ).toEqual({
        valid: false,
      });
      const resend = await request(await app())
        .post(`/api/guardian/seats/${seatId}/invite`)
        .send({});
      expect(resend.status).toBe(409);
      expect(resend.body.error.code).toBe("SEAT_INVITE_NO_EMAIL");
    });

    it("IN5 another guardian's seat is a 404 for every operation; a student is refused the routes", async () => {
      const seatId = await seatFor(GUARDIAN);
      session.id = GUARDIAN_B;
      const a = await app();
      expect(
        (
          await request(a).post(`/api/guardian/seats/${seatId}/invite`).send({
            email: "x@example.test",
          })
        ).status,
      ).toBe(404);
      expect(
        (await request(a).post(`/api/guardian/seats/${seatId}/invite-link`))
          .status,
      ).toBe(404);
      expect(
        (await request(a).delete(`/api/guardian/seats/${seatId}/invite`))
          .status,
      ).toBe(404);
      expect((await request(a).get("/api/guardian/seats")).body.seats).toEqual(
        [],
      );
      session.id = STUDENT;
      expect((await request(a).get("/api/guardian/seats")).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("tokens", () => {
    it("TK1 expired, cancelled, used, unknown and malformed tokens get the one same answer", async () => {
      const a = await app();
      const seatExpired = await seatFor(GUARDIAN, "sub_exp");
      const expired = await inviteToken(
        GUARDIAN,
        seatExpired,
        "e@example.test",
      );
      await pg.query(
        `UPDATE public.guardian_seats SET invite_expires_at = now() - interval '1 second'
          WHERE id = $1`,
        [seatExpired],
      );
      const seatCancelled = await seatFor(GUARDIAN_B, "sub_can");
      const cancelled = await inviteToken(
        GUARDIAN_B,
        seatCancelled,
        "c@example.test",
      );
      session.id = GUARDIAN_B;
      await request(a).delete(`/api/guardian/seats/${seatCancelled}/invite`);
      const seatUsed = await seatFor(GUARDIAN_YOUNG, "sub_used");
      const used = await inviteToken(
        GUARDIAN_YOUNG,
        seatUsed,
        "u@example.test",
      );
      session.id = STUDENT;
      expect((await request(a).post(`/api/join/${used}/claim`)).body).toEqual({
        outcome: "claimed",
      }); // presence: it was a real invite
      const unknown = "A".repeat(43);
      const malformed = "not-a-token";

      session.id = STUDENT_B;
      const statuses = [];
      const claims = [];
      for (const t of [expired, cancelled, used, unknown, malformed]) {
        const s = await request(a).get(`/api/join/${t}`);
        statuses.push([s.status, s.body]);
        const c = await request(a).post(`/api/join/${t}/claim`);
        claims.push([c.status, c.body]);
      }
      for (const s of statuses) expect(s).toEqual([200, { valid: false }]);
      for (const c of claims) expect(c).toEqual([200, { outcome: "invalid" }]);
    });

    it("TK2 the raw token and the address are never logged", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(
        GUARDIAN,
        seatId,
        "secret-teen@example.test",
      );
      const a = await app();
      await request(a).get(`/api/join/${token}`);
      session.id = STUDENT;
      await request(a).post(`/api/join/${token}/claim`);
      // Every log path a token reaches: a status check, a claim, and a refused claim (the
      // same token, now used, by another student).
      session.id = STUDENT_B;
      expect((await request(a).post(`/api/join/${token}/claim`)).body).toEqual({
        outcome: "invalid",
      });
      expect(logs.lines.length).toBeGreaterThan(0); // presence: the run logged
      for (const line of logs.lines) {
        expect(line).not.toContain(token);
        expect(line).not.toContain(sha256(token));
        expect(line).not.toContain("secret-teen@example.test");
      }
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("claim", () => {
    it("CL1 one transaction: a guardian-initiated link, the seat claimed, the link notification queued", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      session.id = STUDENT;
      const res = await request(await app()).post(`/api/join/${token}/claim`);
      expect(res.body).toEqual({ outcome: "claimed" });
      expect(await links()).toEqual([
        { guardian: GUARDIAN, student: STUDENT, initiated_by: "guardian" },
      ]);
      const row = await seatRow(seatId);
      expect(row.status).toBe("claimed");
      expect(row.student_profile_id).toBe(STUDENT);
      const audit = await pg.query(
        `SELECT context->'changes'->>'via' AS via, changes->>'via' AS via2
           FROM public.audit_logs WHERE action = 'guardian_link_initiated'
            AND created_at >= $1`,
        [testStart],
      );
      expect(
        audit.rows.map(
          (r: { via: string | null; via2: string | null }) => r.via ?? r.via2,
        ),
      ).toEqual(["guardian_seat_invite"]);
      const events = await pg.query(
        `SELECT event_type FROM public.notification_events WHERE event_type = 'guardian_linked'`,
      );
      expect(events.rows).toHaveLength(1);
      expect(attach.calls).toEqual([
        {
          seatId,
          subscriptionId: "sub_1",
          itemId: "si_1",
          studentProfileId: STUDENT,
        },
      ]);
    });

    it("CL2 idempotent: the same student claiming again gets 'claimed', one link, one audit row", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      session.id = STUDENT;
      const a = await app();
      expect((await request(a).post(`/api/join/${token}/claim`)).body).toEqual({
        outcome: "claimed",
      });
      expect((await request(a).post(`/api/join/${token}/claim`)).body).toEqual({
        outcome: "claimed",
      });
      expect(await links()).toHaveLength(1);
      const audit = await pg.query(
        `SELECT count(*)::int AS n FROM public.audit_logs WHERE action = 'guardian_link_initiated'
            AND created_at >= $1`,
        [testStart],
      );
      expect(audit.rows[0].n).toBe(1);
      // The Stripe step runs again on the retry, so a failure part-way is finished.
      expect(attach.calls).toHaveLength(2);
    });

    it("CL3 a student who already has Pro: not claimed, no link, the seat stays unassigned and says so", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      session.id = STUDENT_PAID;
      const res = await request(await app()).post(`/api/join/${token}/claim`);
      expect(res.body).toEqual({ outcome: "already_paid" });
      expect(await links()).toEqual([]);
      const row = await seatRow(seatId);
      expect(row.status).toBe("unassigned");
      expect(row.student_profile_id).toBeNull();
      expect(row.claim_refused_at).not.toBeNull();
      expect(attach.calls).toEqual([]);
      session.id = GUARDIAN;
      const view = await request(await app()).get("/api/guardian/seats");
      expect(view.body.seats[0].claimRefused).toBe(true);
      // The seat is still open to another teen with the same link.
      session.id = STUDENT;
      expect(
        (await request(await app()).post(`/api/join/${token}/claim`)).body,
      ).toEqual({ outcome: "claimed" });
    });

    it("CL4 refusals: signed out, a guardian, an incomplete profile — nothing changes", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      const a = await app();
      session.id = null;
      expect((await request(a).post(`/api/join/${token}/claim`)).status).toBe(
        401,
      );
      session.id = GUARDIAN_B;
      expect((await request(a).post(`/api/join/${token}/claim`)).status).toBe(
        403,
      );
      session.id = STUDENT_NEW;
      expect((await request(a).post(`/api/join/${token}/claim`)).status).toBe(
        403,
      );
      expect(await links()).toEqual([]);
      expect((await seatRow(seatId)).status).toBe("unassigned");
    });

    it("CL5 an under-13 student claims before any guardian link exists, and is then linked", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      session.id = STUDENT_KID;
      expect(
        (await request(await app()).post(`/api/join/${token}/claim`)).body,
      ).toEqual({ outcome: "claimed" });
      expect(await links()).toEqual([
        { guardian: GUARDIAN, student: STUDENT_KID, initiated_by: "guardian" },
      ]);
    });

    it("CL6 a guardian already linked by code: the seat still attaches, no second link", async () => {
      await pg.query(
        `SELECT public.create_active_guardian_link_audited($1, $2, 'pre')`,
        [GUARDIAN, STUDENT],
      );
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      session.id = STUDENT;
      expect(
        (await request(await app()).post(`/api/join/${token}/claim`)).body,
      ).toEqual({ outcome: "claimed" });
      expect(await links()).toEqual([
        { guardian: GUARDIAN, student: STUDENT, initiated_by: "student" },
      ]);
      expect((await seatRow(seatId)).status).toBe("claimed");
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("rate limits", () => {
    it("RL1 3 sends a day to one address, then 429 — nothing sent", async () => {
      const seatId = await seatFor(GUARDIAN);
      session.id = GUARDIAN;
      const a = await app();
      for (let i = 0; i < 3; i += 1) {
        const r = await request(a)
          .post(`/api/guardian/seats/${seatId}/invite`)
          .send({ email: "same@example.test" });
        expect(r.status).toBe(200);
      }
      const fourth = await request(a)
        .post(`/api/guardian/seats/${seatId}/invite`)
        .send({ email: "same@example.test" });
      expect(fourth.status).toBe(429);
      expect(sent.emails).toHaveLength(3);
    });

    it("RL2 10 sends a day per guardian across addresses, then 429", async () => {
      const seatId = await seatFor(GUARDIAN);
      session.id = GUARDIAN;
      const a = await app();
      for (let i = 0; i < 10; i += 1) {
        const r = await request(a)
          .post(`/api/guardian/seats/${seatId}/invite`)
          .send({ email: `teen${i}@example.test` });
        expect(r.status).toBe(200);
      }
      const eleventh = await request(a)
        .post(`/api/guardian/seats/${seatId}/invite`)
        .send({ email: "teen99@example.test" });
      expect(eleventh.status).toBe(429);
      expect(sent.emails).toHaveLength(10);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("database", () => {
    it("DB1 the webhook's record is once per subscription", async () => {
      const first = await seatFor(GUARDIAN, "sub_once");
      const second = await seatFor(GUARDIAN, "sub_once");
      expect(second).toBe(first);
      const r = await pg.query(
        `SELECT count(*)::int AS n FROM public.guardian_seats WHERE stripe_subscription_id = 'sub_once'`,
      );
      expect(r.rows[0].n).toBe(1);
    });

    it("DB2 a subscription that ends cancels the seat, and its invite stops working", async () => {
      const seatId = await seatFor(GUARDIAN);
      const token = await inviteToken(GUARDIAN, seatId);
      await pg.query(`SELECT public.guardian_seat_mark_cancelled('sub_1')`);
      expect((await seatRow(seatId)).status).toBe("cancelled");
      expect(
        (await request(await app()).get(`/api/join/${token}`)).body,
      ).toEqual({
        valid: false,
      });
    });

    it("DB3 link-code redemption is unchanged: initiated by the student, via the code", async () => {
      await pg.query(
        `SELECT public.create_active_guardian_link_audited($1, $2, 'db3')`,
        [GUARDIAN, STUDENT_B],
      );
      expect(await links()).toEqual([
        { guardian: GUARDIAN, student: STUDENT_B, initiated_by: "student" },
      ]);
      const audit = await pg.query(
        `SELECT coalesce(context->'changes'->>'via', changes->>'via') AS via
           FROM public.audit_logs WHERE action = 'guardian_link_initiated'
           ORDER BY created_at DESC LIMIT 1`,
      );
      expect(audit.rows[0].via).toBe("student_link_code");
    });

    it("DB4 privileges: service_role only; the link core is callable by no client role; RLS on", async () => {
      const fns = await pg.query(
        `SELECT p.proname AS fn,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND (p.proname LIKE 'guardian_seat_%' OR p.proname = 'guardian_link_create_core')
          ORDER BY 1`,
      );
      expect(fns.rows.map((r: { fn: string }) => r.fn)).toEqual([
        "guardian_link_create_core",
        "guardian_seat_cancel_invite",
        "guardian_seat_claim",
        "guardian_seat_invite_valid",
        "guardian_seat_issue_invite",
        "guardian_seat_mark_cancelled",
        "guardian_seat_record",
      ]);
      for (const r of fns.rows as {
        fn: string;
        anon: boolean;
        authed: boolean;
        svc: boolean;
      }[]) {
        expect([r.fn, r.anon, r.authed, r.svc]).toEqual([
          r.fn,
          false,
          false,
          r.fn !== "guardian_link_create_core",
        ]);
      }
      const t = await pg.query(
        `SELECT relrowsecurity AS rls,
                has_table_privilege('anon', 'public.guardian_seats', 'SELECT') AS anon,
                has_table_privilege('authenticated', 'public.guardian_seats', 'SELECT') AS authed
           FROM pg_class WHERE oid = 'public.guardian_seats'::regclass`,
      );
      expect(t.rows[0]).toEqual({ rls: true, anon: false, authed: false });
    });

    it("DB5 an unassigned seat can carry no student, and a token is a sha-256 hex or nothing", async () => {
      const seatId = await seatFor(GUARDIAN);
      await expect(
        pg.query(
          `UPDATE public.guardian_seats SET student_profile_id = $1 WHERE id = $2`,
          [STUDENT, seatId],
        ),
      ).rejects.toThrow(/guardian_seats_unassigned_has_no_student/);
      await expect(
        pg.query(
          `UPDATE public.guardian_seats SET invite_token_hash = 'raw-token', invite_expires_at = now()
            WHERE id = $1`,
          [seatId],
        ),
      ).rejects.toThrow(/guardian_seats_token_is_sha256_hex/);
    });
  });
});
