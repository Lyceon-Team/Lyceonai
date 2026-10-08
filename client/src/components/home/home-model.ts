/**
 * Home's words and numbers, as pure functions of the payloads it reads.
 *
 * @spec [DESIGN.md §4 "Home"; prototype Main.dc.html (copy and layout); evidence/wiring-table.md
 *        §3 Home (the endpoint behind each element); register §2 (counts of the student's own
 *        data only, no bank counts, no raw accuracy), OQ-22 (sessions named by criteria), OQ-23
 *        (recent sessions are `/api/review/pool` rows), OQ-39(c) (the free Home after the
 *        diagnostic); owner ruling 2026-10-03 (copy from the prototype or shipped copy only)]
 *        | @implemented [2026-10-03]
 *
 * plain English: every sentence Home writes is the prototype's template with the server's
 * values put in ("15 questions in Advanced Math", "7 of 26 answered", "3 to review"). Nothing
 * here reads a clock or fetches: "today" and the hour are arguments, so each function gives the
 * same answer for the same input and the tests can pin it.
 *
 * WHAT IS NEVER WRITTEN. No percentage, no correct/total, no count of the question bank: the
 * only numbers are the student's own (their plan's targets, their answered items, their review
 * queue, their daily quota) and the projection band Doc 05C serves.
 *
 * edge cases: a plan block whose minutes cannot be stated (a full-length test, whose length
 * comes from the form, `minutesFor`) carries no time; a day whose blocks are all done has no
 * first block, so the page offers no "Start today's plan"; a test date in the past or today has
 * no countdown.
 */
import type { CalendarDay, PlanningEstimates } from "@lyceon/shared/calendar";
import type { SessionCriteria } from "@lyceon/shared/session-criteria";
import type { ReviewPoolSourceSession } from "@lyceon/shared/review-schema";
import { displayFormName } from "@lyceon/shared/exam-form-display";
import type { EstimateStatus } from "@lyceon/shared/diagnostic-state";
import { sectionDisplayLabel } from "@shared/section-display";
import { minutesFor } from "@/features/calendar/lib/blocks";
import { daysBetween } from "@/features/calendar/lib/dates";
import { formatDate } from "@/lib/format-date";
import { sourceEngineLabel } from "@/lib/review-session-picker";

type DayBlock = CalendarDay["blocks"][number];

/** The shipped greeting (the old dashboard's `getGreeting`): by the student's local hour. */
function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Good evening, Sam" — or the greeting alone when the profile has no name. */
export function greetingLine(hour: number, name: string | null): string {
  const trimmed = name?.trim() ?? "";
  const greeting = greetingFor(hour);
  return trimmed.length > 0 ? `${greeting}, ${trimmed}` : greeting;
}

/**
 * "Monday, September 28. 68 days until your SAT on Saturday, December 5." (US style, OQ-66 (g)) The countdown is
 * omitted when the profile has no test date (wiring table §3) or the date is not ahead.
 */
export function dateLine(today: string, testDate: string | null): string {
  // QA 2026-10-07 item 15 / OQ-66 (g): the one student date formatter, US style.
  const head = `${formatDate(today, "weekday-month-day") ?? ""}.`;
  if (testDate === null) return head;
  const days = daysBetween(today, testDate);
  if (days <= 0) return head;
  const unit = days === 1 ? "day" : "days";
  return `${head} ${days} ${unit} until your SAT on ${formatDate(testDate, "weekday-month-day") ?? ""}.`;
}

/** "A", "A and B", "A, B, and C" — the prototype's list form. */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function questions(n: number): string {
  return `${n} ${n === 1 ? "question" : "questions"}`;
}

