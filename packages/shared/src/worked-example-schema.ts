/**
 * Worked examples: the content file a weekly batch carries, the monthly plan, the committed
 * voice manifest and the Slack post.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): video order (hook →
 *       question → steps → answer near the end → "The trap:" → end card), hook library (five
 *       types), cadence (monthly plan PR; weekly batch PR of 3 examples into `social`; Karl merges),
 *       the labelled Slack set; Step 0 rulings (Karl, 2026-10-27): 2 puzzle hooks, 3 post_on + a
 *       daily job, 4 render from the merged content file + seed SQL, 5 voice audio committed at
 *       batch time, 6 a per-skill style table] | @implemented [2026-10-27]
 *
 * plain English: one file per example, content/worked-examples/<YYYY-Www>/<question_id>/example.json,
 * on `social`. It names the question by id only: the question text, choices and key are read from
 * the seed SQL that created the question (scripts/worked-examples/seed-question.ts), never copied.
 * Every spoken line is written out here and voiced once at batch time; the voice manifest records
 * a hash of each line's text, so audio that no longer matches its script fails the checks.
 * The database row (supabase/migrations/20261118000000_worked_examples.sql) mirrors this file and
 * is written only by the generated seed SQL. Approval is not a field: it is Karl's merge of the
 * batch pull request, read from GitHub's record (shared/worked-examples/approval.ts).
 */
import { z } from "zod";
import { socialStartLinksSchema } from "./qotd-schema";

/** The hook library (Karl, 2026-10-27); the table's CHECK holds the same five. */
export const WORKED_EXAMPLE_HOOK_TYPES = [
  "puzzle",
  "obvious_answer_trap",
  "speed",
  "challenge",
  "contrarian",
] as const;
export const workedExampleHookTypeSchema = z.enum(WORKED_EXAMPLE_HOOK_TYPES);
export type WorkedExampleHookType = z.infer<typeof workedExampleHookTypeSchema>;

export const WORKED_EXAMPLE_STEPS_MIN = 3;
export const WORKED_EXAMPLE_STEPS_MAX = 6;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const line = z.string().trim().min(1);
/** A notepad line is handwritten on screen: one short line, no line breaks. */
const notepadLine = line.max(32).regex(/^[^\n]+$/);

export const workedExampleQuestionIdSchema = z
  .string()
  .regex(/^SAT(M|RW)[12][A-Z0-9]{6}$/);

export const workedExampleStepSchema = z
  .object({ notepad: notepadLine, voice: line })
  .strict();
export type WorkedExampleStep = z.infer<typeof workedExampleStepSchema>;

export const workedExampleContentSchema = z
  .object({
    question_id: workedExampleQuestionIdSchema,
    /** The skill as the question bank names it (questions.skill_codes). */
    skill_code: line,
    post_on: isoDate,
    hook: z
      .object({
        type: workedExampleHookTypeSchema,
        /** On screen from frame 0, bold, above the question. */
        line: line.max(90).regex(/^[^\n]+$/),
        /** Spoken from 0:00. */
        voice: line,
      })
      .strict(),
    /** The spoken reading of the question while it is on screen. */
    question_voice: line,
    signature_move: line,
    steps: z
      .array(workedExampleStepSchema)
      .min(WORKED_EXAMPLE_STEPS_MIN)
      .max(WORKED_EXAMPLE_STEPS_MAX),
    answer: z
      .object({
        /** The choice letter the answer names; must be the question's key. */
        letter: z.enum(["A", "B", "C", "D"]),
        notepad: notepadLine,
        voice: line,
      })
      .strict(),
    trap: z
      .object({
        /** The trap in one sentence (the database's `trap`). */
        summary: line,
        /** Written under the fixed "The trap:" heading. */
        notepad: z.array(notepadLine).min(1).max(3),
        /** Spoken; starts "The trap". */
        voice: line,
      })
      .strict(),
    /** How to confirm the answer (the database's check_step). */
    check: line,
    takeaway: line,
    /** A retired example never posts; its row is seeded as 'retired'. */
    retired: z.literal(true).optional(),
  })
  .strict();
