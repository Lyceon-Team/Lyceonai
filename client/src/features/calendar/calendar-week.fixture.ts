/**
 * One study week, built by the REAL read model — for tests, the browser harness and the
 * review screenshots. Not imported by the app.
 *
 * @spec [Doc_05F §13 (the allocator), §14 (the read model and its facts), §16 (the guardian
 *       projection, `toGuardianCalendarDay`); CLAUDE.md "derive the fixture from real output";
 *       owner decision 2026-10-01 on PR 1003 ("re-shoot the calendar with review data whose
 *       `days` contain real blocks consistent with `facts` — the Dashboard and the Calendar
 *       must tell the same story")] | @implemented [2026-10-01]
 *
 * plain English: a Monday–Sunday week of planned blocks and the work the student did, handed
 * to `buildCalendarRange` — the function the server's read service calls — so every block's
 * status and every number in `facts` is what the product itself would compute. The student
 * payload and the guardian payload are both cut from that ONE range (the guardian's days
 * through `toGuardianCalendarDay`, as the server does), so the guardian Dashboard's header
 * (which reads `facts`) and either calendar agree by construction.
 *
 * The week is relative to `today`: days before it have work done (one block missed, one
 * partly done), today has one block done and one still to do, later days are scheduled.
 */
import {
  buildCalendarRange,
  calendarReadyResponseSchema,
  guardianCalendarResponseSchema,
  toGuardianCalendarDay,
  type ActivityUnit,
  type CalendarDayInput,
  type CanonicalDomain,
  type CalendarRange,
  type PlanBlock,
} from "@lyceon/shared/calendar";
import { addDays, startOfWeek } from "./lib/dates";

const TIMEZONE = "UTC";

/** A deterministic uuid per (day, slot), so a re-run builds byte-identical payloads. */
function blockId(dayIndex: number, slot: number): string {
  const n = String(dayIndex * 10 + slot).padStart(12, "0");
  return `7c9e6679-7425-40de-944b-${n}`;
}

type Slot =
  | {
      kind: "practice";
      section: "M" | "RW";
      domain: CanonicalDomain;
      target: number;
    }
  | { kind: "review"; target: number }
  | { kind: "full_length" };

/** What each weekday plans (Monday first). Sunday is a rest day. */
const WEEK_PLAN: readonly (readonly Slot[])[] = [
  [
    { kind: "practice", section: "M", domain: "Algebra", target: 15 },
    {
      kind: "practice",
      section: "RW",
      domain: "Craft and Structure",
      target: 12,
    },
  ],
  [
    { kind: "practice", section: "M", domain: "Advanced Math", target: 15 },
    { kind: "review", target: 10 },
  ],
  [
    {
      kind: "practice",
      section: "RW",
      domain: "Information and Ideas",
      target: 12,
    },
    {
      kind: "practice",
      section: "M",
      domain: "Geometry and Trigonometry",
      target: 10,
    },
  ],
  [
    {
      kind: "practice",
      section: "M",
      domain: "Problem Solving and Data Analysis",
      target: 15,
    },
    { kind: "review", target: 10 },
  ],
  [
    {
      kind: "practice",
      section: "RW",
      domain: "Standard English Conventions",
      target: 12,
    },
    {
      kind: "practice",
      section: "RW",
      domain: "Expression of Ideas",
      target: 12,
    },
  ],
  [{ kind: "full_length" }],
  [],
];

function toBlock(
  date: string,
  dayIndex: number,
  slot: number,
  s: Slot,
): PlanBlock {
  const common = {
    block_id: blockId(dayIndex, slot),
    scheduled_date: date,
    source: "auto" as const,
    derived_from_block_id: null,
    explanation_key: "weighted",
    display_ordinal: slot + 1,
    membership_type: "created" as const,
  };
  if (s.kind === "practice") {
    return {
      ...common,
      block_type: "practice",
      section: s.section,
      scope: {
        level: "domain",
        mix: [{ domain: s.domain, count: s.target, explanation_key: "weak" }],
      },
      target_count: s.target,
    };
  }
  if (s.kind === "review") {
    return {
      ...common,
      block_type: "review",
      section: null,
      scope: { mode: "queue" },
      target_count: s.target,
    };
  }
  return {
    ...common,
    block_type: "full_length",
    section: null,
    scope: { form_id: null, exam_mode: "strict" },
    target_count: 1,
  };
}

/**
 * How much of a block's target was done. Past days: all of it, except Tuesday's review
 * (missed) and Wednesday's Geometry (partly done). Today: the first block done, the second
 * not started. Later days: nothing yet.
 */
function doneFor(
  dayIndex: number,
  slot: number,
  target: number,
  todayIndex: number,
): number {
  if (dayIndex > todayIndex) return 0;
  if (dayIndex === todayIndex) return slot === 0 ? target : 0;
  if (dayIndex === 1 && slot === 1) return 0;
  if (dayIndex === 2 && slot === 1) return Math.ceil(target / 2);
  return target;
}

