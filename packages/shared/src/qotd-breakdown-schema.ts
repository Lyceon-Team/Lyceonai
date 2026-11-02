/**
 * The QOTD breakdown pilot: the pilot window, the skip codes and the manifest the build hands
 * the Slack poster.
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): a breakdown
 *       video of YESTERDAY's QOTD each day, from the stored option order and display letter,
 *       dropped into #social for review (Karl's manual posting is the approval; nothing
 *       auto-publishes); the fallback rule (a)-(d), each reason with a stable code; a 14-day
 *       window with dates Karl sets, off by default; SCL-266] | @implemented [2026-11-02]
 *
 * plain English: `qotdBreakdownManifestSchema` is breakdown.json, written by
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
 * as written). (a) length, (b) a letter named, (c) unsuitable, (d) a check failed; plus the days
 * there is nothing to break down.
 */
export const QOTD_BREAKDOWN_SKIP_CODES = [
  // (a) the voiced script over 60 s, or under the 30 s the MP4 check requires; the MP4 check
  "script_too_long",
  "script_too_short",
  "mp4_check_failed",
  // (b) the stored explanation or a choice names a letter (wrong under the shuffled order)
  "letter_named",
  // (c) unsuitable for a QOTD breakdown (the QOTD's own readability rules, and grid-ins)
  "grid_in",
  "too_long_to_read",
  "paired_passage",
  "stem_repeats_passage",
  "no_explanation",
  "too_many_steps",
  // (d) a check failed
  "content_rules",
  "voice_check_failed",
  "hyperframes_check_failed",
  "layout_check_failed",
  "render_failed",
  // nothing to break down
  "withheld",
  "order_mismatch",
  "build_failed",
] as const;
export const qotdBreakdownSkipCodeSchema = z.enum(QOTD_BREAKDOWN_SKIP_CODES);
export type QotdBreakdownSkipCode = z.infer<typeof qotdBreakdownSkipCodeSchema>;

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
        duration_seconds: z.number().min(30).max(60),
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
