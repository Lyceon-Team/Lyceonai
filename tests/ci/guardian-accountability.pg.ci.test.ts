/**
 * The guardian accountability loop — against real Postgres (genesis + every migration).
 *
 * @spec [owner brief "Guardian accountability loop (plan changes, missed days, daily digest)"
 *       (Karl, 2026-10-13) "Tests (each observed failing once)"; Doc-05F_V1.0 §12.4, §12.8, §14,
 *       §16; contracts/notifications.contract.md §2.3, §2A, §5, §8 (amended)]
 *       | @implemented [2026-10-13]
 *
 * plain English: the REAL calendar writers (`calendar_edit_day`, `calendar_move_block`,
 * `calendar_persist_version`, `calendar_regenerate_day`), the REAL profile service, the REAL
 * accountability SQL and the REAL evening job with the REAL notification dispatcher, over the
 * shared `makePgSupabase` transport. Substituted: the email transport (captured), the logger
 * (captured) and, in the job group only, the calendar READ (`readDays`), which is handed days
 * built by the real `buildCalendarRange` so the allocator's own statuses drive the rule.
 *
 * Map to the brief's test list:
 *   R1-R4  each recorded trigger creates an event: clear a day, remove blocks, move a block off a
 *          day, move and remove a full-length test (guardian in-app, never the student)
 *   R5     removing blocks one by one is caught the same as clearing the day (the digest line)
 *   R6     SAT date, target score, Regenerate, the weekly re-plan and day regenerate do not
 *   M1-M5  missed days: two in a row alert once; rest days ignored; no repeat until a fresh run;
 *          back on track once; a rerun changes nothing
 *   J1-J7  the job: at most one digest per guardian per day, only with content, at 18:00 Chicago
 *          in CDT and CST; no guardian / inactive link / lapsed entitlement → nothing to the
 *          guardian; the toggle stops the email but keeps in-app; under-13 → no email; completing
 *          blocks is not a calendar write (progress is derived at read time, §13), so it has no
 *          recorder to test; see the PR
 *   T1-T3  the guardian toggle route: default on, students refused, the one writer
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  buildCalendarRange,
  calendarRangeInputSchema,
  type CalendarDay,
} from "../../packages/shared/src/calendar";
import {
  GUARDIAN_DIGEST_SEND_HOUR_CHICAGO,
  guardianDailyDigestPayloadSchema,
} from "../../packages/shared/src/notifications-schema";

const DB_NAME = "guardian_accountability_ci";

// Recording group (real "now").
const REC = "a8000000-0000-4000-8000-000000000001";
const REC_GUARDIAN = "a8000000-0000-4000-8000-000000000002";
const LONE = "a8000000-0000-4000-8000-000000000003"; // no guardian at all
const REVOKED = "a8000000-0000-4000-8000-000000000004"; // link revoked
const REVOKED_GUARDIAN = "a8000000-0000-4000-8000-000000000005";
// Missed-day rule group.
const RULE = "a8000000-0000-4000-8000-000000000010";
const RULE_GUARDIAN = "a8000000-0000-4000-8000-000000000011";
// Job group (fixed clocks).
const J1 = "a8000000-0000-4000-8000-000000000021"; // 13+, guardian GJ1, missed run
const J8 = "a8000000-0000-4000-8000-000000000028"; // GJ1's second student: completion only
const GJ1 = "a8000000-0000-4000-8000-000000000031";
const J2 = "a8000000-0000-4000-8000-000000000022"; // under 13
const GJ2 = "a8000000-0000-4000-8000-000000000032";
const J3 = "a8000000-0000-4000-8000-000000000023"; // guardian turned the digest off
const GJ3 = "a8000000-0000-4000-8000-000000000033";
const J4 = "a8000000-0000-4000-8000-000000000024"; // nothing to report
const GJ4 = "a8000000-0000-4000-8000-000000000034";
const J5 = "a8000000-0000-4000-8000-000000000025"; // entitlement lapsed
const GJ5 = "a8000000-0000-4000-8000-000000000035";
const J6 = "a8000000-0000-4000-8000-000000000026"; // link revoked
const GJ6 = "a8000000-0000-4000-8000-000000000036";
const J7 = "a8000000-0000-4000-8000-000000000027"; // no guardian
const W1 = "a8000000-0000-4000-8000-000000000041"; // winter
const GW1 = "a8000000-0000-4000-8000-000000000042";

const ADULT = "1980-01-01";
const TEEN = "2008-01-01";
const CHILD = "2016-01-01";

let pg: Client;
const logs: string[] = [];
const session: { id: string | null; role: "student" | "guardian" } = {
  id: null,
  role: "guardian",
};

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
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makePgSupabase(pg),
}));
vi.mock("../../server/logger", () => {
  const record = (...args: unknown[]): void => {
    logs.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  return {
    logger: { info: record, warn: record, error: record, debug: record },
  };
});

async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await pg.query(sql, params);
  return r.rows as T[];
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await q<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function seedPerson(
  id: string,
  role: "student" | "guardian",
  dob: string,
  displayName: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, `${id}@example.test`],
  );
  await pg.query(
    `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
     VALUES ($1, $2, $3, $4, $5::date)
     ON CONFLICT (id) DO UPDATE
       SET role = EXCLUDED.role, display_name = EXCLUDED.display_name,
           date_of_birth = EXCLUDED.date_of_birth`,
    [id, `${id}@example.test`, role, displayName, dob],
  );
}

async function entitle(id: string, status = "active"): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id)
     VALUES ($1, 'premium', $2, $3, $4)`,
    [id, status, `sub_${id.slice(-4)}`, `si_${id.slice(-4)}`],
  );
}

async function link(
  guardian: string,
  student: string,
  status: "active" | "revoked" = "active",
): Promise<void> {
  await pg.query(
    `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
     VALUES ($1, $2, 'active', 'student', now(), now())`,
    [guardian, student],
  );
  if (status === "revoked") {
    await pg.query(
      `UPDATE public.guardian_links SET status = 'revoked', revoked_at = now(), revoked_by_profile_id = $2
        WHERE guardian_profile_id = $1 AND student_profile_id = $2`,
      [guardian, student],
    );
  }
}

async function studyProfile(id: string, timezone = "America/Chicago") {
  await pg.query(
    `INSERT INTO public.student_study_profile
       (student_id, timezone, study_days_mask, daily_minutes, target_score, setup_completed_at)
     VALUES ($1, $2, 127, 60, 1400, now() - interval '14 days')`,
    [id, timezone],
  );
}

type EventRow = {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

async function events(subject: string, type: string): Promise<EventRow[]> {
  return q<EventRow>(
    `SELECT event_id, event_type, payload FROM public.notification_events
      WHERE subject_profile_id = $1 AND event_type = $2 ORDER BY created_at, event_id`,
    [subject, type],
  );
}

async function messages(
  eventId: string,
): Promise<{ recipient: string; channel: string }[]> {
  return q(
    `SELECT recipient_profile_id AS recipient, channel FROM public.notification_messages
      WHERE event_id = $1 ORDER BY recipient_profile_id, channel`,
    [eventId],
  );
}

// ── calendar fixtures (real writers) ────────────────────────────────────────

/**
 * A practice block of `count` questions. §7.4/V-04 allows one practice block per section per day,
 * so a day with two blocks has one in Math and one in Reading and Writing.
 */
