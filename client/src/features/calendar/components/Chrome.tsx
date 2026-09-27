/**
 * @spec [Doc_05F_Study_Calendar, §17.1 layout, §17.4 plan-updated banner (INV-08-13),
 *        §14 facts (R-08-28), §15 streak (INV-08-20)]
 * @implemented [2026-09-23]
 *
 * plain English: the frame around the grid — the left rail, the top bar, the plan-updated
 * banner and the facts strip. Expected outcome: the same chrome the prototype draws, with
 * every control that writes anything absent on the guardian surface.
 *
 * THE GUARDIAN DIFFERENCE IS IN THE PROPS, NOT IN A FLAG. `TopBar` takes `onRefresh?`, and a
 * guardian caller passes nothing; there is no `readOnly` branch inside to get wrong. Same
 * for the banner's dismiss and the rail's type filters, which stay because filtering is a
 * view control and writes nothing.
 *
 * edge cases: §15's streak is `{ current, longest, history_complete }` where both numbers
 * are nullable until their gates clear. `history_complete: false` renders the current streak
 * WITHOUT a longest figure — showing "longest: 0" for a student whose history has not been
 * backfilled would be a claim the data does not support.
 */
import type { PlanTrigger, StreakSummary } from "@lyceon/shared/calendar";
import type { SectionProjectionDto } from "@lyceon/shared";
import { projectedRange } from "../lib/projection";
import { bannerCopy } from "../copy/banner";
import {
  dayOfMonth,
  isSameMonth,
  monthGridDates,
  monthName,
  WEEKDAY_HEADERS,
} from "../lib/dates";
import type { CalendarViewModel, ViewBlock } from "../lib/view-model";
import { Link } from "wouter";

// ── Left rail ───────────────────────────────────────────────────────────────

export type ToneFilter = Record<ViewBlock["tone"], boolean>;

export const ALL_TONES_VISIBLE: ToneFilter = {
  math: true,
  rw: true,
  review: true,
  exam: true,
};

const FILTER_ROWS: readonly {
  tone: ViewBlock["tone"];
  label: string;
  varName: string;
}[] = [
  { tone: "math", label: "Math practice", varName: "--math" },
  { tone: "rw", label: "Reading & Writing", varName: "--rw" },
  { tone: "review", label: "Review", varName: "--rev" },
  { tone: "exam", label: "Practice test", varName: "--exam" },
];

