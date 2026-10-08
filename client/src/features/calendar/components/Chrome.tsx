/**
 * @spec [Doc_05F_Study_Calendar, §17.1 layout, §17.4 plan-updated banner (INV-08-13),
 *        §14 facts (R-08-28), §15 streak (INV-08-20)]
 * @implemented [2026-09-23]
 *
 * plain English: the frame around the grid — the left rail, the top bar, the plan-updated
 * banner and the facts strip. Expected outcome: the same chrome the prototype draws, with
 * every control that writes anything absent on the guardian surface.
 *
 * SINCE UI-55 (2026-10-03) THE RAIL AND THE TOP BAR ARE THE GUARDIAN'S. The student calendar
 * moved onto the App shell (`StudentChrome.tsx`: a Canvas-style header, and the mini month,
 * goal card, schedule summary and Show filters in the shell's right panel, register §2), so
 * the student-only parts of these two went with it: the rail's "Lyceon" wordmark (the shell
 * carries the logo) and its "Your schedule" card (now in the panel), and the header's Edit
 * schedule and Refresh plan controls (now the student header's). The guardian render is
 * unchanged — it never had any of them. The banner, the suppression notice, the facts strip
 * and the header facts remain shared.
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
  dayAndMonth,
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
}): JSX.Element {
  const dates = monthGridDates(miniMonth);
  // No "Lyceon" wordmark: the guardian calendar sits inside `GuardianShell`, whose header
  // carries the logo (owner decision 2026-10-01, item 6), and the student calendar, the only
  // surface that showed it, moved onto the App shell, which carries its own (UI-55).
  return (
    <aside className="rail">
      <div className="who">
        <b>{name}</b>
        <span>{subtitle}</span>
      </div>

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
export const ABSENT_COPY = {
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

// ── The header facts, one component per slot (G4-03) ────────────────────────

/**
 * @spec [Doc 05F §17.1; Guardian_Closure_Plan G4-03, R11; owner approval 2026-09-30]
 *   | @implemented [2026-09-30]
 *
 * plain English: the four readouts of the calendar header — target, streak, test-date
 * countdown, projected band — as display-only components. `TopBar` renders each in its own
 * slot, exactly as it always did; the guardian's
 * Calendar tab renders the same `TopBar`, so a parent reads the same numbers, the same absence
 * copy and the same markup as the student's calendar — one component, not a guardian copy
 * (R11). None of them holds a control. (The guardian Dashboard drew these four as a flat strip
 * through `HeaderFacts` until G5-05; R13 gave that tab the design's own score strip.)
 */
function TargetFact({
  viewer,
  targetScore,
}: {
  viewer: "student" | "guardian";
  targetScore: number | null;
}): JSX.Element {
  return (
    <div className="item" data-item="target">
      {targetScore === null ? (
        <div className="ptarget absent" data-testid="calendar-target-absent">
          {ABSENT_COPY[viewer].target}
        </div>
      ) : (
        <div className="ptarget" data-testid="calendar-target">
          <b>{targetScore}</b> <span>Target</span>
        </div>
      )}
    </div>
  );
}

/** Renders nothing when the streak is unknown — never a zero it did not read. */
function StreakFact({
  streak,
}: {
  streak: StreakSummary | undefined;
}): JSX.Element | null {
  if (streak?.current === null || streak === undefined) return null;
  return (
    <div className="item" data-item="streak">
      <div className="streakline" title="Days in a row with study activity">
        🔥 <b>{streak.current}</b> day streak
        {streak.history_complete && streak.longest !== null ? (
          <span className="muted"> · best {streak.longest}</span>
        ) : null}
      </div>
    </div>
  );
}

function CountdownFact({
  viewer,
  daysToTest,
}: {
  viewer: "student" | "guardian";
  daysToTest: number | null;
}): JSX.Element {
  return (
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
  );
}

