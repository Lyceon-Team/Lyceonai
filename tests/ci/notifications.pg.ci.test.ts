/**
 * Notifications rebuild — real PostgreSQL proof.
 *
 * @spec [contracts/notifications.contract.md — every clause in §13's proving table;
 *        Doc-01_V8 §36.1 step 6; Doc-01A_V1.0 §14] | @implemented [2026-09-03]
 *
 * plain English: drives the REAL routes, the REAL SQL functions and the REAL migrations
 * against a throwaway Postgres. No table is mocked anywhere — a mock is a second unverified
 * copy of the schema, and that is exactly how the deleted stack passed CI while its tables
 * did not exist. What is substituted: the database TRANSPORT (`supabaseServer` → SQL via
 * tests/helpers/pg-supabase), the AUTH BOUNDARY (a session fixture), CSRF, and the network
 * (global `fetch` → an in-memory fake Resend that records every request).
 *
 * The cases are the contract's falsification table, one `it` per observation. Each was
 * observed FAILING once against a deliberate mutation before it counted as a gate; the
 * mutations and their outputs are recorded in docs/plans/Notifications_Rebuild_Evidence.md.
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
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  pgConnConfig,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  RESEND_WEBHOOK_PATH,
} from "../../packages/shared/src/notifications-schema";
import { notificationEventId } from "../../server/lib/notifications/event-id";

const DB_NAME = "notifications_ci";
const GUARDIAN = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const GUARDIAN_EMAIL = "guardian@example.test";
const FROM_EMAIL = "notifications@send.example.test";
const WEBHOOK_SECRET = `whsec_${randomBytes(32).toString("base64")}`;

let pg: Client;
const session = { id: GUARDIAN, role: "guardian" as string };

// ── Fake Resend: records requests; mode decides the answer ─────────────────
type FakeMode = "ok" | "reject" | "throw" | "slow";
type CapturedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
const fakeResend = {
  mode: "ok" as FakeMode,
  requests: [] as CapturedRequest[],
  nextId: 1,
  slowResolvedAt: 0,
};

async function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const headers = Object.fromEntries(
    Object.entries((init?.headers ?? {}) as Record<string, string>),
  );
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<
    string,
    unknown
  >;
  fakeResend.requests.push({ url, headers, body });
  if (fakeResend.mode === "throw") throw new Error("ECONNRESET");
  if (fakeResend.mode === "reject") {
    return new Response(
      JSON.stringify({
        statusCode: 500,
        name: "internal_server_error",
        message: "boom",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  if (fakeResend.mode === "slow") {
    await new Promise((r) => setTimeout(r, 150));
    fakeResend.slowResolvedAt = Date.now();
  }
  const id = `re_${fakeResend.nextId++}`;
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as express.Request & { user?: unknown }).user = {
        id: session.id,
        email: "party@example.test",
        role: session.role,
      };
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf", () => ({
  doubleCsrfProtection: (_q: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "test-csrf-token",
}));

async function buildApp(): Promise<express.Express> {
  const guardianRouter = (await import("../../server/routes/guardian-routes"))
    .default;
  const notificationsRouter = (
    await import("../../server/routes/notifications")
  ).default;
  const { resendWebhookHandler } =
    await import("../../server/routes/resend-webhook");
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "notif-ci";
    next();
  });
  // Contract §7.1: raw body, registered BEFORE express.json().
  app.post(
    RESEND_WEBHOOK_PATH,
    express.raw({ type: "application/json" }),
    resendWebhookHandler,
  );
  app.use(express.json());
  app.use("/api/guardian", guardianRouter);
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  app.use("/api/notifications", requireSupabaseAuth, notificationsRouter);
  app.use(
    (
      err: Error,
      _rq: express.Request,
      rs: express.Response,
      _n: express.NextFunction,
    ) => {
      rs.status(500).json({ error: String(err?.message ?? err) });
    },
  );
  return app;
}

async function currentCode(): Promise<string> {
  const { issueStudentLinkCode } =
    await import("../../server/lib/student-link-code");
  const issued = await issueStudentLinkCode(STUDENT);
  expect(issued).not.toBeNull();
  return issued!.code;
}

async function redeem(app: express.Express): Promise<request.Response> {
  session.id = GUARDIAN;
  session.role = "guardian";
  return request(app)
    .post("/api/guardian/link/redeem")
    .send({ code: await currentCode() });
}

async function counts(): Promise<{ events: number; messages: number }> {
  const r = await pg.query(
    `SELECT (SELECT count(*)::int FROM public.notification_events) AS events,
            (SELECT count(*)::int FROM public.notification_messages) AS messages`,
  );
  return r.rows[0] as { events: number; messages: number };
}

/** Run statements as a Supabase role with auth.uid() = `uid`, inside a rolled-back transaction. */
async function asRole<T>(
  role: "authenticated" | "anon",
  uid: string | null,
  fn: (
    run: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>,
  ) => Promise<T>,
): Promise<T> {
  const c = new Client(pgConnConfig(DB_NAME));
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL ROLE ${role}`);
    if (uid)
      await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
        uid,
      ]);
    // Each statement runs under a savepoint so a denied one (the point of these cases) does
    // not abort the transaction for the statements after it.
    return await fn(async (sql, params) => {
      await c.query("SAVEPOINT s");
      try {
        const r = await c.query(sql, params);
        await c.query("RELEASE SAVEPOINT s");
        return {
          rowCount: r.rowCount,
          rows: r.rows as Record<string, unknown>[],
        };
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT s");
        throw e;
      }
    });
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    await c.end();
  }
}

function sign(
  id: string,
  timestamp: string,
  body: string,
  secret = WEBHOOK_SECRET,
): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const mac = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${mac}`;
}

