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
 * the literal `null`.
 *
 * Owner ruling 2026-10-05 (QOTD follow-up): today's options are shuffled on every request and
 * each carries an opaque token (`qotdOptionTokenSchema`), never the canonical letter; the
 * browser letters them A-D by position. The reveal names the correct option by its token. The
 * archive keeps the canonical order and letters. No payload carries the canonical question id:
 * a day is keyed by `qotd_date`.
 *
 * The success-rate stat is a discriminated union: below the threshold the payload says
 * `hidden` and carries no number at all, so a client cannot show what the server withheld.
 */
import { z } from "zod";

/** "N% answered correctly" is shown only once a day has at least this many attempts. */
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

/** An opaque option token: 22 base64url characters (server/services/qotd/option-tokens.ts). */
export const qotdOptionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** An archive option: canonical order, canonical letter. */
export const qotdOptionSchema = z
  .object({ id: qotdOptionKeySchema, text: z.string() })
  .strict();

/** Today's option: shuffled per request, identified only by its token. */
export const qotdServedOptionSchema = z
  .object({ id: qotdOptionTokenSchema, text: z.string() })
  .strict();

const qotdQuestionBaseShape = {
  section_code: z.enum(["M", "RW"]),
  domain: z.string().min(1),
  item_type: z.enum(["mcq", "grid_in"]),
  stem: z.string(),
  passage: z.string().nullable(),
};

/** Before submit: no answer, no explanation; options shuffled and tokenised. */
export const qotdPreSubmitQuestionSchema = z
  .object({
    ...qotdQuestionBaseShape,
    /** MCQ: four options in this request's shuffled order. Grid-in: empty. */
    options: z.array(qotdServedOptionSchema),
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
    /** MCQ: the chosen option's token. Grid-in: the entered value. */
    answer: z.string().trim().min(1).max(32),
    turnstile_token: z.string().min(1).max(2048),
  })
  .strict();

const qotdRevealShape = {
  qotd_date: qotdDateSchema,
  is_correct: z.boolean(),
  /** MCQ: the correct option's token, so the browser marks it in its own order. Grid-in: null. */
  correct_option_id: qotdOptionTokenSchema.nullable(),
  /** Grid-in: the keyed answer. MCQ: null (the token names it). */
  correct_answer: z.string().nullable(),
  explanation: z.string(),
  stats: qotdStatSchema,
};

export const qotdSubmitResponseSchema = z.object(qotdRevealShape).strict();

/** A past day: the question with its answer and explanation, for the archive. */
export const qotdArchiveQuestionSchema = z
  .object({
    ...qotdQuestionBaseShape,
    /** MCQ: four options in canonical order. Grid-in: empty. */
    options: z.array(qotdOptionSchema),
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

/**
 * The ONLY input the QOTD social assets (image + caption + alt text) are built from.
 *
 * @spec [Doc 10A §7 ("no answer is revealed before submitting"), §11 (the QOTD is the first
 *       social stream); owner decisions 2026-10-07 on the QOTD social assets (GitHub run
 *       downloads; portrait 1080x1350 + story 1080x1920; choice order fixed per day)]
 *       | @implemented [2026-10-07]
 *
 * plain English: the pre-submit shape, with the answer and the explanation as the literal
 * `null` and STRICT, so a payload that carries either fails to parse. The generator
 * (scripts/qotd-social/generate.ts) cannot leak what it is never given. Options are plain texts
 * in display order (letters come from position); grid-in has none.
 */
export const qotdSocialInputSchema = z
  .object({
    qotd_date: qotdDateSchema,
    section_code: z.enum(["M", "RW"]),
    domain: z.string().min(1),
    item_type: z.enum(["mcq", "grid_in"]),
    stem: z.string().min(1),
    passage: z.string().nullable(),
    options: z.array(z.object({ text: z.string() }).strict()),
    correct_answer: z.null(),
    explanation: z.null(),
  })
  .strict()
  .refine(
    (q) =>
      q.item_type === "mcq" ? q.options.length === 4 : q.options.length === 0,
    "an MCQ has four options; a grid-in has none",
  );

/** The caption and alt text posted with the images. */
export const qotdSocialCopySchema = z
  .object({ caption: z.string().min(1), alt_text: z.string().min(1).max(1000) })
  .strict();

export type QotdOption = z.infer<typeof qotdOptionSchema>;
export type QotdSocialInput = z.infer<typeof qotdSocialInputSchema>;
export type QotdSocialCopy = z.infer<typeof qotdSocialCopySchema>;
export type QotdServedOption = z.infer<typeof qotdServedOptionSchema>;
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