/** Doc 05C's band, summed by `projectedRange` and nothing else. */
function ProjectionFact({
  viewer,
  projection,
}: {
  viewer: "student" | "guardian";
  projection: readonly SectionProjectionDto[] | undefined;
}): JSX.Element {
  const range = projectedRange(projection);
  return (
    <div className="item" data-item="range">
      {range === null ? (
        // Doc 05C nulls a section's low/mid/high together below its Q4 gate, so this
        // is "not enough answered questions yet", not a failure. Saying so beats a
        // blank (looks broken) and beats a zero (200 is the floor of a real section,
        // so 0 is not a score).
        <div className="prange absent" data-testid="calendar-projection-absent">
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
  );
}

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
 *   L2  (empty)                  C2  🔥 6 day streak · 47 days to test   R2  680 – 1060 Projected
 *
 * L2 held the student's Edit schedule and Refresh plan until UI-55 moved the student calendar
 * onto the App shell; this header is now the guardian's, and a guardian has neither (§16).
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
  hideBackLink = false,
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
}: {
  /** `/dashboard` for a student, `/guardian` for a guardian — the page decides. */
  backHref: string;
  /**
   * G4-04 (owner, 2026-09-30): inside the guardian shell the Calendar is a TAB, so the way back
   * is the Dashboard tab beside it and "← Dashboard" would be a second, redundant exit. Hidden
   * by a prop, not a fork; the L1 slot stays so the header grid does not reflow.
   */
  hideBackLink?: boolean;
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
}): JSX.Element {
  return (
    <div className="top">
      {/* ── L1 ─────────────────────────────────────────────────────────── */}
      <div className="slot" data-slot="L1">
        {hideBackLink ? null : (
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
        )}
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
        <TargetFact viewer={viewer} targetScore={targetScore} />
      </div>

      {/* ── L2 ─────────────────────────────────────────────────────────── */}
      {/* Kept, empty, so the header grid does not reflow: Edit schedule and Refresh plan were
          the student's and moved to the student header with UI-55; a guardian has neither
          (§16). */}
      <div className="slot" data-slot="L2" />

      {/* ── C2 ─────────────────────────────────────────────────────────── */}
      <div className="slot" data-slot="C2">
        <StreakFact streak={streak} />
        <CountdownFact viewer={viewer} daysToTest={daysToTest} />
      </div>

      {/* ── R2: Doc 05C's band, summed ─────────────────────────────────── */}
      <div className="slot" data-slot="R2">
        <ProjectionFact viewer={viewer} projection={projection} />
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

// ── Suppressed practice test (Brief 14 Step 4) ──────────────────────────────

/**
 * The sentence a plan says when the generator could NOT place a practice test.
 *
 * @spec [Doc_05F_Study_Calendar, §8.1 full-length placement; owner ruling 2026-09-26
 *        (Brief 14 Step 4)] | @implemented [2026-09-27]
 *
 * plain English: `calendar_place_full_lengths` refuses a date when BOTH the student's chosen
 * weekday occurrence and the +7-day alternative are days the student has blocked out. Those
 * dates come back in `degraded[]` as `full_length_suppressed` and reach both payloads as
 * `full_length_suppressions`. This component is the only place either surface says so.
 *
 * Expected outcome: a student whose test silently vanished from the plan is told it did, and
 * given the week it would have fallen in. Before this, the plan simply had no test in it and
 * nothing anywhere said why — which is the defect the whole brief exists to end.
 *
 * WHY THE TWO VIEWERS GET DIFFERENT COPY AND DIFFERENT CONTROLS. Owner ruling 2026-09-26:
 * "Guardians see the suppression. It's a fact about the plan, not a control and not a profile
 * field... With the guardian's own copy, though: a statement, never an action." So the
 * guardian's sentence is third-person and the component renders NO buttons for them — the
 * same rule `ABSENT_COPY` above follows for "No target set". A guardian has no write path
 * (§16), so an affordance would point nowhere.
 *
 * trade-offs: the student's dates are buttons that move the grid to that week and select the
 * day, rather than opening the day menu directly. The menu lives on the day cell, so putting
 * the date in view IS how you reach it — and the alternative, a second day-menu mount owned
 * by a banner, would be a second copy of §17.2's four controls.
 *
 * edge cases: an EMPTY array renders nothing at all, never an empty bar. That is the ordinary
 * case — a plan with no suppression is the plan working.
 */
const SUPPRESSION_COPY = {
  student:
    "We couldn't fit your full-length test — the days you picked are blocked.",
  guardian:
    "A practice test couldn't be scheduled — the days chosen are blocked.",
} as const satisfies Record<"student" | "guardian", string>;

export function FullLengthSuppressionNotice({
  viewer,
  dates,
  onGoToWeek,
}: {
  viewer: "student" | "guardian";
  /** `full_length_suppressions` off the payload, unchanged and in server order. */
  dates: readonly string[];
  /**
   * Student only, and OPTIONAL even then: given, each date becomes a button that moves the
   * grid to its week. A guardian caller passes nothing, which is what makes "a statement,
   * never an action" a property of the call site rather than a branch in here.
   */
  onGoToWeek?: (date: string) => void;
}): JSX.Element | null {
  if (dates.length === 0) return null;
  const goTo = viewer === "student" ? onGoToWeek : undefined;
  return (
    <div
      className="banner"
      role="status"
      data-testid="calendar-full-length-suppressed"
    >
      <span>{SUPPRESSION_COPY[viewer]}</span>
      {goTo === undefined
        ? null
        : dates.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => goTo(date)}
              data-testid={`calendar-full-length-suppressed-goto-${date}`}
            >
              {dayAndMonth(date)}
            </button>
          ))}
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
