/**
 * Question of the Day: read a day, project it for the browser, grade an answer.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16-R18, Q2; Coding Standards §5.2 (pre-submit
 *       nulls), §7.1 (parse at every boundary), §8.1 (domain logic out of the handler); owner
 *       Step 0 decisions 2026-10-05 (canonical option order; grade with the shared grader)]
 *       | @implemented [2026-10-05]
 *
 * plain English:
 *   * readQotd: one call to qotd_question_for, which returns nothing for a future or unscheduled
 *     day (the database decides "today" in America/Chicago). The row is Zod-parsed here.
 *   * toTodayResponse: the pre-submit payload. It goes through the canonical student-safe
 *     projection (projectStudentSafeQuestion, which types correct_answer / explanation as the
 *     literal null) and is then parsed against the STRICT response schema, so nothing outside
 *     the contract can leave even if the row grows a column.
 *   * toArchiveResponse (shared/qotd/projection.ts, re-exported): a past day, answer and
 *     explanation included (R20a). The build-time prerender uses the same projection.
 *   * gradeQotd: the shared gradeAnswer (shared/practice/grade.ts), the same function practice and
 *     review use, over the day's recomputed token map (option-tokens.ts).
 *
 * Owner ruling 2026-10-05 (QOTD follow-up, items 1 and 4) | updated [2026-10-05]: today's options
 * are shuffled on EVERY request with the same unseeded Fisher-Yates practice uses
 * (`fisherYates`, shared/question-bank-contract.ts) and each is sent as an opaque token, never
 * the canonical letter. On submit only one of the day's four tokens is accepted: a raw letter
 * or any other string is `invalid_answer` (400) before grading, because the shared resolver
 * would otherwise fall back to reading a bare "A"-"D" as a canonical key. No payload carries the
 * canonical question id.
 */
import { z } from "zod";
import {
  fisherYates,
  mapGenesisQuestionRow,
  parseCanonicalMcOptions,
  projectStudentSafeQuestion,
} from "../../../shared/question-bank-contract";
import { qotdOptionToken, qotdOptionTokenMap } from "./option-tokens";
import { explanationNamesChoiceLetter } from "../../../shared/practice/letter-reference";
import {
  qotdCorrectOptionId,
  qotdRowSchema,
  toArchiveIndex,
  toArchiveResponse,
  type QotdRow,
} from "../../../shared/qotd/projection";
import {
  gradeAnswer,
  type CanonicalQuestionForServing,
  type GradeResult,
} from "../../../shared/practice/grade";
import {
  qotdTodayResponseSchema,
  type QotdArchiveIndexResponse,
  type QotdTodayResponse,
} from "../../../packages/shared/src/qotd-schema";
import {
  localDayWindowUtc,
  localTodayIn,
} from "../calendar/adapters/local-day";

/** The QOTD day boundary (plan R18). The database uses the same zone (public.qotd_today()). */
export const QOTD_TIME_ZONE = "America/Chicago";

/** The subset of the Supabase client this service needs. */
export type QotdDbClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export class QotdUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QotdUnavailableError";
  }
}

export type { QotdRow };

export function qotdToday(now: Date = new Date()): string {
  return localTodayIn(QOTD_TIME_ZONE, now);
}

/** The America/Chicago day `[start, end)` as UTC instants: the stats bucket's window. */
export function qotdDayWindow(date: string): { start: Date; end: Date } {
  const w = localDayWindowUtc(date, QOTD_TIME_ZONE);
  return { start: new Date(w.startUtc), end: new Date(w.endUtc) };
}

/** A day's row, or null when that day is in the future or not scheduled. */
export async function readQotd(
  client: QotdDbClient,
  date: string | null,
): Promise<QotdRow | null> {
  const { data, error } = await client.rpc("qotd_question_for", {
    p_date: date,
  });
  if (error)
    throw new QotdUnavailableError(
      `qotd_question_for failed: ${error.message}`,
    );
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  const parsed = qotdRowSchema.safeParse(rows[0]);
  if (!parsed.success)
    throw new QotdUnavailableError(
      "qotd_question_for returned an unexpected row",
    );
  return parsed.data;
}

