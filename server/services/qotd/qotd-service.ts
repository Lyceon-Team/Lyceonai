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
 *     day (the database decides "today": the QOTD day, 04:00 UTC to 04:00 UTC since the switch of
 *     Karl's ruling 2026-10-27, America/Chicago before it). The row is Zod-parsed here.
 *   * qotdToday / qotdDayWindow: the same QOTD day in TypeScript (qotd-day.ts), with the switch's
 *     cutover read from the database (`qotd_day_cutover()`, cached), so the server and the
 *     database never disagree about when the day turns over.
 *   * toTodayResponse: the pre-submit payload. It goes through the canonical student-safe
 *     projection (projectStudentSafeQuestion, which types correct_answer / explanation as the
 *     literal null) and is then parsed against the STRICT response schema, so nothing outside
 *     the contract can leave even if the row grows a column.
 *   * toArchiveResponse (shared/qotd/projection.ts, re-exported): a past day, answer and
 *     explanation included (R20a). The build-time prerender uses the same projection.
 *   * gradeQotd: the shared gradeAnswer (shared/practice/grade.ts), the same function practice and
 *     review use, over the day's recomputed token map (option-tokens.ts).
 *
 * ORDER (Karl's rulings 2026-10-28, SCL-258, superseding the paragraph below on order only): the
 * options are shuffled ONCE, in the database, when the day is scheduled; every request serves the
 * stored order (servedTokenOptions -> qotdServedChoices). Tokens still do not depend on order.
 *
 * Owner ruling 2026-10-05 (QOTD follow-up, items 1 and 4), superseded on order by Karl's ruling
 * 2026-10-23 ("QOTD social: TikTok 3-slide carousel + fixed answer order"): today's options are
 * served in CANONICAL (authored) order on every request, the same order the archive, the home
 * card, the social images and the Reddit reveal use, so the letter a reveal names is the letter
 * the question showed. What 2026-10-05 put in place and still holds: each option is sent as an
 * opaque token, never the canonical letter, and on submit only one of the day's four tokens is
 * accepted: a raw letter or any other string is `invalid_answer` (400) before grading, because
 * the shared resolver would otherwise fall back to reading a bare "A"-"D" as a canonical key.
 * Tokens do not depend on display order, so a visitor who loaded the page before the 2026-10-23
 * deploy (a shuffled order) still submits a valid token and is graded correctly. No payload
 * carries the canonical question id. Practice and diagnostic shuffling are unchanged.
 */
import { z } from "zod";
import {
  mapGenesisQuestionRow,
  parseCanonicalMcOptions,
  projectStudentSafeQuestion,
} from "../../../shared/question-bank-contract";
import { qotdOptionToken, qotdOptionTokenMap } from "./option-tokens";
import {
  qotdCorrectOptionId,
  qotdRowSchema,
  qotdServedChoices,
  stemRepeatsPassage,
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
import type { RpcClient } from "../../lib/rpc-client";
import { logger } from "../../logger";
import {
  QOTD_LEGACY_TIME_ZONE,
  qotdDayOf,
  qotdDayWindowOf,
  type QotdCutover,
} from "./qotd-day";

/**
 * The zone of the QOTD's Chicago-clock jobs (the 17:00 daily reminder), and of the QOTD day
 * before the 04:00 UTC switch (Karl, 2026-10-27). The QOTD day itself is qotd-day.ts's.
 */
export const QOTD_TIME_ZONE = QOTD_LEGACY_TIME_ZONE;

/** The subset of the Supabase client this service needs. */
export type QotdDbClient = RpcClient;

export class QotdUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QotdUnavailableError";
  }
}

export type { QotdRow };

/** The cutover never moves once set; this only has to notice the migration arriving. */
const QOTD_CUTOVER_TTL_MS = 5 * 60 * 1000;
let cutoverCache: { value: QotdCutover; readAt: number } | null = null;

/**
 * When the 04:00 UTC QOTD day took over (`public.qotd_day_cutover()`), cached. Unreadable (no
 * migration yet, or the read failed): the last value read, else null, which is the Chicago day,
 * the database's own day without the migration. Logged, never thrown: a QOTD request is never
 * refused because this read failed.
 */
export async function loadQotdCutover(
  client: QotdDbClient,
  nowMs: number = Date.now(),
): Promise<QotdCutover> {
  if (
    cutoverCache !== null &&
    nowMs - cutoverCache.readAt < QOTD_CUTOVER_TTL_MS
  )
    return cutoverCache.value;
  const { data, error } = await client.rpc("qotd_day_cutover", {});
  // A value that is not a timestamp is unreadable too: an Invalid Date would compare as "switched".
  const parsed = z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)))
    .nullable()
    .safeParse(data);
  if (error || !parsed.success) {
    const value = cutoverCache?.value ?? null;
    logger.warn(
      "QOTD",
      "day_cutover_unreadable",
      "The QOTD day switch could not be read; keeping the last known day rule",
      { known: value !== null },
    );
    cutoverCache = { value, readAt: nowMs };
    return value;
  }
  const value = parsed.data === null ? null : new Date(parsed.data);
  cutoverCache = { value, readAt: nowMs };
  return value;
}

/** Tests only. */
export function resetQotdCutoverCacheForTests(): void {
  cutoverCache = null;
}

/** Today's QOTD date (YYYY-MM-DD). */
export async function qotdToday(
  client: QotdDbClient,
  now: Date = new Date(),
): Promise<string> {
  return qotdDayOf(now, await loadQotdCutover(client));
}

/** The QOTD day `date` as `[start, end)` UTC instants: the public stats bucket's window. */
export async function qotdDayWindow(
  client: QotdDbClient,
  date: string,
): Promise<{ start: Date; end: Date }> {
  return qotdDayWindowOf(date, await loadQotdCutover(client));
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
  // Owner 2026-10-08: a day whose question has no prompt is not published (the prerender skips
  // it too), so the hub never links to a page that does not exist.
  return parsed.data.filter((r) => isPublishableArchiveRow(r));
}

/**
 * A past day is published only while its question has a prompt (stem not a copy of the
 * passage; shared/qotd/projection.ts). Checked on content each time, so a repaired question
 * is published again with no other change.
 */
export function isPublishableArchiveRow(row: QotdRow): boolean {
  return !stemRepeatsPassage(row.stem, row.passage);
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
 * Today's options in the day's STORED order (qotdServedChoices; Karl's rulings 2026-10-28,
 * SCL-258), each carrying only its token. The order is the archive's and the home card's, so
 * every surface letters the same choice the same way. A row whose stored order is refused throws
 * QotdServedOrderError; the route answers 503 rather than serve a different order.
 */
function servedTokenOptions(row: QotdRow): { id: string; text: string }[] {
  return qotdServedChoices(row).options.map((o) => ({
    id: qotdOptionToken(row.qotd_date, o.id),
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
      options: servedTokenOptions(row),
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
