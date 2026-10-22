/**
 * Parity: the shared "will this notify?" predicate against the REAL SQL recording.
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A: "A parity test enumerates
 *        every calendar action: each one the SQL recording captures shows the dialog, each one it
 *        ignores doesn't. Plant: dropping an action from the predicate turns the parity test
 *        red."; SCL-238; the recording: supabase/migrations/
 *        20261101000000_guardian_accountability.sql (the LAST migration defining
 *        `calendar_write_version`, `accountability_record_plan_change` and
 *        `accountability_record_profile_change`)] | @implemented [2026-10-21]
 *
 * plain English: a student with an ACTIVE guardian link and an ACTIVE entitlement, so every
 * recorded change has a recipient. Every action in `CALENDAR_ACTIONS` is performed through its
 * real writer (the profile service for a schedule save; `calendar_edit_day`,
 * `calendar_move_block`, `calendar_persist_version`, `calendar_regenerate_day`,
 * `calendar_do_it_now`, `calendar_link_launch`, `calendar_acknowledge_version` for the rest)
 * against genesis + every migration. For each, the predicate is asked FIRST, from the state the
 * page would see (the day's blocks as the plan holds them, the stored profile, the version's own
 * seconds-per-unit), and the test then counts the `study_plan_changed` events the write emitted.
 * The two must agree for every scenario: recorded ⇔ the predicate says the dialog shows.
 *
 * Coverage is part of the assertion: every kind in `CALENDAR_ACTIONS` has at least one scenario,
 * and both answers occur (the suite cannot pass by every action agreeing on "no").
 */
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  CALENDAR_ACTIONS,
  calendarActionRecorded,
  willNotifyGuardian,
  type CalendarAction,
  type CalendarActionKind,
  type DayBlockBefore,
  type PlanMember,
} from "../../packages/shared/src/calendar";

const DB_NAME = "guardian_notify_parity_ci";
const STUDENT = "a9000000-0000-4000-8000-000000000001";
const GUARDIAN = "a9000000-0000-4000-8000-000000000002";

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
vi.mock("../../server/logger", () => {
  const quiet = (): void => undefined;
  return { logger: { info: quiet, warn: quiet, error: quiet, debug: quiet } };
});

async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pg.query(sql, params)).rows as T[];
}

