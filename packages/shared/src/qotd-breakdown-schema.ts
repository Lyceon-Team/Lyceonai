/**
 * The QOTD breakdown pilot: the pilot window, the skip codes and the manifest the build hands
 * the Slack poster.
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): a breakdown
 *       video of YESTERDAY's QOTD each day, from the stored option order and display letter,
 *       dropped into #social for review (Karl's manual posting is the approval; nothing
 *       auto-publishes); the fallback rule (a)-(d), each reason with a stable code; a 14-day
 *       window, ruled 2026-11-09 to 2026-11-22 (Karl, 2026-11-02, on #1398; the schema still
 *       allows "off" for after the pilot); SCL-266; Karl's rulings on #1398,
 *       2026-11-02: authored scripts replace the templated one ("the voice never reads the
 *       screen"), one per scheduled QOTD date, written weekly by Claude Code for the next 7 dates
 *       from each date's stored order and letter, landed as a batch PR into `social`, Karl's
 *       merge the approval; no approved script = the fallback with a new skip code; the pilot
 *       2026-11-09 to 2026-11-22] | @implemented [2026-11-02, authored scripts 2026-11-02]
 *
 * plain English: `qotdBreakdownScriptSchema` is one authored script,
 * qotd-breakdowns/<YYYY-Www>/<qotd_date>/script.json in the private repo
 * Lyceon-Team/lyceon-content-private (Karl, 2026-11-03; never in this public repo): the QOTD date, the
 * question id, the day's stored option order (canonical keys, as qotd_schedule.option_order) and
 * correct display letter, and the spoken script in the worked examples' own field schemas
 * (workedExampleScriptSchema: hook line and voice, setup, steps, trap, answer). The order and
 * letter are copied from the owner-run schedule export (qotdBreakdownScheduleSchema) and must
 * equal the archive's stored row at render time, or nothing is rendered (order_mismatch).
 * `qotdBreakdownScheduleSchema` is that export: the next days' schedule, JSON from
 * scripts/qotd-social/breakdown-schedule.sql. It carries FUTURE answers: it is read from a path
 * outside the repository and never committed, posted or logged.
 * `qotdBreakdownManifestSchema` is breakdown.json, written by
 * scripts/qotd-social/breakdown.ts build and read by its `post` step. Three shapes: `built` (the
 * MP4 and its captions), `skipped` (a stable code; the poster posts yesterday's answer slide and
 * "Breakdown skipped: <reason>") and `inactive` (outside the pilot window: nothing is posted).
 * The captions open with the headline, as every SCL-262 caption does. Strict throughout.
 */
import { z } from "zod";
import {
  previousQotdDate,
  qotdDateSchema,
  qotdOptionKeySchema,
} from "./qotd-schema";
import { masterySectionSchema } from "./mastery-levels";
import {
  workedExamplePostSchema,
  workedExampleQuestionIdSchema,
  workedExampleScriptSchema,
} from "./worked-example-schema";

/** The pilot runs at most this many days, start and end included (Karl: "2 weeks"). */
export const QOTD_BREAKDOWN_PILOT_MAX_DAYS = 14;

/**
 * The pilot window: both dates null (off, the default) or both set, end on or after start and at
 * most 14 days in all. Dates are QOTD posting days (the day the breakdown of the day before
 * posts).
 */
export const qotdBreakdownPilotSchema = z
  .object({ start: qotdDateSchema.nullable(), end: qotdDateSchema.nullable() })
  .strict()
  .refine((p) => (p.start === null) === (p.end === null), {
    message: "set both dates or neither",
  })
  .refine(
    (p) => {
      if (p.start === null || p.end === null) return true;
      const days =
        (Date.parse(`${p.end}T00:00:00Z`) -
          Date.parse(`${p.start}T00:00:00Z`)) /
          86_400_000 +
        1;
      return days >= 1 && days <= QOTD_BREAKDOWN_PILOT_MAX_DAYS;
    },
    { message: "the end is on or after the start, 14 days at most" },
  );
export type QotdBreakdownPilot = z.infer<typeof qotdBreakdownPilotSchema>;

/** Where a posting day sits against the window. Only `active` builds and posts. */
export const QOTD_BREAKDOWN_WINDOWS = [
  "off",
  "not_started",
  "active",
  "ended",
  "paused",
] as const;
export const qotdBreakdownWindowSchema = z.enum(QOTD_BREAKDOWN_WINDOWS);
export type QotdBreakdownWindow = z.infer<typeof qotdBreakdownWindowSchema>;

/**
 * Why a day's breakdown was skipped: one stable code per reason (Karl's fallback rule, approved
 * as written; amended by his 2026-11-02 rulings on #1398: the script is authored, so the codes
 * that judged the stored explanation as a script (letter_named, no_explanation, too_many_steps)
 * are gone, and a day with no approved script is `no_approved_script`).
 */
export const QOTD_BREAKDOWN_SKIP_CODES = [
  // (a) the voiced script over 60 s, or under the 30 s the MP4 check requires; the MP4 check
  "script_too_long",
  "script_too_short",
  "mp4_check_failed",
  // (c) unsuitable for a QOTD breakdown (the QOTD's own readability rules, and grid-ins)
  "grid_in",
  "too_long_to_read",
  "paired_passage",
  "stem_repeats_passage",
  // (d) a check failed
  "content_rules",
  "voice_check_failed",
  "hyperframes_check_failed",
  "layout_check_failed",
  "render_failed",
  // nothing to break down
  "withheld",
  "no_approved_script",
  "order_mismatch",
  "build_failed",
] as const;
export const qotdBreakdownSkipCodeSchema = z.enum(QOTD_BREAKDOWN_SKIP_CODES);
export type QotdBreakdownSkipCode = z.infer<typeof qotdBreakdownSkipCodeSchema>;

