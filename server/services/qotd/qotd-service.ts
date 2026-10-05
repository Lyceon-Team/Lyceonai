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
 *     review use. Options are served in authored order with their canonical key as the id, so the
 *     token map is the identity map A->A ... D->D.
 */
import { z } from "zod";
import {
  mapGenesisQuestionRow,
  parseCanonicalMcOptions,
  projectStudentSafeQuestion,
} from "../../../shared/question-bank-contract";
import {
  qotdCorrectOptionId,
  qotdRowSchema,
  qotdServedOptions,
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

/** Pre-submit: the canonical student-safe projection, then the strict schema. */
export function toTodayResponse(row: QotdRow): QotdTodayResponse {
  const projected = projectStudentSafeQuestion(
    mapGenesisQuestionRow({ ...row, id: row.question_id }),
  );
  return qotdTodayResponseSchema.parse({
    qotd_date: row.qotd_date,
    question: {
      id: projected.id,
      section_code: row.section,
      domain: row.domain,
      item_type: projected.item_type,
      stem: projected.stem,
      passage: projected.passage,
      options: qotdServedOptions(row),
      correct_answer: projected.correct_answer,
      explanation: projected.explanation,
    },
  });
}

const IDENTITY_TOKEN_MAP: Record<string, string> = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
};

/** Grade with the shared grader. Options are served by canonical key, so tokens are keys. */
export function gradeQotd(row: QotdRow, answer: string): GradeResult {
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
  return gradeAnswer(
    question,
    answer,
    row.item_type === "grid_in" ? null : IDENTITY_TOKEN_MAP,
  );
}

export { qotdCorrectOptionId, toArchiveResponse };
