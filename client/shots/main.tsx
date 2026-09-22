/**
 * @spec [Doc_05F_Study_Calendar, §17.1 layout, §17.5 states] | @implemented [2026-09-23]
 * plain English: a dev-only harness that mounts the real calendar with the prototype's own
 * plan data so the two can be screenshotted and compared. Expected outcome: a picture of the
 * shipped component, not of a mock. Trade-off: the plan data is fixtures — but so is the
 * prototype's, which is exactly what makes the comparison fair. Edge case: it renders
 * OUTSIDE App.tsx, so it does not get the global token stylesheet; that is a feature, and it
 * is how the missing `var()` fallbacks in calendar.css were found.
 *
 * Screenshot harness — NOT shipped. Mounts the real `CalendarView` with the same plan data
 * the approved prototype uses, so a screenshot of this and a screenshot of
 * docs/design/calendar-prototype.html are comparing like with like: the prototype is itself
 * fixture-driven, so the only difference between the two pictures is the implementation.
 *
 * The scene is chosen by `?scene=` so one build serves every state.
 */
import { createRoot } from "react-dom/client";
import type {
  CalendarReadyResponse,
  GuardianCalendarReadyResponse,
  PlanBlock,
} from "@lyceon/shared/calendar";
import { CalendarView } from "@/features/calendar/CalendarView";
import {
  guardianViewModel,
  studentViewModel,
} from "@/features/calendar/lib/view-model";
import {
  CalendarError,
  CalendarPremiumGate,
  CalendarSkeleton,
  GuardianNotSetUp,
} from "@/features/calendar/components/CalendarStates";
import { HttpApiError } from "@/lib/api-error";
import "@/features/calendar/calendar.css";

const TODAY = "2026-09-21";
const ESTIMATES = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 120,
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

