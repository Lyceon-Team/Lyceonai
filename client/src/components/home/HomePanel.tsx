/**
 * Home's right panel sections (DESIGN.md §4 Home; prototype Main.dc.html `<aside>`).
 *
 * @spec [DESIGN.md §2 (right panel 360px, --margin), §3 (Locked mastery card, Ruler progress),
 *        §4 Home; evidence/wiring-table.md §3 (projected range: projections/sections; target:
 *        GET /api/calendar profile; week strip: GET /api/calendar days; recent sessions:
 *        /api/review/pool per OQ-23; quota: GET /api/practice/quota per OQ-21); register §2
 *        (no bank counts, no raw accuracy, no confidence)] | @implemented [2026-10-03]
 *
 * plain English: presentational sections; the page reads the endpoints and hands each section
 * the server's values. Every heading is a panel heading (h2, 20px serif) as in the prototype.
 * The page renders these inside `AppShellPanel`, so on a phone they stack under the main column.
 */
import { Link } from "wouter";
import type { CalendarDay } from "@lyceon/shared/calendar";
import type { ReviewPoolSourceSession } from "@lyceon/shared/review-schema";
import type { PracticeQuota } from "@lyceon/shared/practice-quota";
import { BASELINE_PENDING_HEADLINE } from "@lyceon/shared/diagnostic-state";
import { RulerProgress, rulerFill } from "@/components/student-ui";
import { ABSENT_COPY } from "@/features/calendar/components/Chrome";
import { dayOfMonth, shortWeekday } from "@/features/calendar/lib/dates";
import type { ProjectedRange } from "@/features/calendar/lib/projection";
import { dayHeaderLabel, sourceEngineLabel } from "@/lib/review-session-picker";
import { cn } from "@/lib/utils";
import {
  quotaLine,
  rangeText,
  toReviewLine,
  weekSummary,
  type FreeHomeStage,
} from "./home-model";

const PANEL_H2 =
  "m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong";
const PANEL_LINK =
  "self-start text-base font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

/** The empty state the prototype's free panel shows before the diagnostic. */
const BEFORE_DIAGNOSTIC =
  "Your projected score appears here when you finish the diagnostic.";

/**
 * "Projected score": the band (both plans), else the sentence for why there is none. Paid adds
 * "Your target is N." from the calendar profile when one is set.
 */
export function ProjectionSection({
  range,
  stage,
  targetScore,
}: {
  range: ProjectedRange | null;
  /** Which "no band yet" sentence applies; the free Home's stage, or "after" for paid. */
  stage: FreeHomeStage;
  targetScore: number | null;
}): JSX.Element {
  let empty: string | null = null;
  if (range === null) {
    if (stage === "diagnostic") empty = BEFORE_DIAGNOSTIC;
    else if (stage === "pending") empty = BASELINE_PENDING_HEADLINE;
    else if (stage === "after") empty = ABSENT_COPY.student.projection;
  }
  return (
    <section
      aria-labelledby="home-proj-h"
      className="flex flex-col gap-2"
      data-testid="home-projection"
    >
      <h2 id="home-proj-h" className={PANEL_H2}>
        Projected score
      </h2>
      {range !== null ? (
        <>
          <p
            className="m-0 font-lyc-serif text-[46px] font-semibold leading-[1.1] text-lyc-ink-strong"
            data-testid="home-projection-range"
          >
            {rangeText(range)}
          </p>
          <p className="m-0 text-base leading-normal text-lyc-muted">
            {targetScore !== null ? `Your target is ${targetScore}. ` : null}
            The range narrows as you answer more questions.
          </p>
        </>
      ) : empty !== null ? (
        <p className="m-0 text-[17px] leading-normal text-lyc-muted">{empty}</p>
      ) : null}
    </section>
  );
}