const PRACTICE = (count: number, section: "M" | "RW" = "M") => ({
  kind: "created",
  block: {
    block_type: "practice",
    section,
    scope: {
      level: "domain",
      mix: [
        {
          domain: section === "M" ? "Algebra" : "Craft and Structure",
          count,
          explanation_key: "weak",
        },
      ],
    },
    target_count: count,
    explanation_key: "weighted",
  },
});
const TWO_BLOCKS = [PRACTICE(10, "M"), PRACTICE(10, "RW")];
const FULL_LENGTH = {
  kind: "created",
  block: {
    block_type: "full_length",
    section: null,
    scope: { form_id: null, exam_mode: "strict" },
    target_count: 1,
    explanation_key: null,
  },
};

async function today(): Promise<string> {
  const rows = await q<{ d: string }>(
    `SELECT ((now() AT TIME ZONE 'America/Chicago')::date)::text AS d`,
  );
  return rows[0]?.d ?? "";
}

async function plusDays(date: string, n: number): Promise<string> {
  const rows = await q<{ d: string }>(
    `SELECT (($1::date + $2::int))::text AS d`,
    [date, n],
  );
  return rows[0]?.d ?? "";
}

async function editDay(
  student: string,
  date: string,
  members: unknown[],
): Promise<Record<string, unknown>> {
  const rows = await q<{ r: Record<string, unknown> }>(
    `SELECT public.calendar_edit_day($1, $2::date, $3::jsonb, 'v1', NULL) AS r`,
    [student, date, JSON.stringify(members)],
  );
  const r = rows[0]?.r ?? {};
  expect(r.validator_result).toBe("accepted");
  return r;
}

async function blocksOn(
  student: string,
  date: string,
): Promise<{ block_id: string; block_type: string }[]> {
  return q(
    `SELECT cp.block_id::text AS block_id, b.block_type
       FROM public.calendar_current_plan cp
       JOIN public.calendar_blocks b ON b.block_id = cp.block_id
      WHERE cp.student_id = $1 AND cp.scheduled_date = $2::date
      ORDER BY cp.display_ordinal`,
    [student, date],
  );
}

function carried(ids: readonly string[]) {
  return ids.map((id) => ({ kind: "carried", block_id: id }));
}

