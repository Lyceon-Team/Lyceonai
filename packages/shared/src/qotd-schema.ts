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
 * Owner ruling 2026-10-05 (QOTD follow-up): each of today's options carries an opaque token
 * (`qotdOptionTokenSchema`), never the canonical letter; the browser letters them A-D by
 * position. Since Karl's ruling 2026-10-23 they are served in canonical order (the per-request
 * shuffle of 2026-10-05 is gone), so position lettering IS the canonical lettering. The reveal names the correct option by its token. The
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

/** An archive option: in the day's stored order (SCL-258), identified by its canonical key. */
export const qotdOptionSchema = z
  .object({ id: qotdOptionKeySchema, text: z.string() })
  .strict();

/** Today's option: in the day's stored order (SCL-258), identified only by its token. */
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

/** Before submit: no answer, no explanation; options in canonical order and tokenised. */
export const qotdPreSubmitQuestionSchema = z
  .object({
    ...qotdQuestionBaseShape,
    /** MCQ: four options in canonical order (Karl, 2026-10-23). Grid-in: empty. */
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
    /** MCQ: the options in the day's stored order (SCL-258). Grid-in: empty. */
    options: z.array(qotdOptionSchema),
    /** The correct option's canonical key (its id above). */
    correct_option_id: qotdOptionKeySchema.nullable(),
    /**
     * The letter the correct option is shown under, from the stored order. Grid-in: null. The
     * server always sends it; it is optional to READ only because a reader (the social run, a
     * browser tab) can meet a server that predates SCL-258, whose options are in the order it
     * showed (canonical). Readers letter by position and require this to agree when present.
     */
    correct_letter: qotdOptionKeySchema.nullable().optional(),
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

/**
 * The day before a QOTD date (YYYY-MM-DD, calendar arithmetic in UTC so no zone shifts it).
 * "Yesterday" for the reveal is always this, taken from the posted day itself, never the clock.
 */
export function previousQotdDate(date: string): string {
  const d = new Date(`${qotdDateSchema.parse(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Yesterday's reveal, for the comment on yesterday's r/satquestion post.
 *
 * @spec [Doc 10A §7 ("no answer is revealed before submitting"; a past day's answer is public on
 *       its archive page), Doc 10B (Reddit posting stays manual); owner brief "QOTD Slack post —
 *       add yesterday's reveal" (Karl, 2026-10-15)] | @implemented [2026-10-15]
 *
 * plain English: built ONLY from yesterday's public archive payload (GET
 * /api/public/qotd/:date, which refuses today and future days). `withheld` is a day the archive
 * does not publish (a repaired question, owner 2026-10-08): it carries the date and nothing else,
 * so there is nothing to post but the notice.
 */
export const qotdRevealAnswerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("choice"),
      letter: qotdOptionKeySchema,
      text: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("value"), value: z.string().min(1) }).strict(),
]);

export const qotdRevealSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("revealed"),
        qotd_date: qotdDateSchema,
        section: z.enum(["Math", "Reading and Writing"]),
        domain: z.string().min(1),
        answer: qotdRevealAnswerSchema,
        explanation: z.string().min(1),
        archive_url: z
          .string()
          .regex(
            /^https:\/\/lyceon\.ai\/sat-question-of-the-day\/\d{4}-\d{2}-\d{2}$/,
          ),
      })
      .strict(),
    z
      .object({ status: z.literal("withheld"), qotd_date: qotdDateSchema })
      .strict(),
  ])
  .refine(
    (r) => r.status !== "revealed" || r.archive_url.endsWith(`/${r.qotd_date}`),
    "the archive link is the revealed day's page",
  );

/** Today's suggested Reddit post: the title and the question as plain text. */
export const qotdRedditPostSchema = z
  .object({
    title: z.string().min(1).max(300),
    body: z.string().min(1),
  })
  .strict();

/** The TikTok "Why:" line: at most this many characters, cut at a sentence boundary. */
export const QOTD_TIKTOK_WHY_MAX = 300;
/** The TikTok title: hard cap (Karl, 2026-10-23). */
export const QOTD_TIKTOK_TITLE_MAX = 90;

/**
 * Yesterday's question as a TikTok photo carousel: question, pause, answer.
 *
 * @spec [Doc 10A §7 ("no answer is revealed before submitting": a past day's answer is public on
 *       its archive page), §11; owner brief "QOTD social: TikTok 3-slide carousel + fixed answer
 *       order + CTA-first caption + short title" (Karl, 2026-10-23)] | @implemented [2026-10-23]
 *
 * plain English: built ONLY from yesterday's public archive payload, like the Reddit reveal, so
 * it can never carry today's answer. `question` is the strict no-answer social input (slide 1);
 * `answer` and `why` are slide 3: the correct choice's letter and RAW text (drawn with the site's
 * maths renderer) or the grid-in value, and at most 300 characters of the explanation, ending
 * at a sentence boundary. The letter is the one slide 1 shows for that choice (refused by the
 * builder otherwise).
 */
export const qotdTiktokCarouselSchema = z
  .object({
    question: qotdSocialInputSchema,
    section: z.enum(["Math", "Reading and Writing"]),
    answer: qotdRevealAnswerSchema,
    why: z.string().min(1).max(QOTD_TIKTOK_WHY_MAX),
  })
  .strict()
  .refine(
    (c) => (c.question.item_type === "mcq") === (c.answer.kind === "choice"),
    "a choice answer for an MCQ, a value for a grid-in",
  );

/**
 * The TikTok part of a day's post: three slides of yesterday's question with the title and
 * caption, or, when yesterday is withheld or missing from the archive (or its slides cannot fit),
 * no carousel and a one-line note (Karl, 2026-10-23).
 */
export const qotdTiktokPostSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("built"),
        /** The carousel's question day: yesterday. */
        qotd_date: qotdDateSchema,
        title: z.string().min(1).max(QOTD_TIKTOK_TITLE_MAX),
        caption: z.string().min(1),
        slides: z
          .array(z.string().regex(/^qotd-\d{4}-\d{2}-\d{2}-tiktok-[123]\.png$/))
          .length(3),
      })
      .strict(),
    z
      .object({
        status: z.literal("skipped"),
        qotd_date: qotdDateSchema,
        reason: z.enum(["withheld", "does_not_fit"]),
      })
      .strict(),
  ])
  .refine(
    (t) =>
      t.status !== "built" ||
      t.slides.every(
        (file, i) => file === `qotd-${t.qotd_date}-tiktok-${i + 1}.png`,
      ),
    "the slides are the carousel day's, numbered 1 to 3 in order",
  );

/**
 * The publish manifest: what the generator hands the Slack poster for one day.
 *
 * @spec [Doc 10A §7 ("no answer is revealed before submitting"), §11; owner brief 2026-10-10
 *       (QOTD social assets to Slack: "never post a day with a leak-check failure", the date and
 *       section with the caption and alt text)] | @implemented [2026-10-10]
 *
 * plain English: scripts/qotd-social/generate.ts writes post.json ONLY when every check passed,
 * and the poster (scripts/qotd-social/post-to-slack.ts) posts nothing without it. `leaks` says
 * how the leak check went: "passed" when the day's answer was known and socialAssetLeaks found
 * nothing (a past day), or "no-answer-in-source" for today, whose public pre-submit payload
 * carries the answer and explanation as the literal null (qotdSocialInputSchema), so there is
 * nothing to leak and nothing to check against. Any other value fails to parse.
 */
export const qotdSocialPostManifestSchema = z
  .object({
    qotd_date: qotdDateSchema,
    section: z.enum(["Math", "Reading and Writing"]),
    source: z.enum(["today", "past"]),
    caption: z.string().min(1),
    alt_text: z.string().min(1).max(1000),
    images: z
      .array(
        z
          .object({
            format: z.enum(["portrait", "story"]),
            file: z
              .string()
              .regex(/^qotd-\d{4}-\d{2}-\d{2}-(portrait|story)\.png$/),
          })
          .strict(),
      )
      .min(1),
    checks: z
      .object({
        input: z.literal("passed"),
        copy: z.literal("passed"),
        reveal_wording: z.literal("passed"),
        leaks: z.enum(["passed", "no-answer-in-source"]),
      })
      .strict(),
    /** Today's suggested Reddit title and body (owner brief 2026-10-15). */
    reddit: qotdRedditPostSchema,
    /** Yesterday's reveal: always the day before `qotd_date` (owner brief 2026-10-15). */
    reveal: qotdRevealSchema,
    /** Yesterday's question as a TikTok carousel, or why there is none (Karl, 2026-10-23). */
    tiktok: qotdTiktokPostSchema,
  })
  .strict()
  .refine(
    (m) => m.reveal.qotd_date === previousQotdDate(m.qotd_date),
    "the reveal is yesterday's, never today's",
  )
  .refine(
    (m) => m.tiktok.qotd_date === previousQotdDate(m.qotd_date),
    "the TikTok carousel is yesterday's question, never today's",
  )
  .refine(
    (m) => m.source === "past" || m.checks.leaks === "no-answer-in-source",
    "today's source has no answer to check against",
  )
  .refine(
    (m) => m.source === "today" || m.checks.leaks === "passed",
    "a past day's leak check must have run and passed",
  );

export type QotdOption = z.infer<typeof qotdOptionSchema>;
export type QotdSocialInput = z.infer<typeof qotdSocialInputSchema>;
export type QotdSocialCopy = z.infer<typeof qotdSocialCopySchema>;
export type QotdSocialPostManifest = z.infer<
  typeof qotdSocialPostManifestSchema
>;
export type QotdServedOption = z.infer<typeof qotdServedOptionSchema>;
export type QotdReveal = z.infer<typeof qotdRevealSchema>;
export type QotdTiktokCarousel = z.infer<typeof qotdTiktokCarouselSchema>;
export type QotdTiktokPost = z.infer<typeof qotdTiktokPostSchema>;
export type QotdRevealAnswer = z.infer<typeof qotdRevealAnswerSchema>;
export type QotdRedditPost = z.infer<typeof qotdRedditPostSchema>;
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
