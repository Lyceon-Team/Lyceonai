/**
 * Email quiet hours, expiry of time-sensitive notifications, and the week notice after the
 * weekly re-plan — real PostgreSQL proof.
 *
 * @spec [owner rulings, Karl 2026-10-09, schedule audit Step 2: item 2 (no student- or
 *       guardian-facing email 21:00–08:00 America/Chicago; deferred to the next 08:00, never
 *       dropped; exempt only user-triggered email), item 3(1) (the exam reminder expires at the
 *       start of the test day in the student's zone; expired = dropped and logged), item 3(4)
 *       (the "this week" notice always after that student's weekly re-plan);
 *       contracts/notifications.contract.md C6.3, C6.6, C6.7; Doc-05F_V1.0 §12.5]
 *       | @implemented [2026-10-09]
 *
 * plain English: drives the REAL migrations, the REAL emitters (`emit_notification_event`,
 * `calendar_emit_exam_notification`, `calendar_persist_version`), the REAL dispatcher and the
 * REAL Resend transport against a throwaway Postgres. Substituted: the database transport
 * (`supabaseServer` → SQL, tests/helpers/pg-supabase) and the network (a fake `fetch` that
 * records each request body). Every clock is explicit: no assertion here depends on the hour the
 * suite runs. Each case was observed failing once under a plant; the plants are listed in the PR.
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
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "notification_quiet_hours_ci";
const STUDENT = "c1000000-0000-4000-8000-000000000001";
const GUARDIAN = "c1000000-0000-4000-8000-000000000002";
const CAL_STUDENT = "c1000000-0000-4000-8000-000000000003";
const ENV = {
  RESEND_API_KEY: "re_test",
  NOTIFICATION_FROM_EMAIL: "notifications@send.example.test",
} as NodeJS.ProcessEnv;

let pg: Client;

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

type Captured = { body: Record<string, unknown> };
const requests: Captured[] = [];
const fetchImpl = (async (
  _input: string | URL | Request,
  init?: RequestInit,
) => {
  requests.push({
    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
  });
  return new Response(JSON.stringify({ id: `re_${requests.length}` }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

type LogLine = { level: string; event: string; data: unknown };
const logged: LogLine[] = [];

async function transport() {
  const { createResendTransport } =
    await import("../../server/lib/notifications/transport");
  return createResendTransport({ fetchImpl, env: ENV });
}

async function dispatchAt(iso: string, eventId?: string) {
  const { dispatchQueuedMessages } =
    await import("../../server/lib/notifications/dispatch");
  return dispatchQueuedMessages({
    transport: await transport(),
    now: new Date(iso),
    ...(eventId ? { eventId } : {}),
  });
}

/** A guardian_linked email row, written by the real emitter; returns its event id. */
async function queueGuardianEmail(linkId: string): Promise<string> {
  const r = await pg.query<{ id: string }>(
    `SELECT public.notification_event_id('guardian_linked', $1::text) AS id`,
    [linkId],
  );
  const id = r.rows[0]!.id;
  await pg.query(
    `SELECT public.emit_notification_event($1::uuid, 'guardian_linked', $2::uuid,
       jsonb_build_array(jsonb_build_object('profile_id', $3::uuid, 'channels', jsonb_build_array('email'))),
       jsonb_build_object('link_id', $4::text, 'student_display_name', 'Sam'))`,
    [id, STUDENT, GUARDIAN, linkId],
  );
  return id;
}

async function emailRow(eventId: string) {
  const r = await pg.query<{
    status: string;
    attempts: number;
    last_error: string | null;
    not_before: Date | null;
  }>(
    `SELECT status, attempts, last_error, not_before FROM public.notification_messages
      WHERE event_id = $1 AND channel = 'email'`,
    [eventId],
  );
  expect(r.rows).toHaveLength(1);
  return r.rows[0]!;
}