let uid = 0;
function id(): string {
  uid += 1;
  return `${uid.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
}

type MixSpec = [string, number, string];

function practice(
  date: string,
  section: "M" | "RW",
  mix: MixSpec[],
  ordinal: number,
): PlanBlock {
  return {
    block_id: id(),
    scheduled_date: date,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "weighted",
    display_ordinal: ordinal,
    membership_type: "created",
    block_type: "practice",
    section,
    scope: {
      level: "domain",
      mix: mix.map(([domain, count, key]) => ({
        domain: domain as never,
        count,
        explanation_key: key,
      })),
    },
    target_count: mix.reduce((sum, [, count]) => sum + count, 0),
  };
}

function review(date: string, count: number, ordinal: number): PlanBlock {
  return {
    block_id: id(),
    scheduled_date: date,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "review_due",
    display_ordinal: ordinal,
    membership_type: "created",
    block_type: "review",
    section: null,
    scope: { mode: "queue" },
    target_count: count,
  };
}

function fullLength(date: string, ordinal: number): PlanBlock {
  return {
    block_id: id(),
    scheduled_date: date,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "exam_cadence",
    display_ordinal: ordinal,
    membership_type: "created",
    block_type: "full_length",
    section: null,
    scope: { form_id: "form-a" },
    target_count: 1,
  };
}

/** The prototype's own plan, day for day. */
const PLAN: Record<string, PlanBlock[]> = {};
const M_MIX: MixSpec[][] = [
  [
    ["Advanced Math", 5, "weak"],
    ["Geometry and Trigonometry", 5, "weak"],
  ],
  [
    ["Algebra", 5, "balanced"],
    ["Problem Solving and Data Analysis", 5, "balanced"],
    ["Advanced Math", 5, "weak"],
  ],
  [
    ["Geometry and Trigonometry", 5, "weak"],
    ["Algebra", 5, "balanced"],
    ["Problem Solving and Data Analysis", 5, "balanced"],
  ],
  [
    ["Advanced Math", 5, "weak"],
    ["Geometry and Trigonometry", 5, "weak"],
    ["Algebra", 5, "balanced"],
  ],
  [
    ["Problem Solving and Data Analysis", 5, "balanced"],
    ["Advanced Math", 5, "weak"],
    ["Geometry and Trigonometry", 5, "weak"],
  ],
];
const RW_MIX: MixSpec[][] = [
  [
    ["Expression of Ideas", 5, "weak"],
    ["Craft and Structure", 5, "weak"],
    ["Standard English Conventions", 5, "weak"],
  ],
  [
    ["Information and Ideas", 5, "balanced"],
    ["Expression of Ideas", 5, "weak"],
    ["Craft and Structure", 5, "weak"],
  ],
  [
    ["Standard English Conventions", 5, "weak"],
    ["Expression of Ideas", 5, "weak"],
    ["Information and Ideas", 5, "balanced"],
  ],
  [
    ["Craft and Structure", 5, "weak"],
    ["Standard English Conventions", 5, "weak"],
    ["Expression of Ideas", 5, "weak"],
  ],
  [
    ["Information and Ideas", 5, "balanced"],
    ["Craft and Structure", 5, "weak"],
    ["Standard English Conventions", 5, "weak"],
  ],
];

for (let index = 0; index < 5; index += 1) {
  const date = addDays(TODAY, index);
  PLAN[date] = [
    review(date, index === 0 ? 9 : 4, 1),
    practice(date, "M", M_MIX[index] ?? [], 2),
    practice(date, "RW", RW_MIX[index] ?? [], 3),
  ];
}
PLAN[addDays(TODAY, 5)] = [fullLength(addDays(TODAY, 5), 1)];
PLAN[addDays(TODAY, 6)] = [];
for (let index = 7; index < 14; index += 1) {
  const date = addDays(TODAY, index);
  PLAN[date] =
    index % 7 === 6
      ? []
      : [
          review(date, 4, 1),
          practice(date, "M", M_MIX[index % 5] ?? [], 2),
          practice(date, "RW", RW_MIX[index % 5] ?? [], 3),
        ];
}
// A week of history, so "Today" is not the first day the calendar knows about.
for (let index = -7; index < 0; index += 1) {
  const date = addDays(TODAY, index);
  PLAN[date] =
    index === -2
      ? [fullLength(date, 1)]
      : index === -1
        ? []
        : [
            review(date, 4, 1),
            practice(date, "M", M_MIX[(index + 7) % 5] ?? [], 2),
            practice(date, "RW", RW_MIX[(index + 7) % 5] ?? [], 3),
          ];
}

function statusFor(
  date: string,
  block: PlanBlock,
  ordinal: number,
): { actual: number; status: string } {
  if (date < TODAY) {
    // Last week finished; Friday partial — the prototype's own history.
    if (date === addDays(TODAY, -3)) {
      if (ordinal === 1)
        return { actual: block.target_count, status: "completed" };
      if (ordinal === 2)
        return {
          actual: Math.round((block.target_count * 0.6) / 5) * 5,
          status: "partial",
        };
      return { actual: 0, status: "missed" };
    }
    return { actual: block.target_count, status: "completed" };
  }
  // Today: the review block is underway, which is what makes it locked.
  if (date === TODAY && ordinal === 1)
    return { actual: 5, status: "in_progress" };
  return { actual: 0, status: "scheduled" };
}

function buildDays(from: string, to: string): CalendarReadyResponse["days"] {
  const days: CalendarReadyResponse["days"] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const blocks = (PLAN[date] ?? []).map((block, index) => {
      const { actual, status } = statusFor(date, block, index + 1);
      return {
        block,
        actual,
        progress: block.target_count === 0 ? 0 : actual / block.target_count,
        status: status as never,
      };
    });
    const planned = blocks.reduce(
      (sum, entry) => sum + entry.block.target_count,
      0,
    );
    const done = blocks.reduce((sum, entry) => sum + entry.actual, 0);
    days.push({
      local_date: date,
      timezone: "America/Chicago",
      is_user_override: false,
      is_study_day: blocks.length > 0,
      version_no: 1,
      status: (blocks.length === 0
        ? "rest"
        : date === TODAY
          ? "today"
          : date < TODAY
            ? done >= planned
              ? "complete"
              : done > 0
                ? "partial"
                : "missed"
            : "upcoming") as never,
      blocks,
      extra_work: [],
      planned_count: planned,
      actual_count: done,
      extra_count: 0,
    });
  }
  return days;
}

const FACTS = {
  blocks_total: 27,
  blocks_completed: 16,
  blocks_partial: 1,
  blocks_missed: 1,
  blocks_in_progress: 1,
  blocks_scheduled: 8,
  questions_completed: 214,
  full_lengths_completed: 1,
  extra_questions: 18,
};

const STREAK = { current: 6, longest: null, history_complete: false };

function readyResponse(from: string, to: string): CalendarReadyResponse {
  return {
    status: "ready",
    profile: {
      timezone: "America/Chicago",
      target_exam_date: "2026-11-07",
      target_score: 1400,
      study_days_mask: 126,
      daily_minutes: 60,
      full_length_weekday: 6,
      planner_mode: "auto",
      setup_completed_at: "2026-09-01T00:00:00Z",
    },
    estimates: ESTIMATES,
    days: buildDays(from, to),
    facts: FACTS,
    streak: STREAK,
    latest_unacknowledged_nonstudent_change: {
      version_no: 2,
      trigger: "weekly",
      created_at: "2026-09-21T09:00:00Z",
    },
    diagnostic_state: "baseline_ready",
  };
}

const NOOP_MUTATIONS = {
  editDay: () => {},
  moveBlock: () => {},
  regeneratePlan: () => {},
  regenerateDay: () => {},
  resetDay: () => {},
  doItNow: () => {},
  launch: () => {},
  acknowledge: () => {},
  refreshPending: false,
  launchPending: false,
};

function guardianResponse(
  from: string,
  to: string,
): GuardianCalendarReadyResponse {
  const student = readyResponse(from, to);
  return {
    status: "ready",
    days: student.days.map((day) => ({
      local_date: day.local_date,
      timezone: day.timezone,
      is_study_day: day.is_study_day,
      status: day.status,
      blocks: day.blocks.map((entry) => ({
        block:
          entry.block.block_type === "practice"
            ? {
                block_id: entry.block.block_id,
                scheduled_date: entry.block.scheduled_date,
                display_ordinal: entry.block.display_ordinal,
                block_type: "practice" as const,
                section: entry.block.section,
                scope:
                  entry.block.scope.level === "domain"
                    ? {
                        level: "domain" as const,
                        mix: entry.block.scope.mix.map((item) => ({
                          domain: item.domain,
                          count: item.count,
                        })),
                      }
                    : {
                        level: "section" as const,
                        count: entry.block.scope.count,
                      },
                target_count: entry.block.target_count,
              }
            : entry.block.block_type === "review"
              ? {
                  block_id: entry.block.block_id,
                  scheduled_date: entry.block.scheduled_date,
                  display_ordinal: entry.block.display_ordinal,
                  block_type: "review" as const,
                  section: null,
                  scope: { mode: "queue" as const },
                  target_count: entry.block.target_count,
                }
              : {
                  block_id: entry.block.block_id,
                  scheduled_date: entry.block.scheduled_date,
                  display_ordinal: entry.block.display_ordinal,
                  block_type: "full_length" as const,
                  section: null,
                  scope: {},
                  target_count: 1 as const,
                },
        actual: entry.actual,
        progress: entry.progress,
        status: entry.status,
      })),
      extra_work: [],
      planned_count: day.planned_count,
      actual_count: day.actual_count,
      extra_count: day.extra_count,
    })),
    facts: FACTS,
    streak: STREAK,
  };
}

const WEEK = { from: addDays(TODAY, -7), to: addDays(TODAY, 20) };
const MONTH = { from: "2026-08-31", to: "2026-10-11" };

function Scene(): JSX.Element {
  const scene =
    new URLSearchParams(window.location.search).get("scene") ?? "week";

  if (scene === "loading") return <CalendarSkeleton />;
  if (scene === "premium") return <CalendarPremiumGate />;
  if (scene === "guardian-not-set-up") return <GuardianNotSetUp />;
  if (scene === "error") {
    return (
      <CalendarError
        error={
          new HttpApiError({
            status: 500,
            message: "We couldn't reach your plan just now.",
          })
        }
        onRetry={() => {}}
      />
    );
  }

  if (scene === "guardian") {
    return (
      <CalendarView
        model={guardianViewModel(guardianResponse(WEEK.from, WEEK.to))}
        today={TODAY}
        viewerName="Study plan"
        targetExamDate={null}
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
      />
    );
  }

  if (scene === "setup") {
    return (
      <CalendarView
        model={null}
        setup={{
          defaults: {
            timezone: "America/Chicago",
            daily_minutes_presets: [15, 30, 45, 60, 90, 120],
            daily_minutes_min: 15,
            daily_minutes_max: 180,
            target_exam_date_max_days: 540,
          },
          onSubmit: () => {},
          pending: false,
          error: null,
        }}
        today={TODAY}
        viewerName="Karl Nkemzi"
        targetExamDate={null}
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
      />
    );
  }

  const range = scene === "month" ? MONTH : WEEK;
  return (
    <CalendarView
      model={studentViewModel(readyResponse(range.from, range.to))}
      today={TODAY}
      viewerName="Karl Nkemzi"
      targetExamDate="2026-11-07"
      streak={STREAK}
      planUpdate={{ versionNo: 2, trigger: "weekly" }}
      onRangeChange={() => {}}
      mutations={NOOP_MUTATIONS}
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Scene />);
