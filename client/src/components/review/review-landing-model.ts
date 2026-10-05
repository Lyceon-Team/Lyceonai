/**
 * The Review page's words and choices, as pure functions of the payloads it reads.
 *
 * @spec [DESIGN.md §3 ("Domain chips: counts come from the student's own queue"), §4 Review;
 *        prototype Review.dc.html (copy: the queue card, `topicSummary`, `topicCta`, "Load more", `shown: 5` and `shown + 5`); register §2
 *        (counts of the student's own data only, no bank counts), OQ-24 ruling (Karl,
 *        2026-10-02: no count; the list reads "Past sessions" with Load more), UI-16 (the
 *        picker is paged by the server's cursor, 20 a page); evidence/wiring-table.md §6 Review;
 *        owner ruling 2026-10-03 (copy from the prototype or shipped copy only)]
 *        | @implemented [2026-10-03]
 *
 * plain English: every number here is the student's own (their queue, their sessions). The
 * past-session list shows five rows, then five more per "Load more"; when the rows already
 * fetched run out, the next server page is fetched with the UI-16 cursor. No total is ever
 * written for the past sessions (OQ-24), and nothing here reads a clock or fetches.
 */
import type { ReviewPoolSourceSession } from "@lyceon/shared/review-schema";
import {
  groupByLocalDay,
  type SessionDayGroup,
} from "@/lib/review-session-picker";

/** Rows the collapsed "Past sessions" list shows first, and adds per "Load more" (prototype). */
export const PAST_SESSIONS_STEP = 5;

/** The queue card's heading (prototype): "112 questions to review". */
export function queueHeadline(total: number): string {
  return `${total} ${total === 1 ? "question" : "questions"} to review`;
}

/** A domain chip (prototype `domainChips`): "Algebra (12)", the student's own queue count. */
export function domainChipLabel(domain: string, count: number): string {
  return `${domain} (${count})`;
}

/**
 * How many queued questions the topic choice covers: the chosen domains' own counts, or, with
 * none chosen, the section's own count (`bySection`, which also counts a question whose domain
 * is not tagged, so it is the number a section-wide session would actually hold).
 */
export function topicCount(
  chosenDomains: readonly string[],
  byDomain: ReadonlyMap<string, number>,
  sectionCount: number,
): number {
  if (chosenDomains.length === 0) return sectionCount;
  return chosenDomains.reduce((sum, d) => sum + (byDomain.get(d) ?? 0), 0);
}

/** The topic row's summary (prototype `topicSummary`): "12 waiting in Algebra, Advanced Math". */
export function topicSummary(
  count: number,
  chosenDomains: readonly string[],
  sectionName: string,
): string {
  const where =
    chosenDomains.length > 0 ? chosenDomains.join(", ") : sectionName;
  return `${count} waiting in ${where}`;
}

/** The topic row's button (prototype `topicCta`): "Review these 12". */
export function topicCta(count: number): string {
  return `Review these ${count}`;
}

/**
 * The first `shown` rows (already newest first, as served), grouped under their day headers.
 * A day the cut falls inside keeps only its first rows, as in the prototype.
 */
export function visiblePastGroups(
  rows: readonly ReviewPoolSourceSession[],
  shown: number,
  todayKey: string,
): SessionDayGroup<ReviewPoolSourceSession>[] {
  return groupByLocalDay(rows.slice(0, Math.max(0, shown)), todayKey);
}

/**
 * Whether "Load more" is offered: rows already fetched but not shown, or a further server page
 * (the UI-16 cursor). No count is computed or shown (OQ-24).
 */
export function hasMorePast(
  loaded: number,
  shown: number,
  serverHasMore: boolean,
): boolean {
  return shown < loaded || serverHasMore;
}

/**
 * Whether showing `nextShown` rows needs the next server page: the rows already fetched do not
 * reach that far and the server has another page.
 */
export function needsNextPage(
  loaded: number,
  nextShown: number,
  serverHasMore: boolean,
): boolean {
  return nextShown > loaded && serverHasMore;
}