/** Four distinct canonical keys: a stored MCQ order (qotd_schedule.option_order). */
const storedOrderSchema = z
  .array(qotdOptionKeySchema)
  .length(4)
  .refine((o) => new Set(o).size === 4, {
    message: "the stored order names each canonical key once",
  });

/**
 * One authored breakdown script. The spoken fields are the worked examples' own
 * (workedExampleScriptSchema), so the same hook, notepad and trap limits apply.
 */
export const qotdBreakdownScriptSchema = workedExampleScriptSchema
  .extend({
    /** The QOTD day it breaks down (it posts the day after). */
    qotd_date: qotdDateSchema,
    /** The scheduled question, by id only (its text is read from the seed SQL, never copied). */
    question_id: workedExampleQuestionIdSchema,
    /** The day's stored order: canonical keys in the order shown under A-D (SCL-258). */
    option_order: storedOrderSchema,
    /** The day's stored correct_display_letter: the letter the correct choice is shown under. */
    correct_display_letter: qotdOptionKeySchema,
  })
  .strict();
export type QotdBreakdownScript = z.infer<typeof qotdBreakdownScriptSchema>;

/**
 * The owner-run schedule export (scripts/qotd-social/breakdown-schedule.sql): one row per
 * scheduled day after today, in date order. A grid-in has an empty order and no letter.
 */
export const qotdBreakdownScheduleSchema = z
  .array(
    z
      .object({
        qotd_date: qotdDateSchema,
        question_id: z.string().min(1),
        option_order: z.union([
          storedOrderSchema,
          z.array(z.string()).length(0),
        ]),
        correct_display_letter: qotdOptionKeySchema.nullable(),
        section: masterySectionSchema,
      })
      .strict()
      .refine(
        (r) =>
          (r.option_order.length === 0) === (r.correct_display_letter === null),
        { message: "an order has a letter; a grid-in has neither" },
      ),
  )
  .refine(
    (rows) =>
      rows.every(
        (r, k) => k === 0 || r.qotd_date > (rows[k - 1]?.qotd_date ?? ""),
      ),
    { message: "one row per day, in date order" },
  );
export type QotdBreakdownSchedule = z.infer<typeof qotdBreakdownScheduleSchema>;

/** The MP4's file name: the QOTD day it breaks down. */
export const qotdBreakdownVideoSchema = z
  .string()
  .regex(/^qotd-\d{4}-\d{2}-\d{2}-breakdown\.mp4$/);

/** Yesterday's answer slide, as the QOTD run wrote it (the TikTok carousel's slide 3). */
export const qotdBreakdownAnswerSlideSchema = z
  .string()
  .regex(/^qotd-\d{4}-\d{2}-\d{2}-tiktok-3\.png$/);

const dayShape = {
  /** The QOTD day broken down: yesterday. */
  qotd_date: qotdDateSchema,
  /** The day it posts: the QOTD day after it. */
  posted_on: qotdDateSchema,
};

export const qotdBreakdownManifestSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("built"),
        ...dayShape,
        /** The canonical section ('M' | 'RW'); its long form is rendered only in the label and captions. */
        section: masterySectionSchema,
        video: qotdBreakdownVideoSchema,
        /** The run's label, outside the copy blocks: "QOTD breakdown · 2026-10-03". */
        label: z.string().min(1),
        /** The captions' headline (SCL-262). */
        headline: z.string().min(1),
        caption: z.string().min(1),
        instagram_caption: z.string().min(1),
        facebook_caption: z.string().min(1),
        keywords: z.array(z.string().min(1)).min(1),
        warnings: z.array(z.string().min(1)),
        /** The stored order and letter the video shows (SCL-258), for the record. */
        option_order: z.array(qotdOptionKeySchema).length(4),
        display_letter: qotdOptionKeySchema,
        /** The scheduled question the approved script names. */
        question_id: workedExampleQuestionIdSchema,
        duration_seconds: z.number().min(30).max(60),
        /** Karl's merge of the script, from GitHub's record (the worked examples' approval). */
        approval: workedExamplePostSchema.innerType().shape.approval,
      })
      .strict(),
    z
      .object({
        status: z.literal("skipped"),
        ...dayShape,
        code: qotdBreakdownSkipCodeSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("inactive"),
        ...dayShape,
        window: qotdBreakdownWindowSchema.exclude(["active"]),
      })
      .strict(),
  ])
  .superRefine((m, ctx) => {
    if (previousQotdDate(m.posted_on) !== m.qotd_date)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qotd_date"],
        message:
          "a breakdown is of the day before it posts, never the same day",
      });
    if (m.status !== "built") return;
    for (const key of [
      "caption",
      "instagram_caption",
      "facebook_caption",
    ] as const) {
      if (!m[key].startsWith(`${m.headline}\n`))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "must open with the headline",
        });
    }
    if (m.video !== `qotd-${m.qotd_date}-breakdown.mp4`)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["video"],
        message: "the video is the broken-down day's",
      });
  });
export type QotdBreakdownManifest = z.infer<typeof qotdBreakdownManifestSchema>;