/** "This week": Monday to Sunday from the calendar, today filled, and the done line. */
export function WeekSection({
  days,
  today,
}: {
  days: readonly CalendarDay[];
  today: string;
}): JSX.Element {
  const summary = weekSummary(days);
  return (
    <section
      aria-labelledby="home-week-h"
      className="flex flex-col gap-3"
      data-testid="home-week"
    >
      <h2 id="home-week-h" className={PANEL_H2}>
        This week
      </h2>
      <ol className="m-0 grid list-none grid-cols-7 gap-1.5 p-0">
        {days.map((day) => {
          const isToday = day.local_date === today;
          return (
            <li
              key={day.local_date}
              aria-current={isToday ? "date" : undefined}
              data-status={day.status}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-md py-2",
                isToday
                  ? "bg-lyc-primary-bg text-lyc-primary-ink"
                  : "border border-lyc-rule bg-lyc-sheet text-lyc-ink-strong",
              )}
            >
              <span className="text-lyc-meta font-semibold">
                {shortWeekday(day.local_date)}
              </span>
              <span className="font-lyc-serif text-[18px] font-semibold">
                {dayOfMonth(day.local_date)}
              </span>
            </li>
          );
        })}
      </ol>
      {summary !== null ? (
        <p className="m-0 text-base leading-normal text-lyc-ink">{summary}</p>
      ) : null}
    </section>
  );
}

/** How many pool rows the panel lists (the prototype's five). */
const RECENT_ROWS = 5;

/**
 * "Recent sessions" (OQ-23: the `/api/review/pool` rows, which are the student's sessions that
 * still have questions to review): kind, when, and "N to review". The raw `filters` the row
 * carries are never read here (F-52).
 */
export function RecentSessionsSection({
  sessions,
  todayKey,
}: {
  sessions: readonly ReviewPoolSourceSession[];
  todayKey: string;
}): JSX.Element {
  return (
    <section
      aria-labelledby="home-recent-h"
      className="flex flex-col gap-2.5"
      data-testid="home-recent"
    >
      <h2 id="home-recent-h" className={PANEL_H2}>
        Recent sessions
      </h2>
      {sessions.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {sessions.slice(0, RECENT_ROWS).map((s) => (
            <li
              key={`${s.source_engine}:${s.source_session_id}`}
              className="flex items-baseline justify-between gap-3 border-b border-lyc-rule-soft py-[9px]"
              data-testid="home-recent-row"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-semibold text-lyc-ink">
                  {sourceEngineLabel(s.source_engine)}
                </span>
                <span className="text-lyc-meta text-lyc-muted">
                  {s.local_time === null
                    ? dayHeaderLabel(s.local_date, todayKey)
                    : `${dayHeaderLabel(s.local_date, todayKey)}, ${s.local_time}`}
                </span>
              </span>
              <span className="whitespace-nowrap text-lyc-meta-lg text-lyc-muted">
                {toReviewLine(s.open_count)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link href="/review" className={PANEL_LINK}>
        See all sessions
      </Link>
    </section>
  );
}

/**
 * "Today": the free daily quota as a ruler and a sentence, then "Review is unlimited". Hidden
 * for an unlimited quota (a paid student has no number to show).
 */
export function QuotaSection({
  quota,
}: {
  quota: PracticeQuota;
}): JSX.Element | null {
  if (quota.unlimited) return null;
  return (
    <section
      aria-labelledby="home-today-h"
      className="flex flex-col gap-3"
      data-testid="home-quota"
    >
      <h2 id="home-today-h" className={PANEL_H2}>
        Today
      </h2>
      <RulerProgress
        size="panel"
        filled={rulerFill(quota.remaining, quota.limit)}
        data-testid="home-quota-ruler"
      />
      <p className="m-0 text-[17px] leading-normal text-lyc-ink">
        {quotaLine(quota.remaining, quota.limit)}
      </p>
      <p className="m-0 text-[17px] leading-normal text-lyc-ink">
        Review is unlimited
      </p>
    </section>
  );
}