function unitsFor(
  date: string,
  dayIndex: number,
  slot: number,
  s: Slot,
  done: number,
): ActivityUnit[] {
  const base = {
    session_id: `s-${dayIndex}-${slot}`,
    local_date: date,
    form_id: null,
  };
  return Array.from({ length: done }, (_unused, i) => ({
    ...base,
    engine: s.kind,
    unit_id: `u-${dayIndex}-${slot}-${i}`,
    occurred_at: `${date}T${String(14 + slot).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
    section: s.kind === "practice" ? s.section : null,
    domain: s.kind === "practice" ? s.domain : null,
  }));
}

/** The week containing `today`, through the real read model. */
export function calendarWeekRange(today: string): {
  range: CalendarRange;
  from: string;
  to: string;
} {
  const monday = startOfWeek(today);
  const todayIndex = WEEK_PLAN.findIndex(
    (_p, i) => addDays(monday, i) === today,
  );
  const days: CalendarDayInput[] = [];
  const units: ActivityUnit[] = [];
  WEEK_PLAN.forEach((slots, dayIndex) => {
    const date = addDays(monday, dayIndex);
    const blocks = slots.map((s, slot) => toBlock(date, dayIndex, slot, s));
    days.push({
      local_date: date,
      timezone: TIMEZONE,
      is_user_override: false,
      is_study_day: slots.length > 0,
      version_no: 1,
      blocks,
    });
    slots.forEach((s, slot) => {
      const target = s.kind === "full_length" ? 1 : s.target;
      units.push(
        ...unitsFor(
          date,
          dayIndex,
          slot,
          s,
          doneFor(dayIndex, slot, target, todayIndex),
        ),
      );
    });
  });
  const range = buildCalendarRange({
    today,
    days,
    units,
    launches: [],
    linked_sessions: [],
  });
  return { range, from: monday, to: addDays(monday, 6) };
}

const STREAK = { current: 4, longest: 11, history_complete: false };
const PROJECTION = [
  {
    section: "RW",
    projectedScoreLow: 590,
    projectedScoreMid: 620,
    projectedScoreHigh: 650,
    relevantQuestionCount: 40,
    computedAt: "2026-09-29T00:00:00Z",
  },
  {
    section: "M",
    projectedScoreLow: 590,
    projectedScoreMid: 610,
    projectedScoreHigh: 630,
    relevantQuestionCount: 40,
    computedAt: "2026-09-29T00:00:00Z",
  },
];
const ESTIMATES = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 60,
};
const TARGET_SCORE = 1350;
const TARGET_EXAM_DATE = "2026-12-06";

/** The student's `GET /api/calendar` answer for that week, through its schema and envelope. */
export function studentCalendarWeek(today: string): Record<string, unknown> {
  const { range } = calendarWeekRange(today);
  const payload = calendarReadyResponseSchema.parse({
    status: "ready",
    profile: {
      timezone: TIMEZONE,
      target_exam_date: TARGET_EXAM_DATE,
      target_score: TARGET_SCORE,
      study_days_mask: 63,
      daily_minutes: 45,
      full_length_weekday: 6,
      full_length_interval_weeks: 1,
      planner_mode: "auto",
      setup_completed_at: "2026-09-01T00:00:00Z",
    },
    bounds: {
      daily_minutes_min: 15,
      daily_minutes_max: 180,
      daily_minutes_presets: [15, 30, 45, 60, 90, 120],
      target_exam_date_max_days: 540,
    },
    estimates: ESTIMATES,
    exam_planning: {
      final_exam_lead_days: 7,
      default_full_length_interval_weeks: 2,
      default_full_length_weekday: 6,
    },
    full_length_suppressions: [],
    days: range.days,
    facts: range.facts,
    streak: STREAK,
    latest_unacknowledged_nonstudent_change: null,
    diagnostic_state: "baseline_ready",
    projection: PROJECTION,
    enabled_block_types: ["practice", "review", "full_length"],
  });
  // `/api/calendar` wraps its payload with `requestId` alone — no `ok`, which is the
  // `/api/students/*` surface's marker (`calendar/api/client.ts`, CALENDAR_TRANSPORT_KEYS).
  return { ...payload, requestId: "r" };
}

/** The guardian's `GET /api/students/:id/calendar` answer for the SAME week, as the server projects it. */
export function guardianCalendarWeek(
  today: string,
  over: {
    streak?: number | null;
    targetScore?: number | null;
    testDate?: string | null;
  } = {},
): Record<string, unknown> {
  const { range } = calendarWeekRange(today);
  const payload = guardianCalendarResponseSchema.parse({
    status: "ready",
    target_score:
      over.targetScore === undefined ? TARGET_SCORE : over.targetScore,
    target_exam_date:
      over.testDate === undefined ? TARGET_EXAM_DATE : over.testDate,
    projection: PROJECTION,
    estimates: ESTIMATES,
    full_length_suppressions: [],
    days: range.days.map(toGuardianCalendarDay),
    facts: range.facts,
    streak: {
      ...STREAK,
      current: over.streak === undefined ? STREAK.current : over.streak,
    },
  });
  return { ok: true, ...payload, requestId: "r" };
}