/** "About 23 min"; "About 1 hour" and "About 2 hours" from an hour up (the prototype's total). */
function aboutMinutes(minutes: number): string {
  if (minutes < 60) return `About ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `About ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

type PlanRowView = {
  readonly blockId: string;
  readonly blockType: DayBlock["block"]["block_type"];
  readonly title: string;
  readonly detail: string | null;
  readonly time: string | null;
  readonly completed: boolean;
};

/**
 * One row of "Today's plan". Titles: "Review", the section's display name, or the shipped
 * "Full-length test" (OQ-62 (b), 2026-10-05). Detail: "15 questions from your review queue", "15 questions in
 * Advanced Math and Algebra", or "15 questions" when the block is section-level (no mix yet).
 */
export function planRowView(
  entry: DayBlock,
  estimates: PlanningEstimates,
): PlanRowView {
  const { block } = entry;
  const minutes = minutesFor(block, estimates);
  const base = {
    blockId: block.block_id,
    blockType: block.block_type,
    time: minutes === null ? null : aboutMinutes(minutes),
    completed: entry.status === "completed",
  };
  if (block.block_type === "review") {
    return {
      ...base,
      title: "Review",
      detail: `${questions(block.target_count)} from your review queue`,
    };
  }
  if (block.block_type === "full_length") {
    return { ...base, title: "Full-length test", detail: null };
  }
  const domains =
    block.scope.level === "domain" ? block.scope.mix.map((m) => m.domain) : [];
  return {
    ...base,
    title: sectionDisplayLabel(block.section) ?? "Practice",
    detail:
      domains.length > 0
        ? `${questions(block.target_count)} in ${joinList(domains)}`
        : questions(block.target_count),
  };
}

/** The day's total, "About 1 hour", from the blocks that have a duration; null with none. */
export function planTotal(
  blocks: readonly DayBlock[],
  estimates: PlanningEstimates,
): string | null {
  const minutes = blocks
    .map((b) => minutesFor(b.block, estimates))
    .filter((m): m is number => m !== null);
  if (minutes.length === 0) return null;
  return aboutMinutes(minutes.reduce((sum, m) => sum + m, 0));
}

/**
 * What "Start today's plan" launches: the first block of the day, in plan order, that is not
 * completed (wiring table §3: there is no day-level launch). Null when every block is done.
 */
export function firstOpenBlock(
  blocks: readonly DayBlock[],
): DayBlock["block"] | null {
  return blocks.find((b) => b.status !== "completed")?.block ?? null;
}

/**
 * "2 of 6 days done. 35 questions planned each day." over the days that ask for work. The
 * second sentence only when every such day plans the same count: otherwise "each day" would be
 * untrue, and the sentence is dropped rather than averaged.
 */
export function weekSummary(days: readonly CalendarDay[]): string | null {
  const planned = days.filter((d) => d.planned_count > 0);
  if (planned.length === 0) return null;
  const done = planned.filter((d) => d.status === "complete").length;
  const head = `${done} of ${planned.length} days done.`;
  const counts = new Set(planned.map((d) => d.planned_count));
  const [only] = [...counts];
  return counts.size === 1 && only !== undefined
    ? `${head} ${questions(only)} planned each day.`
    : head;
}

/**
 * A session named by what the student chose (OQ-22): the skills, else the domains, else the
 * sections. With no criteria, practice falls back to the shipped section label (or
 * "Practice") and review to the prototype's "Review session".
 */
export function sessionTitle(
  kind: "practice" | "review",
  criteria: SessionCriteria,
  section: string | null,
): string {
  if (criteria.skills.length > 0) return criteria.skills.join(", ");
  if (criteria.domains.length > 0) return criteria.domains.join(", ");
  const sections = criteria.sections
    .map((s) => sectionDisplayLabel(s))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (sections.length > 0) return sections.join(", ");
  if (kind === "review") return "Review session";
  return sectionDisplayLabel(section) ?? "Practice";
}

/** No criteria chosen: `sessionTitle`'s fallback input. */
const NO_CRITERIA: SessionCriteria = {
  sections: [],
  domains: [],
  skills: [],
  difficulties: [],
};

/**
 * A recent-session row (`/api/review/pool` `sessions[]`) named the way the open-session rows are.
 *
 * @spec [student-UI register UI-66; OQ-53 (e), owner ruling (Karl) 2026-10-05: "print the
 *        canonical criteria on Practice and Home recent rows"; OQ-22 (criteria shape); F-52 (the
 *        row's `filters` is the strict four-array criteria, or a full-length row's
 *        `{test_form_name}`)] | @implemented [2026-10-08]
 *
 * plain English: a practice or review row is named by `sessionTitle` from the criteria the row
 * carries ("Algebra", "Math", "Review session"), exactly as "Pick up where you left off" names an
 * open session. Fallbacks, the open rows' own: no criteria (`filters: null`, the source row gone)
 * gives sessionTitle's empty-criteria answer ("Practice" / "Review session"); a full-length row
 * is named by its form ("Full-Length Test 1", as Home's open full-length row), else "Full-length
 * test". A diagnostic row keeps the shipped "Diagnostic" (its criteria name no choice the
 * student made). The pool row carries no `section`, so none is passed.
 */
export function recentSessionTitle(row: ReviewPoolSourceSession): string {
  if (row.mode === "diagnostic") return "Diagnostic";
  const filters = row.filters;
  if (row.source_engine === "full_length") {
    return filters !== null && "test_form_name" in filters
      ? displayFormName(filters.test_form_name)
      : sourceEngineLabel("full_length");
  }
  const criteria =
    filters !== null && "sections" in filters ? filters : NO_CRITERIA;
  return sessionTitle(
    row.source_engine === "review" ? "review" : "practice",
    criteria,
    null,
  );
}

/** "7 of 26 answered" — the student's own session. */
export function answeredLine(answered: number, total: number): string {
  return `${answered} of ${total} answered`;
}

/** "3 to review" — the student's own queue (register §2 allows these counts). */
export function toReviewLine(openCount: number): string {
  return `${openCount} to review`;
}

/** "27 of 37 practice questions left" — today's quota (OQ-21), both numbers the server's. */
export function quotaLine(remaining: number, limit: number): string {
  return `${remaining} of ${limit} practice questions left`;
}

/** The words the approved copy spells its small counts with ("five", "eight"). */
const SMALL_COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

/** A count as the copy writes it: a word up to ten, digits above. */
function countWord(n: number): string {
  return SMALL_COUNT_WORDS[n] ?? String(n);
}

/**
 * @spec [owner ruling OQ-68 (d), Karl, 2026-10-08, register row UI-64: "The '40 questions' copy
 *        reads the server quota value (the same source as the 402)"; Doc 05P §10.1 (the
 *        diagnostic is 8 domains × `diagnostic_per_domain`, trimmed to
 *        `diagnostic_total_questions`)] | @implemented [2026-10-08]
 *
 * plain English: the free Home's sentences that state a configured number, with the server's
 * numbers put in. The diagnostic's length and per-domain count come from
 * `GET /api/practice/sessions/open` (`diagnosticTotalQuestions`, `diagnosticPerDomain`, the
 * config `POST /diagnostic/sessions` sizes it with); the daily limit from
 * `GET /api/practice/quota` (`freeDailyLimit`, the 402's `daily_quota_free`). A null number (the
 * read failed) prints the sentence without one, never a remembered 40.
 * edge cases: "five from each of the eight SAT domains" is printed only when the total is a
 * whole number of per-domain draws (total ÷ per-domain = the domains); otherwise the server
 * trims some domain short, so the per-domain clause is dropped rather than stated wrongly.
 */
export function diagnosticCardLine(
  total: number | null,
  perDomain: number | null,
): string {
  const ending = "When you finish, you'll see your projected SAT score.";
  if (total === null) {
    return `Questions from every SAT domain. ${ending}`;
  }
  if (perDomain !== null && perDomain > 0 && total % perDomain === 0) {
    return `${total} questions, ${countWord(perDomain)} from each of the ${countWord(total / perDomain)} SAT domains. ${ending}`;
  }
  return `${total} questions across the SAT domains. ${ending}`;
}

/** "How Lyceon works" step 1, with the diagnostic's length (OQ-68 (d)). */
export function diagnosticStepBody(total: number | null): string {
  const lead = total === null ? "Questions" : `${total} questions`;
  return `${lead} across every domain give you a projected score and a starting point.`;
}

/** "How Lyceon works" step 2, with the free daily limit (OQ-68 (d)). */
export function practiceStepBody(freeDailyLimit: number | null): string {
  const lead =
    freeDailyLimit === null
      ? "Practice questions every day"
      : `${freeDailyLimit} practice ${freeDailyLimit === 1 ? "question" : "questions"} a day`;
  return `${lead}, and every question you miss comes back until you get it right.`;
}

/** The projected band as the prototype prints it: "610–990". */
export function rangeText(range: { low: number; high: number }): string {
  return `${range.low}–${range.high}`;
}

/**
 * Which free Home this is (DESIGN.md §4; OQ-39(c)), from `/api/progress/projection`'s
 * `estimateStatus` and nothing else (wiring table §3, OQ-36).
 *   - baseline_pending is decided FIRST: the student finished the diagnostic and the numbers are
 *     not ready, so nothing may offer to start another (owner ruling Q2, 2026-08-17).
 *   - no_baseline: the diagnostic card, with "Start diagnostic" as the primary.
 *   - computed / baseline_only: the diagnostic is done; the free layout stays and "Go to
 *     practice" is the primary (OQ-39(c)).
 *   - unknown (still loading, or the read failed): neither, so nothing is offered on a guess.
 */
export type FreeHomeStage = "diagnostic" | "pending" | "after" | "unknown";

export function freeHomeStage(
  estimateStatus: EstimateStatus | undefined,
): FreeHomeStage {
  if (estimateStatus === "baseline_pending") return "pending";
  if (estimateStatus === "no_baseline") return "diagnostic";
  if (estimateStatus === undefined) return "unknown";
  return "after";
}
