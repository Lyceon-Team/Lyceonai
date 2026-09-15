/**
 * guardian_unlinked — real PostgreSQL proof.
 *
 * @spec [Doc-01_V8 §36.3 Revocation ("either party"), §38.1, §12.1;
 *        contracts/notifications.contract.md C1.1, C2.2, C2.3, C5.1, C5.2, C8.1 for
 *        guardian_unlinked; owner brief 2026-09-15 Part A, tests A4.1–A4.6] | @implemented [2026-09-15]
 *
 * plain English: drives the REAL revoke routes (student side and guardian side), the REAL
 * `revoke_guardian_link_audited` function and the REAL migrations against a throwaway
 * Postgres. No table is mocked. Substituted: the database transport (`supabaseServer` → SQL
 * via tests/helpers/pg-supabase), the auth boundary (a session fixture), CSRF, and the
 * network (global `fetch` → an in-memory fake Resend that records every request).
 *
 * Every case was observed FAILING once against a deliberate mutation before it counted as a
 * gate (recorded in the PR body).
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
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { notificationEventId } from "../../server/lib/notifications/event-id";

const DB_NAME = "guardian_unlinked_ci";
const GUARDIAN = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const GUARDIAN_EMAIL = "guardian@example.test";
const STUDENT_EMAIL = "student@example.test";
const FROM_EMAIL = "notifications@send.example.test";
/** Distinctive on purpose: the A4.6 search string. */
const REASON = "ZEBRA-REASON-7f3a-never-leaks";

let pg: Client;
const session = { id: GUARDIAN, role: "guardian" as string };

type CapturedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
const fakeResend = { requests: [] as CapturedRequest[], nextId: 1 };

async function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  fakeResend.requests.push({
    url: typeof input === "string" ? input : input.toString(),
    headers: Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    ),
    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
  });
  return new Response(JSON.stringify({ id: `re_${fakeResend.nextId++}` }), {
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
  const studentRouter = (await import("../../server/routes/student-resources"))
    .default;
  const notificationsRouter = (
    await import("../../server/routes/notifications")
  ).default;
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "unlink-ci";
    next();
  });
  app.use("/api/guardian", guardianRouter);
  // Mounted exactly as server/index.ts mounts it: auth at the mount, the resolver per route.
  app.use("/api/students", requireSupabaseAuth, studentRouter);
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

/** Guardian redeems the student's code → one ACTIVE link. Returns its id. */
async function link(app: express.Express): Promise<string> {
  session.id = GUARDIAN;
  session.role = "guardian";
  const res = await request(app)
    .post("/api/guardian/link/redeem")
    .send({ code: await currentCode() });
  expect(res.status).toBe(201);
  // The link's own event is not under test here; clear it so counts below are ours.
  fakeResend.requests = [];
  return String(res.body.data.link_id);
}

async function unlinkedEvents(): Promise<
  Array<{ event_id: string; subject_profile_id: string; payload: unknown }>
> {
  const r = await pg.query(
    `SELECT event_id, subject_profile_id, payload FROM public.notification_events
      WHERE event_type = 'guardian_unlinked'`,
  );
  return r.rows as Array<{
    event_id: string;
    subject_profile_id: string;
    payload: unknown;
  }>;
}

async function messagesFor(
  eventId: string,
): Promise<
  Array<{ recipient_profile_id: string; channel: string; status: string }>
> {
  const r = await pg.query(
    `SELECT recipient_profile_id, channel, status FROM public.notification_messages
      WHERE event_id = $1 ORDER BY channel`,
    [eventId],
  );
  return r.rows as Array<{
    recipient_profile_id: string;
    channel: string;
    status: string;
  }>;
}

async function linkStatus(linkId: string): Promise<string> {
  const r = await pg.query(
    `SELECT status FROM public.guardian_links WHERE id = $1`,
    [linkId],
  );
  return String(r.rows[0]?.status);
}

