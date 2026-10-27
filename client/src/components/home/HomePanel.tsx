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
import { Fragment } from "react";
import { Link } from "wouter";
import type { CalendarDay } from "@lyceon/shared/calendar";
import type { ReviewPoolSourceSession } from "@lyceon/shared/review-schema";
import type { PracticeQuota } from "@lyceon/shared/practice-quota";
import { BASELINE_PENDING_HEADLINE } from "@lyceon/shared/diagnostic-state";
import {
  ClampedLabel,
  RulerProgress,
  rulerFill,
} from "@/components/student-ui";
import { LYC_FOCUS } from "@/components/ui/button";
import { ABSENT_COPY } from "@/features/calendar/components/Chrome";
import { dayOfMonth, shortWeekday } from "@/features/calendar/lib/dates";
import type { ProjectedRange } from "@/features/calendar/lib/projection";
import { STARTING_LABEL } from "@/lib/pending-copy";
import { dayHeaderLabel } from "@/lib/review-session-picker";
import { cn } from "@/lib/utils";
import {
  quotaLine,
  rangeText,
  recentSessionTitle,
  toReviewLine,
  weekSummary,
  type FreeHomeStage,
} from "./home-model";
import { BLIND_SPOTS_NAME } from "@/lib/blind-spots-copy";

const PANEL_H2 =
  "m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong";
const PANEL_LINK =
  "self-start text-base font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline";

/** The empty state the prototype's free panel shows before the diagnostic. */
const BEFORE_DIAGNOSTIC = `Your projected score appears here when you finish ${BLIND_SPOTS_NAME}.`;

/** The free panel's line under the diagnostic band (SCL-236: written once, never changed). */
const DIAGNOSTIC_RESULT_LINE =
  "From your diagnostic answers. This result doesn’t change.";
/** D1 (a): the diagnostic is done and a skipped question left an area under the gate. */
const DIAGNOSTIC_INSUFFICIENT =
  "We need more answers in some areas to estimate your score. Skipped questions don’t count as answers.";
/** The upgrade link: the live projection is the locked thing (SCL-235). */
const LIVE_PROJECTION_UPGRADE = "See your score update as you practice";

/**
 * "Projected score" (paid: the live band) or "Your diagnostic result" (free: the stored
 * diagnostic band, SCL-235), else the sentence for why there is none. Paid adds "Your target is
 * N." from the calendar profile when one is set. `kind` is the server's word for which band this
 * is; before it lands the heading follows the plan the page already knows.
 *
 * @spec [SCL-235 / SCL-236; owner rulings 2026-10-16 (1, 4) and D1 (a); DESIGN.md §5 (one filled
 *        primary per screen: the upgrade is a text link)] | @implemented [2026-10-03; free
 *        diagnostic result 2026-10-17]
 */
export function ProjectionSection({
  range,
  stage,
  targetScore,
  kind = "live",
  diagnosticInsufficient = false,
  onUpgrade,
}: {
  range: ProjectedRange | null;
  /** Which "no band yet" sentence applies; the free Home's stage, or "after" for paid. */
  stage: FreeHomeStage;
  targetScore: number | null;
  kind?: "live" | "diagnostic";
  diagnosticInsufficient?: boolean;
  /** Free only: opens the upgrade modal for the live projection. */
  onUpgrade?: () => void;
}): JSX.Element {
  const diagnostic = kind === "diagnostic";
  let empty: string | null = null;
  if (range === null) {
    if (stage === "diagnostic") empty = BEFORE_DIAGNOSTIC;
    else if (stage === "pending") empty = BASELINE_PENDING_HEADLINE;
    else if (diagnostic && diagnosticInsufficient)
      empty = DIAGNOSTIC_INSUFFICIENT;
    else if (stage === "after") empty = ABSENT_COPY.student.projection;
  }
  return (
    <section
      aria-labelledby="home-proj-h"
      className="flex flex-col gap-2"
      data-testid="home-projection"
      data-kind={kind}
    >
      <h2 id="home-proj-h" className={PANEL_H2}>
        {diagnostic ? "Your diagnostic result" : "Projected score"}
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
            {diagnostic ? (
              DIAGNOSTIC_RESULT_LINE
            ) : (
              <>
                {targetScore !== null
                  ? `Your target is ${targetScore}. `
                  : null}
                The range narrows as you answer more questions.
              </>
            )}
          </p>
        </>
      ) : empty !== null ? (
        <p className="m-0 text-[17px] leading-normal text-lyc-muted">{empty}</p>
      ) : null}
      {diagnostic && onUpgrade !== undefined && stage !== "diagnostic" ? (
        <button
          type="button"
          onClick={onUpgrade}
          className={cn(PANEL_LINK, "bg-transparent p-0", LYC_FOCUS)}
          data-testid="home-projection-upgrade"
        >
          {LIVE_PROJECTION_UPGRADE}
        </button>
      ) : null}
    </section>
  );
}

/**
 * "This week": Monday to Sunday from the calendar, today filled, and the done line.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P1: '"This week" ticks days
 *       with any study activity (same definition as the streak); plan completion is a separate
 *       line'] | @implemented [2026-10-13]
 * plain English: a day carries a ✓ when it is one of `activeDays`, the server's days with at least
 * one answered question (`active_days` on GET /api/qotd/today, read from the streak's own day set,
 * `public.student_answer_days`). It no longer depends on the plan: a student who practised off
 * plan still sees the day ticked. The plan's completion stays the line under the strip
 * ("N of M days done"). Screen readers hear "studied" on a ticked day.
 */
