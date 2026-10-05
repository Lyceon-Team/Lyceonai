/**
 * The student calendar's chrome on the App shell: the Canvas-style header and the right panel.
 *
 * @spec [student-UI register UI-55; §2 "Shell and navigation" (the calendar's left column —
 *        mini month, schedule summary, show filters — moves into the right panel); DESIGN.md
 *        §4 Calendar; prototype design/prototype/Calendar.dc.html; OQ-25 (the free goal card
 *        reads the ungated profile); OQ-37 (no "Training for" until UI-S8 closes); Doc 05F
 *        §17.1 and §17.5 as amended by SCL-211 (OQ-56: DESIGN.md's layout; no streak line, no
 *        facts strip), §17.3; Doc 05C (the projected band is read 1:1, `lib/projection`)]
 *        | @implemented [2026-10-03; SCL-211 2026-10-05]
 *
 * plain English: what replaced the calendar's own dark rail and three-zone top bar for the
 * STUDENT. The header carries Week/Month, Today and the arrows on the left, the visible range
 * centred (`M/D – M/D`), and Edit schedule and Regenerate plan on the right. The right panel
 * carries the navigable mini month, the goal card (days until the SAT with a ★ date pill,
 * Target and Projected side by side, Target only on the free plan, and Edit goals), the
 * "Your schedule" summary (register §2 moves it here) and the Show category filters. The
 * guardian calendar keeps `LeftRail` and `TopBar` (`Chrome.tsx`) unchanged.
 *
 * Everything here draws with the student tokens (`lyc-*`, `--cat-*`), so it follows the
 * device theme. Copy is the prototype's or already shipped (`ABSENT_COPY`).
 *
 * NO STREAK LINE (SCL-211, owner ruling 2026-10-05 on OQ-56: "Drop the streak line and the
 * facts strip to match the design"). The header is the prototype's: nothing under the range
 * title. The guardian calendar's `TopBar` still renders `StreakFact` (guardian vertical).
 *
 * edge cases: every number can be absent and absence has the shipped student copy, never a
 * blank or a zero (SCL-130: nothing in setup is required). A test date already past counts as
 * 0 days, as the shipped countdown did. The test day is starred in the mini month whether or
 * not a plan is read (free and paid alike), because the date comes from the profile.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import type { SectionProjectionDto } from "@lyceon/shared";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import type { BlockTone } from "../lib/blocks";
import {
  addDays,
  dayOfMonth,
  daysBetween,
  isSameMonth,
  monthGridDates,
  monthName,
  weekdayDayMonth,
} from "../lib/dates";
import { projectedRange } from "../lib/projection";
import { ABSENT_COPY, type ToneFilter } from "./Chrome";

// ── Header ───────────────────────────────────────────────────────────────────

const OUTLINE_BUTTON = `${LYC_FOCUS} inline-flex h-10 items-center justify-center rounded-md border border-lyc-input-bd bg-transparent text-lyc-body font-semibold text-lyc-ink-strong hover:bg-lyc-hover`;

export type RegenerateControl = {
  onClick: () => void;
  pending: boolean;
  /** True once a regenerate has returned; the label then says so (prototype `regenLabel`). */
  done: boolean;
};

