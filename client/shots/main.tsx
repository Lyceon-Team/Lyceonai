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
import { SettingsSheet } from "@/features/calendar/components/SettingsSheet";
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

/** §8.1 bounds, served on the ready payload since 2026-09-22 so §17.3 can build its chips. */
const BOUNDS = {
  daily_minutes_min: 15,
  daily_minutes_max: 180,
  daily_minutes_presets: [15, 30, 45, 60, 90, 120],
  target_exam_date_max_days: 540,
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

/**
 * `blockedOut` is a date the STUDENT cleared: overridden, and holding nothing. It is not a
 * rest day — that is the mask — and the two must not look alike, which is exactly what the
 * day-off scenes exist to check.
 */
function buildDays(
  from: string,
  to: string,
  blockedOut?: string,
): CalendarReadyResponse["days"] {
  const days: CalendarReadyResponse["days"] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const cleared = date === blockedOut;
    const blocks = (cleared ? [] : (PLAN[date] ?? [])).map((block, index) => {
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
      is_user_override: cleared,
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

function readyResponse(
  from: string,
  to: string,
  blockedOut?: string,
): CalendarReadyResponse {
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
    bounds: BOUNDS,
    estimates: ESTIMATES,
    days: buildDays(from, to, blockedOut),
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
  blockOutDay: () => {},
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

/** Doc 05C's band, production's values for this student: M 470 (380-560), RW 400 (300-500). */
const SHOT_PROJECTION = [
  {
    section: "M" as const,
    projectedScoreMid: 470,
    projectedScoreLow: 380,
    projectedScoreHigh: 560,
    relevantQuestionCount: 42,
    computedAt: "2026-09-25T00:00:00Z",
  },
  {
    section: "RW" as const,
    projectedScoreMid: 400,
    projectedScoreLow: 300,
    projectedScoreHigh: 500,
    relevantQuestionCount: 37,
    computedAt: "2026-09-25T00:00:00Z",
  },
];

function guardianResponse(
  from: string,
  to: string,
): GuardianCalendarReadyResponse {
  const student = readyResponse(from, to);
  return {
    status: "ready",
    // Owner ruling 2026-09-26: R-08-22 reversed, §16's "no profile" clause narrowed to these
    // two. Same values the student fixture carries — it is the same plan.
    target_score: student.profile.target_score,
    target_exam_date: student.profile.target_exam_date,
    projection: SHOT_PROJECTION,
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
    // PRE-EXISTING BUG, fixed here because it blocked the screenshot this change needs.
    // `estimates` became REQUIRED on the guardian payload with the owner's ruling of
    // 2026-09-22, and this fixture never gained it — so `?scene=guardian` has been throwing
    // "Cannot read properties of undefined (reading 'review_seconds_per_unit')" and
    // rendering a blank page ever since. Nothing caught it: `client/shots/` is outside
    // tsconfig, so the missing required field was invisible to the compiler, and a dev-only
    // harness has no test. Same shape as the finding in CLAUDE.md — a surface with weaker
    // guarantees than the code it depicts.
    estimates: ESTIMATES,
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
    const guardian = guardianResponse(WEEK.from, WEEK.to);
    return (
      <CalendarView
        model={guardianViewModel(guardian)}
        today={TODAY}
        viewerName="Study plan"
        viewer="guardian"
        targetExamDate={guardian.target_exam_date}
        targetScore={guardian.target_score}
        projection={guardian.projection}
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
      />
    );
  }

  // The guardian header with NOTHING to show — the state 103 of 104 students in production
  // are in. Its whole point is that each empty slot STATES a fact ("No target set", "No test
  // date", "Not enough practice yet") where the student's would instruct an action. A
  // guardian has no write path, so an instruction would point nowhere.
  if (scene === "guardian-empty") {
    return (
      <CalendarView
        model={guardianViewModel(guardianResponse(WEEK.from, WEEK.to))}
        today={TODAY}
        viewerName="Study plan"
        viewer="guardian"
        targetExamDate={null}
        targetScore={null}
        projection={undefined}
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
      />
    );
  }

  // The same empty header as a STUDENT sees it, for the side-by-side that shows the
  // difference is copy and nothing else.
  if (scene === "student-empty") {
    return (
      <CalendarView
        model={studentViewModel(readyResponse(WEEK.from, WEEK.to))}
        today={TODAY}
        viewerName="Karl Nkemzi"
        viewer="student"
        targetExamDate={null}
        targetScore={null}
        projection={undefined}
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
        viewer="student"
        targetExamDate={null}
        // FOURTH instance, same one-line shape. A student who has not run setup has no
        // target, so this is `null` — the ABSENT branch, "Set a target" — where before it
        // was `undefined` and rendered an empty populated branch.
        targetScore={null}
        streak={STREAK}
        planUpdate={null}
        onRangeChange={() => {}}
      />
    );
  }

  // The settings sheet is opened by internal state, so the scene renders the component
  // itself. That is the honest screenshot: it is the shipped component with the served
  // bounds, not a mock of one.
  if (scene === "settings") {
    const response = readyResponse(WEEK.from, WEEK.to);
    return (
      <div className="lyceon-calendar" style={{ height: "100vh" }}>
        <SettingsSheet
          profile={response.profile}
          bounds={BOUNDS}
          estimates={ESTIMATES}
          today={TODAY}
          onSave={() => {}}
          onClose={() => {}}
          pending={false}
          error={null}
          replanOffer={null}
        />
      </div>
    );
  }

  // A day the student BLOCKED OUT, in each grid. Wednesday, two days out.
  const dayOff = addDays(TODAY, 2);
  const isDayOff = scene === "dayoff-week" || scene === "dayoff-month";

  const range = scene === "month" || scene === "dayoff-month" ? MONTH : WEEK;
  return (
    <CalendarView
      model={studentViewModel(
        readyResponse(range.from, range.to, isDayOff ? dayOff : undefined),
      )}
      today={TODAY}
      viewerName="Karl Nkemzi"
      viewer="student"
      targetExamDate="2026-11-07"
      // THIRD INSTANCE of the same harness bug, found the same way. `targetScore` is a
      // REQUIRED prop and this scene never passed it, so the header rendered "Target" with
      // no number in every committed shot — `undefined` is neither a number nor `null`, so
      // it took the POPULATED branch with nothing in it rather than the absent one. Same
      // root cause as the missing `estimates`: `client/shots/` is outside tsconfig, so a
      // missing required prop is invisible here in a way it could never be in `client/src`.
      targetScore={readyResponse(range.from, range.to).profile.target_score}
      projection={SHOT_PROJECTION}
      streak={STREAK}
      planUpdate={{ versionNo: 2, trigger: "weekly" }}
      onRangeChange={() => {}}
      schedule={{
        profile: readyResponse(range.from, range.to).profile,
        bounds: BOUNDS,
        estimates: ESTIMATES,
        onSave: () => {},
        pending: false,
        error: null,
        offerReplan: false,
        onConfirmReplan: () => {},
        onDismissReplan: () => {},
      }}
      mutations={NOOP_MUTATIONS}
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Scene />);
