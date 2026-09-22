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
   */
  schedule?: { summary: string; onEdit: () => void };
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
          <button type="button" onClick={schedule.onEdit}>
            Change schedule
          </button>
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

export function TopBar({
  backHref,
  rangeLabelText,
  view,
  onView,
  onStep,
  onToday,
  streak,
  daysToTest,
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
  /** Absent for a guardian — §16 gives them no write path, so no Refresh control exists. */
  onRefresh?: () => void;
  refreshPending?: boolean;
  /** §17.3. Absent for a guardian, for the same reason as `onRefresh`. */
  onEditSchedule?: () => void;
}): JSX.Element {
  return (
    <div className="top">
      {/* THE WAY OUT. A real anchor to a known page, never `history.back()`: popping the
          history stack lands wherever the student happened to arrive from, including an
          external referrer, and it cannot be middle-clicked or opened in a new tab. A
          link to the dashboard is deterministic and behaves like every other link. */}
      <Link href={backHref} className="back" data-testid="calendar-back-link">
        <span aria-hidden="true">←</span> Dashboard
      </Link>
      <span className="topdiv" aria-hidden="true" />
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
      <div className="spacer" />
      {onEditSchedule === undefined ? null : (
        <button
          type="button"
          className="btn sched"
          onClick={onEditSchedule}
          data-testid="topbar-edit-schedule"
        >
          <span aria-hidden="true">✎</span> Edit schedule
        </button>
      )}
      {streak?.current === null || streak === undefined ? null : (
        <div className="stat" title="Days in a row with study activity">
          🔥 <b>{streak.current}</b> day streak
          {streak.history_complete && streak.longest !== null ? (
            <span className="muted"> · best {streak.longest}</span>
          ) : null}
        </div>
      )}
      {daysToTest === null ? null : (
        <div className="stat">
          <b>{daysToTest}</b> days to test
        </div>
      )}
      {onRefresh === undefined ? null : (
        <button
          type="button"
          className="btn primary"
          onClick={onRefresh}
          disabled={refreshPending === true}
        >
          {refreshPending === true ? "Refreshing…" : "Refresh plan"}
        </button>
      )}
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