export function StudentCalendarHeader({
  view,
  title,
  onView,
  onToday,
  onStep,
  onEditSchedule,
  regenerate,
}: {
  view: "week" | "month";
  /** `numericRangeLabel`: "9/28 – 10/4", or "September 2026" in month view. */
  title: string;
  onView: (next: "week" | "month") => void;
  onToday: () => void;
  onStep: (delta: number) => void;
  /** §17.3's single entry point. Absent before setup (there is no profile to edit). */
  onEditSchedule?: () => void;
  /** `POST /api/calendar/plan/regenerate`. Absent before setup (there is no plan). */
  regenerate?: RegenerateControl;
}): JSX.Element {
  return (
    <header
      className="grid shrink-0 grid-cols-1 items-center gap-4 border-b border-lyc-rule px-4 py-4 lg:grid-cols-[1fr_auto_1fr] lg:px-7 lg:py-5"
      data-testid="calendar-header"
    >
      <div
        className="flex flex-wrap items-center justify-center gap-2.5 lg:justify-self-start"
        data-testid="calendar-header-nav"
      >
        <div
          role="group"
          aria-label="View"
          className="flex overflow-hidden rounded-md border border-lyc-ink-strong"
        >
          {(["week", "month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => onView(value)}
              data-testid={`calendar-view-${value}`}
              className={`${LYC_FOCUS} h-10 border-0 px-4 text-lyc-body font-semibold ${
                view === value
                  ? "bg-lyc-primary-bg text-lyc-primary-ink"
                  : "bg-lyc-sheet text-lyc-ink-strong hover:bg-lyc-hover"
              }`}
            >
              {value === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToday}
          className={`${OUTLINE_BUTTON} px-4`}
          data-testid="calendar-today"
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Previous"
          onClick={() => onStep(-1)}
          className={`${OUTLINE_BUTTON} w-10`}
          data-testid="calendar-prev"
        >
          <Chevron direction="left" />
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => onStep(1)}
          className={`${OUTLINE_BUTTON} w-10`}
          data-testid="calendar-next"
        >
          <Chevron direction="right" />
        </button>
      </div>

      <div className="order-first flex flex-col items-center gap-1 lg:order-none">
        <h1
          className="m-0 whitespace-nowrap text-center font-lyc-serif text-[28px] font-semibold text-lyc-ink-strong"
          data-testid="calendar-range-title"
        >
          {title}
        </h1>
      </div>

      {onEditSchedule === undefined && regenerate === undefined ? (
        <div aria-hidden="true" className="hidden lg:block" />
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-2.5 lg:justify-self-end">
          {onEditSchedule === undefined ? null : (
            <Button
              type="button"
              variant="lyc-outline"
              className="h-10"
              onClick={onEditSchedule}
              data-testid="topbar-edit-schedule"
            >
              Edit schedule
            </Button>
          )}
          {regenerate === undefined ? null : (
            <Button
              type="button"
              variant="lyc-outline"
              className="h-10"
              onClick={regenerate.onClick}
              disabled={regenerate.pending}
              aria-busy={regenerate.pending || undefined}
              data-testid="calendar-regenerate"
            >
              {regenerate.done && !regenerate.pending
                ? "Plan regenerated"
                : "Regenerate plan"}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

// ── Right panel ──────────────────────────────────────────────────────────────

const PANEL_H2 =
  "m-0 font-lyc-serif text-[19px] font-semibold text-lyc-ink-strong";

/** Monday-first single letters, as the prototype's mini month draws them. */
const MINI_HEAD = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * The month's grid, without a sixth row that holds only the next month (the prototype stops
 * at five rows when the month ends inside them).
 */
function miniMonthDates(month: string): readonly string[] {
  const dates = monthGridDates(month);
  const lastRow = dates.slice(35);
  return lastRow.every((date) => !isSameMonth(date, month))
    ? dates.slice(0, 35)
    : dates;
}

export function MiniMonth({
  month,
  onMonthStep,
  today,
  weekStart,
  testDate,
  onPickDate,
}: {
  /** Any date in the month shown; the grid is built from its first. */
  month: string;
  onMonthStep: (delta: number) => void;
  today: string;
  /** The Monday of the week the grid shows, highlighted; null in month view and on free. */
  weekStart: string | null;
  testDate: string | null;
  /** Paid: a day is a button that moves the week grid there. Free: plain cells. */
  onPickDate?: (date: string) => void;
}): JSX.Element {
  const weekEnd = weekStart === null ? null : addDays(weekStart, 7);
  return (
    <section
      aria-labelledby="calendar-mini-h"
      className="flex flex-col gap-2.5"
      data-testid="calendar-mini-month"
    >
      <div className="flex items-center justify-between">
        <h2 id="calendar-mini-h" className={PANEL_H2}>
          {monthName(month)} {month.slice(0, 4)}
        </h2>
        <span className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthStep(-1)}
            className={`${LYC_FOCUS} h-8 w-8 rounded-md border-0 bg-transparent text-lyc-ink-strong hover:bg-lyc-hover`}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthStep(1)}
            className={`${LYC_FOCUS} h-8 w-8 rounded-md border-0 bg-transparent text-lyc-ink-strong hover:bg-lyc-hover`}
          >
            ›
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-lyc-meta">
        {MINI_HEAD.map((label, index) => (
          <span
            key={`${label}-${index}`}
            aria-hidden="true"
            className="py-1 font-semibold text-lyc-muted"
          >
            {label}
          </span>
        ))}
        {miniMonthDates(month).map((date) => {
          const isTest = testDate !== null && date === testDate;
          const inWeek =
            weekStart !== null &&
            weekEnd !== null &&
            date >= weekStart &&
            date < weekEnd;
          const tone = isTest
            ? "bg-lyc-lv0-bg font-semibold text-lyc-lv0-ink outline outline-2 -outline-offset-2 outline-lyc-lv0-fill"
            : inWeek
              ? "bg-lyc-primary-bg font-semibold text-lyc-primary-ink"
              : isSameMonth(date, month)
                ? "text-lyc-ink"
                : "text-lyc-muted opacity-50";
          const todayMark =
            date === today && !inWeek && !isTest
              ? " underline underline-offset-4"
              : "";
          const label = `${isTest ? "★" : ""}${dayOfMonth(date)}`;
          const common = `rounded py-1.5 ${tone}${todayMark}`;
          return onPickDate === undefined ? (
            <span
              key={date}
              className={common}
              title={isTest ? "SAT test day" : undefined}
              data-testid={`calendar-mini-day-${date}`}
              data-test-day={isTest ? "true" : undefined}
            >
              {label}
            </span>
          ) : (
            <button
              key={date}
              type="button"
              className={`${LYC_FOCUS} border-0 ${common} ${inWeek || isTest ? "" : "bg-transparent hover:bg-lyc-hover"}`}
              title={isTest ? "SAT test day" : undefined}
              aria-label={isTest ? `${date}, SAT test day` : date}
              aria-current={date === today ? "date" : undefined}
              onClick={() => onPickDate(date)}
              data-testid={`calendar-mini-day-${date}`}
              data-test-day={isTest ? "true" : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Settings is today's `/profile`; its Profile section holds the test date and target (UI-S2). */
export const EDIT_GOALS_HREF = "/profile";

/**
 * The goal card, centred and large (DESIGN.md §4). `projection: null` is the FREE card:
 * Target only (Projected is a paid readout on the calendar). No "Training for": the dream
 * school is held on the calendar until UI-S8 closes (OQ-37).
 */
export function GoalCard({
  today,
  testDate,
  targetScore,
  projection,
}: {
  today: string;
  testDate: string | null;
  targetScore: number | null;
  projection: readonly SectionProjectionDto[] | null;
}): JSX.Element {
  const daysToTest =
    testDate === null ? null : Math.max(0, daysBetween(today, testDate));
  const range = projection === null ? null : projectedRange(projection);
  return (
    <section
      aria-labelledby="calendar-goal-h"
      className="flex flex-col items-center gap-[18px] rounded-[10px] border border-lyc-rule bg-lyc-sheet px-5 py-6 text-center"
      data-testid="calendar-goal-card"
    >
      <h2 id="calendar-goal-h" className="sr-only">
        Your goal
      </h2>
      {daysToTest === null || testDate === null ? (
        <p
          className="m-0 text-[17px] text-lyc-ink"
          data-testid="calendar-countdown-absent"
        >
          {ABSENT_COPY.student.testDate}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-0.5">
          <span
            className="font-lyc-serif text-[64px] font-semibold leading-none text-lyc-ink-strong"
            data-testid="calendar-countdown"
          >
            {daysToTest}
          </span>
          <span className="text-[17px] text-lyc-ink">
            {daysToTest === 1 ? "day" : "days"} until your SAT
          </span>
          <span
            className="mt-2 rounded-full bg-lyc-lv0-bg px-3 py-1 text-lyc-body font-semibold text-lyc-lv0-ink"
            data-testid="calendar-test-date-pill"
          >
            ★ {weekdayDayMonth(testDate)}
          </span>
        </div>
      )}
      <div
        className={`grid w-full border-t border-lyc-rule-soft pt-4 ${projection === null ? "grid-cols-1" : "grid-cols-2"}`}
      >
        <GoalFigure
          label="Target"
          testId="calendar-target"
          value={targetScore === null ? null : String(targetScore)}
          absent={ABSENT_COPY.student.target}
        />
        {projection === null ? null : (
          <div className="border-l border-lyc-rule-soft">
            <GoalFigure
              label="Projected"
              testId="calendar-projection"
              value={range === null ? null : `${range.low}–${range.high}`}
              absent={ABSENT_COPY.student.projection}
            />
          </div>
        )}
      </div>
      <Link
        href={EDIT_GOALS_HREF}
        className={`${LYC_FOCUS} text-lyc-meta-lg font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline`}
        data-testid="calendar-edit-goals"
      >
        Edit goals
      </Link>
    </section>
  );
}

/** One side of the Target | Projected pair: the value, or the shipped absence sentence. */
function GoalFigure({
  label,
  testId,
  value,
  absent,
}: {
  label: string;
  testId: string;
  value: string | null;
  /** The shipped student absence sentence (`ABSENT_COPY`). */
  absent: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <span className="text-lyc-meta-lg text-lyc-muted">{label}</span>
      {value === null ? (
        <span
          className="text-lyc-meta text-lyc-ink"
          data-testid={`${testId}-absent`}
        >
          {absent}
        </span>
      ) : (
        <span
          className="font-lyc-serif text-[32px] font-semibold text-lyc-ink-strong"
          data-testid={testId}
        >
          {value}
        </span>
      )}
    </div>
  );
}

/** §17.3's "Your schedule" summary — register §2 moves it from the old rail into the panel. */
export function ScheduleSummary({ summary }: { summary: string }): JSX.Element {
  return (
    <section
      aria-labelledby="calendar-schedule-h"
      className="flex flex-col gap-1.5"
      data-testid="calendar-schedule-card"
    >
      <h2 id="calendar-schedule-h" className={PANEL_H2}>
        Your schedule
      </h2>
      <p
        className="m-0 text-lyc-body text-lyc-ink"
        data-testid="calendar-schedule-summary"
      >
        {summary}
      </p>
    </section>
  );
}

/** The Show filters: one row per category, its swatch the category's border token. */
const SHOW_ROWS: readonly {
  tone: BlockTone;
  label: string;
  swatch: string;
}[] = [
  { tone: "math", label: "Math", swatch: "bg-lyc-cat-math-bd" },
  // Section vocabulary: the canonical display name (OQ-51 (a)), not the prototype's "and".
  { tone: "rw", label: "Reading & Writing", swatch: "bg-lyc-cat-rw-bd" },
  { tone: "review", label: "Review", swatch: "bg-lyc-cat-review-bd" },
  { tone: "exam", label: "Practice test", swatch: "bg-lyc-cat-test-bd" },
];

export function ShowFilters({
  filters,
  onToggle,
}: {
  filters: ToneFilter;
  onToggle: (tone: BlockTone, next: boolean) => void;
}): JSX.Element {
  return (
    <section
      aria-labelledby="calendar-show-h"
      className="flex flex-col gap-1.5"
      data-testid="calendar-show-filters"
    >
      <h2 id="calendar-show-h" className={`${PANEL_H2} mb-1`}>
        Show
      </h2>
      {SHOW_ROWS.map((row) => (
        <label
          key={row.tone}
          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-lyc-body text-lyc-ink hover:bg-lyc-hover"
        >
          <input
            type="checkbox"
            checked={filters[row.tone]}
            onChange={(event) => onToggle(row.tone, event.target.checked)}
            className={`${LYC_FOCUS} h-[18px] w-[18px] accent-lyc-ink-strong`}
            data-testid={`calendar-show-${row.tone}`}
          />
          <span
            aria-hidden="true"
            className={`h-3 w-3 rounded-[3px] ${row.swatch}`}
          />
          <span>{row.label}</span>
        </label>
      ))}
    </section>
  );
}

/** The panel's column: the sections in DESIGN.md §4's order, 28px apart (prototype). */
export function CalendarPanelColumn({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-7" data-testid="calendar-panel">
      {children}
    </div>
  );
}
