/**
 * Marketing email lane — real PostgreSQL proof.
 *
 * @spec [contracts/notifications.contract.md §14 and C7.4 (amended 2026-10-07); docs/plans/seo/
 *       seo-marketing-vertical.md row D3, R26; Privacy Policy v6 §9.2; owner brief "SEO vertical
 *       — email lane" acceptance evidence + Step 0 decisions 2026-10-07] | @implemented [2026-10-07]
 *
 * plain English: the brief's acceptance list, one `it` per observation, against the REAL
 * migrations, the REAL SQL functions, the REAL reconcile and the REAL webhook receiver. What is
 * substituted: the database transport (`supabaseServer` → SQL via tests/helpers/pg-supabase),
 * the network (a stateful in-memory Resend that keeps contacts and segments the way the API
 * describes them), and the logger (captured, so the suite can prove no address is logged).
 *
 *   S1  opt-in → contact created in the right segment (student → students, guardian → guardians)
 *   S2  opt-out in Lyceon → contact deleted at the next run, record forgotten
 *   S3  under-13 and no date of birth → never synced, even if a legacy row slipped past the guard
 *   S4  a pending deletion request → removed at the next run (marketing stops at the request)
 *   S5  the reconcile brings an unsubscribe back BEFORE deleting, including a manual import's
 *   S6  every contact no eligible profile backs is deleted; a foreign segment is reported
 *   S7  a failed read writes nothing; a second run over a correct state writes nothing
 *   S8  past the write deadline the rest is deferred to the next run
 *   W1  bad / missing signature → 400, no row
 *   W2  contact.updated unsubscribed → opt-in false + one consent-log row `email_unsubscribe`
 *   W3  replaying it → `duplicate`, no second row
 *   W4  email.complained → opt-in false + `email_complaint`, and the delivery status still applies
 *   W5  a contact update that is not an unsubscribe changes nothing
 *   D1  a provider source can never grant
 *   L1  no address appears in any log line
 * Account deletion's own removal (T+7) is asserted in tests/ci/deletion-completed-notice.pg.ci
 * .test.ts A4.1, where the executor runs end to end.
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
import type { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { RESEND_WEBHOOK_PATH } from "../../packages/shared/src/notifications-schema";

const DB_NAME = "marketing_email_sync_ci";
const WEBHOOK_SECRET = `whsec_${randomBytes(32).toString("base64")}`;
const SEG_STUDENTS = "seg_students_0001";
const SEG_GUARDIANS = "seg_guardians_0002";
const SEG_LEGACY = "seg_launch_manual";

const TEEN = {
  id: "e1000000-0000-4000-8000-000000000001",
  email: "teen@x.test",
};
const PARENT = {
  id: "e1000000-0000-4000-8000-000000000002",
  email: "parent@x.test",
};
const CHILD = {
  id: "e1000000-0000-4000-8000-000000000003",
  email: "child@x.test",
};
const NODOB = {
  id: "e1000000-0000-4000-8000-000000000004",
  email: "nodob@x.test",
};
const LEAVER = {
  id: "e1000000-0000-4000-8000-000000000005",
  email: "leaver@x.test",
};
const PEOPLE = [TEEN, PARENT, CHILD, NODOB, LEAVER];

let pg: Client;

// ── Stateful fake Resend ───────────────────────────────────────────────────────────────────
type FakeContact = {
  id: string;
  email: string;
  unsubscribed: boolean;
  segments: Set<string>;
};
const resend = {
  contacts: new Map<string, FakeContact>(),
  segments: [] as { id: string; name: string }[],
  nextId: 1,
  failListContacts: false,
  writes: [] as string[],
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function page<T extends { id: string }>(items: T[], url: URL): Response {
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const after = url.searchParams.get("after");
  const start = after ? items.findIndex((i) => i.id === after) + 1 : 0;
  const slice = items.slice(start, start + limit);
  return json({
    object: "list",
    has_more: start + limit < items.length,
    data: slice,
  });
}
function findContact(idOrEmail: string): FakeContact | undefined {
  return (
    resend.contacts.get(idOrEmail) ??
    [...resend.contacts.values()].find(
      (c) => c.email === idOrEmail.toLowerCase(),
    )
  );
}
async function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body
    ? (JSON.parse(String(init.body)) as Record<string, unknown>)
    : null;
  if (method === "GET" && url.pathname === "/segments") {
    return page(resend.segments, url);
  }
  if (method === "GET" && url.pathname === "/contacts") {
    if (resend.failListContacts) return json({ message: "down" }, 500);
    const seg = url.searchParams.get("segment_id");
    const items = [...resend.contacts.values()]
      .filter((c) => seg === null || c.segments.has(seg))
      .map((c) => ({ id: c.id, email: c.email, unsubscribed: c.unsubscribed }));
    return page(items, url);
  }
  if (method === "POST" && url.pathname === "/contacts") {
    const email = String(body?.email);
    if (findContact(email)) return json({ message: "exists" }, 409);
    const id = `c_${String(resend.nextId++).padStart(4, "0")}`;
    const segments = new Set(
      ((body?.segments as { id: string }[] | undefined) ?? []).map((s) => s.id),
    );
    resend.contacts.set(id, {
      id,
      email,
      unsubscribed: body?.unsubscribed === true,
      segments,
    });
    resend.writes.push(`create ${id}`);
    return json({ object: "contact", id });
  }
  const del = /^\/contacts\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && del) {
    const c = findContact(decodeURIComponent(del[1]!));
    if (!c) return json({ message: "not found" }, 404);
    resend.contacts.delete(c.id);
    resend.writes.push(`delete ${c.id}`);
    return json({ object: "contact", contact: c.id, deleted: true });
  }
  return json({ message: `unexpected ${method} ${url.pathname}` }, 500);
}
function seedContact(
  email: string,
  segments: string[],
  unsubscribed = false,
): string {
  const id = `c_${String(resend.nextId++).padStart(4, "0")}`;
  resend.contacts.set(id, {
    id,
    email,
    unsubscribed,
    segments: new Set(segments),
  });
  return id;
}
function contactOf(email: string): FakeContact | undefined {
  return [...resend.contacts.values()].find((c) => c.email === email);
}

// ── Log capture ────────────────────────────────────────────────────────────────────────────
const captured: string[] = [];
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]): void => {
    captured.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

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

const ENV = {
  RESEND_API_KEY: "re_test_key",
  RESEND_SEGMENT_ID_STUDENTS: SEG_STUDENTS,
  RESEND_SEGMENT_ID_GUARDIANS: SEG_GUARDIANS,
} as NodeJS.ProcessEnv;

async function reconcile(
  now?: () => number,
): Promise<
  Awaited<
    ReturnType<
      typeof import("../../server/lib/marketing-email-sync").reconcileMarketingContacts
    >
  >
> {
  const { reconcileMarketingContacts } =
    await import("../../server/lib/marketing-email-sync");
  const { createResendContactsTransport } =
    await import("../../server/lib/notifications/transport");
  return reconcileMarketingContacts({
    db: makePgSupabase(pg),
    contacts: createResendContactsTransport({ fetchImpl: fakeFetch, env: ENV }),
    env: ENV,
    pause: async () => undefined,
    ...(now ? { now } : {}),
  });
}

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

async function optIn(id: string, granted: boolean): Promise<void> {
  const r = await pg.query<{ r: { ok: boolean } }>(
    `SELECT public.set_marketing_consent($1, $2, 'settings', '1.0.0') AS r`,
    [id, granted],
  );
  expect(r.rows[0]?.r.ok).toBe(true);
}

async function optedIn(id: string): Promise<boolean> {
  const r = await pg.query<{ marketing_opt_in: boolean }>(
    `SELECT marketing_opt_in FROM public.profiles WHERE id = $1`,
    [id],
  );
  return r.rows[0]?.marketing_opt_in === true;
}

async function logOf(
  id: string,
): Promise<{ granted: boolean; source: string }[]> {
  const r = await pg.query<{ granted: boolean; source: string }>(
    `SELECT granted, source FROM public.marketing_consent_log WHERE profile_id = $1 ORDER BY id`,
    [id],
  );
  return r.rows;
}

// ── Webhook app ────────────────────────────────────────────────────────────────────────────
async function buildApp(): Promise<express.Express> {
  const { resendWebhookHandler } =
    await import("../../server/routes/resend-webhook");
  const app = express();
  app.post(
    RESEND_WEBHOOK_PATH,
    express.raw({ type: "application/json" }),
    resendWebhookHandler,
  );
  return app;
}
function sign(id: string, ts: string, body: string): string {
  const key = Buffer.from(WEBHOOK_SECRET.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}
async function post(
  app: express.Express,
  body: string,
  opts: { id?: string; signature?: string } = {},
): Promise<request.Response> {
  const id = opts.id ?? `msg_${randomBytes(6).toString("hex")}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return request(app)
    .post(RESEND_WEBHOOK_PATH)
    .set("Content-Type", "application/json")
    .set("svix-id", id)
    .set("svix-timestamp", ts)
    .set("svix-signature", opts.signature ?? sign(id, ts, body))
    .send(body);
}
function contactUpdated(
  contactId: string,
  email: string,
  unsubscribed: boolean,
): string {
  return JSON.stringify({
    type: "contact.updated",
    created_at: new Date().toISOString(),
    data: {
      id: contactId,
      audience_id: "aud_1",
      segment_ids: [SEG_STUDENTS],
      email,
      first_name: null,
      last_name: null,
      unsubscribed,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
}

describe.skipIf(!PG_AVAILABLE)("marketing email lane — real Postgres", () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    pg = await bootstrapPgDatabase(DB_NAME);
    for (const p of PEOPLE) {
      await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        p.id,
        p.email,
      ]);
    }
    app = await buildApp();
  }, 180_000);

  afterAll(async () => {
    await pg?.end();
  });

  beforeEach(async () => {
    captured.length = 0;
    resend.contacts.clear();
    resend.nextId = 1;
    resend.failListContacts = false;
    resend.writes = [];
    resend.segments = [
      { id: SEG_STUDENTS, name: "Marketing — students" },
      { id: SEG_GUARDIANS, name: "Marketing — guardians" },
    ];
    await pg.query(`DELETE FROM public.marketing_email_webhook_events`);
    await pg.query(`DELETE FROM public.account_deletion_requests`);
    await pg.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
      PEOPLE.map((p) => p.id),
    ]);
    await pg.query(
      `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at)
       VALUES ($1, $2, 'student', 'Teen', $3::date, now()),
              ($4, $5, 'guardian', 'Parent', $6::date, now()),
              ($7, $8, 'student', 'Child', $9::date, now()),
              ($10, $11, 'guardian', 'NoDob', NULL, now()),
              ($12, $13, 'student', 'Leaver', $14::date, now())`,
      [
        TEEN.id,
        TEEN.email,
        yearsAgo(15),
        PARENT.id,
        PARENT.email,
        yearsAgo(40),
        CHILD.id,
        CHILD.email,
        yearsAgo(10),
        NODOB.id,
        NODOB.email,
        LEAVER.id,
        LEAVER.email,
        yearsAgo(16),
      ],
    );
  });

  // ── Lyceon → Resend ────────────────────────────────────────────────────────────────────
  it("S1 opt-in → a contact in the right segment, recorded by contact id (no address stored)", async () => {
    await optIn(TEEN.id, true);
    await optIn(PARENT.id, true);
    const summary = await reconcile();
    expect(summary).toMatchObject({
      ok: true,
      aborted: null,
      eligible: 2,
      created: 2,
    });

    expect([...(contactOf(TEEN.email)?.segments ?? [])]).toEqual([
      SEG_STUDENTS,
    ]);
    expect([...(contactOf(PARENT.email)?.segments ?? [])]).toEqual([
      SEG_GUARDIANS,
    ]);
    expect(contactOf(TEEN.email)?.unsubscribed).toBe(false);

    const rows = await pg.query(
      `SELECT profile_id, resend_contact_id, segment FROM public.marketing_email_contacts ORDER BY segment`,
    );
    expect(rows.rows).toEqual([
      {
        profile_id: PARENT.id,
        resend_contact_id: contactOf(PARENT.email)?.id,
        segment: "guardians",
      },
      {
        profile_id: TEEN.id,
        resend_contact_id: contactOf(TEEN.email)?.id,
        segment: "students",
      },
    ]);
    const cols = await pg.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('marketing_email_contacts', 'marketing_email_webhook_events')`,
    );
    expect(
      cols.rows.map((r: { column_name: string }) => r.column_name),
    ).not.toContain("email");
  });

  it("S2 opt-out in Lyceon → the contact is deleted at the next run and its record forgotten", async () => {
    await optIn(TEEN.id, true);
    await reconcile();
    expect(contactOf(TEEN.email)).toBeDefined();

    await optIn(TEEN.id, false);
    const summary = await reconcile();
    expect(summary).toMatchObject({
      ok: true,
      deleted: 1,
      forgotten: 1,
      created: 0,
    });
    expect(contactOf(TEEN.email)).toBeUndefined();
    const left = await pg.query(
      `SELECT 1 FROM public.marketing_email_contacts`,
    );
    expect(left.rowCount).toBe(0);
  });

  it("S3 under-13 and no date of birth are never synced — even a legacy opted-in row that slipped past the trigger", async () => {
    // The DB guard refuses these opt-ins outright...
    const child = await pg.query<{ r: { ok: boolean; reason?: string } }>(
      `SELECT public.set_marketing_consent($1, true, 'settings', '1.0.0') AS r`,
      [CHILD.id],
    );
    expect(child.rows[0]?.r).toEqual({ ok: false, reason: "age_ineligible" });
    // ...so prove the audience's OWN age check by planting rows the trigger never saw.
    await pg.query(`SET session_replication_role = replica`);
    await pg.query(
      `UPDATE public.profiles SET marketing_opt_in = true WHERE id = ANY($1::uuid[])`,
      [[CHILD.id, NODOB.id]],
    );
    await pg.query(`SET session_replication_role = origin`);
    expect(await optedIn(CHILD.id)).toBe(true);

    const summary = await reconcile();
    expect(summary).toMatchObject({ ok: true, eligible: 0, created: 0 });
    expect(contactOf(CHILD.email)).toBeUndefined();
    expect(contactOf(NODOB.email)).toBeUndefined();
  });

  it("S4 a pending deletion request removes the contact at the next run (marketing stops at the request)", async () => {
    await optIn(LEAVER.id, true);
    await reconcile();
    expect(contactOf(LEAVER.email)).toBeDefined();

    await pg.query(
      `INSERT INTO public.account_deletion_requests
         (profile_id, scheduled_hard_delete_at, actor_profile_id, status)
       VALUES ($1, now() + interval '7 days', $1, 'pending')`,
      [LEAVER.id],
    );
    const summary = await reconcile();
    expect(summary).toMatchObject({ ok: true, eligible: 0, deleted: 1 });
    expect(contactOf(LEAVER.email)).toBeUndefined();
  });

  it("S5 an unsubscribe in Resend comes back BEFORE the contact is deleted — a manual launch contact included", async () => {
    await optIn(TEEN.id, true);
    await optIn(PARENT.id, true);
    // The launch import: the teen unsubscribed from the notice; the parent did not.
    const teenManual = seedContact(TEEN.email, [SEG_LEGACY], true);
    seedContact(PARENT.email, [SEG_LEGACY], false);
    resend.segments.push({ id: SEG_LEGACY, name: "Launch — friends & family" });

    const summary = await reconcile();
    expect(summary.optedOut).toBe(1);
    expect(await optedIn(TEEN.id)).toBe(false);
    expect((await logOf(TEEN.id)).at(-1)).toEqual({
      granted: false,
      source: "email_unsubscribe",
    });
    // the unsubscribed contact is gone, and NOT re-created
    expect(resend.contacts.has(teenManual)).toBe(false);
    expect(contactOf(TEEN.email)).toBeUndefined();
    // the parent's manual contact is replaced by one in the synced guardians segment
    expect([...(contactOf(PARENT.email)?.segments ?? [])]).toEqual([
      SEG_GUARDIANS,
    ]);
    // ledger: one row, keyed by the contact, applied
    const ledger = await pg.query(
      `SELECT provider_event_id, event_type, outcome FROM public.marketing_email_webhook_events`,
    );
    expect(ledger.rows).toEqual([
      {
        provider_event_id: `reconcile:${teenManual}`,
        event_type: "reconcile.unsubscribed",
        outcome: "applied",
      },
    ]);
  });

  it("S6 every contact no eligible profile backs is deleted, and a foreign segment is reported", async () => {
    seedContact("stranger@x.test", [SEG_LEGACY]);
    seedContact(CHILD.email, ["seg_general"]);
    resend.segments.push({
      id: SEG_LEGACY,
      name: "Launch — all account holders (batch 2)",
    });
    const summary = await reconcile();
    expect(summary).toMatchObject({ deleted: 2, foreignSegments: 1 });
    expect(resend.contacts.size).toBe(0);
    expect(
      captured.some(
        (l) => l.includes("foreign_segment_present") && l.includes(SEG_LEGACY),
      ),
    ).toBe(true);
  });

  it("S7 a failed read writes nothing; a missing segment writes nothing; a correct state writes nothing", async () => {
    seedContact("stranger@x.test", []);
    resend.failListContacts = true;
    expect(await reconcile()).toMatchObject({
      ok: false,
      aborted: "read_failed",
      deleted: 0,
    });
    expect(resend.writes).toEqual([]);

    resend.failListContacts = false;
    resend.segments = resend.segments.filter((s) => s.id !== SEG_GUARDIANS);
    expect(await reconcile()).toMatchObject({
      ok: false,
      aborted: "segment_missing",
    });
    expect(resend.writes).toEqual([]);

    resend.segments.push({ id: SEG_GUARDIANS, name: "Marketing — guardians" });
    await optIn(TEEN.id, true);
    await reconcile();
    resend.writes = [];
    expect(await reconcile()).toMatchObject({
      ok: true,
      created: 0,
      deleted: 0,
      recorded: 0,
    });
    expect(resend.writes).toEqual([]);
  });

  it("S8 past the write deadline the rest is deferred, and the next run finishes it", async () => {
    await optIn(TEEN.id, true);
    await optIn(PARENT.id, true);
    // The clock reads 0 at the start, then jumps past the deadline after the first write.
    let calls = 0;
    const clock = (): number => (calls++ < 2 ? 0 : 10 * 60 * 1000);
    const first = await reconcile(clock);
    expect(first).toMatchObject({ created: 1, deferred: 1 });
    expect(resend.contacts.size).toBe(1);
    const second = await reconcile();
    expect(second).toMatchObject({ ok: true, created: 1, deferred: 0 });
    expect(resend.contacts.size).toBe(2);
  });

  // ── Resend → Lyceon ────────────────────────────────────────────────────────────────────
  it("W1 a bad or missing signature is rejected with 400 and writes nothing", async () => {
    await optIn(TEEN.id, true);
    const body = contactUpdated("c_x", TEEN.email, true);
    const bad = await post(app, body, { signature: "v1,AAAA" });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe("bad_signature");
    expect(await optedIn(TEEN.id)).toBe(true);
    const ledger = await pg.query(
      `SELECT 1 FROM public.marketing_email_webhook_events`,
    );
    expect(ledger.rowCount).toBe(0);
  });

  it("W2 contact.updated with unsubscribed → opt-in false and ONE consent-log row `email_unsubscribe`", async () => {
    await optIn(TEEN.id, true);
    await reconcile();
    const contactId = contactOf(TEEN.email)!.id;
    const res = await post(app, contactUpdated(contactId, TEEN.email, true));
    expect(res.status).toBe(200);
    expect(await optedIn(TEEN.id)).toBe(false);
    expect(await logOf(TEEN.id)).toEqual([
      { granted: true, source: "settings" },
      { granted: false, source: "email_unsubscribe" },
    ]);
  });

  it("W3 replaying the same webhook → `duplicate`, no second consent-log row", async () => {
    await optIn(TEEN.id, true);
    const body = contactUpdated("c_unknown", TEEN.email, true); // matched by address
    const first = await post(app, body, { id: "msg_replay_1" });
    const again = await post(app, body, { id: "msg_replay_1" });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("duplicate");
    expect(
      (await logOf(TEEN.id)).filter((r) => r.source === "email_unsubscribe"),
    ).toHaveLength(1);
    // A different event for someone already opted out writes no row either.
    await post(app, body, { id: "msg_replay_2" });
    expect(
      (await logOf(TEEN.id)).filter((r) => r.source === "email_unsubscribe"),
    ).toHaveLength(1);
  });

  it("W4 email.complained → opt-in false with `email_complaint`, and the delivery status is still recorded", async () => {
    await optIn(PARENT.id, true);
    const res = await post(
      app,
      JSON.stringify({
        type: "email.complained",
        created_at: new Date().toISOString(),
        data: {
          email_id: "re_broadcast_1",
          to: [PARENT.email.toUpperCase()],
          subject: "x",
        },
      }),
      { id: "msg_complaint_1" },
    );
    expect(res.status).toBe(200);
    expect(await optedIn(PARENT.id)).toBe(false);
    expect((await logOf(PARENT.id)).at(-1)).toEqual({
      granted: false,
      source: "email_complaint",
    });
    const delivery = await pg.query(
      `SELECT event_type FROM public.notification_delivery_events WHERE provider_event_id = 'msg_complaint_1'`,
    );
    expect(delivery.rows).toEqual([{ event_type: "email.complained" }]);
  });

  it("W5 a contact update that is not an unsubscribe changes nothing", async () => {
    await optIn(TEEN.id, true);
    const res = await post(app, contactUpdated("c_x", TEEN.email, false));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
    expect(await optedIn(TEEN.id)).toBe(true);
  });

  it("D1 a provider source can only withdraw, never grant", async () => {
    await expect(
      pg.query(
        `SELECT public.set_marketing_consent($1, true, 'email_unsubscribe', '1.0.0')`,
        [TEEN.id],
      ),
    ).rejects.toThrow(/can only withdraw/);
    await expect(
      pg.query(
        `SELECT public.set_marketing_consent($1, true, 'email_complaint', '1.0.0')`,
        [TEEN.id],
      ),
    ).rejects.toThrow(/can only withdraw/);
  });

  it("L1 no address appears in any log line — reconcile, webhook and complaint paths", async () => {
    await optIn(TEEN.id, true);
    await optIn(PARENT.id, true);
    seedContact("stranger@x.test", [], true);
    await reconcile();
    await post(
      app,
      contactUpdated(contactOf(TEEN.email)!.id, TEEN.email, true),
    );
    await post(
      app,
      JSON.stringify({
        type: "email.complained",
        created_at: new Date().toISOString(),
        data: { email_id: "re_2", to: [PARENT.email] },
      }),
    );
    expect(captured.length).toBeGreaterThan(3);
    for (const line of captured) {
      expect(line).not.toMatch(/@x\.test/i);
    }
  });
});
