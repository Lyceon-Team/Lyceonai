/**
 * Question of the Day readability: quick-to-read questions only.
 *
 * @spec [owner brief "QOTD — readability filter (Karl's option B)" (Karl, 2026-10-09) "Rules":
 *       multiple choice only; no paired passages ("Text 1" and "Text 2"); Math: passage plus
 *       question text <= 400 characters; Reading and Writing: passage <= 300 characters (about 50
 *       words); "thresholds: named constants in one shared place, used by both the scheduler and
 *       the social-asset generator, so the two never disagree"] | @implemented [2026-10-09]
 *
 * plain English: one pure predicate, `qotdReadabilityProblem`, that the scheduler
 * (server/services/qotd/schedule-job.ts) and the social generator (shared/qotd/social.ts
 * socialInputProblems) both call, so a question the scheduler would refuse is refused by the
 * social path too. Lengths are counted on what a reader sees: HTML tags removed, runs of
 * whitespace collapsed to one space, ends trimmed. Maths markup is counted as written (it is
 * part of what is on screen). The other existing rules (no images, no repeated passage) stay
 * where they are: the eligibility predicate in SQL and `stemRepeatsPassage`.
 */

/** Math: the passage and the question text together, at most this many characters. */
export const QOTD_MATH_MAX_CHARS = 400;

/** Reading and Writing: the passage alone, at most this many characters (about 50 words). */
export const QOTD_RW_MAX_PASSAGE_CHARS = 300;

export type QotdReadabilityInput = {
  section: "M" | "RW";
  itemType: string;
  stem: string | null;
  passage: string | null;
};

export type QotdReadabilityProblem =
  | "not_multiple_choice"
  | "paired_passage"
  | "math_too_long"
  | "rw_passage_too_long";

/** The visible text: tags removed, whitespace collapsed, trimmed. Pure. */
export function qotdVisibleText(text: string | null): string {
  return (text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Text 1" and "Text 2" both present: a paired-passage item. Case-insensitive. Pure. */
export function isPairedPassage(passage: string | null): boolean {
  const p = qotdVisibleText(passage);
  return /\btext\s*1\b/i.test(p) && /\btext\s*2\b/i.test(p);
}

/** The first rule the question breaks, or null when it is quick to read. Pure. */
export function qotdReadabilityProblem(
  q: QotdReadabilityInput,
): QotdReadabilityProblem | null {
  if (q.itemType !== "mcq") return "not_multiple_choice";
  if (isPairedPassage(q.passage)) return "paired_passage";
  const passage = qotdVisibleText(q.passage);
  if (q.section === "M") {
    const stem = qotdVisibleText(q.stem);
    const total = passage.length + stem.length + (passage && stem ? 1 : 0);
    return total > QOTD_MATH_MAX_CHARS ? "math_too_long" : null;
  }
  return passage.length > QOTD_RW_MAX_PASSAGE_CHARS
    ? "rw_passage_too_long"
    : null;
}