export type WorkedExampleContent = z.infer<typeof workedExampleContentSchema>;

/** The spoken lines, in screen order. The end card's line is the kit's, not the example's. */
export const WORKED_EXAMPLE_VOICE_LINES = [
  "hook",
  "question",
  "steps",
  "answer",
  "trap",
] as const;

/** One voiced line's committed timing: words as spoken, seconds from the line's start. */
export const voiceWordSchema = z
  .object({
    text: z.string().min(1),
    start: z.number().min(0),
    end: z.number().min(0),
  })
  .strict()
  .refine((w) => w.end >= w.start, { message: "a word ends before it starts" });

export const voiceLineSchema = z
  .object({
    /** hook, question, step-1..step-6, answer, trap. */
    key: z.string().regex(/^(hook|question|step-[1-6]|answer|trap|outro)$/),
    /** sha256 of the exact text that was voiced. */
    text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    file: z.string().regex(/^[a-z0-9-]+\.wav$/),
    duration: z.number().positive(),
    words: z.array(voiceWordSchema).min(1),
  })
  .strict();
export type VoiceLine = z.infer<typeof voiceLineSchema>;

export const voiceManifestSchema = z
  .object({
    voice: z.string().min(1),
    lines: z.array(voiceLineSchema).min(1),
  })
  .strict();
export type VoiceManifest = z.infer<typeof voiceManifestSchema>;

/** content/worked-examples/<YYYY-MM>-plan/plan.json: the month's slots, hook types rotating. */
export const workedExamplePlanSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    slots: z
      .array(
        z
          .object({
            post_on: isoDate,
            skill_code: line,
            hook_type: workedExampleHookTypeSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type WorkedExamplePlan = z.infer<typeof workedExamplePlanSchema>;

/** content/worked-examples/STYLE.json: the per-skill signature (ruling 6), approved by merge. */
export const workedExampleStyleSchema = z.record(
  z.string().min(1),
  z
    .object({
      signature_move: line,
      check: line,
      trap: line,
    })
    .strict(),
);
export type WorkedExampleStyle = z.infer<typeof workedExampleStyleSchema>;

export const WORKED_EXAMPLE_TITLE_MAX = 90;
export const WORKED_EXAMPLE_CAPTION_FIRST_LINE =
  "Follow for daily SAT questions 👆";

/** The Slack set for one example (post.json, written by the daily job only after every check). */
export const workedExamplePostSchema = z
  .object({
    id: z.string().regex(/^we-[a-z0-9]+$/),
    post_on: isoDate,
    /** "Worked example · Percentages · obvious_answer_trap". */
    label: z.string().min(1),
    video: z.string().regex(/^[a-z0-9-]+\.mp4$/),
    title: z.string().min(1).max(WORKED_EXAMPLE_TITLE_MAX).startsWith("SAT"),
    caption: z.string().startsWith(`${WORKED_EXAMPLE_CAPTION_FIRST_LINE}\n`),
    /** The Instagram caption (owner brief "One funnel for every social post", Karl, 2026-10-28). */
    instagram_caption: z
      .string()
      .startsWith(`${WORKED_EXAMPLE_CAPTION_FIRST_LINE}\n`),
    /** The tagged /start links: TikTok bio, and the one sent to people who comment SAT. */
    links: socialStartLinksSchema,
    approval: z
      .object({
        pr: z.number().int().positive(),
        mergedBy: z.string().min(1),
        mergeSha: z.string().regex(/^[0-9a-f]{40}$/),
        mergedAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type WorkedExamplePost = z.infer<typeof workedExamplePostSchema>;

/** content/worked-examples/posted.json: one line per example the daily job has posted. */
export const workedExamplePostedLedgerSchema = z.record(
  z.string().regex(/^we-[a-z0-9]+$/),
  z.object({ date: isoDate, run: z.string().min(1) }).strict(),
);
export type WorkedExamplePostedLedger = z.infer<
  typeof workedExamplePostedLedgerSchema
>;

/** The database id: 'we-' || lower(question_id) (the table's CHECK). */
export function workedExampleId(questionId: string): string {
  return `we-${questionId.toLowerCase()}`;
}