/** An instant at 18:30 Chicago on the digest day that a change made NOW reports in. */
async function digestRunNow(): Promise<string> {
  const rows = await q<{ at: string }>(
    `SELECT to_char(((public.accountability_digest_date(now())::timestamp + interval '18 hours 30 minutes')
                     AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
  );
  return rows[0]?.at ?? "";
}

// ── job fixtures (days from the real allocator) ─────────────────────────────

type DaySpec = { date: string; blocks: number; done: number };

/** Days the way the calendar read derives them: plan blocks + engine units → buildCalendarRange. */
function rangeDays(
  todayDate: string,
  specs: readonly DaySpec[],
): CalendarDay[] {
  const days = specs.map((s) => ({
    local_date: s.date,
    timezone: "America/Chicago",
    is_user_override: false,
    is_study_day: s.blocks > 0,
    version_no: s.blocks > 0 ? 1 : null,
    blocks: Array.from({ length: s.blocks }, (_, i) => ({
      block_id: randomUUID(),
      scheduled_date: s.date,
      block_type: "practice",
      section: "M",
      scope: {
        level: "domain",
        mix: [{ domain: "Algebra", count: 10, explanation_key: "weak" }],
      },
      target_count: 10,
      source: "auto",
      derived_from_block_id: null,
      explanation_key: "weighted",
      display_ordinal: i + 1,
      membership_type: "created",
    })),
  }));
  const units = specs.flatMap((s) =>
    Array.from({ length: s.done * 10 }, (_, i) => ({
      engine: "practice",
      unit_id: `${s.date}-${i}`,
      occurred_at: `${s.date}T17:${String(i % 60).padStart(2, "0")}:00Z`,
      local_date: s.date,
      section: "M",
      domain: "Algebra",
      form_id: null,
    })),
  );
  const input = calendarRangeInputSchema.parse({
    today: todayDate,
    days,
    units,
    launches: [],
    linked_sessions: [],
  });
  return buildCalendarRange(input).days;
}

describe.skipIf(!PG_AVAILABLE)(
  "guardian accountability (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, role, dob, name] of [
        [REC, "student", TEEN, "Amingwa Test"],
        [REC_GUARDIAN, "guardian", ADULT, "Pat Parent"],
        [LONE, "student", TEEN, "Lone Student"],
        [REVOKED, "student", TEEN, "Rev Student"],
        [REVOKED_GUARDIAN, "guardian", ADULT, "Rev Parent"],
        [RULE, "student", TEEN, "Rula Student"],
        [RULE_GUARDIAN, "guardian", ADULT, "Rule Parent"],
        [J1, "student", TEEN, "Jamie One"],
        [J8, "student", TEEN, "Kai Eight"],
        [GJ1, "guardian", ADULT, "Gee One"],
        [J2, "student", CHILD, "Jo Two"],
        [GJ2, "guardian", ADULT, "Gee Two"],
        [J3, "student", TEEN, "Jay Three"],
        [GJ3, "guardian", ADULT, "Gee Three"],
        [J4, "student", TEEN, "Jen Four"],
        [GJ4, "guardian", ADULT, "Gee Four"],
        [J5, "student", TEEN, "Jim Five"],
        [GJ5, "guardian", ADULT, "Gee Five"],
        [J6, "student", TEEN, "Jas Six"],
        [GJ6, "guardian", ADULT, "Gee Six"],
        [J7, "student", TEEN, "Jules Seven"],
        [W1, "student", TEEN, "Wren Winter"],
        [GW1, "guardian", ADULT, "Gee Winter"],
      ] as const) {
        await seedPerson(id, role, dob, name);
      }
      for (const s of [
        REC,
        LONE,
        REVOKED,
        RULE,
        J1,
        J8,
        J2,
        J3,
        J4,
        J6,
        J7,
        W1,
      ])
        await entitle(s);
      await entitle(J5, "canceled");
      await link(REC_GUARDIAN, REC);
      await link(REVOKED_GUARDIAN, REVOKED, "revoked");
      await link(RULE_GUARDIAN, RULE);
      await link(GJ1, J1);
      await link(GJ1, J8);
      await link(GJ2, J2);
      await link(GJ3, J3);
      await link(GJ4, J4);
      await link(GJ5, J5);
      await link(GJ6, J6, "revoked");
      await link(GW1, W1);
      for (const s of [REC, LONE, REVOKED]) {
        await studyProfile(s);
        const r = await q<{ r: Record<string, unknown> }>(
          `SELECT public.calendar_persist_version($1, 'setup', 'student', 'v1', NULL) AS r`,
          [s],
        );
        expect(r[0]?.r.validator_result).toBe("accepted");
      }
      for (const s of [J1, J8, J2, J3, J4, J5, J6, J7, W1])
        await studyProfile(s);
    }, 240_000);

    afterAll(async () => {
      if (pg) await pg.end();
    });

    // ── Recording ───────────────────────────────────────────────────────────

    describe("R: what gets recorded (student-initiated, before → after)", () => {
      it("R1: clearing a day records one day_reduced event with before → 0, to the guardian in-app only", async () => {
        const d = await plusDays(await today(), 20);
        await editDay(REC, d, TWO_BLOCKS);
        // An increase is not recorded.
        expect(
          (await events(REC, "study_plan_changed")).filter(
            (e) => e.payload.plan_date === d,
          ),
        ).toEqual([]);

        await editDay(REC, d, []);
        const mine = (await events(REC, "study_plan_changed")).filter(
          (e) => e.payload.plan_date === d,
        );
        expect(mine).toHaveLength(1);
        expect(mine[0]?.payload).toMatchObject({
          kind: "day_reduced",
          student_first_name: "Amingwa",
          before_minutes: 30,
          after_minutes: 0,
        });
        expect(await messages(mine[0]?.event_id ?? "")).toEqual([
          { recipient: REC_GUARDIAN, channel: "in_app" },
        ]);
      });

      it("R2: removing blocks one by one records each removal", async () => {
        const d = await plusDays(await today(), 21);
        await editDay(REC, d, TWO_BLOCKS);
        const ids = (await blocksOn(REC, d)).map((b) => b.block_id);
        expect(ids).toHaveLength(2);
        await editDay(REC, d, carried(ids.slice(1)));
        await editDay(REC, d, []);
        const mine = (await events(REC, "study_plan_changed")).filter(
          (e) => e.payload.plan_date === d,
        );
        expect(
          mine.map((e) => [e.payload.before_minutes, e.payload.after_minutes]),
        ).toEqual([
          [30, 15],
          [15, 0],
        ]);
      });

      it("R3: moving a block off a day records that day's reduction, and nothing for the day it lands on", async () => {
        const from = await plusDays(await today(), 22);
        const to = await plusDays(await today(), 23);
        await editDay(REC, from, TWO_BLOCKS);
        // The day it lands on already has work, so an increase there would be visible.
        await editDay(REC, to, [PRACTICE(10, "RW")]);
        const [first] = await blocksOn(REC, from);
        const moved = await q<{ r: Record<string, unknown> }>(
          `SELECT public.calendar_move_block($1, $2::uuid, $3::date, 'v1', NULL) AS r`,
          [REC, first?.block_id, to],
        );
        expect(moved[0]?.r.validator_result).toBe("accepted");
        const all = await events(REC, "study_plan_changed");
        expect(
          all
            .filter((e) => e.payload.plan_date === from)
            .map((e) => [e.payload.before_minutes, e.payload.after_minutes]),
        ).toEqual([[30, 15]]);
        expect(all.filter((e) => e.payload.plan_date === to)).toEqual([]);
      });

      it("R4: moving a full-length test, then removing it, records full_length_moved then full_length_removed", async () => {
        const a = await plusDays(await today(), 24);
        const b = await plusDays(await today(), 25);
        await editDay(REC, a, [FULL_LENGTH]);
        const fl = (await blocksOn(REC, a)).find(
          (x) => x.block_type === "full_length",
        );
        expect(fl).toBeDefined();
        await q(
          `SELECT public.calendar_move_block($1, $2::uuid, $3::date, 'v1', NULL)`,
          [REC, fl?.block_id, b],
        );
        const flOnB = (await blocksOn(REC, b)).filter(
          (x) => x.block_type === "full_length",
        );
        expect(flOnB).toHaveLength(1);
        await editDay(
          REC,
          b,
          carried(
            (await blocksOn(REC, b))
              .filter((x) => x.block_type !== "full_length")
              .map((x) => x.block_id),
          ),
        );
        const fls = (await events(REC, "study_plan_changed")).filter((e) =>
          String(e.payload.kind).startsWith("full_length"),
        );
        expect(fls.map((e) => e.payload)).toEqual([
          expect.objectContaining({
            kind: "full_length_moved",
            plan_date: a,
            to_date: b,
          }),
          expect.objectContaining({
            kind: "full_length_removed",
            plan_date: b,
          }),
        ]);
      });

      it("R5: removing blocks one by one reads in the digest exactly like clearing the day", async () => {
        const runAt = await digestRunNow();
        const r = await q<{ r: { emitted: number } }>(
          `SELECT public.guardian_daily_digest_notify($1::timestamptz, 500) AS r`,
          [runAt],
        );
        expect(r[0]?.r.emitted).toBeGreaterThanOrEqual(1);
        const digest = (await events(REC_GUARDIAN, "guardian_daily_digest"))[0];
        expect(digest).toBeDefined();
        const payload = guardianDailyDigestPayloadSchema.parse(digest?.payload);
        const changes = payload.students[0]?.plan_changes ?? [];
        const cleared = await plusDays(await today(), 20);
        const oneByOne = await plusDays(await today(), 21);
        const pick = (date: string) =>
          changes.find((c) => c.kind === "day_reduced" && c.plan_date === date);
        expect(pick(cleared)).toEqual({
          kind: "day_reduced",
          plan_date: cleared,
          before_minutes: 30,
          after_minutes: 0,
        });
        expect(pick(oneByOne)).toEqual({
          kind: "day_reduced",
          plan_date: oneByOne,
          before_minutes: 30,
          after_minutes: 0,
        });
        // The guardian's digest is email-only, to the guardian.
        expect(await messages(digest?.event_id ?? "")).toEqual([
          { recipient: REC_GUARDIAN, channel: "email" },
        ]);
      });

      it("R6: SAT dates, the target score, Regenerate, day regenerate and the weekly re-plan record nothing", async () => {
        const before = await count(
          `SELECT count(*)::int AS n FROM public.notification_events WHERE event_type = 'study_plan_changed'`,
        );
        const { upsertStudyProfile } =
          await import("../../server/services/calendar/profile-service");
        const t = await today();
        // NON-TRIVIAL ON PURPOSE: the budget is halved underneath the plan (a fixture write, not a
        // student action), so every regeneration below really does lower planned days. Without it
        // a regeneration that changes nothing would pass this test for the wrong reason.
        await pg.query(
          `UPDATE public.student_study_profile SET daily_minutes = 30 WHERE student_id = $1`,
          [LONE],
        );
        const minutesBefore = await q<{ m: number }>(
          `SELECT public.accountability_day_minutes(
                    public.accountability_plan_snapshot($1, ARRAY[($2::date + 5)]),
                    ($2::date + 5),
                    '{"practice_seconds_per_unit": 90, "review_seconds_per_unit": 120}'::jsonb) AS m`,
          [LONE, t],
        );
        const satDate = await plusDays(t, 60);
        const sat = await upsertStudyProfile(LONE, {
          target_exam_dates: [satDate],
          idempotency_key: randomUUID(),
        });
        expect(sat.ok).toBe(true);
        const score = await upsertStudyProfile(LONE, {
          target_score: 1500,
          idempotency_key: randomUUID(),
        });
        expect(score.ok).toBe(true);
        // Presence: each of these really wrote an accepted version for this student.
        const versionsBefore = await count(
          `SELECT count(*)::int AS n FROM public.calendar_plan_versions WHERE student_id = $1 AND validator_result = 'accepted'`,
          [LONE],
        );
        for (const sql of [
          `SELECT public.calendar_persist_version($1, 'student_refresh', 'student', 'v1', NULL)`,
          `SELECT public.calendar_persist_version($1, 'weekly', 'system', 'v1', NULL)`,
          `SELECT public.calendar_regenerate_day($1, ($2::date + 2), 'day_regenerate', 'v1', NULL)`,
          `SELECT public.calendar_regenerate_day($1, ($2::date + 3), 'day_reset', 'v1', NULL)`,
        ]) {
          await q(sql, sql.includes("$2") ? [LONE, t] : [LONE]);
        }
        expect(
          await count(
            `SELECT count(*)::int AS n FROM public.calendar_plan_versions WHERE student_id = $1 AND validator_result = 'accepted'`,
            [LONE],
          ),
        ).toBeGreaterThanOrEqual(versionsBefore + 4);
        const minutesAfter = await q<{ m: number }>(
          `SELECT public.accountability_day_minutes(
                    public.accountability_plan_snapshot($1, ARRAY[($2::date + 5)]),
                    ($2::date + 5),
                    '{"practice_seconds_per_unit": 90, "review_seconds_per_unit": 120}'::jsonb) AS m`,
          [LONE, t],
        );
        // Presence: the regenerations really reduced a day the student never touched.
        expect(Number(minutesAfter[0]?.m)).toBeLessThan(
          Number(minutesBefore[0]?.m),
        );
        expect(
          await count(
            `SELECT count(*)::int AS n FROM public.notification_events WHERE event_type = 'study_plan_changed'`,
          ),
        ).toBe(before);
      });

      it("R7: a student with no guardian, or a revoked link, is recorded with no guardian message", async () => {
        for (const s of [LONE, REVOKED]) {
          const d = await plusDays(await today(), 20);
          await editDay(s, d, [PRACTICE(10)]);
          await editDay(s, d, []);
          const mine = (await events(s, "study_plan_changed")).filter(
            (e) => e.payload.plan_date === d,
          );
          expect(mine).toHaveLength(1);
          expect(await messages(mine[0]?.event_id ?? "")).toEqual([]);
        }
      });
    });

    // ── The missed-day rule ─────────────────────────────────────────────────

    describe("M: missed planned days and back on track", () => {
      async function record(
        days: { date: string; outcome: "did_work" | "missed" }[],
        through: string,
      ): Promise<{ alerts: number; back_on_track: number }> {
        const rows = await q<{ r: { alerts: number; back_on_track: number } }>(
          `SELECT public.accountability_record_day_outcomes($1, $2::jsonb, $3::date, $4::date, 0, 0, now()) AS r`,
          [RULE, JSON.stringify(days), through, through],
        );
        const r = rows[0]?.r;
        if (r === undefined) throw new Error("no result");
        return r;
      }

      it("M1: two consecutive missed planned days alert once (student in-app + email, guardian in-app); a third does not", async () => {
        expect(
          await record(
            [{ date: "2026-03-02", outcome: "missed" }],
            "2026-03-02",
          ),
        ).toEqual(expect.objectContaining({ alerts: 0 }));
        expect(
          await record(
            [{ date: "2026-03-03", outcome: "missed" }],
            "2026-03-03",
          ),
        ).toEqual(expect.objectContaining({ alerts: 1 }));
        expect(
          await record(
            [{ date: "2026-03-04", outcome: "missed" }],
            "2026-03-04",
          ),
        ).toEqual(expect.objectContaining({ alerts: 0 }));
        const alerts = await events(RULE, "missed_plan_alert");
        expect(alerts).toHaveLength(1);
        expect(alerts[0]?.payload).toMatchObject({
          missed_days: 2,
          last_missed_date: "2026-03-03",
          student_first_name: "Rula",
        });
        expect(await messages(alerts[0]?.event_id ?? "")).toEqual(
          [
            { recipient: RULE, channel: "email" },
            { recipient: RULE, channel: "in_app" },
            { recipient: RULE_GUARDIAN, channel: "in_app" },
          ].sort((x, y) =>
            (x.recipient + x.channel).localeCompare(y.recipient + y.channel),
          ),
        );
      });

      it("M2: back on track fires once, on the first day with work after the alert", async () => {
        expect(
          await record(
            [
              { date: "2026-03-05", outcome: "did_work" },
              { date: "2026-03-06", outcome: "did_work" },
            ],
            "2026-03-06",
          ),
        ).toEqual(expect.objectContaining({ back_on_track: 1 }));
        const backs = await events(RULE, "back_on_track");
        expect(backs).toHaveLength(1);
        expect(backs[0]?.payload).toMatchObject({ back_on_date: "2026-03-05" });
      });

      it("M3: no new alert until a fresh run of two misses after studying again; one miss is not a run", async () => {
        await record([{ date: "2026-03-09", outcome: "missed" }], "2026-03-09");
        await record(
          [{ date: "2026-03-10", outcome: "did_work" }],
          "2026-03-10",
        );
        await record([{ date: "2026-03-11", outcome: "missed" }], "2026-03-11");
        expect(await events(RULE, "missed_plan_alert")).toHaveLength(1);
        // Rest days are not in the list: a miss on Thursday and the next planned day (Monday)
        // are consecutive PLANNED days.
        expect(
          await record(
            [{ date: "2026-03-16", outcome: "missed" }],
            "2026-03-16",
          ),
        ).toEqual(expect.objectContaining({ alerts: 1 }));
        expect(await events(RULE, "missed_plan_alert")).toHaveLength(2);
      });

      it("M4: a rerun over days already evaluated changes nothing", async () => {
        const before = await count(
          `SELECT count(*)::int AS n FROM public.notification_events WHERE subject_profile_id = $1`,
          [RULE],
        );
        expect(
          await record(
            [
              { date: "2026-03-10", outcome: "did_work" },
              { date: "2026-03-11", outcome: "missed" },
              { date: "2026-03-16", outcome: "missed" },
            ],
            "2026-03-16",
          ),
        ).toEqual(expect.objectContaining({ alerts: 0, back_on_track: 0 }));
        expect(
          await count(
            `SELECT count(*)::int AS n FROM public.notification_events WHERE subject_profile_id = $1`,
            [RULE],
          ),
        ).toBe(before);
      });

      it("M5: the TS evaluator drops rest days and today-without-work, and counts partial as work (§14)", async () => {
        const { evaluateAccountabilityDays } =
          await import("../../packages/shared/src/calendar");
        const days = rangeDays("2026-03-20", [
          { date: "2026-03-16", blocks: 2, done: 0 }, // missed
          { date: "2026-03-17", blocks: 0, done: 0 }, // rest
          { date: "2026-03-18", blocks: 2, done: 1 }, // one block done: partial day
          { date: "2026-03-19", blocks: 2, done: 0 }, // missed
          { date: "2026-03-20", blocks: 2, done: 0 }, // today, nothing yet
        ]);
        expect(
          evaluateAccountabilityDays({
            days,
            from: "2026-03-16",
            today: "2026-03-20",
            digestDate: "2026-03-20",
          }),
        ).toEqual({
          days: [
            { date: "2026-03-16", outcome: "missed" },
            { date: "2026-03-18", outcome: "did_work" },
            { date: "2026-03-19", outcome: "missed" },
          ],
          completion: { planned: 2, completed: 0 },
        });
      });
    });

    // ── The evening job ─────────────────────────────────────────────────────

    describe("J: the 18:00 Chicago job (alerts, digest, sends)", () => {
      const sent: { to: string; subject: string; text: string }[] = [];
      const fakeTransport = async (input: {
        to: string;
        subject: string;
        text: string;
      }) => {
        sent.push(input);
        return {
          ok: true as const,
          value: { providerMessageId: `re_${sent.length}` },
        };
      };
      const plan = new Map<string, DaySpec[]>();
      async function run(nowIso: string) {
        const { runGuardianAccountabilityJob } =
          await import("../../server/services/calendar/accountability-job");
        const { dispatchQueuedMessages } =
          await import("../../server/lib/notifications/dispatch");
        return runGuardianAccountabilityJob({
          db: makePgSupabase(pg),
          readDays: async (req) => {
            const specs = plan.get(req.student_id);
            if (specs === undefined) return null;
            const t =
              nowIso.slice(0, 10) < "2026-07-01" ? "2026-01-14" : "2026-07-14";
            const inRange = specs.filter(
              (s) => s.date >= req.from && s.date <= req.to,
            );
            return { today: t, days: rangeDays(t, inRange) };
          },
          dispatch: (options) =>
            dispatchQueuedMessages({ ...options, transport: fakeTransport }),
          now: new Date(nowIso),
        });
      }
      const missedRun: DaySpec[] = [
        { date: "2026-07-12", blocks: 2, done: 0 },
        { date: "2026-07-13", blocks: 2, done: 0 },
        { date: "2026-07-14", blocks: 2, done: 0 },
      ];

      beforeAll(async () => {
        for (const s of [J1, J2, J3, J4, J5, J6, J7]) {
          await pg.query(
            `INSERT INTO public.accountability_state (student_id, last_evaluated_date) VALUES ($1, '2026-07-11')`,
            [s],
          );
        }
        for (const s of [J1, J2, J3, J5, J6, J7]) plan.set(s, missedRun);
        plan.set(J8, [{ date: "2026-07-14", blocks: 1, done: 1 }]);
        plan.set(J4, [
          { date: "2026-07-12", blocks: 0, done: 0 },
          { date: "2026-07-13", blocks: 0, done: 0 },
          { date: "2026-07-14", blocks: 0, done: 0 },
        ]);
        await pg.query(
          `SELECT public.set_guardian_daily_digest_email($1, false, now())`,
          [GJ3],
        );
        // Winter: W1 has its own run.
        await pg.query(
          `INSERT INTO public.accountability_state (student_id, last_evaluated_date) VALUES ($1, '2026-01-11')`,
          [W1],
        );
        plan.set(W1, [
          { date: "2026-01-12", blocks: 1, done: 0 },
          { date: "2026-01-13", blocks: 1, done: 0 },
          { date: "2026-01-14", blocks: 1, done: 0 },
        ]);
      });

      it("J1: outside the 18:00 Chicago hour nothing is created or sent (17:00 CDT, 19:00 CDT)", async () => {
        for (const at of ["2026-07-14T22:00:00Z", "2026-07-15T00:00:00Z"]) {
          const summary = await run(at);
          expect(summary.skipped).toBe("not_send_hour");
        }
        expect(await events(J1, "missed_plan_alert")).toEqual([]);
        expect(sent).toEqual([]);
        expect(GUARDIAN_DIGEST_SEND_HOUR_CHICAGO).toBe(18);
      });

      it("J2: at 18:00 CDT the run alerts, digests and sends: one digest per guardian, two students in one email", async () => {
        const summary = await run("2026-07-14T23:00:00Z");
        expect(summary.ok).toBe(true);
        expect(summary.skipped).toBeUndefined();
        const digests = await events(GJ1, "guardian_daily_digest");
        expect(digests).toHaveLength(1);
        const payload = guardianDailyDigestPayloadSchema.parse(
          digests[0]?.payload,
        );
        expect(payload.digest_date).toBe("2026-07-14");
        expect(payload.students).toEqual([
          {
            student_first_name: "Jamie",
            completion: { planned: 2, completed: 0 },
            plan_changes: [],
            missed_plan_alert: { missed_days: 2 },
            back_on_track: false,
          },
          {
            student_first_name: "Kai",
            completion: { planned: 1, completed: 1 },
            plan_changes: [],
            missed_plan_alert: null,
            back_on_track: false,
          },
        ]);
        const toGj1 = sent.filter((s) => s.to === `${GJ1}@example.test`);
        expect(toGj1).toHaveLength(1);
        expect(toGj1[0]?.text).toContain(
          "Jamie hasn't studied for 2 planned days",
        );
        expect(toGj1[0]?.text).toContain(
          "Kai completed 1 of 1 planned session",
        );
        // The 13+ student got their alert by email too.
        expect(sent.filter((s) => s.to === `${J1}@example.test`)).toHaveLength(
          1,
        );
      });

      it("J3: a rerun in the hour sends nothing more; at most one email per guardian per day", async () => {
        const before = sent.length;
        await run("2026-07-14T23:30:00Z");
        expect(sent.length).toBe(before);
        expect(await events(GJ1, "guardian_daily_digest")).toHaveLength(1);
        expect(await events(J1, "missed_plan_alert")).toHaveLength(1);
      });

      it("J4: nothing to report → no digest; the toggle stops the email but keeps in-app; under-13 → no email", async () => {
        expect(await events(GJ4, "guardian_daily_digest")).toEqual([]);
        expect(sent.some((s) => s.to === `${GJ4}@example.test`)).toBe(false);

        expect(await events(GJ3, "guardian_daily_digest")).toEqual([]);
        expect(sent.some((s) => s.to === `${GJ3}@example.test`)).toBe(false);
        const j3Alert = (await events(J3, "missed_plan_alert"))[0];
        expect(await messages(j3Alert?.event_id ?? "")).toContainEqual({
          recipient: GJ3,
          channel: "in_app",
        });

        const j2Alert = (await events(J2, "missed_plan_alert"))[0];
        const j2Messages = await messages(j2Alert?.event_id ?? "");
        expect(j2Messages).toContainEqual({ recipient: J2, channel: "in_app" });
        expect(j2Messages).not.toContainEqual({
          recipient: J2,
          channel: "email",
        });
        expect(sent.some((s) => s.to === `${J2}@example.test`)).toBe(false);
      });

      it("J5: no guardian, an inactive link or a lapsed entitlement → nothing to the guardian", async () => {
        // J7 (no guardian) and J6 (revoked link) are evaluated: the student is told, nobody else.
        for (const [student, guardian] of [
          [J7, null],
          [J6, GJ6],
        ] as const) {
          const alert = (await events(student, "missed_plan_alert"))[0];
          expect(alert).toBeDefined();
          const recipients = (await messages(alert?.event_id ?? "")).map(
            (m) => m.recipient,
          );
          expect(new Set(recipients)).toEqual(new Set([student]));
          if (guardian !== null) {
            expect(await events(guardian, "guardian_daily_digest")).toEqual([]);
          }
        }
        // J5's entitlement lapsed: not evaluated, and its guardian gets no digest.
        expect(await events(J5, "missed_plan_alert")).toEqual([]);
        expect(await events(GJ5, "guardian_daily_digest")).toEqual([]);
        // Visibility is read at emit time, whoever calls the rule.
        await pg.query(
          `SELECT public.accountability_record_day_outcomes($1, $2::jsonb, '2026-07-14', '2026-07-14', 0, 0, now())`,
          [
            J5,
            JSON.stringify([
              { date: "2026-07-12", outcome: "missed" },
              { date: "2026-07-13", outcome: "missed" },
            ]),
          ],
        );
        const lapsed = (await events(J5, "missed_plan_alert"))[0];
        expect(lapsed).toBeDefined();
        expect(
          (await messages(lapsed?.event_id ?? "")).map((m) => m.recipient),
        ).not.toContain(GJ5);
      });

      it("J7: winter — 17:00 CST does nothing, 18:00 CST (00:00 UTC) sends the day's digest", async () => {
        const before = sent.length;
        const early = await run("2026-01-14T23:00:00Z");
        expect(early.skipped).toBe("not_send_hour");
        expect(sent.length).toBe(before);
        const onTime = await run("2026-01-15T00:00:00Z");
        expect(onTime.skipped).toBeUndefined();
        const digests = await events(GW1, "guardian_daily_digest");
        expect(digests).toHaveLength(1);
        expect(digests[0]?.payload.digest_date).toBe("2026-01-14");
        expect(sent.filter((s) => s.to === `${GW1}@example.test`)).toHaveLength(
          1,
        );
      });

      it("J8: the SQL digest cut is the shared send hour (17:59 → today, 18:00 → tomorrow, both seasons)", async () => {
        const rows = await q<{ a: string; b: string; c: string; d: string }>(
          `SELECT public.accountability_digest_date('2026-07-14T22:59:00Z')::text AS a,
                public.accountability_digest_date('2026-07-14T23:00:00Z')::text AS b,
                public.accountability_digest_date('2026-01-14T23:59:00Z')::text AS c,
                public.accountability_digest_date('2026-01-15T00:00:00Z')::text AS d`,
        );
        expect(rows[0]).toEqual({
          a: "2026-07-14",
          b: "2026-07-15",
          c: "2026-01-14",
          d: "2026-01-15",
        });
      });

      it("J9: no log line carries a student's or guardian's name", () => {
        expect(logs.length).toBeGreaterThan(0);
        for (const line of logs) {
          for (const name of ["Jamie", "Kai", "Amingwa", "Wren"]) {
            expect(line).not.toContain(name);
          }
        }
      });
    });

    // ── The guardian's switch ───────────────────────────────────────────────

    describe("T: the daily summary email switch", () => {
      function injectSession(req: Request, _res: Response, next: NextFunction) {
        if (session.id) {
          req.user = {
            id: session.id,
            email: `${session.id}@example.test`,
            display_name: null,
            role: session.role,
            isAdmin: false,
            isGuardian: session.role === "guardian",
            is_under_13: false,
            profile_completed_at: "2026-09-01T00:00:00Z",
            actor_id: session.id,
          };
        }
        next();
      }
      async function app(): Promise<express.Express> {
        const { default: guardianRoutes } =
          await import("../../server/routes/guardian-routes");
        const a = express();
        a.use(express.json());
        a.use(injectSession);
        a.use("/api/guardian", guardianRoutes);
        return a;
      }
      const PATH = "/api/guardian/notification-preferences/daily-digest";

      it("T1: a guardian's switch is ON until they turn it off, and the PUT round-trips", async () => {
        session.id = GW1;
        session.role = "guardian";
        const a = await app();
        const first = await request(a).get(PATH);
        expect(first.status).toBe(200);
        expect(first.body).toEqual({ data: { enabled: true } });
        const off = await request(a).put(PATH).send({ enabled: false });
        expect(off.status).toBe(200);
        expect(off.body).toEqual({ data: { enabled: false } });
        expect((await request(a).get(PATH)).body).toEqual({
          data: { enabled: false },
        });
        expect(
          (await request(a).put(PATH).send({ enabled: "no" })).status,
        ).toBe(400);
      });

      it("T2: a student cannot read or change it (403 at the route; the writer refuses too)", async () => {
        session.id = W1;
        session.role = "student";
        const a = await app();
        expect((await request(a).get(PATH)).status).toBe(403);
        expect(
          (await request(a).put(PATH).send({ enabled: false })).status,
        ).toBe(403);
        await expect(
          pg.query(
            `SELECT public.set_guardian_daily_digest_email($1, false, now())`,
            [W1],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      });

      it("T0: the event-type CHECK and the shared list name exactly the same types", async () => {
        const { NOTIFICATION_EVENT_TYPES } =
          await import("../../packages/shared/src/notifications-schema");
        const rows = await q<{ def: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'notification_events' AND c.conname = 'notification_events_type_check'`,
        );
        const inCheck = [...String(rows[0]?.def).matchAll(/'([a-z_]+)'::text/g)]
          .map((m) => m[1])
          .sort();
        expect(inCheck).toEqual([...NOTIFICATION_EVENT_TYPES].sort());
        expect(inCheck).toContain("guardian_daily_digest");
      });

      it("T3: one writer per switch in the catalog", async () => {
        const writers = await q<{ proname: string }>(
          `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.prosrc ~* '(insert\\s+into|update)\\s+public\\.notification_channel_preferences'
          ORDER BY 1`,
        );
        expect(writers.map((r) => r.proname)).toEqual([
          "set_guardian_daily_digest_email",
          "set_qotd_daily_email",
        ]);
        const body = await q<{ prosrc: string }>(
          `SELECT prosrc FROM pg_proc WHERE proname = 'set_guardian_daily_digest_email'`,
        );
        expect(body[0]?.prosrc).not.toContain("qotd_daily");
      });
    });
  },
);