describe.skipIf(!PG_AVAILABLE)(
  "quiet hours, expiry, week order — real Postgres",
  () => {
    beforeAll(async () => {
      process.env.PUBLIC_SITE_URL = "https://app.example.test";
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'s@example.test'),($2,'g@example.test'),($3,'c@example.test')`,
        [STUDENT, GUARDIAN, CAL_STUDENT],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth) VALUES
         ($1,'s@example.test','student','Sam','2010-01-01'),
         ($2,'g@example.test','guardian','Gia','1980-01-01'),
         ($3,'c@example.test','student','Cal','2010-01-01')`,
        [STUDENT, GUARDIAN, CAL_STUDENT],
      );
      const { logger } = await import("../../server/logger");
      for (const level of ["info", "warn", "error"] as const) {
        vi.spyOn(logger, level).mockImplementation(((
          _component: string,
          event: string,
          _message: string,
          data?: unknown,
        ) => {
          logged.push({ level, event, data });
        }) as never);
      }
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      if (pg) await pg.end();
    });

    beforeEach(() => {
      requests.length = 0;
      logged.length = 0;
    });

    // ── The window itself ──────────────────────────────────────────────────────
    describe("the window: [21:00, 08:00) America/Chicago, both sides of DST", () => {
      it("CDT (2026-07-15) and CST (2026-12-15): 01:00 → that day's 08:00; 20:59 and 08:00 send; 21:00 → next 08:00", async () => {
        const { quietHoursDeferral } =
          await import("../../server/lib/notifications/quiet-hours");
        const at = (iso: string) =>
          quietHoursDeferral(new Date(iso))?.toISOString() ?? null;
        // CDT = UTC-5. 08:00 CDT = 13:00Z.
        expect(at("2026-07-15T06:00:00Z")).toBe("2026-07-15T13:00:00.000Z"); // 01:00
        expect(at("2026-07-15T12:59:00Z")).toBe("2026-07-15T13:00:00.000Z"); // 07:59
        expect(at("2026-07-15T13:00:00Z")).toBeNull(); // 08:00
        expect(at("2026-07-16T01:59:00Z")).toBeNull(); // 20:59 on the 15th
        expect(at("2026-07-16T02:00:00Z")).toBe("2026-07-16T13:00:00.000Z"); // 21:00 on the 15th
        // CST = UTC-6. 08:00 CST = 14:00Z.
        expect(at("2026-12-15T07:00:00Z")).toBe("2026-12-15T14:00:00.000Z"); // 01:00
        expect(at("2026-12-15T14:00:00Z")).toBeNull(); // 08:00
        expect(at("2026-12-16T02:59:00Z")).toBeNull(); // 20:59 on the 15th
        expect(at("2026-12-16T03:00:00Z")).toBe("2026-12-16T14:00:00.000Z"); // 21:00 on the 15th
      });
    });

    // ── Dispatch: deferred, then sent ──────────────────────────────────────────
    describe("a notification email due in the window is postponed to 08:00 Chicago, then sent", () => {
      for (const c of [
        {
          name: "CDT 2026-07-15",
          link: "c1000000-0000-4000-8000-0000000000a1",
          night: "2026-07-15T06:00:00Z", // 01:00 CDT
          eight: "2026-07-15T13:00:00.000Z",
          justBefore: "2026-07-15T12:59:00Z",
        },
        {
          name: "CST 2026-12-15",
          link: "c1000000-0000-4000-8000-0000000000a2",
          night: "2026-12-15T07:00:00Z", // 01:00 CST
          eight: "2026-12-15T14:00:00.000Z",
          justBefore: "2026-12-15T13:59:00Z",
        },
      ]) {
        it(`${c.name}: 01:00 → not_before 08:00 (not an attempt); not selected before; sent at 08:00`, async () => {
          const eventId = await queueGuardianEmail(c.link);

          const night = await dispatchAt(c.night, eventId);
          expect(night).toMatchObject({ selected: 1, postponed: 1, sent: 0 });
          expect(requests).toHaveLength(0);
          const deferred = await emailRow(eventId);
          expect(deferred.status).toBe("queued");
          expect(deferred.attempts).toBe(0);
          expect(deferred.last_error).toBeNull();
          expect(deferred.not_before?.toISOString()).toBe(c.eight);

          const early = await dispatchAt(c.justBefore, eventId);
          expect(early.selected).toBe(0);
          expect(requests).toHaveLength(0);

          const eight = await dispatchAt(c.eight, eventId);
          expect(eight).toMatchObject({ selected: 1, sent: 1 });
          expect(requests).toHaveLength(1);
          expect(requests[0]!.body.to).toEqual(["g@example.test"]);
          expect(requests[0]!.body).not.toHaveProperty("scheduled_at");
          expect((await emailRow(eventId)).status).toBe("sent");
        });
      }

      it("20:59 sends; 21:00 postpones (CDT)", async () => {
        const a = await queueGuardianEmail(
          "c1000000-0000-4000-8000-0000000000a3",
        );
        expect(await dispatchAt("2026-07-16T01:59:00Z", a)).toMatchObject({
          sent: 1,
        });
        const b = await queueGuardianEmail(
          "c1000000-0000-4000-8000-0000000000a4",
        );
        expect(await dispatchAt("2026-07-16T02:00:00Z", b)).toMatchObject({
          sent: 0,
          postponed: 1,
        });
        expect((await emailRow(b)).not_before?.toISOString()).toBe(
          "2026-07-16T13:00:00.000Z",
        );
        expect(requests).toHaveLength(1);
      });
    });

    // ── The shared sender ──────────────────────────────────────────────────────
    describe("the shared sender: student/guardian mail held to 08:00; user-triggered mail goes now", () => {
      const NIGHT = new Date("2026-07-15T06:00:00Z"); // 01:00 CDT

      it("a user-triggered email (the guardian invite a student sends) sends at 01:00 Chicago, unscheduled", async () => {
        const { sendGuardianLinkInviteEmail } =
          await import("../../server/lib/notifications/direct-sends");
        const sent = await sendGuardianLinkInviteEmail(
          {
            studentProfileId: STUDENT,
            studentDisplayName: "Sam",
            code: "ABC234",
            codeIssuedAt: "2026-07-15T05:59:00.000Z",
            expiresAt: "2026-07-16T05:59:00.000Z",
            guardianEmail: "parent@example.test",
          },
          {
            transport: await transport(),
            siteUrl: "https://app.example.test",
            now: NIGHT,
          },
        );
        expect(sent.ok && sent.value.scheduledAt).toBeNull();
        expect(requests).toHaveLength(1);
        expect(requests[0]!.body).not.toHaveProperty("scheduled_at");
      });

      it("the deletion-scheduled email (recovery link, the holder's own request) sends at 01:00, unscheduled", async () => {
        const { sendAccountDeletionScheduledEmail } =
          await import("../../server/lib/notifications/direct-sends");
        await sendAccountDeletionScheduledEmail(
          {
            deletionRequestId: "c1000000-0000-4000-8000-0000000000d1",
            email: "s@example.test",
            recipientProfileId: STUDENT,
            rawToken: "tok",
            scheduledHardDeleteAt: "2026-07-22T06:00:00.000Z",
          },
          {
            transport: await transport(),
            siteUrl: "https://app.example.test",
            now: NIGHT,
          },
        );
        expect(requests).toHaveLength(1);
        expect(requests[0]!.body).not.toHaveProperty("scheduled_at");
      });

      it("the deletion-completed notice is NOT exempt: at 01:00 it is handed to Resend for 08:00 Chicago, not dropped", async () => {
        const { sendAccountDeletionCompletedEmail } =
          await import("../../server/lib/notifications/direct-sends");
        const sent = await sendAccountDeletionCompletedEmail(
          {
            deletionRequestId: "c1000000-0000-4000-8000-0000000000d2",
            email: "gone@example.test",
            recipientProfileId: STUDENT,
            completedAt: "2026-07-15T06:00:00.000Z",
          },
          { transport: await transport(), now: NIGHT },
        );
        expect(sent.ok).toBe(true);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.body.scheduled_at).toBe("2026-07-15T13:00:00.000Z");
      });

      it("ops alerts are not student- or guardian-facing: an `ops` send at 01:00 goes now", async () => {
        const t = await transport();
        await t({
          idempotencyKey: "ops-alert:test",
          to: "owner@example.test",
          recipientProfileId: null,
          subject: "s",
          html: "<p>h</p>",
          text: "t",
          audience: "ops",
          now: NIGHT,
        });
        expect(requests[0]!.body).not.toHaveProperty("scheduled_at");
        // And the ops path names that audience at its one call site.
        const src = fs.readFileSync(
          path.resolve(__dirname, "../../server/lib/ops-alerts.ts"),
          "utf8",
        );
        expect(src).toMatch(/audience: "ops",/);
      });

      it("password reset and sign-up confirmation are Supabase Auth mail and never reach this sender", () => {
        const src = fs.readFileSync(
          path.resolve(
            __dirname,
            "../../server/routes/supabase-auth-routes.ts",
          ),
          "utf8",
        );
        // PRESENCE first: the reset and the sign-up are where we think they are.
        expect(src).toContain("resetPasswordForEmail(");
        expect(src).toContain("auth.signUp(");
        expect(src).not.toMatch(
          /notifications\/transport|direct-sends|defaultEmailTransport/,
        );
      });
    });

    // ── The recipient cannot move their own deferral ───────────────────────────
    it("not_before is a delivery column: the recipient may write seen_at, never not_before (42501)", async () => {
      const eventId = await queueGuardianEmail(
        "c1000000-0000-4000-8000-0000000000a9",
      );
      await pg.query("BEGIN");
      try {
        await pg.query(
          `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
           SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$`,
        );
        await pg.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
          GUARDIAN,
        ]);
        await pg.query("SET LOCAL ROLE authenticated");
        // PRESENCE FIRST: the recipient's own row is reachable and a recipient column is writable.
        const seen = await pg.query(
          `UPDATE public.notification_messages SET seen_at = now() WHERE event_id = $1`,
          [eventId],
        );
        expect(seen.rowCount).toBe(1);
        let code: string | undefined;
        try {
          await pg.query(
            `UPDATE public.notification_messages SET not_before = now() WHERE event_id = $1`,
            [eventId],
          );
        } catch (e) {
          code = (e as { code?: string }).code;
        }
        expect(code).toBe("42501");
      } finally {
        await pg.query("ROLLBACK");
      }
    });

    // ── Expiry ─────────────────────────────────────────────────────────────────
    describe("the exam reminder expires at the start of the test day in the student's zone", () => {
      async function emitTomorrow(
        block: string,
        localDate: string,
        tz: string,
      ) {
        const r = await pg.query<{ out: string }>(
          `SELECT public.calendar_emit_exam_notification($1, $2, 'full_length_tomorrow', $3::date, $4) AS out`,
          [STUDENT, block, localDate, tz],
        );
        expect(r.rows[0]?.out).toBe("emitted");
        const id = await pg.query<{ id: string; expires_at: Date | null }>(
          `SELECT event_id AS id, expires_at FROM public.notification_events
          WHERE event_id = public.notification_event_id('full_length_tomorrow', $1::text)`,
          [block],
        );
        return id.rows[0]!;
      }

      it("the emitter sets it (Tokyo: 2026-07-16 starts at 2026-07-15T15:00Z); sent before it, dropped and logged at it", async () => {
        // Tokyo's day boundary falls at 10:00 CDT, outside quiet hours, so expiry alone decides.
        const before = await emitTomorrow(
          "c1000000-0000-4000-8000-0000000000b1",
          "2026-07-16",
          "Asia/Tokyo",
        );
        expect(before.expires_at?.toISOString()).toBe(
          "2026-07-15T15:00:00.000Z",
        );
        expect(
          await dispatchAt("2026-07-15T14:59:00Z", before.id),
        ).toMatchObject({
          sent: 1,
          expired: 0,
        });
        expect(requests).toHaveLength(1);

        const at = await emitTomorrow(
          "c1000000-0000-4000-8000-0000000000b2",
          "2026-07-16",
          "Asia/Tokyo",
        );
        expect(await dispatchAt("2026-07-15T15:00:00Z", at.id)).toMatchObject({
          sent: 0,
          expired: 1,
        });
        expect(requests).toHaveLength(1); // nothing more went out
        const row = await emailRow(at.id);
        expect(row.status).toBe("failed");
        expect(row.last_error).toBe("expired: not sent");
        // Logged, structured, ids only.
        const line = logged.find((l) => l.event === "dispatch_expired");
        expect(line?.level).toBe("warn");
        expect(line?.data).toMatchObject({
          eventType: "full_length_tomorrow",
          reason: "expired",
        });
        expect(JSON.stringify(line?.data)).not.toContain("@");
        // Never retried: the dispatcher does not select it again.
        expect((await dispatchAt("2026-07-15T16:00:00Z", at.id)).selected).toBe(
          0,
        );
      });

      it("a quiet-hours deferral that would land after the test day has begun is a drop, not a postponement (Los Angeles)", async () => {
        // LA's 2026-07-16 begins at 07:00Z = 02:00 CDT; at 22:00 CDT on the 15th the next 08:00
        // Chicago (13:00Z on the 16th) is after it.
        const ev = await emitTomorrow(
          "c1000000-0000-4000-8000-0000000000b3",
          "2026-07-16",
          "America/Los_Angeles",
        );
        expect(ev.expires_at?.toISOString()).toBe("2026-07-16T07:00:00.000Z");
        expect(await dispatchAt("2026-07-16T03:00:00Z", ev.id)).toMatchObject({
          expired: 1,
          postponed: 0,
        });
        expect(requests).toHaveLength(0);
        const row = await emailRow(ev.id);
        expect(row.status).toBe("failed");
        expect(row.last_error).toBe("expires_before_quiet_hours_end: not sent");
      });
    });

    // ── Week notice after the re-plan ──────────────────────────────────────────
    describe("the week notice is never emitted for a student whose current week is not re-planned", () => {
      const TZ = "America/Chicago";

      beforeAll(async () => {
        await pg.query(
          `UPDATE public.calendar_runtime_config SET value = '["practice","review","full_length"]'::jsonb
          WHERE key = 'enabled_block_types'`,
        );
        await pg.query(
          `INSERT INTO public.student_study_profile
           (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
            full_length_interval_weeks, target_score, setup_completed_at)
         VALUES ($1, $2, 127, 60, 6, 2, 1400, now() - interval '14 days')`,
          [CAL_STUDENT, TZ],
        );
        await pg.query(
          `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
          [CAL_STUDENT],
        );
        // The setup version, from the real writer.
        const r = await pg.query<{ v: { validator_result: string } }>(
          `SELECT public.calendar_persist_version($1, 'setup', 'student', 'v1',
           'c1000000-0000-4000-8000-0000000000e1') AS v`,
          [CAL_STUDENT],
        );
        expect(r.rows[0]?.v.validator_result).toBe("accepted");
      });

      /** Move every accepted refresh version to one instant: "the last re-plan ran at X". */
      async function lastReplanAt(iso: string) {
        await pg.query(
          `UPDATE public.calendar_plan_versions SET created_at = $2::timestamptz WHERE student_id = $1`,
          [CAL_STUDENT, iso],
        );
      }
      async function emitWeek(block: string, nowIso: string) {
        const r = await pg.query<{ out: string }>(
          `SELECT public.calendar_emit_exam_notification($1, $2, 'full_length_week', $3::date, $4, $5::timestamptz) AS out`,
          [CAL_STUDENT, block, "2026-12-19", TZ, nowIso],
        );
        return r.rows[0]?.out;
      }
      async function weekEvents(block: string) {
        const r = await pg.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.notification_events
          WHERE event_id = public.notification_event_id('full_length_week', $1::text)`,
          [block],
        );
        return r.rows[0]?.n;
      }

      it("the audit's case — Chicago in winter: Monday 15:00 CST, last re-plan Sunday 23:30 CST (the previous week) → refused", async () => {
        // 05:30Z Monday 2026-12-14 = Sunday 23:30 CST: the weekly cron's run lands in LAST week.
        await lastReplanAt("2026-12-14T05:30:00Z");
        const block = "c1000000-0000-4000-8000-0000000000c1";
        // 21:00Z Monday = 15:00 CST, the notify cron.
        expect(await emitWeek(block, "2026-12-14T21:00:00Z")).toBe(
          "skipped_not_replanned",
        );
        expect(await weekEvents(block)).toBe(0);
        // Once this week's re-plan exists (the notify job's own, 14:00 CST), the notice goes.
        await lastReplanAt("2026-12-14T20:00:00Z");
        expect(await emitWeek(block, "2026-12-14T21:00:00Z")).toBe("emitted");
        expect(await weekEvents(block)).toBe(1);
      });

      it("the same cron instants in summer (CDT): the 05:30Z re-plan is Monday 00:30, this week → emitted", async () => {
        await lastReplanAt("2026-07-13T05:30:00Z");
        const block = "c1000000-0000-4000-8000-0000000000c2";
        expect(await emitWeek(block, "2026-07-13T21:00:00Z")).toBe("emitted");
      });

      it("the day-before notice is not held by the weekly re-plan", async () => {
        await lastReplanAt("2026-12-14T05:30:00Z");
        const r = await pg.query<{ out: string }>(
          `SELECT public.calendar_emit_exam_notification($1, $2, 'full_length_tomorrow', '2026-12-19'::date, $3, '2026-12-18T21:00:00Z'::timestamptz) AS out`,
          [CAL_STUDENT, "c1000000-0000-4000-8000-0000000000c3", TZ],
        );
        expect(r.rows[0]?.out).toBe("emitted");
      });

      it("the job's re-plan-first step: ensureWeeklyReplan re-plans a stale week through the weekly writer, then the notice goes", async () => {
        // Last re-plan eight days ago: this local week is not re-planned at real now().
        await pg.query(
          `UPDATE public.calendar_plan_versions SET created_at = now() - interval '8 days' WHERE student_id = $1`,
          [CAL_STUDENT],
        );
        const block = "c1000000-0000-4000-8000-0000000000c4";
        const refused = await pg.query<{ out: string }>(
          `SELECT public.calendar_emit_exam_notification($1, $2, 'full_length_week', (now() + interval '3 days')::date, $3) AS out`,
          [CAL_STUDENT, block, TZ],
        );
        expect(refused.rows[0]?.out).toBe("skipped_not_replanned");

        const { ensureWeeklyReplan } =
          await import("../../server/services/calendar/weekly-job");
        expect(await ensureWeeklyReplan(CAL_STUDENT)).toBe("replanned");
        const weekly = await pg.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.calendar_plan_versions
          WHERE student_id = $1 AND trigger = 'weekly' AND validator_result = 'accepted'`,
          [CAL_STUDENT],
        );
        expect(weekly.rows[0]?.n).toBe(1);
        // Second call: nothing due, nothing written.
        expect(await ensureWeeklyReplan(CAL_STUDENT)).toBe("already");

        const emitted = await pg.query<{ out: string }>(
          `SELECT public.calendar_emit_exam_notification($1, $2, 'full_length_week', (now() + interval '3 days')::date, $3) AS out`,
          [CAL_STUDENT, block, TZ],
        );
        expect(emitted.rows[0]?.out).toBe("emitted");
      });
    });
  },
);