async function recordedEvents(): Promise<number> {
  const r = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.notification_events
      WHERE event_type = 'study_plan_changed' AND subject_profile_id = $1`,
    [STUDENT],
  );
  return Number(r[0]?.n ?? 0);
}

async function plusDays(n: number): Promise<string> {
  const r = await q<{ d: string }>(
    `SELECT (((now() AT TIME ZONE 'America/Chicago')::date) + $1::int)::text AS d`,
    [n],
  );
  return r[0]?.d ?? "";
}

/** The day as the plan holds it: what the page's `dayBlocksBefore` reads. */
async function dayBefore(date: string): Promise<DayBlockBefore[]> {
  const rows = await q<{
    block_id: string;
    block_type: DayBlockBefore["block_type"];
    target_count: number;
  }>(
    `SELECT cp.block_id::text AS block_id, b.block_type, b.target_count
       FROM public.calendar_current_plan cp
       JOIN public.calendar_blocks b ON b.block_id = cp.block_id
      WHERE cp.student_id = $1 AND cp.scheduled_date = $2::date
      ORDER BY cp.display_ordinal`,
    [STUDENT, date],
  );
  return rows.map((r) => ({ ...r, started: false }));
}

/** The seconds-per-unit the latest version was planned against (§15 `estimates`). */
async function estimates(): Promise<{
  practice_seconds_per_unit: number;
  review_seconds_per_unit: number;
}> {
  const r = await q<{
    e: { practice_seconds_per_unit: number; review_seconds_per_unit: number };
  }>(
    `SELECT input_snapshot -> 'engine_planning' AS e FROM public.calendar_plan_versions
      WHERE student_id = $1 ORDER BY version_no DESC LIMIT 1`,
    [STUDENT],
  );
  const e = r[0]?.e;
  if (e === undefined)
    throw new Error("no version to read engine_planning from");
  return {
    practice_seconds_per_unit: Number(e.practice_seconds_per_unit),
    review_seconds_per_unit: Number(e.review_seconds_per_unit),
  };
}

async function storedProfile(): Promise<
  Extract<CalendarAction, { kind: "save_schedule" }>["before"]
> {
  const r = await q<{
    setup_completed_at: string | null;
    study_days_mask: number | null;
    daily_minutes: number | null;
    full_length_weekday: number | null;
    full_length_interval_weeks: number | null;
  }>(
    `SELECT setup_completed_at::text, study_days_mask, daily_minutes, full_length_weekday,
            full_length_interval_weeks
       FROM public.student_study_profile WHERE student_id = $1`,
    [STUDENT],
  );
  return r[0] ?? null;
}

const PRACTICE = (count: number, section: "M" | "RW" = "M"): PlanMember => ({
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
const FULL_LENGTH = (mode: "strict" | "lenient" = "strict"): PlanMember => ({
  kind: "created",
  block: {
    block_type: "full_length",
    section: null,
    scope: { form_id: null, exam_mode: mode },
    target_count: 1,
    explanation_key: null,
  },
});
const carried = (ids: readonly string[]): PlanMember[] =>
  ids.map((block_id) => ({ kind: "carried", block_id }));

async function editDay(
  date: string,
  members: readonly PlanMember[],
): Promise<void> {
  const r = await q<{ r: { validator_result: string } }>(
    `SELECT public.calendar_edit_day($1, $2::date, $3::jsonb, 'v1', NULL) AS r`,
    [STUDENT, date, JSON.stringify(members)],
  );
  expect(r[0]?.r.validator_result).toBe("accepted");
}

async function saveProfile(body: Record<string, unknown>): Promise<void> {
  const { upsertStudyProfile } =
    await import("../../server/services/calendar/profile-service");
  const r = await upsertStudyProfile(STUDENT, {
    ...body,
    idempotency_key: randomUUID(),
  });
  expect(r.ok).toBe(true);
}

type Scenario = {
  name: string;
  kind: CalendarActionKind;
  /** Set-up the page would already show (not under test; its events are not counted). */
  arrange?: () => Promise<void>;
  /** The predicate's input, built from the state BEFORE the write. */
  action: () => Promise<CalendarAction>;
  /** The real write. */
  act: () => Promise<void>;
};

const D = {
  clear: 30,
  removeOne: 31,
  lower: 32,
  raise: 33,
  add: 34,
  flAdd: 35,
  flEdit: 35,
  flRemove: 35,
  moveFrom: 36,
  moveTo: 37,
  flMoveFrom: 38,
  flMoveTo: 39,
  doItNow: 40,
  launch: 41,
  regenDay: 3,
  resetDay: 4,
} as const;

const SCENARIOS: Scenario[] = [
  // ── save_schedule (PUT /api/calendar/profile → the student_study_profile trigger) ──
  {
    name: "save: minutes per day 60 → 45",
    kind: "save_schedule",
    action: async () => ({
      kind: "save_schedule",
      before: await storedProfile(),
      after: { daily_minutes: 45 },
    }),
    act: () => saveProfile({ daily_minutes: 45 }),
  },
  {
    name: "save: study days 7 → 6",
    kind: "save_schedule",
    action: async () => ({
      kind: "save_schedule",
      before: await storedProfile(),
      after: { study_days_mask: 63 },
    }),
    act: () => saveProfile({ study_days_mask: 63 }),
  },
  {
    name: "save: practice tests on, every 2 weeks on Saturdays",
    kind: "save_schedule",
    action: async () => ({
      kind: "save_schedule",
      before: await storedProfile(),
      after: { full_length_weekday: 6, full_length_interval_weeks: 2 },
    }),
    act: () =>
      saveProfile({ full_length_weekday: 6, full_length_interval_weeks: 2 }),
  },
  {
    name: "save: the target score only",
    kind: "save_schedule",
    action: async () => ({
      kind: "save_schedule",
      before: await storedProfile(),
      after: {},
    }),
    act: () => saveProfile({ target_score: 1500 }),
  },
  {
    name: "save: the schedule as it already is",
    kind: "save_schedule",
    action: async () => ({
      kind: "save_schedule",
      before: await storedProfile(),
      after: { daily_minutes: 45, study_days_mask: 63 },
    }),
    act: () => saveProfile({ daily_minutes: 45, study_days_mask: 63 }),
  },
  // ── edit_day (PUT /api/calendar/days/:date → calendar_edit_day → day_edit version) ──
  {
    name: "edit: block out (clear) a day with work on it",
    kind: "edit_day",
    arrange: async () =>
      editDay(await plusDays(D.clear), [PRACTICE(10, "M"), PRACTICE(10, "RW")]),
    action: async () => ({
      kind: "edit_day",
      before: await dayBefore(await plusDays(D.clear)),
      after: [],
      estimates: await estimates(),
    }),
    act: async () => editDay(await plusDays(D.clear), []),
  },
  {
    name: "edit: remove one block",
    kind: "edit_day",
    arrange: async () =>
      editDay(await plusDays(D.removeOne), [
        PRACTICE(10, "M"),
        PRACTICE(10, "RW"),
      ]),
    action: async () => {
      const before = await dayBefore(await plusDays(D.removeOne));
      return {
        kind: "edit_day",
        before,
        after: carried(before.slice(1).map((b) => b.block_id)),
        estimates: await estimates(),
      };
    },
    act: async () => {
      const before = await dayBefore(await plusDays(D.removeOne));
      await editDay(
        await plusDays(D.removeOne),
        carried(before.slice(1).map((b) => b.block_id)),
      );
    },
  },
  {
    name: "edit: lower a block's count (20 → 10)",
    kind: "edit_day",
    arrange: async () => editDay(await plusDays(D.lower), [PRACTICE(20)]),
    action: async () => ({
      kind: "edit_day",
      before: await dayBefore(await plusDays(D.lower)),
      after: [PRACTICE(10)],
      estimates: await estimates(),
    }),
    act: async () => editDay(await plusDays(D.lower), [PRACTICE(10)]),
  },
  {
    name: "edit: raise a block's count (10 → 20)",
    kind: "edit_day",
    arrange: async () => editDay(await plusDays(D.raise), [PRACTICE(10)]),
    action: async () => ({
      kind: "edit_day",
      before: await dayBefore(await plusDays(D.raise)),
      after: [PRACTICE(20)],
      estimates: await estimates(),
    }),
    act: async () => editDay(await plusDays(D.raise), [PRACTICE(20)]),
  },
  {
    name: "edit: add a block",
    kind: "edit_day",
    arrange: async () => editDay(await plusDays(D.add), [PRACTICE(10)]),
    action: async () => {
      const before = await dayBefore(await plusDays(D.add));
      return {
        kind: "edit_day",
        before,
        after: [...carried(before.map((b) => b.block_id)), PRACTICE(5, "RW")],
        estimates: await estimates(),
      };
    },
    act: async () => {
      const before = await dayBefore(await plusDays(D.add));
      await editDay(await plusDays(D.add), [
        ...carried(before.map((b) => b.block_id)),
        PRACTICE(5, "RW"),
      ]);
    },
  },
  {
    name: "edit: put a full-length test on a day",
    kind: "edit_day",
    arrange: async () => editDay(await plusDays(D.flAdd), []),
    action: async () => ({
      kind: "edit_day",
      before: await dayBefore(await plusDays(D.flAdd)),
      after: [FULL_LENGTH()],
      estimates: await estimates(),
    }),
    act: async () => editDay(await plusDays(D.flAdd), [FULL_LENGTH()]),
  },
  {
    name: "edit: change a full-length test's timing on the same day",
    kind: "edit_day",
    action: async () => ({
      kind: "edit_day",
      before: await dayBefore(await plusDays(D.flEdit)),
      after: [FULL_LENGTH("lenient")],
      estimates: await estimates(),
    }),
    act: async () =>
      editDay(await plusDays(D.flEdit), [FULL_LENGTH("lenient")]),
  },
  {
    name: "edit: remove a full-length test",
    kind: "edit_day",
    action: async () => ({
      kind: "edit_day",
      before: await dayBefore(await plusDays(D.flRemove)),
      after: [],
      estimates: await estimates(),
    }),
    act: async () => editDay(await plusDays(D.flRemove), []),
  },
  // ── move_block (POST /api/calendar/blocks/:id/move → calendar_move_block) ──
  {
    name: "move: a practice block to another day",
    kind: "move_block",
    arrange: async () => editDay(await plusDays(D.moveFrom), [PRACTICE(10)]),
    action: async () => ({ kind: "move_block" }),
    act: async () => {
      const [b] = await dayBefore(await plusDays(D.moveFrom));
      const r = await q<{ r: { validator_result: string } }>(
        `SELECT public.calendar_move_block($1, $2::uuid, $3::date, 'v1', NULL) AS r`,
        [STUDENT, b?.block_id, await plusDays(D.moveTo)],
      );
      expect(r[0]?.r.validator_result).toBe("accepted");
    },
  },
  {
    name: "move: a full-length test to another day",
    kind: "move_block",
    arrange: async () => editDay(await plusDays(D.flMoveFrom), [FULL_LENGTH()]),
    action: async () => ({ kind: "move_block" }),
    act: async () => {
      const [b] = await dayBefore(await plusDays(D.flMoveFrom));
      const r = await q<{ r: { validator_result: string } }>(
        `SELECT public.calendar_move_block($1, $2::uuid, $3::date, 'v1', NULL) AS r`,
        [STUDENT, b?.block_id, await plusDays(D.flMoveTo)],
      );
      expect(r[0]?.r.validator_result).toBe("accepted");
    },
  },
  // ── the rest: never a student day_edit version ──
  {
    name: "Regenerate plan (student_refresh)",
    kind: "regenerate_plan",
    action: async () => ({ kind: "regenerate_plan" }),
    act: async () => {
      // NON-TRIVIAL: the budget is halved underneath the plan first (fixture write, triggers
      // off), so the regeneration really lowers planned days — it still records nothing.
      await pg.query(`SET session_replication_role = replica`);
      await pg.query(
        `UPDATE public.student_study_profile SET daily_minutes = 20 WHERE student_id = $1`,
        [STUDENT],
      );
      await pg.query(`SET session_replication_role = DEFAULT`);
      await q(
        `SELECT public.calendar_persist_version($1, 'student_refresh', 'student', 'v1', NULL)`,
        [STUDENT],
      );
    },
  },
  {
    name: "Regenerate day (day_regenerate)",
    kind: "regenerate_day",
    action: async () => ({ kind: "regenerate_day" }),
    act: async () => {
      await q(
        `SELECT public.calendar_regenerate_day($1, $2::date, 'day_regenerate', 'v1', NULL)`,
        [STUDENT, await plusDays(D.regenDay)],
      );
    },
  },
  {
    name: "Reset day / undo a day off (day_reset)",
    kind: "reset_day",
    action: async () => ({ kind: "reset_day" }),
    act: async () => {
      await q(
        `SELECT public.calendar_regenerate_day($1, $2::date, 'day_reset', 'v1', NULL)`,
        [STUDENT, await plusDays(D.resetDay)],
      );
    },
  },
  {
    name: "Do it now (a copy to today)",
    kind: "do_it_now",
    arrange: async () => editDay(await plusDays(D.doItNow), [PRACTICE(10)]),
    action: async () => ({ kind: "do_it_now" }),
    act: async () => {
      const [b] = await dayBefore(await plusDays(D.doItNow));
      const r = await q<{ r: { validator_result: string } }>(
        `SELECT public.calendar_do_it_now($1, $2::uuid, 'v1', NULL) AS r`,
        [STUDENT, b?.block_id],
      );
      expect(r[0]?.r.validator_result).toBe("accepted");
    },
  },
  {
    name: "Start a block (launch)",
    kind: "launch_block",
    arrange: async () => editDay(await plusDays(D.launch), [PRACTICE(10)]),
    action: async () => ({ kind: "launch_block" }),
    act: async () => {
      const [b] = await dayBefore(await plusDays(D.launch));
      await q(
        `SELECT public.calendar_link_launch($1, $2::uuid, 'practice', $3::uuid)`,
        [STUDENT, b?.block_id, randomUUID()],
      );
    },
  },
  {
    name: "Acknowledge a plan update",
    kind: "acknowledge",
    action: async () => ({ kind: "acknowledge" }),
    act: async () => {
      const v = await q<{ n: number }>(
        `SELECT max(version_no)::int AS n FROM public.calendar_plan_versions WHERE student_id = $1`,
        [STUDENT],
      );
      await q(`SELECT public.calendar_acknowledge_version($1, $2::int)`, [
        STUDENT,
        v[0]?.n,
      ]);
    },
  },
];

describe.skipIf(!PG_AVAILABLE)(
  "guardian-notify predicate ⇔ SQL recording (real Postgres)",
  () => {
    const results: {
      name: string;
      kind: CalendarActionKind;
      predicted: boolean;
      recorded: boolean;
    }[] = [];

    beforeAll(async () => {
      process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "guardian-notify-parity";
      pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, role, dob, name] of [
        [STUDENT, "student", "2008-01-01", "Parity Student"],
        [GUARDIAN, "guardian", "1980-01-01", "Parity Guardian"],
      ] as const) {
        await pg.query(
          `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, `${id}@example.test`],
        );
        await pg.query(
          `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth)
           VALUES ($1, $2, $3, $4, $5::date)`,
          [id, `${id}@example.test`, role, name, dob],
        );
      }
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id)
         VALUES ($1, 'premium', 'active', 'sub_parity', 'si_parity')`,
        [STUDENT],
      );
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
         VALUES ($1, $2, 'active', 'student', now(), now())`,
        [GUARDIAN, STUDENT],
      );
      await pg.query(
        `INSERT INTO public.student_study_profile
           (student_id, timezone, study_days_mask, daily_minutes, target_score, setup_completed_at)
         VALUES ($1, 'America/Chicago', 127, 60, 1400, now() - interval '14 days')`,
        [STUDENT],
      );
      const r = await q<{ r: { validator_result: string } }>(
        `SELECT public.calendar_persist_version($1, 'setup', 'student', 'v1', NULL) AS r`,
        [STUDENT],
      );
      expect(r[0]?.r.validator_result).toBe("accepted");
      // Presence: this student HAS a recipient, so "not recorded" below is never "no guardian".
      const recipients = await q<{ r: unknown[] }>(
        `SELECT public.accountability_guardian_recipients($1) AS r`,
        [STUDENT],
      );
      expect(recipients[0]?.r).toHaveLength(1);
    }, 240_000);

    afterAll(async () => {
      if (pg) await pg.end();
    });

    it.each(SCENARIOS.map((s) => [s.name, s] as const))(
      "%s: the dialog shows exactly when the SQL records it",
      async (_name, s) => {
        if (s.arrange) await s.arrange();
        const action = await s.action();
        expect(action.kind).toBe(s.kind);
        const predicted = calendarActionRecorded(action);
        const before = await recordedEvents();
        await s.act();
        const recorded = (await recordedEvents()) > before;
        results.push({ name: s.name, kind: s.kind, predicted, recorded });
        expect(predicted).toBe(recorded);
        // And the dialog question is that answer for a student whose guardian is told.
        expect(willNotifyGuardian(action, true)).toBe(recorded);
        expect(willNotifyGuardian(action, false)).toBe(false);
      },
    );

    it("covers every calendar action, and both answers occur", () => {
      const kinds = new Set(SCENARIOS.map((s) => s.kind));
      for (const k of CALENDAR_ACTIONS) expect(kinds.has(k)).toBe(true);
      expect(results).toHaveLength(SCENARIOS.length);
      expect(results.some((r) => r.recorded)).toBe(true);
      expect(results.some((r) => !r.recorded)).toBe(true);
      // The brief's named recorded actions are among the recorded ones (the SQL captures them
      // today; if it ever stopped, the predicate must follow, and this names the gap).
      for (const name of [
        "save: minutes per day 60 → 45",
        "save: study days 7 → 6",
        "save: practice tests on, every 2 weeks on Saturdays",
        "edit: block out (clear) a day with work on it",
        "edit: remove one block",
        "edit: remove a full-length test",
        "move: a practice block to another day",
        "move: a full-length test to another day",
      ]) {
        expect(results.find((r) => r.name === name)?.recorded).toBe(true);
      }
    });
  },
);