describe.skipIf(!PG_AVAILABLE)("guardian_unlinked — real Postgres", () => {
  beforeAll(async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFICATION_FROM_EMAIL = FROM_EMAIL;
    process.env.PUBLIC_SITE_URL = "https://app.example.test";
    vi.stubGlobal("fetch", fakeFetch);

    pg = await bootstrapPgDatabase(DB_NAME);
    await pg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
      [
        GUARDIAN,
        GUARDIAN_EMAIL,
        STUDENT,
        STUDENT_EMAIL,
        OUTSIDER,
        "o@example.test",
      ],
    );
    await pg.query(
      `INSERT INTO public.profiles (id, email, role, display_name) VALUES
         ($1,$2,'guardian','Gia Guardian'),($3,$4,'student','Sam Student'),($5,$6,'student','Otto Outsider')`,
      [
        GUARDIAN,
        GUARDIAN_EMAIL,
        STUDENT,
        STUDENT_EMAIL,
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

  it("C1.1 the CHECK admits exactly guardian_linked and guardian_unlinked", async () => {
    const r = await pg.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'notification_events' AND c.conname = 'notification_events_type_check'`,
    );
    const def = String(r.rows[0]?.def);
    expect(def).toContain("guardian_linked");
    expect(def).toContain("guardian_unlinked");
    await expect(
      pg.query(
        `INSERT INTO public.notification_events (event_id, event_type, subject_profile_id)
         VALUES (gen_random_uuid(), 'guardian_something_else', $1)`,
        [STUDENT],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("A4.1 student revokes → exactly one event; messages to the GUARDIAN (in_app + email), none to the student", async () => {
    const app = await buildApp();
    const linkId = await link(app);

    session.id = STUDENT;
    session.role = "student";
    const res = await request(app).delete(
      `/api/students/${STUDENT}/links/${linkId}`,
    );
    expect(res.status).toBe(200);
    expect(await linkStatus(linkId)).toBe("revoked");

    const events = await unlinkedEvents();
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.subject_profile_id).toBe(STUDENT);
    expect(event.event_id).toBe(
      notificationEventId("guardian_unlinked", linkId),
    );

    const messages = await messagesFor(event.event_id);
    expect(messages.map((m) => [m.recipient_profile_id, m.channel])).toEqual([
      [GUARDIAN, "email"],
      [GUARDIAN, "in_app"],
    ]);
    expect(messages.find((m) => m.channel === "in_app")?.status).toBe(
      "delivered",
    );
    // Inline dispatch: the email went out before the response, to the guardian's address.
    expect(fakeResend.requests).toHaveLength(1);
    const sent = fakeResend.requests[0]!;
    expect(sent.body.to).toEqual([GUARDIAN_EMAIL]);
    expect(String(sent.body.subject)).toContain("Sam Student");
    expect(String(sent.body.subject)).toMatch(/removed/i);
    expect(messages.find((m) => m.channel === "email")?.status).toBe("sent");
  });

  it("A4.2 guardian revokes → messages to the STUDENT (in_app + email), none to the guardian", async () => {
    const app = await buildApp();
    const linkId = await link(app);

    const res = await request(app).delete(`/api/guardian/link/${STUDENT}`);
    expect(res.status).toBe(200);

    const events = await unlinkedEvents();
    expect(events).toHaveLength(1);
    const messages = await messagesFor(events[0]!.event_id);
    expect(messages.map((m) => [m.recipient_profile_id, m.channel])).toEqual([
      [STUDENT, "email"],
      [STUDENT, "in_app"],
    ]);
    expect(fakeResend.requests).toHaveLength(1);
    expect(fakeResend.requests[0]!.body.to).toEqual([STUDENT_EMAIL]);
    expect(String(fakeResend.requests[0]!.body.subject)).toContain(
      "Gia Guardian",
    );
    expect(await linkStatus(linkId)).toBe("revoked");
  });

  it("A4.3 revoking an already-revoked link raises LY003, emits nothing, and the route returns 409", async () => {
    const app = await buildApp();
    const linkId = await link(app);
    session.id = STUDENT;
    session.role = "student";
    expect(
      (await request(app).delete(`/api/students/${STUDENT}/links/${linkId}`))
        .status,
    ).toBe(200);
    expect(await unlinkedEvents()).toHaveLength(1);
    fakeResend.requests = [];

    const again = await request(app).delete(
      `/api/students/${STUDENT}/links/${linkId}`,
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("LINK_NOT_ACTIVE");
    expect(await unlinkedEvents()).toHaveLength(1);
    expect(fakeResend.requests).toHaveLength(0);

    // The SQLSTATE itself, straight from the function.
    await expect(
      pg.query(
        `SELECT public.revoke_guardian_link_audited($1, $2, $3, NULL, 'unlink-ci')`,
        [GUARDIAN, STUDENT, STUDENT],
      ),
    ).rejects.toMatchObject({ code: "LY003" });
    expect(await unlinkedEvents()).toHaveLength(1);
  });

  it("A4.4 a student cannot revoke a link they are not the student on — 404, link untouched, nothing emitted", async () => {
    const app = await buildApp();
    const linkId = await link(app);

    session.id = OUTSIDER;
    session.role = "student";
    // Addressing their own subject with someone else's link id.
    const ownSubject = await request(app).delete(
      `/api/students/${OUTSIDER}/links/${linkId}`,
    );
    expect(ownSubject.status).toBe(404);
    // Addressing the other student's subject directly: the resolver denies before the handler.
    const otherSubject = await request(app).delete(
      `/api/students/${STUDENT}/links/${linkId}`,
    );
    expect(otherSubject.status).toBe(404);
    expect(otherSubject.body).toEqual(ownSubject.body); // one 404 shape, Q7

    expect(await linkStatus(linkId)).toBe("active");
    expect(await unlinkedEvents()).toHaveLength(0);
    expect(fakeResend.requests).toHaveLength(0);
  });

  it("A4.5 C2.2 rolling back the revoke transaction leaves zero events and zero messages", async () => {
    const app = await buildApp();
    const linkId = await link(app);

    await pg.query("BEGIN");
    const inTx = await pg.query(
      `SELECT public.revoke_guardian_link_audited($1, $2, $3, $4, 'unlink-ci') AS row`,
      [GUARDIAN, STUDENT, STUDENT, REASON],
    );
    expect(inTx.rowCount).toBe(1);
    const during = await pg.query(
      `SELECT count(*)::int AS c FROM public.notification_events WHERE event_type = 'guardian_unlinked'`,
    );
    expect(during.rows[0].c).toBe(1); // visible inside the transaction …
    await pg.query("ROLLBACK");

    expect(await unlinkedEvents()).toHaveLength(0); // … and gone with it
    // Only the guardian_linked rows from the link() helper remain — none for the unlink.
    const messages = await pg.query(
      `SELECT count(*)::int AS c FROM public.notification_messages m
         JOIN public.notification_events e ON e.event_id = m.event_id
        WHERE e.event_type = 'guardian_unlinked'`,
    );
    expect(messages.rows[0].c).toBe(0);
    expect(await linkStatus(linkId)).toBe("active");
  });

  it("A4.6 revocation_reason appears in NO payload, NO rendered email, NO in-app item, and NO audit changes — only on the row", async () => {
    const app = await buildApp();
    const linkId = await link(app);

    session.id = STUDENT;
    session.role = "student";
    const res = await request(app)
      .delete(`/api/students/${STUDENT}/links/${linkId}`)
      .send({ reason: REASON });
    expect(res.status).toBe(200);

    // Positive control: the reason WAS stored, so its absence elsewhere is meaningful.
    const row = await pg.query(
      `SELECT revocation_reason FROM public.guardian_links WHERE id = $1`,
      [linkId],
    );
    expect(row.rows[0].revocation_reason).toBe(REASON);

    const events = await unlinkedEvents();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.payload)).not.toContain(REASON);
    expect(Object.keys(events[0]!.payload as object).sort()).toEqual([
      "guardian_display_name",
      "link_id",
      "student_display_name",
    ]);

    expect(fakeResend.requests).toHaveLength(1);
    const email = fakeResend.requests[0]!;
    expect(JSON.stringify(email.body)).not.toContain(REASON);
    expect(JSON.stringify(email.headers)).not.toContain(REASON);

    // The guardian's feed renders the in-app copy; the reason is not in it.
    session.id = GUARDIAN;
    session.role = "guardian";
    const feed = await request(app).get("/api/notifications");
    expect(feed.status).toBe(200);
    const unlinkedItems = (
      feed.body.data.items as Array<{ title: string; body: string }>
    ).filter((i) => /removed/i.test(i.title));
    expect(unlinkedItems).toHaveLength(1);
    expect(JSON.stringify(feed.body)).not.toContain(REASON);

    const audit = await pg.query(
      `SELECT changes::text AS changes FROM public.audit_logs
        WHERE action = 'guardian_link_revoked' AND context ->> 'link_id' = $1`,
      [linkId],
    );
    expect(audit.rowCount).toBe(1);
    expect(String(audit.rows[0].changes)).not.toContain(REASON);
  });

  it("C5.1/C5.2 the id is derived from the link row, cannot collide with guardian_linked for the same row, and a replay is a no-op", async () => {
    const app = await buildApp();
    const linkId = await link(app);

    const ids = await pg.query(
      `SELECT public.notification_event_id('guardian_linked', $1) AS linked,
              public.notification_event_id('guardian_unlinked', $1) AS unlinked`,
      [linkId],
    );
    expect(ids.rows[0].linked).not.toBe(ids.rows[0].unlinked);
    expect(ids.rows[0].unlinked).toBe(
      notificationEventId("guardian_unlinked", linkId),
    );

    session.id = STUDENT;
    session.role = "student";
    await request(app).delete(`/api/students/${STUDENT}/links/${linkId}`);
    const before = await pg.query(
      `SELECT (SELECT count(*)::int FROM public.notification_events) AS e,
              (SELECT count(*)::int FROM public.notification_messages) AS m`,
    );
    // Replaying the emit with the same id changes nothing.
    await pg.query(
      `SELECT public.emit_notification_event($1, 'guardian_unlinked', $2,
         '[{"profile_id":"${GUARDIAN}","channels":["in_app","email"]}]'::jsonb, '{}'::jsonb)`,
      [notificationEventId("guardian_unlinked", linkId), STUDENT],
    );
    const after = await pg.query(
      `SELECT (SELECT count(*)::int FROM public.notification_events) AS e,
              (SELECT count(*)::int FROM public.notification_messages) AS m`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    // A re-created link is a NEW row and therefore a new id.
    const relinked = await link(app);
    expect(relinked).not.toBe(linkId);
    expect(notificationEventId("guardian_unlinked", relinked)).not.toBe(
      notificationEventId("guardian_unlinked", linkId),
    );
  });

  it("GET /api/students/:id/links lists the student's active guardians (identity only); a guardian on that route is 404", async () => {
    const app = await buildApp();
    const linkId = await link(app);

    session.id = STUDENT;
    session.role = "student";
    const mine = await request(app).get(`/api/students/${STUDENT}/links`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.links).toEqual([
      expect.objectContaining({
        link_id: linkId,
        guardian_display_name: "Gia Guardian",
      }),
    ]);
    expect(Object.keys(mine.body.data.links[0]).sort()).toEqual([
      "guardian_display_name",
      "link_id",
      "linked_at",
    ]);

    // A LINKED guardian on this route never sees the list: the resolver's entitlement term
    // fires first (402 — this student is unentitled), and a party is a `via='guardian'`
    // subject the handler 404s anyway. A stranger is the resolver's 404.
    session.id = GUARDIAN;
    session.role = "guardian";
    const theirs = await request(app).get(`/api/students/${STUDENT}/links`);
    expect([402, 404]).toContain(theirs.status);
    expect(theirs.body.data).toBeUndefined();
    session.id = OUTSIDER;
    session.role = "student";
    const stranger = await request(app).get(`/api/students/${STUDENT}/links`);
    expect(stranger.status).toBe(404);

    session.id = STUDENT;
    session.role = "student";
    await request(app).delete(`/api/students/${STUDENT}/links/${linkId}`);
    const afterRevoke = await request(app).get(
      `/api/students/${STUDENT}/links`,
    );
    expect(afterRevoke.body.data.links).toEqual([]);
  });
});
