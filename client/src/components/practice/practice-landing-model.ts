/**
 * The Practice page's words and choices, as pure functions of the payloads it reads.
 *
 * @spec [DESIGN.md §4 "Practice"; prototype Practice.dc.html (copy and layout: `summary`,
 *        `startLabel`, the free quota line, `suggestions`, `sugNote`, `pastSessions`);
 *        evidence/wiring-table.md §4 Practice; register §2 (mastery_level only, no raw accuracy,
 *        no bank counts; free = 40 practice questions a day and unlimited review; "Suggested for
 *        you" is paid-only because it is derived from mastery), OQ-21 (quota), OQ-22 (criteria),
 *        OQ-23 (recent practice reuses `/api/review/pool`); owner ruling 2026-10-03 (copy from
 *        the prototype or shipped copy only)] | @implemented [2026-10-03]
 *
 * plain English: every sentence the Practice page writes is the prototype's template with the
 * student's own choices or the server's values put in ("Math: Algebra, questions of any
 * difficulty.", "Start 10 questions", "You have 12 of 40 free practice questions left today.
 * Review is always unlimited."). Nothing here fetches or reads a clock.
 *
 * WHAT IS NEVER WRITTEN. No count of the question bank and no percentage: the only numbers are
 * the student's own (their chosen session size, their daily quota, their review queue).
 *
 * edge cases: a criteria value with no section (cannot come from the Section switch, which
 * always holds one) names no section and reads "every domain"; skills win over domains in the
 * summary because they are the narrower choice (prototype `scopeText`).
 */
import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import type { ReviewPoolSourceSession } from "@lyceon/shared/review-schema";
import type { SessionCriteria } from "@lyceon/shared/session-criteria";
import type { MasteryDomainNode } from "@/lib/masteryApi";
import { joinList } from "@/components/home/home-model";

/** "Questions per session": 5 to 30 in steps of 5 (DESIGN.md §4; the prototype's select). */
export const QUESTIONS_PER_SESSION_OPTIONS = [5, 10, 15, 20, 25, 30] as const;
export type QuestionsPerSession =
  (typeof QUESTIONS_PER_SESSION_OPTIONS)[number];

/** The prototype's initial size (`size: 10`). */
export const DEFAULT_QUESTIONS_PER_SESSION: QuestionsPerSession = 10;

/** Narrows a `<select>` value to one of the offered sizes; anything else is null. */
export function parseQuestionsPerSession(
  raw: string,
): QuestionsPerSession | null {
  return QUESTIONS_PER_SESSION_OPTIONS.find((n) => String(n) === raw) ?? null;
}

/** The chosen section's label, as the taxonomy route names it. */
function sectionLabel(
  taxonomy: PracticeTopicsResponse,
  criteria: SessionCriteria,
): string | null {
  const code = criteria.sections[0];
  return taxonomy.sections.find((s) => s.section === code)?.label ?? null;
}

/**
 * "Your session" summary (prototype `summary`): "Math: Algebra and Advanced Math, easy and hard
 * questions." Skills, else domains, else "every domain"; the chosen difficulties, else
 * "questions of any difficulty".
 */
export function sessionSummary(
  taxonomy: PracticeTopicsResponse,
  criteria: SessionCriteria,
): string {
  const scope =
    criteria.skills.length > 0
      ? joinList(criteria.skills)
      : criteria.domains.length > 0
        ? joinList(criteria.domains)
        : "every domain";
  // The stored values are the lower-case words the prototype prints ("easy and hard").
  const difficulty =
    criteria.difficulties.length > 0
      ? `${joinList(criteria.difficulties)} questions`
      : "questions of any difficulty";
  const section = sectionLabel(taxonomy, criteria);
  return section === null
    ? `${scope}, ${difficulty}.`
    : `${section}: ${scope}, ${difficulty}.`;
}

/** The Start button (prototype `startLabel`): "Start 10 questions". */
export function startLabel(size: QuestionsPerSession): string {
  return `Start ${size} questions`;
}

/** The free plan's quota line under Start (prototype, plan = free), from `GET /api/practice/quota`. */
export function freeQuotaLine(remaining: number, limit: number): string {
  return `You have ${remaining} of ${limit} free practice questions left today. Review is always unlimited.`;
}

/** "Suggested for you" note (prototype `sugNote`). */
export function suggestionNote(section: string): string {
  return `Your lowest mastery levels in ${section} come first.`;
}

/** How many domains "Suggested for you" offers (DESIGN.md §4: "the two lowest-level domains"). */
const SUGGESTION_COUNT = 2;

/**
 * "Suggested for you": the two lowest-level domains of the section (DESIGN.md §4), from the
 * section's canonical domain nodes (`canonicalDomainNodes`, every canonical domain, server order).
 *
 * Order, stated because the prototype only shows measured domains: a measured domain sorts by
 * its `level` (0 Foundations first); a domain with no level yet ("Not enough answers yet") has
 * no level to compare, so it sorts after every measured domain; ties keep the canonical domain
 * order (the sort is stable over that order). So the answer is the same for the same input.
 */
export function suggestedDomains(
  nodes: readonly MasteryDomainNode[],
): MasteryDomainNode[] {
  const rank = (n: MasteryDomainNode): number =>
    n.level === null ? Number.POSITIVE_INFINITY : n.level;
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => rank(a.node) - rank(b.node) || a.index - b.index)
    .slice(0, SUGGESTION_COUNT)
    .map(({ node }) => node);
}

/** How many rows "Recent practice" lists (as Home's recent sessions). */
const RECENT_PRACTICE_ROWS = 5;

/**
 * "Recent practice" (OQ-23: the `/api/review/pool` rows, which are the student's past sessions
 * that still have questions to review): the practice-engine rows, newest first as served.
 */
export function recentPracticeRows(
  sessions: readonly ReviewPoolSourceSession[],
): ReviewPoolSourceSession[] {
  return sessions
    .filter((s) => s.source_engine === "practice")
    .slice(0, RECENT_PRACTICE_ROWS);
}

/** The shipped session-limit notice (pre-redesign practice.tsx), with the server's limit. */
export function sessionLimitLine(max: number): string {
  return `You've reached the limit of ${max} active sessions. Complete or delete an existing session to start a new one.`;
}

/** The shipped "End this session?" confirmation body (pre-redesign practice.tsx). */
export function endSessionBody(answered: number, total: number): string {
  return `This will terminate the session. Your progress so far (${answered} of ${total} questions) is saved, but you will not be able to resume it.`;
}