export function WeekSection({
  days,
  today,
  activeDays,
}: {
  days: readonly CalendarDay[];
  today: string;
  activeDays: readonly string[];
}): JSX.Element {
  const summary = weekSummary(days);
  const studied = new Set(activeDays);
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
              {/* The tick's row is always there, so a ticked and an unticked day line up. */}
              <span
                className="h-5 text-lyc-meta font-semibold leading-5"
                data-testid="home-week-tick"
                data-studied={studied.has(day.local_date) ? "true" : "false"}
              >
                {studied.has(day.local_date) ? (
                  <>
                    <span aria-hidden="true">✓</span>
                    <span className="sr-only">studied</span>
                  </>
                ) : null}
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
 * Owner ruling OQ-66 (h), Karl, 2026-10-07: "approved; make the action explicit on the row
 * (\"Review this session\")." | @implemented [2026-10-07]
 */
const REVIEW_SESSION_LABEL = "Review this session";

/**
 * "Recent sessions" (OQ-23: the `/api/review/pool` rows, which are the student's sessions that
 * still have questions to review): the session's name, when, and "N to review".
 *
 * UI-66 (OQ-53 (e), owner ruling Karl 2026-10-05) | @implemented [2026-10-08]: the name is the
 * canonical criteria title (`recentSessionTitle` → `sessionTitle`, "Algebra", "Review session",
 * "Full-Length Test 1"), as the open-session rows print it, where it used to be the engine label
 * ("Practice"). The row's `filters` is read only through that helper: since F-52 the server sends
 * the strict four-array criteria (or a full-length row's form name), never the stored object.
 *
 * OQ-66 (h) (Karl, 2026-10-07): the row's action is explicit — a visible "Review this session"
 * text link (outline style, like the panel's other links; Home keeps its one filled primary),
 * where the whole row used to be an unlabelled button. Its accessible name carries the row
 * ("Review this session: Algebra, Today, 10:37 AM") so five rows never share one name; the
 * visible words lead that name (label in name). Pressing it starts the same review as before,
 * and the pressed one reads "Starting…" while the others wait.
 */
export function RecentSessionsSection({
  sessions,
  todayKey,
  onReview,
  startingId,
  failure,
}: {
  sessions: readonly ReviewPoolSourceSession[];
  todayKey: string;
  /**
   * QA item 14 (owner QA list, Karl, 2026-10-07) | @implemented [2026-10-07]: a row is a button
   * that reviews that session's open questions, the same start as Review's "Redo a past session"
   * (`mode: "session"` with the row's source).
   */
  onReview: (session: ReviewPoolSourceSession) => void;
  /** The source session whose review start is in flight (item 5: that row says "Starting…"). */
  startingId: string | null;
  /**
   * Why the last start failed, in the student's words, or null. (The QA2-A review-cap notice
   * drawn under a row is retired: owner rulings, Karl, 2026-10-21, on #1277, ruling 3; the server
   * never refuses a start for the cap since F-81.)
   */
  failure: string | null;
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
          {sessions.slice(0, RECENT_ROWS).map((s) => {
            const when =
              s.local_time === null
                ? dayHeaderLabel(s.local_date, todayKey)
                : `${dayHeaderLabel(s.local_date, todayKey)}, ${s.local_time}`;
            const starting = startingId === s.source_session_id;
            const title = recentSessionTitle(s);
            return (
              <Fragment key={recentRowKey(s)}>
                <li
                  className="group flex items-center justify-between gap-3 border-b border-lyc-rule-soft px-1 py-[9px]"
                  data-testid="home-recent-row"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {/* Owner brief 2026-10-11: two lines and an ellipsis, never five. */}
                    <ClampedLabel
                      text={title}
                      className="text-base font-semibold text-lyc-ink"
                      data-testid="home-recent-title"
                    />
                    <span className="text-lyc-meta text-lyc-muted">
                      {/* Two unbreakable halves: a narrow panel wraps between them, never
                          inside "2 to review". */}
                      <span className="whitespace-nowrap">{when} ·</span>{" "}
                      <span className="whitespace-nowrap">
                        {toReviewLine(s.open_count)}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onReview(s)}
                    disabled={startingId !== null}
                    aria-busy={starting ? true : undefined}
                    aria-label={
                      starting
                        ? undefined
                        : `${REVIEW_SESSION_LABEL}: ${title}, ${when}`
                    }
                    className={cn(
                      LYC_FOCUS,
                      "shrink-0 whitespace-nowrap rounded-sm bg-transparent p-0 text-base font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline disabled:cursor-default disabled:no-underline",
                    )}
                    data-testid="home-recent-review"
                  >
                    {starting ? STARTING_LABEL : REVIEW_SESSION_LABEL}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ul>
      ) : null}
      {failure !== null ? (
        <p role="alert" className="m-0 text-base text-lyc-danger">
          {failure}
        </p>
      ) : null}
      <Link href="/review" className={PANEL_LINK}>
        See all sessions
      </Link>
    </section>
  );
}

/** QA2-A: one recent-session row's identity (its source engine and session). */
function recentRowKey(row: ReviewPoolSourceSession): string {
  return `${row.source_engine}:${row.source_session_id}`;
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