/** Every past day, parsed; qotd_archive() returns strictly past, still-published days. */
export async function readQotdArchive(
  client: QotdDbClient,
): Promise<QotdRow[]> {
  const { data, error } = await client.rpc("qotd_archive", {});
  if (error)
    throw new QotdUnavailableError(`qotd_archive failed: ${error.message}`);
  const parsed = z
    .array(qotdRowSchema)
    .safeParse(Array.isArray(data) ? data : []);
  if (!parsed.success)
    throw new QotdUnavailableError("qotd_archive returned an unexpected row");
  return parsed.data;
}

/** The hub's archive list: date, section and domain only, newest first. */
export function toArchiveIndexResponse(
  rows: readonly QotdRow[],
): QotdArchiveIndexResponse {
  return toArchiveIndex(
    rows.map((r) => ({
      qotd_date: r.qotd_date,
      section_code: r.section,
      domain: r.domain,
    })),
  );
}

/**
 * Today's options: a fresh unseeded shuffle per call, each option carrying only its token.
 *
 * Read-time guard for days scheduled before the scheduler screened letter references
 * (owner ruling 2026-10-05; spec audit the same day): if the explanation names a choice letter,
 * the options are served in CANONICAL order — still as tokens — so the on-screen letters match
 * the explanation. A wrong "choice B" for most visitors is the worse outcome; new days never
 * reach this branch because the scheduler skips such questions.
 */
function shuffledTokenOptions(row: QotdRow): { id: string; text: string }[] {
  if (row.item_type === "grid_in") return [];
  const options = parseCanonicalMcOptions(row.options);
  const ordered = explanationNamesChoiceLetter(row.explanation)
    ? options
    : fisherYates(options);
  return ordered.map((o) => ({
    id: qotdOptionToken(row.qotd_date, o.key),
    text: o.text,
  }));
}

/** Pre-submit: the canonical student-safe projection, then the strict schema. */
export function toTodayResponse(row: QotdRow): QotdTodayResponse {
  const projected = projectStudentSafeQuestion(
    mapGenesisQuestionRow({ ...row, id: row.question_id }),
  );
  return qotdTodayResponseSchema.parse({
    qotd_date: row.qotd_date,
    question: {
      section_code: row.section,
      domain: row.domain,
      item_type: projected.item_type,
      stem: projected.stem,
      passage: projected.passage,
      options: shuffledTokenOptions(row),
      correct_answer: projected.correct_answer,
      explanation: projected.explanation,
    },
  });
}

/** The day's token -> canonical key map (recomputed; nothing is stored). */
export function qotdTokenMapFor(row: QotdRow): Record<string, string> {
  return qotdOptionTokenMap(
    row.qotd_date,
    parseCanonicalMcOptions(row.options).map((o) => o.key),
  );
}

/**
 * Grade with the shared grader over the recomputed token map. An MCQ answer that is not one of
 * the day's tokens (a tampered token, a bare canonical letter) is refused before grading.
 * The result's `correctOptionId` is the correct option's token.
 */
export function gradeQotd(row: QotdRow, answer: string): GradeResult {
  const tokenMap = row.item_type === "grid_in" ? null : qotdTokenMapFor(row);
  if (tokenMap && !Object.prototype.hasOwnProperty.call(tokenMap, answer)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_answer",
      message: "The answer must be one of today's options.",
    };
  }
  const question: CanonicalQuestionForServing = {
    id: row.question_id,
    canonical_id: row.question_id,
    section_code: row.section,
    item_type: row.item_type,
    stem: row.stem,
    passage: row.passage,
    options:
      row.item_type === "grid_in" ? [] : parseCanonicalMcOptions(row.options),
    difficulty: row.difficulty,
    domain: row.domain,
    correct_answer: row.correct_answer,
    explanation: row.explanation,
    correct_variants: row.correct_variants,
    assets: null,
    option_metadata: null,
    estimated_time_seconds: null,
  };
  return gradeAnswer(question, answer, tokenMap);
}

export { qotdCorrectOptionId, toArchiveResponse };
