/**
 * Guardian → teen invites against real Postgres: the invite routes, /join lookup and claim,
 * through the real migration pipeline, the real routes and the real SQL functions.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 2, 4, 5, 6; SCL-281;
 *        supabase/migrations/20261206000000_guardian_invites.sql] | @implemented [2026-11-22]
 *
 * plain English: the database is real (bootstrapped from supabase/migrations); the routes are
 * the production routers; only the email transport is recorded instead of called. Every token
 * assertion is made against the token the guardian was actually handed.
 *
 *   Invites   IN1-IN9  start / copy / resend / new link / cancel, ownership, the cap, denials,
 *                      the same answer for an address with or without an account
 *   Tokens    TK1-TK2  what /join may say in each state; nothing secret is ever logged
 *   Claim     CL1-CL9  the link in one transaction, idempotency, the race, refusals, under-13,
 *                      the guardian's age re-checked at claim, an existing link reused
 *   Limits    RL1-RL3  3 a day per (guardian, address) with rollback, 10 a day per guardian,
 *                      the anonymous lookup bucket
 *   Database  DB1-DB5  privileges, RLS, link-code path unchanged, mechanism guard, consent CHECK
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
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  pgConnConfig,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
// The client's own parsers: every response below is parsed by the schema the page and the card
// use, so the wire contract is proved against the real routes (CLAUDE.md: derive fixtures from
// real output; a round trip catches what neither side's tests can).
import {
  guardianInviteLinkResponseSchema,
  guardianInvitesResponseSchema,
  joinClaimResponseSchema,
  joinLookupResponseSchema,
} from "../../packages/shared/src/guardian-invite-schema";

const DB_NAME = "guardian_invites_ci";
const GUARDIAN = "a1111111-1111-4111-8111-111111111111";
const GUARDIAN_B = "a2222222-2222-4222-8222-222222222222";
const GUARDIAN_YOUNG = "a3333333-3333-4333-8333-333333333333";
const GUARDIAN_NO_DOB = "a4444444-4444-4444-8444-444444444444";
const STUDENT = "b1111111-1111-4111-8111-111111111111";
const STUDENT_B = "b2222222-2222-4222-8222-222222222222";
const STUDENT_KID = "b3333333-3333-4333-8333-333333333333";
const STUDENT_NEW = "b4444444-4444-4444-8444-444444444444";
const TEEN_EMAIL = "teen@example.test";

let pg: Client;
/** When the current case began; audit rows are read from here on. */
let testStart: Date = new Date(0);
const session = vi.hoisted(() => ({ id: null as string | null }));
const sent = vi.hoisted(() => ({
  emails: [] as {
    token: string;
    toEmail: string;
    inviteId: string;
    idempotency: string;
  }[],
  ok: true,
}));
const logs = vi.hoisted(() => ({ lines: [] as string[] }));
const dispatched = vi.hoisted(() => ({ eventIds: [] as string[] }));

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
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const keyOf = actual.guardianTeenInviteIdempotencyKey as (i: {
      inviteId: string;
      tokenIssuedAt: string;
    }) => string;
    return {
      ...actual,
      sendGuardianTeenInviteEmail: async (input: {
        token: string;
        toEmail: string;
        inviteId: string;
        tokenIssuedAt: string;
      }) => {
        sent.emails.push({
          token: input.token,
          toEmail: input.toEmail,
          inviteId: input.inviteId,
          idempotency: keyOf({
            inviteId: input.inviteId,
            tokenIssuedAt: input.tokenIssuedAt,
          }),
        });
        return sent.ok
          ? { ok: true, value: { providerMessageId: "msg_1" } }
          : { ok: false, error: { kind: "provider_error", message: "down" } };
      },
    };
  },
);
vi.mock("../../server/lib/notifications/dispatch", () => ({
  dispatchQueuedMessages: async (input: { eventId: string }) => {
    dispatched.eventIds.push(input.eventId);
    return { selected: 0, sent: 0, failed: 0 };
  },
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
  const inviteRoutes = (
    await import("../../server/routes/guardian-invite-routes")
  ).default;
  const joinRoutes = (await import("../../server/routes/join-routes")).default;
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "req-invite";
    next();
  });
  a.use("/api/guardian/invites", requireSupabaseAuth, inviteRoutes);
  a.use("/api/join", joinRoutes);
  return a;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function tokenOf(url: string): string {
  const token = url.split("/join/")[1];
  expect(token, `no token in ${url}`).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return token!;
}

/** Start an invite as `guardian` and return its id and the token the guardian was handed. */
async function startInvite(
  guardian: string,
  email: string | null = TEEN_EMAIL,
): Promise<{ id: string; token: string }> {
  session.id = guardian;
  const res = await request(await app())
    .post("/api/guardian/invites")
    .send(
      email === null
        ? { acceptParentGuardianTerms: true }
        : { email, acceptParentGuardianTerms: true },
    );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  guardianInviteLinkResponseSchema.parse(res.body);
  return {
    id: res.body.data.invite.id as string,
    token: tokenOf(res.body.data.url as string),
  };
}

async function lookup(token: string): Promise<Record<string, unknown>> {
  session.id = null;
  const res = await request(await app())
    .post("/api/join/lookup")
    .set("x-vercel-forwarded-for", "203.0.113.7")
    .send({ token });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return joinLookupResponseSchema.parse(res.body).data as Record<
    string,
    unknown
  >;
}

async function claim(
  student: string,
  token: string,
): Promise<request.Response> {
  session.id = student;
  const res = await request(await app())
    .post("/api/join/claim")
    .send({ token });
  if (res.status === 200) joinClaimResponseSchema.parse(res.body);
  return res;
}

async function activeLinks(): Promise<
  { guardian: string; student: string; initiated_by: string }[]
> {
  const r = await pg.query(
    `SELECT guardian_profile_id AS guardian, student_profile_id AS student, initiated_by
       FROM public.guardian_links WHERE status = 'active' ORDER BY created_at`,
  );
  return r.rows;
}

async function inviteRow(id: string): Promise<Record<string, unknown>> {
  const r = await pg.query(
    `SELECT * FROM public.guardian_invites WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

async function auditSince(action: string): Promise<Record<string, unknown>[]> {
  const r = await pg.query(
    `SELECT actor_profile_id, target_profile_id, changes, context
       FROM public.audit_logs WHERE action = $1 AND created_at >= $2
      ORDER BY created_at`,
    [action, testStart],
  );
  return r.rows;
}

describe.skipIf(!PG_AVAILABLE)("guardian invites (real Postgres)", () => {
  beforeAll(async () => {
    process.env.PUBLIC_SITE_URL = "https://lyceon.test";
    process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "test-hmac-secret-0123456789";
    pg = await bootstrapPgDatabase(DB_NAME);
    const people: [string, string, string | null, string][] = [
      [GUARDIAN, "guardian", "1980-01-01", "Robin Smith"],
      [GUARDIAN_B, "guardian", "1981-01-01", "Sam Lee"],
      [GUARDIAN_YOUNG, "guardian", "2012-01-01", "Young"],
      [GUARDIAN_NO_DOB, "guardian", null, "Nodob"],
      [STUDENT, "student", "2009-01-01", "Ari"],
      [STUDENT_B, "student", "2009-02-01", "Bo"],
      [STUDENT_KID, "student", "2016-01-01", "Kid"],
      [STUDENT_NEW, "student", "2009-04-01", "New"],
    ];
    for (const [id, role, dob, name] of people) {
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        id,
        `${id}@example.test`,
      ]);
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
         VALUES ($1::uuid, $2, $3, $4, $5::date,
                 CASE WHEN $1::uuid = $6::uuid THEN NULL ELSE now() END)`,
        [id, `${id}@example.test`, role, name, dob, STUDENT_NEW],
      );
    }
  }, 240_000);

  afterAll(async () => {
    await pg?.end();
  });

  beforeEach(async () => {
    session.id = null;
    sent.emails.length = 0;
    sent.ok = true;
    logs.lines.length = 0;
    dispatched.eventIds.length = 0;
    await pg.query(`DELETE FROM public.guardian_invites`);
    await pg.query(`DELETE FROM public.guardian_links`);
    await pg.query(`DELETE FROM public.rate_limit_ledger`);
    await pg.query(`DELETE FROM public.rate_limit_ledger_anon`);
    await pg.query(`DELETE FROM public.notification_events`);
    await pg.query(`DELETE FROM public.legal_acceptances`);
    // audit_logs is append-only: each case reads only the rows written since it began.
    testStart = (await pg.query(`SELECT clock_timestamp() AS t`)).rows[0]
      .t as Date;
  });

  // ------------------------------------------------------------------------------------------
  describe("invites", () => {
    it("IN1 starting an invite by email stores only hashes, records the Terms, audits without the address", async () => {
      const { id, token } = await startInvite(GUARDIAN);
      expect(sent.emails).toHaveLength(1);
      expect(sent.emails[0]).toMatchObject({
        token,
        toEmail: TEEN_EMAIL,
        inviteId: id,
      });
      // The idempotency key carries neither the address nor the token.
      expect(sent.emails[0]!.idempotency).not.toContain("@");
      expect(sent.emails[0]!.idempotency).not.toContain(token);

      const row = await inviteRow(id);
      expect(row.status).toBe("open");
      expect(row.token_hash).toBe(sha256(token));
      expect(row.email_hash).toBe(sha256(TEEN_EMAIL));
      const serialised = JSON.stringify(row);
      expect(serialised).not.toContain(token);
      expect(serialised).not.toContain(TEEN_EMAIL);
      // 14 days.
      const ttlDays =
        (new Date(row.expires_at as string).getTime() -
          new Date(row.token_issued_at as string).getTime()) /
        86_400_000;
      expect(ttlDays).toBeCloseTo(14, 3);

      const acceptances = await pg.query(
        `SELECT doc_key, consent_source, actor_type FROM public.legal_acceptances WHERE user_id = $1`,
        [GUARDIAN],
      );
      expect(acceptances.rows).toEqual([
        {
          doc_key: "parent_guardian_terms",
          consent_source: "guardian_invite_issue",
          actor_type: "parent",
        },
      ]);

      const audit = await auditSince("guardian_invite_issued");
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_profile_id).toBe(GUARDIAN);
      expect(JSON.stringify(audit[0])).not.toContain("@");
      expect(JSON.stringify(audit[0])).not.toContain(token);
    });

    it("IN2 Copy a link instead sends nothing and stores no address hash", async () => {
      const { id } = await startInvite(GUARDIAN, null);
      expect(sent.emails).toHaveLength(0);
      const row = await inviteRow(id);
      expect(row.email_hash).toBeNull();
    });

    it("IN3 Resend emails a new link; the old link stops working", async () => {
      const first = await startInvite(GUARDIAN);
      session.id = GUARDIAN;
      const res = await request(await app())
        .post(`/api/guardian/invites/${first.id}/resend`)
        .send({ email: TEEN_EMAIL });
      expect(res.status).toBe(200);
      expect(res.body.data.emailed).toBe(true);
      const second = tokenOf(res.body.data.url as string);
      expect(second).not.toBe(first.token);
      expect(sent.emails.at(-1)?.token).toBe(second);
      // A new link is a new email: a new idempotency key.
      expect(sent.emails[0]!.idempotency).not.toBe(sent.emails[1]!.idempotency);
      expect((await lookup(first.token)).state).toBe("not_found");
      expect((await lookup(second)).state).toBe("open");
      expect(await auditSince("guardian_invite_reissued")).toHaveLength(1);
    });

    it("IN4 Copy new link makes a new link with nothing sent; the old link stops working", async () => {
      const first = await startInvite(GUARDIAN);
      sent.emails.length = 0;
      session.id = GUARDIAN;
      const res = await request(await app())
        .post(`/api/guardian/invites/${first.id}/link`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.emailed).toBe(false);
      expect(sent.emails).toHaveLength(0);
      const second = tokenOf(res.body.data.url as string);
      expect((await lookup(first.token)).state).toBe("not_found");
      expect((await lookup(second)).state).toBe("open");
      // Copy keeps the address hash already on the row.
      expect((await inviteRow(first.id)).email_hash).toBe(sha256(TEEN_EMAIL));
    });

    it("IN5 Cancel kills the link; the next send starts a new invite with a new token", async () => {
      const first = await startInvite(GUARDIAN);
      session.id = GUARDIAN;
      const del = await request(await app()).delete(
        `/api/guardian/invites/${first.id}`,
      );
      expect(del.status).toBe(204);
      expect((await lookup(first.token)).state).toBe("cancelled");
      expect((await claim(STUDENT, first.token)).body.data.outcome).toBe(
        "cancelled",
      );
      expect(await activeLinks()).toEqual([]);
      // The cancelled invite cannot be revived.
      session.id = GUARDIAN;
      const revive = await request(await app())
        .post(`/api/guardian/invites/${first.id}/link`)
        .send({});
      expect(revive.status).toBe(404);
      const next = await startInvite(GUARDIAN);
      expect(next.id).not.toBe(first.id);
      expect(next.token).not.toBe(first.token);
      expect(await auditSince("guardian_invite_cancelled")).toHaveLength(1);
    });

    it("IN6 another guardian cannot list, resend, copy or cancel the invite", async () => {
      const mine = await startInvite(GUARDIAN);
      session.id = GUARDIAN_B;
      const a = await app();
      const list = await request(a).get("/api/guardian/invites");
      expect(
        guardianInvitesResponseSchema.parse(list.body).data.invites,
      ).toEqual([]);
      session.id = GUARDIAN;
      const own = await request(a).get("/api/guardian/invites");
      expect(
        guardianInvitesResponseSchema.parse(own.body).data.invites,
      ).toHaveLength(1);
      session.id = GUARDIAN_B;
      expect(
        (
          await request(a)
            .post(`/api/guardian/invites/${mine.id}/resend`)
            .send({ email: TEEN_EMAIL })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(a)
            .post(`/api/guardian/invites/${mine.id}/link`)
            .send({})
        ).status,
      ).toBe(404);
      expect(
        (await request(a).delete(`/api/guardian/invites/${mine.id}`)).status,
      ).toBe(404);
      expect((await lookup(mine.token)).state).toBe("open");
    });

    it("IN7 at most 3 open invites; an expired one does not count; cancelling frees a place", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push((await startInvite(GUARDIAN, null)).id);
      }
      session.id = GUARDIAN;
      const fourth = await request(await app())
        .post("/api/guardian/invites")
        .send({ acceptParentGuardianTerms: true });
      expect(fourth.status).toBe(409);
      expect(fourth.body.error.code).toBe("GUARDIAN_INVITE_LIMIT");

      await pg.query(
        `UPDATE public.guardian_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [ids[0]],
      );
      await startInvite(GUARDIAN, null); // the expired one does not count
      // Reviving the expired one would make 4 open: refused.
      const revive = await request(await app())
        .post(`/api/guardian/invites/${ids[0]}/link`)
        .send({});
      expect(revive.status).toBe(409);

      await request(await app()).delete(`/api/guardian/invites/${ids[1]}`);
      const revived = await request(await app())
        .post(`/api/guardian/invites/${ids[0]}/link`)
        .send({});
      expect(revived.status).toBe(200);
    });

    it("IN8 denials: no session, a student, a guardian under 18 or with no date of birth, no Terms", async () => {
      const a = await app();
      session.id = null;
      expect(
        (
          await request(a)
            .post("/api/guardian/invites")
            .send({ acceptParentGuardianTerms: true })
        ).status,
      ).toBe(401);
      session.id = STUDENT;
      expect(
        (
          await request(a)
            .post("/api/guardian/invites")
            .send({ acceptParentGuardianTerms: true })
        ).status,
      ).toBe(403);
      session.id = GUARDIAN_YOUNG;
      const young = await request(a)
        .post("/api/guardian/invites")
        .send({ acceptParentGuardianTerms: true });
      expect(young.status).toBe(403);
      expect(young.body.error.code).toBe("GUARDIAN_UNDER_18");
      session.id = GUARDIAN_NO_DOB;
      const nodob = await request(a)
        .post("/api/guardian/invites")
        .send({ acceptParentGuardianTerms: true });
      expect(nodob.status).toBe(403);
      expect(nodob.body.error.code).toBe("GUARDIAN_DATE_OF_BIRTH_REQUIRED");
      session.id = GUARDIAN;
      expect(
        (
          await request(a)
            .post("/api/guardian/invites")
            .send({ email: TEEN_EMAIL })
        ).status,
      ).toBe(400);
      const r = await pg.query(
        `SELECT count(*)::int AS n FROM public.guardian_invites`,
      );
      expect(r.rows[0].n).toBe(0);
    });

    it("IN9 the answer is the same for an address with an account and one without", async () => {
      const shape = (b: { data: Record<string, unknown> }) => ({
        emailed: b.data.emailed,
        keys: Object.keys(b.data).sort(),
        inviteKeys: Object.keys(b.data.invite as object).sort(),
      });
      session.id = GUARDIAN;
      const a = await app();
      const known = await request(a)
        .post("/api/guardian/invites")
        .send({
          email: `${STUDENT}@example.test`,
          acceptParentGuardianTerms: true,
        });
      const unknown = await request(a).post("/api/guardian/invites").send({
        email: "nobody@example.test",
        acceptParentGuardianTerms: true,
      });
      expect(known.status).toBe(unknown.status);
      expect(shape(known.body)).toEqual(shape(unknown.body));
      // Nothing about the address reached the profile table, and no account was touched.
      expect(await activeLinks()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("tokens", () => {
    it("TK1 what /join says in each state", async () => {
      const open = await startInvite(GUARDIAN);
      const found = await lookup(open.token);
      expect(found).toMatchObject({
        state: "open",
        guardianFirstName: "Robin",
      });
      expect(JSON.stringify(found)).not.toContain(GUARDIAN); // no guardian id leaves

      const claimed = await startInvite(GUARDIAN, null);
      expect((await claim(STUDENT, claimed.token)).body.data.outcome).toBe(
        "claimed",
      );
      expect(await lookup(claimed.token)).toEqual({ state: "claimed" });

      const expired = await startInvite(GUARDIAN, null);
      await pg.query(
        `UPDATE public.guardian_invites SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [expired.id],
      );
      expect(await lookup(expired.token)).toEqual({ state: "expired" });
      expect((await claim(STUDENT_B, expired.token)).body.data.outcome).toBe(
        "expired",
      );

      expect(await lookup("A".repeat(43))).toEqual({ state: "not_found" });
      expect(await lookup("not-a-token")).toEqual({ state: "not_found" });
    });

    it("TK2 no log line carries a token, its hash, or an address", async () => {
      const first = await startInvite(GUARDIAN);
      session.id = GUARDIAN;
      await request(await app())
        .post(`/api/guardian/invites/${first.id}/resend`)
        .send({ email: TEEN_EMAIL });
      await lookup(first.token);
      // Both claim paths log: a token that can no longer be claimed (the first, replaced by
      // the resend) and one that can.
      expect((await claim(STUDENT, first.token)).body.data.outcome).toBe(
        "not_found",
      );
      await claim(STUDENT, sent.emails.at(-1)!.token);
      const all = logs.lines.join("\n");
      for (const e of sent.emails) {
        expect(all).not.toContain(e.token);
        expect(all).not.toContain(sha256(e.token));
      }
      expect(all).not.toContain(TEEN_EMAIL);
      expect(all).not.toContain(sha256(TEEN_EMAIL));
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("claim", () => {
    it("CL1 a claim creates the link as guardian-initiated, audits it, and notifies", async () => {
      const { id, token } = await startInvite(GUARDIAN);
      const res = await claim(STUDENT, token);
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe("claimed");
      expect(await activeLinks()).toEqual([
        { guardian: GUARDIAN, student: STUDENT, initiated_by: "guardian" },
      ]);
      const link = await pg.query(
        `SELECT id, accepted_by_profile_id FROM public.guardian_links WHERE status = 'active'`,
      );
      expect(link.rows[0].accepted_by_profile_id).toBe(STUDENT);
      const initiated = await auditSince("guardian_link_initiated");
      expect(initiated).toHaveLength(1);
      expect((initiated[0]!.changes as { via: string }).via).toBe(
        "guardian_invite",
      );
      const event = await pg.query(
        `SELECT count(*)::int AS n FROM public.notification_events WHERE event_type = 'guardian_linked'`,
      );
      expect(event.rows[0].n).toBe(1);
      expect(dispatched.eventIds).toHaveLength(1);
      const row = await inviteRow(id);
      expect(row).toMatchObject({
        status: "claimed",
        claimed_by_profile_id: STUDENT,
        link_id: link.rows[0].id,
      });
      expect(await auditSince("guardian_invite_claimed")).toHaveLength(1);
    });

    it("CL2 the same student's retry answers claimed again and writes nothing more", async () => {
      const { token } = await startInvite(GUARDIAN);
      expect((await claim(STUDENT, token)).body.data.outcome).toBe("claimed");
      expect((await claim(STUDENT, token)).body.data.outcome).toBe("claimed");
      expect(await activeLinks()).toHaveLength(1);
      expect(await auditSince("guardian_link_initiated")).toHaveLength(1);
      expect(dispatched.eventIds).toHaveLength(1);
    });

    it("CL3 two students racing for one invite: exactly one link (two real connections)", async () => {
      const { token } = await startInvite(GUARDIAN);
      const hash = sha256(token);
      const c1 = new Client(pgConnConfig(DB_NAME));
      const c2 = new Client(pgConnConfig(DB_NAME));
      await c1.connect();
      await c2.connect();
      try {
        await c1.query("BEGIN");
        const first = await c1.query(
          `SELECT public.claim_guardian_invite_audited($1, $2) AS r`,
          [hash, STUDENT],
        );
        // The second claim blocks on the row lock until the first commits.
        const secondP = c2.query(
          `SELECT public.claim_guardian_invite_audited($1, $2) AS r`,
          [hash, STUDENT_B],
        );
        await new Promise((r) => setTimeout(r, 200));
        await c1.query("COMMIT");
        const second = await secondP;
        expect(first.rows[0].r.outcome).toBe("claimed");
        expect(second.rows[0].r.outcome).toBe("claimed_by_other");
      } finally {
        await c1.end();
        await c2.end();
      }
      expect(await activeLinks()).toEqual([
        { guardian: GUARDIAN, student: STUDENT, initiated_by: "guardian" },
      ]);
    });

    it("CL4 only a signed-in student may claim", async () => {
      const { token } = await startInvite(GUARDIAN);
      session.id = null;
      expect(
        (
          await request(await app())
            .post("/api/join/claim")
            .send({ token })
        ).status,
      ).toBe(401);
      const asGuardian = await claim(GUARDIAN_B, token);
      expect(asGuardian.status).toBe(403);
      expect(asGuardian.body.error.code).toBe("ROLE_NOT_PERMITTED");
      expect(await activeLinks()).toEqual([]);
    });

    it("CL5 an under-13 student with no link can claim, and is linked", async () => {
      const kid = await pg.query(
        `SELECT is_under_13 FROM public.profiles WHERE id = $1`,
        [STUDENT_KID],
      );
      expect(kid.rows[0].is_under_13).toBe(true);
      const { token } = await startInvite(GUARDIAN);
      const res = await claim(STUDENT_KID, token);
      expect(res.body.data.outcome).toBe("claimed");
      expect(await activeLinks()).toEqual([
        { guardian: GUARDIAN, student: STUDENT_KID, initiated_by: "guardian" },
      ]);
    });

    it("CL6 the inviting guardian's age is re-checked at claim: not an adult, no link", async () => {
      // The route never issues an invite to a guardian under 18, so this one is written straight
      // through the SQL function, as if the guardian's age had changed after issuing. The claim
      // must still refuse: the teen is the caller, and the guardian is checked by id.
      const token = "Y".repeat(43);
      await pg.query(
        `SELECT public.issue_guardian_invite_audited($1, $2, NULL, NULL)`,
        [GUARDIAN_YOUNG, sha256(token)],
      );
      expect((await lookup(token)).state).toBe("open");
      const res = await claim(STUDENT, token);
      expect(res.body.data.outcome).toBe("unavailable");
      expect(await activeLinks()).toEqual([]);
      expect((await lookup(token)).state).toBe("open");
    });

    it("CL7 a pair already linked by code: the invite is claimed against that link, no second link", async () => {
      await pg.query(
        `SELECT public.create_active_guardian_link_audited($1, $2)`,
        [GUARDIAN, STUDENT],
      );
      dispatched.eventIds.length = 0;
      const { id, token } = await startInvite(GUARDIAN);
      expect((await claim(STUDENT, token)).body.data.outcome).toBe("claimed");
      expect(await activeLinks()).toEqual([
        { guardian: GUARDIAN, student: STUDENT, initiated_by: "student" },
      ]);
      expect((await inviteRow(id)).status).toBe("claimed");
      expect(dispatched.eventIds).toHaveLength(0);
    });

    it("CL8 another student's claim of a used invite: claimed_by_other, nothing written", async () => {
      const { token } = await startInvite(GUARDIAN);
      await claim(STUDENT, token);
      const res = await claim(STUDENT_B, token);
      expect(res.body.data.outcome).toBe("claimed_by_other");
      expect(await activeLinks()).toHaveLength(1);
    });

    it("CL9 a student who has not finished onboarding is refused before any claim", async () => {
      const { token } = await startInvite(GUARDIAN);
      const res = await claim(STUDENT_NEW, token);
      expect(res.status).toBe(403);
      expect(await activeLinks()).toEqual([]);
      expect((await lookup(token)).state).toBe("open");
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("rate limits", () => {
    it("RL1 3 emails a day per (guardian, address); the refused one does not cost the daily bucket", async () => {
      const { id } = await startInvite(GUARDIAN);
      session.id = GUARDIAN;
      const a = await app();
      for (let i = 0; i < 2; i += 1) {
        const ok = await request(a)
          .post(`/api/guardian/invites/${id}/resend`)
          .send({ email: TEEN_EMAIL });
        expect(ok.status).toBe(200);
      }
      const denied = await request(a)
        .post(`/api/guardian/invites/${id}/resend`)
        .send({ email: TEEN_EMAIL });
      expect(denied.status).toBe(429);
      const daily = await pg.query(
        `SELECT coalesce(sum(used_count), 0)::int AS n FROM public.rate_limit_ledger
          WHERE profile_id = $1 AND bucket_key = 'guardian_invite_daily'`,
        [GUARDIAN],
      );
      expect(daily.rows[0].n).toBe(3); // the denied 4th was rolled back
      // Another address still works.
      const other = await request(a)
        .post(`/api/guardian/invites/${id}/resend`)
        .send({ email: "other@example.test" });
      expect(other.status).toBe(200);
    });

    it("RL2 10 links a day per guardian, copied or emailed", async () => {
      const { id } = await startInvite(GUARDIAN, null);
      session.id = GUARDIAN;
      const a = await app();
      for (let i = 0; i < 9; i += 1) {
        const ok = await request(a)
          .post(`/api/guardian/invites/${id}/link`)
          .send({});
        expect(ok.status, `link ${i + 2}`).toBe(200);
      }
      const denied = await request(a)
        .post(`/api/guardian/invites/${id}/link`)
        .send({});
      expect(denied.status).toBe(429);
    });

    it("RL3 the anonymous lookup counts against a per-IP bucket", async () => {
      const { token } = await startInvite(GUARDIAN, null);
      await lookup(token);
      const r = await pg.query(
        `SELECT count(*)::int AS n FROM public.rate_limit_ledger_anon
          WHERE bucket_key = 'guardian_invite_lookup_ip'`,
      );
      expect(r.rows[0].n).toBeGreaterThan(0);
      const cfg = await pg.query(
        `SELECT value->'guardian_invite_lookup_ip' AS b,
                value->'guardian_invite_daily' AS d,
                value->'guardian_invite_email' AS e
           FROM public.rate_limit_runtime_config WHERE key = 'bucket_definitions'`,
      );
      expect(cfg.rows[0]).toEqual({
        b: { limit: 60, window_seconds: 3600 },
        d: { limit: 10, window_seconds: 86400 },
        e: { limit: 3, window_seconds: 86400 },
      });
    });
  });

  // ------------------------------------------------------------------------------------------
  describe("database", () => {
    it("DB1 neither anon nor authenticated can read the table or run the functions", async () => {
      const r = await pg.query(
        `SELECT has_table_privilege('anon', 'public.guardian_invites', 'SELECT') AS anon_t,
                has_table_privilege('authenticated', 'public.guardian_invites', 'SELECT') AS auth_t,
                has_function_privilege('authenticated',
                  'public.claim_guardian_invite_audited(text, uuid, text)', 'EXECUTE') AS auth_claim,
                has_function_privilege('anon',
                  'public.guardian_invite_lookup(text)', 'EXECUTE') AS anon_lookup,
                has_function_privilege('authenticated',
                  'public.create_active_guardian_link_audited(uuid, uuid, text, text, text)',
                  'EXECUTE') AS auth_link,
                has_function_privilege('service_role',
                  'public.claim_guardian_invite_audited(text, uuid, text)', 'EXECUTE') AS svc_claim`,
      );
      expect(r.rows[0]).toEqual({
        anon_t: false,
        auth_t: false,
        auth_claim: false,
        anon_lookup: false,
        auth_link: false,
        svc_claim: true,
      });
    });

    it("DB2 RLS is on for guardian_invites", async () => {
      const r = await pg.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.guardian_invites'::regclass`,
      );
      expect(r.rows[0].relrowsecurity).toBe(true);
    });

    it("DB3 link-code redemption is unchanged: the defaults record the student and the code", async () => {
      await pg.query(
        `SELECT public.create_active_guardian_link_audited($1, $2, 'r1')`,
        [GUARDIAN, STUDENT],
      );
      expect(await activeLinks()).toEqual([
        { guardian: GUARDIAN, student: STUDENT, initiated_by: "student" },
      ]);
      const audit = await auditSince("guardian_link_initiated");
      expect((audit[0]!.changes as { via: string }).via).toBe(
        "student_link_code",
      );
      // Exactly one function by that name: the old signature is gone, not overloaded.
      const n = await pg.query(
        `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'create_active_guardian_link_audited'`,
      );
      expect(n.rows[0].n).toBe(1);
    });

    it("DB4 only the two real mechanisms are accepted", async () => {
      await expect(
        pg.query(
          `SELECT public.create_active_guardian_link_audited($1, $2, NULL, 'guardian', 'student_link_code')`,
          [GUARDIAN, STUDENT],
        ),
      ).rejects.toMatchObject({ code: "22023" });
      await expect(
        pg.query(
          `SELECT public.create_active_guardian_link_audited($1, $2, NULL, 'admin', 'guardian_invite')`,
          [GUARDIAN, STUDENT],
        ),
      ).rejects.toMatchObject({ code: "22023" });
      expect(await activeLinks()).toEqual([]);
    });

    it("DB5 the consent CHECK accepts guardian_invite_issue", async () => {
      const r = await pg.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'legal_acceptances_consent_source_check'`,
      );
      expect(r.rows[0].def).toContain("guardian_invite_issue");
    });
  });
});