export function LeftRail({
  name,
  subtitle,
  miniMonth,
  cursor,
  today,
  hasWork,
  filters,
  onToggleFilter,
  onPickDate,
  onMonthStep,
  footer,
  schedule,
}: {
  name: string;
  subtitle: string;
  miniMonth: string;
  cursor: string;
  today: string;
  hasWork: (date: string) => boolean;
  filters: ToneFilter;
  onToggleFilter: (tone: ViewBlock["tone"], next: boolean) => void;
  onPickDate: (date: string) => void;
  onMonthStep: (delta: number) => void;
  footer: string;
  /**
   * §17.3's "Your schedule" card. ABSENT for a guardian, like every other control on this
   * surface — the difference is the missing prop, not a `readOnly` branch inside.
   *
   * SUMMARY ONLY — no control. The card used to carry its own "Change schedule" button, a
   * second way into the settings sheet that the design dropped two revisions ago; the
   * prototype's rail has the summary and no button (`docs/design/calendar-prototype.html`,
   * the `plancard`). "Edit schedule" in the header is the single entry point, so there is
   * one place to look for it and one control to keep working.
   */
  schedule?: { summary: string };
}): JSX.Element {
  const dates = monthGridDates(miniMonth);
  return (
    <aside className="rail">
      <div className="brand">
        <i aria-hidden="true" /> Lyceon
      </div>
      <div className="who">
        <b>{name}</b>
        <span>{subtitle}</span>
      </div>

      {schedule === undefined ? null : (
        <div className="schedcard" data-testid="rail-schedule-card">
          <b>Your schedule</b>
          <span data-testid="rail-schedule-summary">{schedule.summary}</span>
        </div>
      )}

      <div className="mini">
        <header>
          <h4>
            {monthName(miniMonth)} {miniMonth.slice(0, 4)}
          </h4>
          <div className="nav">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => onMonthStep(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => onMonthStep(1)}
            >
              ›
            </button>
          </div>
        </header>
        <div className="mgrid">
          {WEEKDAY_HEADERS.map((label, index) => (
            <span key={`${label}-${index}`} aria-hidden="true">
              {label.slice(0, 1)}
            </span>
          ))}
          {dates.map((date) => {
            const selected = date >= cursor && date < addSevenDays(cursor);
            const classes = [
              isSameMonth(date, miniMonth) ? "" : "off",
              selected ? "sel" : "",
              hasWork(date) ? "has" : "",
              date === today ? "is-today" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={date}
                type="button"
                className={classes}
                aria-label={date}
                aria-current={date === today ? "date" : undefined}
                onClick={() => onPickDate(date)}
              >
                {dayOfMonth(date)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="legend">
        <h4>Show</h4>
        {FILTER_ROWS.map((row) => (
          <label key={row.tone}>
            <input
              type="checkbox"
              checked={filters[row.tone]}
              onChange={(event) =>
                onToggleFilter(row.tone, event.target.checked)
              }
            />
            <i
              style={{ background: `var(${row.varName})` }}
              aria-hidden="true"
            />
            {row.label}
          </label>
        ))}
      </div>

      <div className="foot">{footer}</div>
    </aside>
  );
}

/** Local to the rail: the mini-month highlights the week the main grid is showing. */
function addSevenDays(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
}

// ── Top bar ─────────────────────────────────────────────────────────────────

/**
 * The absence copy, one row per viewer — the ONLY text that differs between the two headers.
 *
 * Kept as a table rather than inline ternaries so that "a guardian is never shown an action"
 * is a property you can read off one object instead of checking three call sites. Every
 * guardian string is a statement of fact in the third person and none is addressed to the
 * reader; a guardian has no write path (§16), so an instruction would point nowhere.
 *
 * The student strings are unchanged, and that matters: this brief must not quietly reword
 * the student's header while adding the guardian's.
 */
const ABSENT_COPY = {
  student: {
    target: "Set a target",
    testDate: "Add your test date",
    projection: "Answer a few questions to see your projection",
  },
  guardian: {
    target: "No target set",
    testDate: "No test date",
    projection: "Not enough practice yet",
  },
} as const satisfies Record<
  "student" | "guardian",
  { target: string; testDate: string; projection: string }
>;

/**
 * §17.1 — the header, in three zones of two rows each.
 *
 * @spec [Doc 05F §17.1; owner ruling 2026-09-24 (Brief 10 Step 4)]
 * | @implemented [2026-09-24]
 *
 * The layout is the prototype's, slot for slot (`docs/design/calendar-prototype.html`,
 * the `.top` grid and its six `.slot`s):
 *
 *   L1  ← Dashboard              C1  ‹ › Today · range · Week/Month     R1  1400 Target
 *   L2  Edit schedule · Refresh  C2  🔥 6 day streak · 47 days to test   R2  680 – 1060 Projected
 *
 * The prototype's drag-to-rearrange mode and its Student/Parent toggle are demo devices and
 * do not ship; the slots they moved around are what ships.
 *
 * EVERY NUMBER HERE CAN BE ABSENT, AND ABSENCE HAS COPY. A student with no target score, no
 * test date or no Doc 05C projection sees a sentence telling them so — never a blank slot
 * and never a zero. Since 20261002000000 (SCL-130) nothing in setup is required, so the
 * all-absent header is the ordinary first visit rather than an edge case: 103 of 104
 * students in production have no target today.
 *
 * THE PROJECTED RANGE IS READ, NOT COMPUTED. It is the sum of Doc 05C's two section rows
 * and nothing else — see `../lib/projection`, whose whole contract is that it contains no
 * arithmetic but `+`, enforced by `scripts/ci/calendar-projection-gate.mjs`.
 */
export function TopBar({
  backHref,
  viewer,
  rangeLabelText,
  view,
  onView,
  onStep,
  onToday,
  streak,
  daysToTest,
  targetScore,
  projection,
  onRefresh,
  refreshPending,
  onEditSchedule,
}: {
  /** `/dashboard` for a student, `/guardian` for a guardian — the page decides. */
  backHref: string;
  rangeLabelText: string;
  view: "week" | "month";
  onView: (next: "week" | "month") => void;
  onStep: (delta: number) => void;
  onToday: () => void;
  streak: StreakSummary | undefined;
  daysToTest: number | null;
  /**
   * WHOSE PLAN THIS IS, and it changes only the ABSENCE copy. Every populated readout is
   * byte-identical between the two — a guardian sees `1400 Target` and `680 – 1060
   * Projected` in the same slots at the same sizes, because it is the same plan.
   *
   * What differs is what an empty slot may say. The student's copy is an instruction —
   * "Set a target", "Add your test date" — and a guardian cannot do any of those things, so
   * for them the same slot states a fact instead. Offering a parent an action they have no
   * path to is worse than saying nothing: §16 gives them no write path at all.
   *
   * A REQUIRED PROP, deliberately, and not a branch on `readOnly`. Required because a
   * defaulted one is forgettable and forgetting it renders CTAs at a guardian — the failure
   * this exists to prevent, silently. Not derived from `readOnly` because `CalendarView`'s
   * own rule is that the guardian difference lives in the props; a flag that means
   * "read-only" today would quietly also mean "third person" tomorrow.
   */
  viewer: "student" | "guardian";
  /** §8.1, optional since SCL-130. `null` renders the absence copy, never a zero. */
  targetScore: number | null;
  /** Doc 05C's section rows, passed through untouched. `undefined` when none were served. */
  projection: readonly SectionProjectionDto[] | undefined;
  /** Absent for a guardian — §16 gives them no write path, so no Refresh control exists. */
  onRefresh?: () => void;
  refreshPending?: boolean;
  /** §17.3. Absent for a guardian, for the same reason as `onRefresh`. */
  onEditSchedule?: () => void;
}): JSX.Element {
  const range = projectedRange(projection);

  return (
    <div className="top">
      {/* ── L1 ─────────────────────────────────────────────────────────── */}
      <div className="slot" data-slot="L1">
        <div className="item" data-item="dashboard">
          {/* THE WAY OUT. A real anchor to a known page, never `history.back()`: popping
              the history stack lands wherever the student happened to arrive from,
              including an external referrer, and it cannot be middle-clicked or opened in
              a new tab. A link to the dashboard is deterministic. */}
          <Link
            href={backHref}
            className="back"
            data-testid="calendar-back-link"
          >
            <span aria-hidden="true">←</span> Dashboard
          </Link>
        </div>
      </div>

      {/* ── C1 ─────────────────────────────────────────────────────────── */}
      <div className="slot" data-slot="C1">
        <div className="item" data-item="nav">
          <div className="navrow">
            <div className="arrows">
              <button
                type="button"
                className="btn icon"
                aria-label="Previous"
                onClick={() => onStep(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                className="btn icon"
                aria-label="Next"
                onClick={() => onStep(1)}
              >
                ›
              </button>
            </div>
            <button type="button" className="btn" onClick={onToday}>
              Today
            </button>
            <div className="range">{rangeLabelText}</div>
          </div>
        </div>
        <div className="item" data-item="viewtoggle">
          <div className="seg" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === "week"}
              onClick={() => onView("week")}
            >
              Week
            </button>
            <button
              type="button"
              aria-pressed={view === "month"}
              onClick={() => onView("month")}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* ── R1: the target ─────────────────────────────────────────────── */}
      <div className="slot" data-slot="R1">
        <div className="item" data-item="target">
          {targetScore === null ? (
            <div
              className="ptarget absent"
              data-testid="calendar-target-absent"
            >
              {ABSENT_COPY[viewer].target}
            </div>
          ) : (
            <div className="ptarget" data-testid="calendar-target">
              <b>{targetScore}</b> <span>Target</span>
            </div>
          )}
        </div>
      </div>

      {/* ── L2 ─────────────────────────────────────────────────────────── */}
      <div className="slot" data-slot="L2">
        {onEditSchedule === undefined ? null : (
          <div className="item" data-item="edit">
            <button
              type="button"
              className="btn sched"
              onClick={onEditSchedule}
              data-testid="topbar-edit-schedule"
            >
              <span aria-hidden="true">✎</span> Edit schedule
            </button>
          </div>
        )}
        {onRefresh === undefined ? null : (
          <div className="item" data-item="refresh">
            <button
              type="button"
              className="btn primary"
              onClick={onRefresh}
              disabled={refreshPending === true}
            >
              {refreshPending === true ? "Refreshing…" : "Refresh plan"}
            </button>
          </div>
        )}
      </div>

      {/* ── C2 ─────────────────────────────────────────────────────────── */}
      <div className="slot" data-slot="C2">
        {streak?.current === null || streak === undefined ? null : (
          <div className="item" data-item="streak">
            <div
              className="streakline"
              title="Days in a row with study activity"
            >
              🔥 <b>{streak.current}</b> day streak
              {streak.history_complete && streak.longest !== null ? (
                <span className="muted"> · best {streak.longest}</span>
              ) : null}
            </div>
          </div>
        )}
        <div className="item" data-item="countdown">
          {daysToTest === null ? (
            <div
              className="countline absent"
              data-testid="calendar-countdown-absent"
            >
              {ABSENT_COPY[viewer].testDate}
            </div>
          ) : (
            <div className="countline" data-testid="calendar-countdown">
              <b>{daysToTest}</b> days to test
            </div>
          )}
        </div>
      </div>

      {/* ── R2: Doc 05C's band, summed ─────────────────────────────────── */}
      <div className="slot" data-slot="R2">
        <div className="item" data-item="range">
          {range === null ? (
            // Doc 05C nulls a section's low/mid/high together below its Q4 gate, so this
            // is "not enough answered questions yet", not a failure. Saying so beats a
            // blank (looks broken) and beats a zero (200 is the floor of a real section,
            // so 0 is not a score).
            <div
              className="prange absent"
              data-testid="calendar-projection-absent"
            >
              {ABSENT_COPY[viewer].projection}
            </div>
          ) : (
            <div className="prange" data-testid="calendar-projection">
              <b>
                {range.low} – {range.high}
              </b>{" "}
              <span>Projected</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Plan-updated banner (§17.4, INV-08-13) ──────────────────────────────────

export function PlanUpdatedBanner({
  trigger,
  onDismiss,
}: {
  trigger: PlanTrigger;
  onDismiss: () => void;
}): JSX.Element | null {
  const copy = bannerCopy(trigger);
  // No copy means no banner. A bar with no sentence in it tells the student nothing and
  // still asks them to dismiss it.
  if (copy === null) return null;
  return (
    <div className="banner" role="status" data-testid="calendar-plan-banner">
      <span>{copy}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

// ── Facts strip (§14, R-08-28) ──────────────────────────────────────────────

/**
 * Counts only — never a percentage and never a rate. The same facts go to a guardian, which
 * is the other reason there is no derived judgement in here.
 */
export function FactsStrip({
  facts,
}: {
  facts: CalendarViewModel["facts"];
}): JSX.Element {
  return (
    <div className="facts" data-testid="calendar-facts">
      <div>
        <b>{facts.blocks_completed}</b> blocks complete
      </div>
      <div>
        <b>{facts.blocks_partial}</b> partial
      </div>
      <div>
        <b>{facts.blocks_missed}</b> missed
      </div>
      <div>
        <b>{facts.questions_completed}</b> questions answered
      </div>
      <div>
        <b>{facts.full_lengths_completed}</b> practice test
        {facts.full_lengths_completed === 1 ? "" : "s"}
      </div>
      <div>
        <b>{facts.extra_questions}</b> extra
      </div>
    </div>
  );
}
