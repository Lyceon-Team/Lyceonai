/**
 * Question of the Day (QOTD): the public API's request and response contract.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16 (answerable without login, same rendering
 *       as practice), R17 (answer + pre-written explanation on submit; "% of students got this
 *       right" only at >= 5 attempts), R18, Q2 ("strict runtime-parsed student-safe DTO");
 *       Coding Standards §5.2 (pre-submit correct_answer / explanation are null), §7.2 (schema
 *       first, types inferred); owner Step 0 decisions 2026-10-05 (canonical option order)]
 *       | @implemented [2026-10-05]
 *
 * plain English: every QOTD payload is a STRICT object (an unknown key is a parse failure, so a
 * field added upstream cannot ride out to the browser), and the server parses its own response
 * against these schemas before sending it. Before submit, `correct_answer` and `explanation` are
 * the literal `null`. Options keep the authored order and carry the canonical key as their id
 * (A-D): the order is the same for every visitor on a day, and the answer is public once anyone
 * submits, so there is nothing a per-visitor token would protect.
 *
 * The success-rate stat is a discriminated union: below the threshold the payload says
 * `hidden` and carries no number at all, so a client cannot show what the server withheld.
 */
import { z } from "zod";

/** "% of students got this right" is shown only once a day has at least this many attempts. */
export const QOTD_MIN_ATTEMPTS_FOR_STAT = 5;

/** A calendar date, YYYY-MM-DD, that exists. */
export const qotdDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a calendar date");

export const qotdOptionKeySchema = z.enum(["A", "B", "C", "D"]);

export const qotdOptionSchema = z
  .object({ id: qotdOptionKeySchema, text: z.string() })
  .strict();

const qotdQuestionBaseShape = {
  id: z.string().min(1),
  section_code: z.enum(["M", "RW"]),
  domain: z.string().min(1),
  item_type: z.enum(["mcq", "grid_in"]),
  stem: z.string(),
  passage: z.string().nullable(),
  /** MCQ: four options in authored order. Grid-in: empty. */
  options: z.array(qotdOptionSchema),
};

/** Before submit: no answer, no explanation. */
export const qotdPreSubmitQuestionSchema = z
  .object({
    ...qotdQuestionBaseShape,
    correct_answer: z.null(),
    explanation: z.null(),
  })
  .strict();

export const qotdStatSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("hidden") }).strict(),
  z
    .object({
      status: z.literal("shown"),
      /** Whole percent, 0-100. */
      percent_correct: z.number().int().min(0).max(100),
    })
    .strict(),
]);

/** GET /api/public/qotd/today */
export const qotdTodayResponseSchema = z
  .object({
    qotd_date: qotdDateSchema,
    question: qotdPreSubmitQuestionSchema,
  })
  .strict();

/** POST /api/public/qotd/today/answer */
export const qotdSubmitRequestSchema = z
  .object({
    qotd_date: qotdDateSchema,
    /** MCQ: the option id (A-D). Grid-in: the entered value. */
    answer: z.string().trim().min(1).max(32),
    turnstile_token: z.string().min(1).max(2048),
  })
  .strict();

const qotdRevealShape = {
  qotd_date: qotdDateSchema,
  is_correct: z.boolean(),
  /** MCQ: the correct option's id. Grid-in: null. */
  correct_option_id: qotdOptionKeySchema.nullable(),
  /** Grid-in: the keyed answer. MCQ: null (the option id names it). */
  correct_answer: z.string().nullable(),
  explanation: z.string(),
  stats: qotdStatSchema,
};

export const qotdSubmitResponseSchema = z.object(qotdRevealShape).strict();

/** A past day: the question with its answer and explanation, for the archive. */
export const qotdArchiveQuestionSchema = z
  .object({
    ...qotdQuestionBaseShape,
    correct_option_id: qotdOptionKeySchema.nullable(),
    correct_answer: z.string().nullable(),
    explanation: z.string(),
  })
  .strict();

/** GET /api/public/qotd/:date (past dates only) */
export const qotdArchiveResponseSchema = z
  .object({
    qotd_date: qotdDateSchema,
    question: qotdArchiveQuestionSchema,
    stats: qotdStatSchema,
  })
  .strict();

/** GET /api/public/qotd/archive — the past days, newest first, for the hub's archive list. */
export const qotdArchiveIndexResponseSchema = z
  .object({
    days: z.array(
      z
        .object({
          qotd_date: qotdDateSchema,
          section_code: z.enum(["M", "RW"]),
          domain: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type QotdOption = z.infer<typeof qotdOptionSchema>;
export type QotdPreSubmitQuestion = z.infer<typeof qotdPreSubmitQuestionSchema>;
export type QotdStat = z.infer<typeof qotdStatSchema>;
export type QotdTodayResponse = z.infer<typeof qotdTodayResponseSchema>;
export type QotdSubmitRequest = z.infer<typeof qotdSubmitRequestSchema>;
export type QotdSubmitResponse = z.infer<typeof qotdSubmitResponseSchema>;
export type QotdArchiveQuestion = z.infer<typeof qotdArchiveQuestionSchema>;
export type QotdArchiveResponse = z.infer<typeof qotdArchiveResponseSchema>;
export type QotdArchiveIndexResponse = z.infer<
  typeof qotdArchiveIndexResponseSchema
>;

/** The stat to show for a day: hidden below the threshold, otherwise a whole percent. */
export function qotdStat(attempts: number, correct: number): QotdStat {
  if (attempts < QOTD_MIN_ATTEMPTS_FOR_STAT) return { status: "hidden" };
  return {
    status: "shown",
    percent_correct: Math.round((Math.min(correct, attempts) / attempts) * 100),
  };
}