function webhookBody(type: string, emailId: string): string {
  return JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: emailId,
      from: FROM_EMAIL,
      to: [GUARDIAN_EMAIL],
      subject: "x",
    },
  });
}

async function postWebhook(
  app: express.Express,
  body: string,
  opts: { id?: string; signature?: string; timestamp?: string } = {},
): Promise<request.Response> {
  const id = opts.id ?? `msg_${randomBytes(6).toString("hex")}`;
  const ts = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const sig = opts.signature ?? sign(id, ts, body);
  return request(app)
    .post(RESEND_WEBHOOK_PATH)
    .set("Content-Type", "application/json")
    .set("svix-id", id)
    .set("svix-timestamp", ts)
    .set("svix-signature", sig)
    .send(body);
}

describe.skipIf(!PG_AVAILABLE)("notifications — real Postgres", () => {
  beforeAll(async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFICATION_FROM_EMAIL = FROM_EMAIL;
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.PUBLIC_SITE_URL = "https://app.example.test";
    vi.stubGlobal("fetch", fakeFetch);

    pg = await bootstrapPgDatabase(DB_NAME);
    // Supabase's real auth.uid() reads the JWT claim; the bootstrap stubs it to NULL. The RLS
    // cases need the real shape.
    await pg.query(
      `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
         SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$`,
    );
    await pg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
      [
        GUARDIAN,
        GUARDIAN_EMAIL,
        STUDENT,
        "student@example.test",
        OUTSIDER,
        "o@example.test",
      ],
    );
    await pg.query(
      `INSERT INTO public.profiles (id, email, role, display_name) VALUES
         ($1,$2,'guardian','Gia Guardian'),($3,$4,'student','Sam Student'),($5,$6,'student','Otto')`,
      [
        GUARDIAN,
        GUARDIAN_EMAIL,
        STUDENT,
        "student@example.test",
        OUTSIDER,
        "o@example.test",
      ],
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (pg) await pg.end();
  });

  beforeEach(async () => {
    session.id = GUARDIAN;
    session.role = "guardian";
    fakeResend.mode = "ok";
    fakeResend.requests = [];
    fakeResend.nextId = 1;
    await pg.query(`DELETE FROM public.guardian_links`);
    await pg.query(`DELETE FROM public.notification_delivery_events`);
    await pg.query(`DELETE FROM public.notification_events`);
    await pg.query(`DELETE FROM public.rate_limit_ledger`);
    await pg.query(
      `UPDATE public.profiles SET student_link_code = NULL, student_link_code_issued_at = NULL`,
    );
  });

  // ── C2.2 same transaction ────────────────────────────────────────────────
  it("C2.2 emit is same-transaction: a rolled-back link leaves zero event and zero message rows", async () => {
    await pg.query("BEGIN");
    await pg.query(
      `SELECT public.create_active_guardian_link_audited($1, $2, 'ci')`,
      [GUARDIAN, STUDENT],
    );
    const inside = await counts();
    await pg.query("ROLLBACK");
    expect(inside).toEqual({ events: 1, messages: 3 });
    expect(await counts()).toEqual({ events: 0, messages: 0 });
  });

  // ── C2.1 / C2.3 fan-out ──────────────────────────────────────────────────
  it("C2.3 one guardian_linked event fans out to exactly student in_app, guardian in_app, guardian email", async () => {
    const res = await redeem(await buildApp());
    expect(res.status).toBe(201);
    expect(await counts()).toEqual({ events: 1, messages: 3 });
    const rows = await pg.query(
      `SELECT recipient_profile_id, channel, status, delivered_at IS NOT NULL AS delivered
         FROM public.notification_messages ORDER BY recipient_profile_id, channel`,
    );
    expect(rows.rows).toEqual([
      {
        recipient_profile_id: GUARDIAN,
        channel: "email",
        status: "sent",
        delivered: false,
      },
      {
        recipient_profile_id: GUARDIAN,
        channel: "in_app",
        status: "delivered",
        delivered: true,
      },
      {
        recipient_profile_id: STUDENT,
        channel: "in_app",
        status: "delivered",
        delivered: true,
      },
    ]);
    const ev = await pg.query(
      `SELECT event_type, subject_profile_id, payload FROM public.notification_events`,
    );
    expect(ev.rows[0].event_type).toBe("guardian_linked");
    expect(ev.rows[0].subject_profile_id).toBe(STUDENT);
    // C8.1: link_id and the student's display name, nothing else.
    expect(Object.keys(ev.rows[0].payload as object).sort()).toEqual([
      "link_id",
      "student_display_name",
    ]);
    expect(
      (ev.rows[0].payload as { student_display_name: string })
        .student_display_name,
    ).toBe("Sam Student");
  });

  // ── C5.2 replay ──────────────────────────────────────────────────────────
  it("C5.2 emitting twice with the same event_id leaves counts unchanged", async () => {
    const id = notificationEventId("guardian_linked", "replay-source");
    const args = [
      id,
      "guardian_linked",
      STUDENT,
      JSON.stringify([
        { profile_id: STUDENT, channels: ["in_app"] },
        { profile_id: GUARDIAN, channels: ["in_app", "email"] },
      ]),
      JSON.stringify({ link_id: id, student_display_name: "Sam" }),
    ];
    await pg.query(
      `SELECT public.emit_notification_event($1,$2,$3,$4::jsonb,$5::jsonb)`,
      args,
    );
    const first = await counts();
    await pg.query(
      `SELECT public.emit_notification_event($1,$2,$3,$4::jsonb,$5::jsonb)`,
      args,
    );
    expect(first).toEqual({ events: 1, messages: 3 });
    expect(await counts()).toEqual(first);
  });

  // ── C5.1 event id parity ─────────────────────────────────────────────────
  it("C5.1 SQL and TypeScript derive the same event id", async () => {
    for (const [type, source] of [
      ["guardian_linked", "7c9e6679-7425-40de-944b-e07fc1f90ae7"],
      ["guardian_linked", "00000000-0000-0000-0000-000000000000"],
      ["some_future_type", "abc"],
    ]) {
      const r = await pg.query(
        `SELECT public.notification_event_id($1, $2) AS id`,
        [type, source],
      );
      expect(r.rows[0].id).toBe(notificationEventId(type!, source!));
    }
  });

  // ── C4.1 / C4.2 / C5.3 / C12.3 dispatch ──────────────────────────────────
  it("C4.1 a failed send leaves the row queued with attempts+1 and last_error, never sent, never failed below the cap", async () => {
    fakeResend.mode = "reject";
    const res = await redeem(await buildApp());
    expect(res.status).toBe(201); // the link is real regardless of mail
    const row = await pg.query(
      `SELECT status, attempts, last_error, provider_message_id, sent_at FROM public.notification_messages WHERE channel='email'`,
    );
    expect(row.rows[0]).toMatchObject({
      status: "queued",
      attempts: 1,
      provider_message_id: null,
      sent_at: null,
    });
    expect(String(row.rows[0].last_error)).toContain("provider_rejected");

    // Retry through the sweep path until the cap: stays queued, then failed exactly at the cap.
    const { dispatchQueuedMessages } =
      await import("../../server/lib/notifications/dispatch");
    for (let i = 2; i < NOTIFICATION_EMAIL_MAX_ATTEMPTS; i += 1) {
      await dispatchQueuedMessages();
      const r = await pg.query(
        `SELECT status, attempts FROM public.notification_messages WHERE channel='email'`,
      );
      expect(r.rows[0]).toEqual({ status: "queued", attempts: i });
    }
    await dispatchQueuedMessages();
    const capped = await pg.query(
      `SELECT status, attempts FROM public.notification_messages WHERE channel='email'`,
    );
    expect(capped.rows[0]).toEqual({
      status: "failed",
      attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
    });
    // A failed row is no longer selected.
    const after = await dispatchQueuedMessages();
    expect(after.selected).toBe(0);
  });

  it("C5.3/C12.3/C6.4 the send carries Idempotency-Key = message_id, the env sender, the profile address, and no tracking fields", async () => {
    await redeem(await buildApp());
    expect(fakeResend.requests).toHaveLength(1);
    const req = fakeResend.requests[0]!;
    const row = await pg.query(
      `SELECT message_id, provider_message_id, status FROM public.notification_messages WHERE channel='email'`,
    );
    expect(req.url).toBe("https://api.resend.com/emails");
    expect(req.headers["Idempotency-Key"]).toBe(row.rows[0].message_id);
    expect(req.headers.Authorization).toBe("Bearer re_test_key");
    expect(req.body.from).toBe(FROM_EMAIL);
    expect(req.body.to).toEqual([GUARDIAN_EMAIL]);
    expect(Object.keys(req.body).sort()).toEqual([
      "from",
      "html",
      "subject",
      "text",
      "to",
    ]);
    expect(String(req.body.subject)).toContain("Sam Student");
    expect(row.rows[0]).toMatchObject({
      status: "sent",
      provider_message_id: "re_1",
    });
  });

  it("C6.1 the redeem response waits for the inline dispatch (not fire-and-forget)", async () => {
    fakeResend.mode = "slow";
    fakeResend.slowResolvedAt = 0;
    const res = await redeem(await buildApp());
    const respondedAt = Date.now();
    expect(res.status).toBe(201);
    expect(fakeResend.slowResolvedAt).toBeGreaterThan(0);
    expect(respondedAt).toBeGreaterThanOrEqual(fakeResend.slowResolvedAt);
    const row = await pg.query(
      `SELECT status FROM public.notification_messages WHERE channel='email'`,
    );
    expect(row.rows[0].status).toBe("sent");
  });

  // ── C7.x / C5.4 webhook ──────────────────────────────────────────────────
  it("C7.2/C7.3/C7.4 a valid delivered event moves sent→delivered; an invalid signature is 400 and writes nothing", async () => {
    const app = await buildApp();
    await redeem(app);
    const before = await pg.query(
      `SELECT provider_message_id FROM public.notification_messages WHERE channel='email'`,
    );
    const providerId = String(before.rows[0].provider_message_id);

    const bad = await postWebhook(
      app,
      webhookBody("email.delivered", providerId),
      { signature: "v1,AAAA" },
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS c FROM public.notification_delivery_events`,
        )
      ).rows[0].c,
    ).toBe(0);
    expect(
      (
        await pg.query(
          `SELECT status FROM public.notification_messages WHERE channel='email'`,
        )
      ).rows[0].status,
    ).toBe("sent");

    const stale = await postWebhook(
      app,
      webhookBody("email.delivered", providerId),
      {
        timestamp: String(Math.floor(Date.now() / 1000) - 3600),
      },
    );
    expect(stale.status).toBe(400);

    const good = await postWebhook(
      app,
      webhookBody("email.delivered", providerId),
      { id: "msg_good" },
    );
    expect(good.status).toBe(200);
    expect(good.body.status).toBe("applied");
    const row = await pg.query(
      `SELECT status, delivered_at FROM public.notification_messages WHERE channel='email'`,
    );
    expect(row.rows[0].status).toBe("delivered");
    expect(row.rows[0].delivered_at).not.toBeNull();
    const ev = await pg.query(
      `SELECT outcome, message_id IS NOT NULL AS matched, applied_at IS NOT NULL AS applied FROM public.notification_delivery_events`,
    );
    expect(ev.rows).toEqual([
      { outcome: "applied", matched: true, applied: true },
    ]);
  });

  it("C5.4 a duplicate svix-id is a 200 no-op; open/click events are acknowledged and never recorded", async () => {
    const app = await buildApp();
    await redeem(app);
    const providerId = String(
      (
        await pg.query(
          `SELECT provider_message_id FROM public.notification_messages WHERE channel='email'`,
        )
      ).rows[0].provider_message_id,
    );

    const body = webhookBody("email.delivered", providerId);
    expect((await postWebhook(app, body, { id: "msg_dup" })).body.status).toBe(
      "applied",
    );
    const dup = await postWebhook(app, body, { id: "msg_dup" });
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe("duplicate");
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS c FROM public.notification_delivery_events`,
        )
      ).rows[0].c,
    ).toBe(1);

    const opened = await postWebhook(
      app,
      webhookBody("email.opened", providerId),
      { id: "msg_open" },
    );
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe("acknowledged");
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS c FROM public.notification_delivery_events`,
        )
      ).rows[0].c,
    ).toBe(1);

    // Terminal statuses do not move: a second delivered after bounced is recorded as ignored.
    expect(
      (
        await postWebhook(app, webhookBody("email.bounced", providerId), {
          id: "msg_bounce",
        })
      ).body.status,
    ).toBe("applied");
    const late = await postWebhook(
      app,
      webhookBody("email.delivered", providerId),
      { id: "msg_late" },
    );
    expect(late.body.status).toBe("ignored");
    expect(
      (
        await pg.query(
          `SELECT status FROM public.notification_messages WHERE channel='email'`,
        )
      ).rows[0].status,
    ).toBe("bounced");
  });

  it("C6.5 a webhook that lands before the send record is unmatched, then reconciled when the send is recorded", async () => {
    const app = await buildApp();
    const early = await postWebhook(
      app,
      webhookBody("email.delivered", "re_1"),
      { id: "msg_early" },
    );
    expect(early.status).toBe(200);
    expect(early.body.status).toBe("unmatched");
    await redeem(app); // fake Resend answers re_1 for the first send
    const row = await pg.query(
      `SELECT status, provider_message_id FROM public.notification_messages WHERE channel='email'`,
    );
    expect(row.rows[0]).toEqual({
      status: "delivered",
      provider_message_id: "re_1",
    });
    const ev = await pg.query(
      `SELECT outcome FROM public.notification_delivery_events WHERE provider_event_id='msg_early'`,
    );
    expect(ev.rows[0].outcome).toBe("applied");
  });

  it("C7.2 a missing webhook secret fails closed", async () => {
    const app = await buildApp();
    const saved = process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.RESEND_WEBHOOK_SECRET;
    try {
      const res = await postWebhook(
        app,
        webhookBody("email.delivered", "re_x"),
      );
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe("bad_signature");
    } finally {
      process.env.RESEND_WEBHOOK_SECRET = saved;
    }
  });

  // ── C9.x RLS ─────────────────────────────────────────────────────────────
  it("C9.1 a student sees only their own message rows; anon sees nothing", async () => {
    await redeem(await buildApp());
    await asRole("authenticated", STUDENT, async (run) => {
      const mine = await run(
        `SELECT recipient_profile_id FROM public.notification_messages`,
      );
      expect(mine.rows.map((r) => r.recipient_profile_id)).toEqual([STUDENT]);
      const events = run(`SELECT * FROM public.notification_events`);
      await expect(events).rejects.toMatchObject({ code: "42501" });
      const insert = run(
        `INSERT INTO public.notification_messages (event_id, recipient_profile_id, channel)
           SELECT event_id, $1, 'in_app' FROM public.notification_events`,
        [STUDENT],
      );
      await expect(insert).rejects.toMatchObject({ code: "42501" });
      await expect(
        run(`DELETE FROM public.notification_messages`),
      ).rejects.toMatchObject({ code: "42501" });
    });
    await asRole("anon", null, async (run) => {
      await expect(
        run(`SELECT * FROM public.notification_messages`),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("C9.2 a recipient may change seen_at/read_at/archived_at and nothing else", async () => {
    await redeem(await buildApp());
    await asRole("authenticated", STUDENT, async (run) => {
      const ok = await run(
        `UPDATE public.notification_messages SET seen_at = now(), read_at = now() WHERE recipient_profile_id = $1`,
        [STUDENT],
      );
      expect(ok.rowCount).toBe(1);
      for (const setter of [
        "status = 'queued'",
        "attempts = 7",
        "provider_message_id = 'x'",
        "last_error = 'x'",
        "sent_at = now()",
        "recipient_profile_id = '" + GUARDIAN + "'",
        "channel = 'email'",
      ]) {
        await expect(
          run(
            `UPDATE public.notification_messages SET ${setter} WHERE recipient_profile_id = $1`,
            [STUDENT],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      }
      // The guardian's row is invisible to the student's UPDATE: zero rows, no error.
      const other = await run(
        `UPDATE public.notification_messages SET seen_at = now() WHERE recipient_profile_id = $1`,
        [GUARDIAN],
      );
      expect(other.rowCount).toBe(0);
    });
  });

  // ── C1.3 cascade + negative control ──────────────────────────────────────
  it("C1.3 deleting a profile succeeds while its messages exist, and the messages are gone; with NO ACTION the same delete fails", async () => {
    const seed = async () => {
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ('44444444-4444-4444-8444-444444444444','d@example.test') ON CONFLICT DO NOTHING`,
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name) VALUES ('44444444-4444-4444-8444-444444444444','d@example.test','student','Del') ON CONFLICT DO NOTHING`,
      );
      const id = notificationEventId(
        "guardian_linked",
        `cascade-${Date.now()}`,
      );
      await pg.query(
        `SELECT public.emit_notification_event($1,'guardian_linked',$2,$3::jsonb,'{}'::jsonb)`,
        [
          id,
          STUDENT,
          JSON.stringify([
            {
              profile_id: "44444444-4444-4444-8444-444444444444",
              channels: ["in_app", "email"],
            },
          ]),
        ],
      );
    };
    await seed();
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS c FROM public.notification_messages WHERE recipient_profile_id='44444444-4444-4444-8444-444444444444'`,
        )
      ).rows[0].c,
    ).toBe(2);
    await pg.query(
      `DELETE FROM public.profiles WHERE id = '44444444-4444-4444-8444-444444444444'`,
    );
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS c FROM public.notification_messages WHERE recipient_profile_id='44444444-4444-4444-8444-444444444444'`,
        )
      ).rows[0].c,
    ).toBe(0);

    // Negative control: the guard must be observed failing on the assertion it names.
    await pg.query(
      `ALTER TABLE public.notification_messages DROP CONSTRAINT notification_messages_recipient_profile_id_fkey`,
    );
    await pg.query(`ALTER TABLE public.notification_messages ADD CONSTRAINT notification_messages_recipient_profile_id_fkey
                      FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE NO ACTION`);
    try {
      await seed();
      await expect(
        pg.query(
          `DELETE FROM public.profiles WHERE id = '44444444-4444-4444-8444-444444444444'`,
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(
        `ALTER TABLE public.notification_messages DROP CONSTRAINT notification_messages_recipient_profile_id_fkey`,
      );
      await pg.query(`ALTER TABLE public.notification_messages ADD CONSTRAINT notification_messages_recipient_profile_id_fkey
                        FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE`);
      await pg.query(
        `DELETE FROM public.profiles WHERE id = '44444444-4444-4444-8444-444444444444'`,
      );
    }
    const fk = await pg.query(
      `SELECT confdeltype FROM pg_constraint WHERE conname IN ('notification_messages_recipient_profile_id_fkey','notification_events_subject_profile_id_fkey')`,
    );
    expect(fk.rows.map((r) => r.confdeltype)).toEqual(["c", "c"]);
  });

  // ── C3.1 / C9.4 feed API ─────────────────────────────────────────────────
  it("C3.1/C9.4 the feed is recipient-scoped, rendered, in_app-only, and a foreign message id is 404", async () => {
    const app = await buildApp();
    await redeem(app);

    session.id = STUDENT;
    session.role = "student";
    const studentFeed = await request(app).get("/api/notifications");
    expect(studentFeed.status).toBe(200);
    expect(studentFeed.body.data.items).toHaveLength(1);
    expect(studentFeed.body.data.items[0].title).toBe(
      "A guardian is now linked to your account",
    );
    expect(studentFeed.body.data.nextCursor).toBeNull();

    session.id = GUARDIAN;
    session.role = "guardian";
    const guardianFeed = await request(app).get("/api/notifications");
    expect(guardianFeed.body.data.items).toHaveLength(1); // the email row is not a feed item
    expect(guardianFeed.body.data.items[0].title).toBe(
      "You're now linked to Sam Student",
    );
    expect(guardianFeed.body.data.items[0].href).toBe("/guardian");

    const unread = await request(app).get("/api/notifications/unread-count");
    expect(unread.body.data.unread).toBe(1);
    const marked = await request(app).post("/api/notifications/mark-all-seen");
    expect(marked.body.data.marked).toBe(1);
    expect(
      (await request(app).get("/api/notifications/unread-count")).body.data
        .unread,
    ).toBe(0);

    const studentsMessage = String(studentFeed.body.data.items[0].messageId);
    const foreign = await request(app)
      .patch(`/api/notifications/${studentsMessage}`)
      .send({ read: true });
    expect(foreign.status).toBe(404);
    expect(
      (
        await pg.query(
          `SELECT read_at FROM public.notification_messages WHERE message_id = $1`,
          [studentsMessage],
        )
      ).rows[0].read_at,
    ).toBeNull();

    const own = String(guardianFeed.body.data.items[0].messageId);
    const read = await request(app)
      .patch(`/api/notifications/${own}`)
      .send({ read: true });
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).not.toBeNull();
    const archived = await request(app)
      .patch(`/api/notifications/${own}`)
      .send({ archived: true });
    expect(archived.body.data.archivedAt).not.toBeNull();
    expect(
      (await request(app).get("/api/notifications")).body.data.items,
    ).toHaveLength(0);

    expect(
      (await request(app).patch(`/api/notifications/${own}`).send({})).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/notifications/not-a-uuid`)
          .send({ read: true })
      ).status,
    ).toBe(400);
  });

  it("feed cursor pagination walks every item exactly once", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i += 1) {
      await pg.query(
        `SELECT public.emit_notification_event($1,'guardian_linked',$2,$3::jsonb,$4::jsonb)`,
        [
          notificationEventId("guardian_linked", `page-${i}`),
          STUDENT,
          JSON.stringify([{ profile_id: GUARDIAN, channels: ["in_app"] }]),
          JSON.stringify({
            link_id: notificationEventId("guardian_linked", `page-${i}`),
            student_display_name: `S${i}`,
          }),
        ],
      );
    }
    const first = await request(app).get("/api/notifications?limit=2");
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.nextCursor).not.toBeNull();
    const second = await request(app).get(
      `/api/notifications?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
    );
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.nextCursor).toBeNull();
    const seen = new Set(
      [...first.body.data.items, ...second.body.data.items].map(
        (i: { messageId: string }) => i.messageId,
      ),
    );
    expect(seen.size).toBe(3);
    expect(
      (await request(app).get("/api/notifications?cursor=%%%")).status,
    ).toBe(400);
  });

  // ── C0.2 / C0.3 / C10.2 grep clauses ─────────────────────────────────────
  it("C0.2/C0.3/C10.2 only the transport talks to Resend; no contact@lyceon.ai; no console in the notification modules", () => {
    const root = path.resolve(__dirname, "../..");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of fs.readdirSync(path.join(root, dir))) {
        if (entry === "node_modules" || entry === "dist" || entry === ".git")
          continue;
        const rel = path.join(dir, entry);
        if (fs.statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
        else if (/\.(ts|tsx|sql|mjs)$/.test(entry)) out.push(rel);
      }
      return out;
    };
    const files = ["server", "apps", "packages", "client", "supabase"].flatMap(
      (d) => walk(d),
    );
    const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const resendCallers = files.filter(
      (f) => !/\.test\./.test(f) && /api\.resend\.com/.test(read(f)),
    );
    expect(resendCallers).toEqual(["server/lib/notifications/transport.ts"]);
    expect(
      files.filter(
        (f) => !/\.test\./.test(f) && read(f).includes("contact@lyceon.ai"),
      ),
    ).toEqual([]);
    const notificationModules = files.filter(
      (f) =>
        f.startsWith("server/lib/notifications/") ||
        f === "server/routes/notifications.ts" ||
        f === "server/routes/resend-webhook.ts",
    );
    expect(notificationModules.length).toBeGreaterThanOrEqual(8);
    expect(
      notificationModules.filter((f) => /\bconsole\./.test(read(f))),
    ).toEqual([]);
  });
});
