/**
 * Notification retention sweep + notifications-page API — real PostgreSQL proof.
 *
 * @spec [contracts/notifications.contract.md §11 (C11.1 window, C11.2 sweep, C11.3 every
 *        run logged), §3.1 (archive view), §3.2 (mark-all-read), §9.4 (recipient scoping);
 *        Doc-06D_V1.0 §9 (retention drift); owner brief 2026-09-15 Parts A3 and B3]
 *        | @implemented [2026-09-15]
 *
 * plain English: drives the REAL SQL functions and the REAL feed routes against a
 * throwaway Postgres carrying genesis + every migration. Nothing about the tables is
 * mocked. What is substituted: the database TRANSPORT (`supabaseServer` → SQL through
 * tests/helpers/pg-supabase), the AUTH BOUNDARY (a session fixture) and the logger (captured,
 * so the zero-deletion log line can be asserted — the gate that makes an unscheduled job
 * detectable from the logs alone). Each case was observed FAILING once against a deliberate
 * mutation before it counted as a gate; see docs/plans/Notifications_Rebuild_Evidence.md §11.
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
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { NOTIFICATION_RETENTION_SWEEP_BATCH_SIZE } from "../../packages/shared/src/notifications-schema";

const DB_NAME = "notifications_retention_ci";
const GUARDIAN = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";

let pg: Client;
const session = { id: STUDENT, role: "student" as string };

/** Every logger call, flattened to one string per call, so log lines can be asserted. */
const captured: string[] = [];
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]) => {
    captured.push(
      args
        .map((a) => {
          try {
            return typeof a === "string" ? a : JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
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

async function buildApp(): Promise<express.Express> {
  const notificationsRouter = (
    await import("../../server/routes/notifications")
  ).default;
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId =
      "notif-retention-ci";
    next();
  });
  app.use(express.json());
  app.use("/api/notifications", requireSupabaseAuth, notificationsRouter);
  return app;
}

/**
 * Seed one guardian_linked event with its student in_app + guardian in_app + guardian email
 * rows, all stamped `ageDays` days ago. Returns the event id.
 */
async function seedEvent(
  ageDays: number,
  opts: { archivedForStudent?: boolean; readForStudent?: boolean } = {},
): Promise<string> {
  const eventId = randomUUID();
  await pg.query(
    `INSERT INTO public.notification_events (event_id, event_type, subject_profile_id, payload, created_at)
     VALUES ($1, 'guardian_linked', $2,
             jsonb_build_object('link_id', $3::text, 'student_display_name', 'Sam Student'),
             now() - make_interval(days => $4))`,
    [eventId, STUDENT, randomUUID(), ageDays],
  );
  await pg.query(
    `INSERT INTO public.notification_messages
       (event_id, recipient_profile_id, channel, status, created_at, archived_at, read_at, seen_at)
     VALUES
       ($1, $2, 'in_app', 'delivered', now() - make_interval(days => $4),
          CASE WHEN $5::boolean THEN now() ELSE NULL END,
          CASE WHEN $6::boolean THEN now() ELSE NULL END,
          CASE WHEN $6::boolean THEN now() ELSE NULL END),
       ($1, $3, 'in_app', 'delivered', now() - make_interval(days => $4), NULL, NULL, NULL),
       ($1, $3, 'email',  'delivered', now() - make_interval(days => $4), NULL, NULL, NULL)`,
    [
      eventId,
      STUDENT,
      GUARDIAN,
      ageDays,
      opts.archivedForStudent === true,
      opts.readForStudent === true,
    ],
  );
  return eventId;
}

async function counts(): Promise<{
  events: number;
  messages: number;
  delivery: number;
}> {
  const r = await pg.query(
    `SELECT (SELECT count(*)::int FROM public.notification_events) AS events,
            (SELECT count(*)::int FROM public.notification_messages) AS messages,
            (SELECT count(*)::int FROM public.notification_delivery_events) AS delivery`,
  );
  return r.rows[0] as { events: number; messages: number; delivery: number };
}

async function eventExists(eventId: string): Promise<boolean> {
  const r = await pg.query(
    `SELECT 1 FROM public.notification_events WHERE event_id = $1`,
    [eventId],
  );
  return (r.rowCount ?? 0) > 0;
}

describe.skipIf(!PG_AVAILABLE)(
  "notification retention sweep + page API — real Postgres",
  () => {
    beforeAll(async () => {
      process.env.PUBLIC_SITE_URL = "https://app.example.test";
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
        [
          GUARDIAN,
          "guardian@example.test",
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
          "guardian@example.test",
          STUDENT,
          "student@example.test",
          OUTSIDER,
          "o@example.test",
        ],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      session.id = STUDENT;
      session.role = "student";
      captured.length = 0;
      await pg.query(`DELETE FROM public.notification_delivery_events`);
      await pg.query(`DELETE FROM public.notification_events`);
    });

    // ── Part A — the sweep ─────────────────────────────────────────────────

    it("C11.1 the window is ONE definition in SQL and it is 90 days", async () => {
      const r = await pg.query(
        `SELECT public.notification_retention_days() AS d`,
      );
      expect(r.rows[0]?.d).toBe(90);
      // The literal appears once, in that function, and nowhere in the sweep's body.
      const sweep = await pg.query(
        `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'sweep_notification_retention'`,
      );
      const def = String(sweep.rows[0]?.def ?? "");
      expect(def).toContain("public.notification_retention_days()");
      expect(def).not.toMatch(/interval\s*'90|=>\s*90\b|90 days/);
      // Pinned search_path and SECURITY DEFINER, as every function in this vertical.
      expect(def).toMatch(/SECURITY DEFINER/);
      expect(def).toMatch(/SET search_path TO 'public', 'pg_temp'/);
    });

    it("A3.1 an event older than the window is deleted and its messages AND delivery events go with it (cascade proven by message count)", async () => {
      const old = await seedEvent(91);
      const young = await seedEvent(1);
      // A delivery event hanging off the old email row — the third table in the cascade.
      const emailRow = await pg.query(
        `SELECT message_id FROM public.notification_messages WHERE event_id = $1 AND channel = 'email'`,
        [old],
      );
      await pg.query(
        `INSERT INTO public.notification_delivery_events
           (provider_event_id, provider_message_id, message_id, event_type, occurred_at, received_at, applied_at)
         VALUES ('evt_old', 're_old', $1, 'email.delivered', now(), now(), now())`,
        [emailRow.rows[0]!.message_id],
      );
      expect(await counts()).toEqual({ events: 2, messages: 6, delivery: 1 });

      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      const summary = await sweepNotificationRetention({ requestId: "t" });

      expect(summary.deletedEvents).toBe(1);
      expect(summary.deletedMessages).toBe(3);
      expect(await eventExists(old)).toBe(false);
      expect(await eventExists(young)).toBe(true);
      // The MESSAGE count is the assertion: the cascade is the mechanism being proven.
      expect(await counts()).toEqual({ events: 1, messages: 3, delivery: 0 });
    });

    it("A3.2 an event inside the window survives, including one at 89 days", async () => {
      const at89 = await seedEvent(89);
      const at30 = await seedEvent(30);
      const at0 = await seedEvent(0);
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      const summary = await sweepNotificationRetention();
      expect(summary.deletedEvents).toBe(0);
      expect(summary.deletedMessages).toBe(0);
      for (const id of [at89, at30, at0])
        expect(await eventExists(id)).toBe(true);
      expect((await counts()).messages).toBe(9);
    });

    it("A3.3 the function returns an accurate count against a known fixture", async () => {
      await seedEvent(120);
      await seedEvent(100);
      await seedEvent(91);
      await seedEvent(89);
      await seedEvent(5);
      const r = await pg.query(
        `SELECT * FROM public.sweep_notification_retention($1)`,
        [NOTIFICATION_RETENTION_SWEEP_BATCH_SIZE],
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]!.deleted_events).toBe(3);
      expect(r.rows[0]!.deleted_messages).toBe(9);
      expect(await counts()).toEqual({ events: 2, messages: 6, delivery: 0 });
      // The cutoff it reports is the window it applied.
      const cutoff = new Date(r.rows[0]!.cutoff as Date | string).getTime();
      const expected = Date.now() - 90 * 24 * 3600 * 1000;
      expect(Math.abs(cutoff - expected)).toBeLessThan(60_000);
    });

    it("A3.4 a ZERO-deletion run emits its log line with the count and the cutoff (asserted on the log, not the return value)", async () => {
      await seedEvent(1);
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      captured.length = 0;
      await sweepNotificationRetention({ requestId: "zero-run" });

      const line = captured.find((l) =>
        l.includes("retention_sweep_completed"),
      );
      expect(
        line,
        "no retention_sweep_completed line was logged",
      ).toBeDefined();
      expect(line).toContain('"deletedEvents":0');
      expect(line).toContain('"deletedMessages":0');
      expect(line).toContain('"deletedOrphanDeliveryEvents":0');
      expect(line).toMatch(/"cutoff":"\d{4}-\d{2}-\d{2}T/);
      expect(line).toContain(
        `"batchSize":${NOTIFICATION_RETENTION_SWEEP_BATCH_SIZE}`,
      );
      expect(line).toContain('"requestId":"zero-run"');
    });

    it("A3.5 the batch bound is respected when more rows are eligible than the batch allows (oldest first)", async () => {
      const ids = [];
      for (const age of [200, 150, 120, 100, 95])
        ids.push(await seedEvent(age));
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");

      const first = await sweepNotificationRetention({ batchSize: 2 });
      expect(first.deletedEvents).toBe(2);
      expect(first.deletedMessages).toBe(6);
      expect(first.batchFull).toBe(true);
      // The two OLDEST went; the three younger-but-expired remain for the next run.
      expect(await eventExists(ids[0]!)).toBe(false);
      expect(await eventExists(ids[1]!)).toBe(false);
      expect(await eventExists(ids[2]!)).toBe(true);
      expect((await counts()).events).toBe(3);

      const second = await sweepNotificationRetention({ batchSize: 2 });
      expect(second.deletedEvents).toBe(2);
      const third = await sweepNotificationRetention({ batchSize: 2 });
      expect(third.deletedEvents).toBe(1);
      expect(third.batchFull).toBe(false);
      expect((await counts()).events).toBe(0);
    });

    it("the sweep refuses a batch size below 1 (fails closed rather than deleting unbounded)", async () => {
      await expect(
        pg.query(`SELECT * FROM public.sweep_notification_retention(0)`),
      ).rejects.toMatchObject({ code: "22023" });
    });

    // ── Part B — the page's API surface ────────────────────────────────────

    it("B3.1/§3.1 the inbox excludes archived rows; ?archived=true returns ONLY archived rows, with archivedAt", async () => {
      const app = await buildApp();
      const inboxEvent = await seedEvent(2);
      const archivedEvent = await seedEvent(3, { archivedForStudent: true });

      const inbox = await request(app).get("/api/notifications?limit=10");
      expect(inbox.status).toBe(200);
      expect(
        inbox.body.data.items.map((i: { eventId: string }) => i.eventId),
      ).toEqual([inboxEvent]);
      expect(inbox.body.data.items[0].archivedAt).toBeNull();

      const archived = await request(app).get(
        "/api/notifications?limit=10&archived=true",
      );
      expect(archived.status).toBe(200);
      expect(
        archived.body.data.items.map((i: { eventId: string }) => i.eventId),
      ).toEqual([archivedEvent]);
      expect(typeof archived.body.data.items[0].archivedAt).toBe("string");

      // "false" is false, not truthy — the enum, not z.coerce.boolean.
      const explicitFalse = await request(app).get(
        "/api/notifications?limit=10&archived=false",
      );
      expect(explicitFalse.body.data.items).toHaveLength(1);
      const junk = await request(app).get("/api/notifications?archived=yes");
      expect(junk.status).toBe(400);
    });

    it("B3.3 archiving through PATCH moves a row from the inbox view to the archived view", async () => {
      const app = await buildApp();
      const eventId = await seedEvent(1);
      const inbox = await request(app).get("/api/notifications");
      const messageId = inbox.body.data.items[0].messageId as string;

      const patched = await request(app)
        .patch(`/api/notifications/${messageId}`)
        .send({ archived: true });
      expect(patched.status).toBe(200);
      expect(typeof patched.body.data.archivedAt).toBe("string");

      const inboxAfter = await request(app).get("/api/notifications");
      expect(inboxAfter.body.data.items).toHaveLength(0);
      const archivedAfter = await request(app).get(
        "/api/notifications?archived=true",
      );
      expect(
        archivedAfter.body.data.items.map(
          (i: { eventId: string }) => i.eventId,
        ),
      ).toEqual([eventId]);
    });

    it("§3.2 mark-all-read stamps read_at AND seen_at on unread inbox rows only; archived rows untouched; returns the count", async () => {
      const app = await buildApp();
      await seedEvent(1);
      await seedEvent(2);
      await seedEvent(3, { readForStudent: true });
      await seedEvent(4, { archivedForStudent: true });

      const res = await request(app).post("/api/notifications/mark-all-read");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ marked: 2 });

      const rows = await pg.query(
        `SELECT read_at IS NOT NULL AS is_read, seen_at IS NOT NULL AS is_seen, archived_at IS NOT NULL AS is_archived
           FROM public.notification_messages
          WHERE recipient_profile_id = $1 AND channel = 'in_app'`,
        [STUDENT],
      );
      const inboxRows = rows.rows.filter((r) => !r.is_archived);
      expect(inboxRows).toHaveLength(3);
      expect(inboxRows.every((r) => r.is_read && r.is_seen)).toBe(true);
      const archivedRow = rows.rows.find((r) => r.is_archived);
      expect(archivedRow?.is_read).toBe(false);
      // The guardian's own rows were not touched: the recipient is the session principal.
      const guardianRows = await pg.query(
        `SELECT count(*)::int AS n FROM public.notification_messages
          WHERE recipient_profile_id = $1 AND channel = 'in_app' AND read_at IS NOT NULL`,
        [GUARDIAN],
      );
      expect(guardianRows.rows[0]!.n).toBe(0);
    });

    it("B3.2 mark-all-seen (what opening the page does) sets seen_at and does NOT set read_at", async () => {
      const app = await buildApp();
      await seedEvent(1);
      const res = await request(app).post("/api/notifications/mark-all-seen");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ marked: 1 });
      const row = await pg.query(
        `SELECT seen_at IS NOT NULL AS is_seen, read_at IS NOT NULL AS is_read
           FROM public.notification_messages WHERE recipient_profile_id = $1 AND channel = 'in_app'`,
        [STUDENT],
      );
      expect(row.rows[0]).toEqual({ is_seen: true, is_read: false });
    });

    it("B3.4 denial: another profile cannot read the student's inbox OR archive through the page's endpoint, and cannot mark-all-read them", async () => {
      const app = await buildApp();
      await seedEvent(1);
      await seedEvent(2, { archivedForStudent: true });

      session.id = OUTSIDER;
      const inbox = await request(app).get("/api/notifications");
      expect(inbox.status).toBe(200);
      expect(inbox.body.data.items).toEqual([]);
      const archived = await request(app).get(
        "/api/notifications?archived=true",
      );
      expect(archived.body.data.items).toEqual([]);
      const marked = await request(app).post(
        "/api/notifications/mark-all-read",
      );
      expect(marked.body.data).toEqual({ marked: 0 });

      // Positive control: the same rows ARE there for their recipient.
      session.id = STUDENT;
      const own = await request(app).get("/api/notifications");
      expect(own.body.data.items).toHaveLength(1);
      const unreadStill = await pg.query(
        `SELECT count(*)::int AS n FROM public.notification_messages
          WHERE recipient_profile_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
        [STUDENT],
      );
      expect(unreadStill.rows[0]!.n).toBe(2);
    });

    it("B3.1 archived view paginates with the same cursor contract", async () => {
      const app = await buildApp();
      for (let i = 0; i < 5; i++)
        await seedEvent(i + 1, { archivedForStudent: true });
      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url = `/api/notifications?limit=2&archived=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const res = await request(app).get(url);
        expect(res.status).toBe(200);
        for (const item of res.body.data.items as { messageId: string }[]) {
          expect(seen.has(item.messageId)).toBe(false);
          seen.add(item.messageId);
        }
        cursor = res.body.data.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(seen.size).toBe(5);
      expect(pages).toBe(3);
    });

    // ── Amendment 2026-09-16 — orphaned delivery events (C11.2 branch 2) ────

    /** An unmatched delivery event (no message), received `ageDays` days ago. */
    async function seedOrphan(ageDays: number, id: string): Promise<string> {
      await pg.query(
        `INSERT INTO public.notification_delivery_events
           (provider_event_id, provider_message_id, message_id, event_type, occurred_at, received_at, outcome)
         VALUES ($1, $2, NULL, 'email.delivered',
                 now() - make_interval(days => $3), now() - make_interval(days => $3), 'unmatched')`,
        [id, `re_${id}`, ageDays],
      );
      return id;
    }

    /** A delivery event attached to the given event's email row, received `ageDays` days ago. */
    async function seedMatched(
      eventId: string,
      ageDays: number,
      id: string,
    ): Promise<string> {
      const emailRow = await pg.query(
        `SELECT message_id FROM public.notification_messages WHERE event_id = $1 AND channel = 'email'`,
        [eventId],
      );
      await pg.query(
        `INSERT INTO public.notification_delivery_events
           (provider_event_id, provider_message_id, message_id, event_type, occurred_at, received_at, outcome, applied_at)
         VALUES ($1, $2, $3, 'email.delivered',
                 now() - make_interval(days => $4), now() - make_interval(days => $4), 'applied', now())`,
        [id, `re_${id}`, emailRow.rows[0]!.message_id, ageDays],
      );
      return id;
    }

    async function deliveryExists(id: string): Promise<boolean> {
      const r = await pg.query(
        `SELECT 1 FROM public.notification_delivery_events WHERE provider_event_id = $1`,
        [id],
      );
      return (r.rowCount ?? 0) > 0;
    }

    it("O1 an orphaned delivery event older than the window is deleted, and the count reports it", async () => {
      await seedOrphan(91, "evt_orphan_old");
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      const summary = await sweepNotificationRetention();
      expect(summary.deletedOrphanDeliveryEvents).toBe(1);
      expect(summary.deletedEvents).toBe(0);
      expect(await deliveryExists("evt_orphan_old")).toBe(false);
    });

    it("O2 an orphaned delivery event inside the window survives, including one at 89 days", async () => {
      await seedOrphan(89, "evt_orphan_89");
      await seedOrphan(30, "evt_orphan_30");
      await seedOrphan(0, "evt_orphan_0");
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      const summary = await sweepNotificationRetention();
      expect(summary.deletedOrphanDeliveryEvents).toBe(0);
      for (const id of ["evt_orphan_89", "evt_orphan_30", "evt_orphan_0"])
        expect(await deliveryExists(id)).toBe(true);
    });

    it("O3 a MATCHED delivery event older than the window is deleted by the CASCADE, not by the orphan branch (the orphan count stays 0)", async () => {
      const old = await seedEvent(120);
      await seedMatched(old, 120, "evt_matched_old");
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      const summary = await sweepNotificationRetention();
      expect(summary.deletedEvents).toBe(1);
      expect(summary.deletedMessages).toBe(3);
      // The parent path did the work: the orphan branch reports nothing for this row.
      expect(summary.deletedOrphanDeliveryEvents).toBe(0);
      expect(await deliveryExists("evt_matched_old")).toBe(false);
      expect(await eventExists(old)).toBe(false);
    });

    it("O4 a matched delivery event whose PARENT is inside the window survives even when its own received_at is older than the cutoff (the child's age never overrides the parent)", async () => {
      const young = await seedEvent(1);
      await seedMatched(young, 200, "evt_matched_young_parent");
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      const summary = await sweepNotificationRetention();
      expect(summary.deletedEvents).toBe(0);
      expect(summary.deletedOrphanDeliveryEvents).toBe(0);
      expect(await deliveryExists("evt_matched_young_parent")).toBe(true);
      expect(await eventExists(young)).toBe(true);
    });

    it("O5 a zero-deletion run emits the log line with BOTH counts at 0 and the cutoff (asserted on the log)", async () => {
      await seedEvent(1);
      await seedOrphan(1, "evt_orphan_young");
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      captured.length = 0;
      await sweepNotificationRetention({ requestId: "zero-both" });
      const line = captured.find((l) =>
        l.includes("retention_sweep_completed"),
      );
      expect(
        line,
        "no retention_sweep_completed line was logged",
      ).toBeDefined();
      expect(line).toContain('"deletedEvents":0');
      expect(line).toContain('"deletedMessages":0');
      expect(line).toContain('"deletedOrphanDeliveryEvents":0');
      expect(line).toMatch(/"cutoff":"\d{4}-\d{2}-\d{2}T/);
      expect(line).toContain('"requestId":"zero-both"');
    });

    it("O6 the batch bound is respected on BOTH branches independently (oldest first on each)", async () => {
      const events = [];
      for (const age of [200, 150, 120, 100, 95])
        events.push(await seedEvent(age));
      const orphans = [];
      for (const [i, age] of [300, 250, 180, 130, 92].entries())
        orphans.push(await seedOrphan(age, `evt_orphan_batch_${i}`));
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");

      const first = await sweepNotificationRetention({ batchSize: 2 });
      expect(first.deletedEvents).toBe(2);
      expect(first.deletedMessages).toBe(6);
      expect(first.deletedOrphanDeliveryEvents).toBe(2);
      expect(first.batchFull).toBe(true);
      // Oldest two of each went; the rest remain for the next run.
      expect(await eventExists(events[0]!)).toBe(false);
      expect(await eventExists(events[2]!)).toBe(true);
      expect(await deliveryExists(orphans[0]!)).toBe(false);
      expect(await deliveryExists(orphans[1]!)).toBe(false);
      expect(await deliveryExists(orphans[2]!)).toBe(true);
      expect((await counts()).events).toBe(3);
      expect((await counts()).delivery).toBe(3);

      // Independence: with the event backlog gone, the orphan branch still gets its own bound.
      await sweepNotificationRetention({ batchSize: 3 });
      expect((await counts()).events).toBe(0);
      expect((await counts()).delivery).toBe(0);
    });

    it("O7 batchFull is true when ONLY the orphan branch hits its bound (the flag reads both branches)", async () => {
      for (const [i, age] of [300, 250, 180].entries())
        await seedOrphan(age, `evt_orphan_only_${i}`);
      const { sweepNotificationRetention } =
        await import("../../server/lib/notifications/retention");
      const first = await sweepNotificationRetention({ batchSize: 2 });
      expect(first.deletedEvents).toBe(0);
      expect(first.deletedOrphanDeliveryEvents).toBe(2);
      expect(first.batchFull).toBe(true);
      const second = await sweepNotificationRetention({ batchSize: 2 });
      expect(second.deletedOrphanDeliveryEvents).toBe(1);
      expect(second.batchFull).toBe(false);
    });

    it("C11.1 (amended) the sweep body still carries no literal window and reads the ONE definition for both branches", async () => {
      const sweep = await pg.query(
        `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'sweep_notification_retention'`,
      );
      expect(sweep.rows).toHaveLength(1); // one function, not two
      const def = String(sweep.rows[0]?.def ?? "");
      expect(def).not.toMatch(/interval\s*'90|=>\s*90\b|90 days/);
      expect(
        def.match(/public\.notification_retention_days\(\)/g),
      ).toHaveLength(1); // one cutoff
      expect(def).toMatch(/message_id IS NULL/);
      expect(def).toMatch(/received_at < v_cutoff/);
    });
  },
);
