/**
 * Worked examples: the content file a weekly batch carries, the monthly plan, the committed
 * voice manifest and the Slack post.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): hook library (five
 *       types), cadence (monthly plan PR; weekly batch PR of 3 examples into `social`; Karl merges),
 *       the labelled Slack set; Step 0 rulings (Karl, 2026-10-27): 2 puzzle hooks, 3 post_on + a
 *       daily job, 4 render from the merged content file + seed SQL, 5 voice audio committed at
 *       batch time, 6 a per-skill style table; SCL-267 (Karl's rulings 2026-11-02, script and
 *       voice): spoken order hook → setup → steps → trap → answer and check → call to action
 *       (replacing the brief's hook → question → steps → answer → "The trap:"), and the voice
 *       never reads the on-screen text] | @implemented [2026-10-27, spoken order 2026-11-02]
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

/**
 * A drawn figure for a geometry or graph question: the shapes the opening scene draws stroke by
 * stroke, and the ones the solution adds to the same drawing.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" item 7: "SVG stroke animation in
 *       HyperFrames, approved. For geometry and graph questions, the opening scene draws the
 *       figure (triangle, cylinder, cone, circle, graph) stroke by stroke in the notepad style,
 *       with the question's labels, and the solution builds on that same drawing. CPU only. The
 *       Manim pilot stays reference only."] | @implemented [2026-11-11]
 *
 * plain English: coordinates are the question's own units, y up, inside `box`; the renderer
 * (scripts/worked-examples/figure.ts) scales them into the figure area under the notepad. Each
 * shape says WHEN it is drawn: "open" (the default: during the hook and setup, in the order
 * listed), "step-N" (as step N is written) or "answer". Cylinder and cone are drawn as their
 * outlines with the hidden back edge dashed; `graph` is y = a·x² + b·x + c over `x`. Labels are
 * short handwriting. shared/worked-examples/rules.ts F1-F3 check the figure against the
 * question: every shape inside the box, every "step-N" a real step, and no opening label shows a
 * number the question does not give (the figure never gives the answer away before the work).
 */
const figurePoint = z.tuple([z.number().finite(), z.number().finite()]);
const figureRange = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([a, b]) => b > a, { message: "a range must run low to high" });
export const WORKED_EXAMPLE_FIGURE_WHEN = [
  "open",
  "step-1",
  "step-2",
  "step-3",
  "step-4",
  "step-5",
  "step-6",
  "answer",
] as const;
const figureWhen = z.enum(WORKED_EXAMPLE_FIGURE_WHEN).optional();
const positive = z.number().finite().positive();
export const workedExampleFigureShapeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("segment"),
      from: figurePoint,
      to: figurePoint,
      dashed: z.boolean().optional(),
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("polygon"),
      points: z.array(figurePoint).min(3).max(8),
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("polyline"),
      points: z.array(figurePoint).min(2).max(64),
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("circle"),
      center: figurePoint,
      r: positive,
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("right_angle"),
      /** The corner, and a point along each of its two sides. */
      vertex: figurePoint,
      a: figurePoint,
      b: figurePoint,
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cylinder"),
      /** The centre of the base. */
      base: figurePoint,
      r: positive,
      h: positive,
      /** The ellipses' half-height (the perspective), in the box's units. */
      ry: positive,
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cone"),
      base: figurePoint,
      r: positive,
      h: positive,
      ry: positive,
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("axes"),
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("graph"),
      /** y = a·x² + b·x + c, drawn over x[0]..x[1]. */
      a: z.number().finite(),
      b: z.number().finite(),
      c: z.number().finite(),
      x: figureRange,
      when: figureWhen,
    })
    .strict(),
  z
    .object({
      kind: z.literal("label"),
      text: z
        .string()
        .trim()
        .min(1)
        .max(16)
        .regex(/^[^\n]+$/),
      at: figurePoint,
      when: figureWhen,
    })
    .strict(),
]);
export type WorkedExampleFigureShape = z.infer<
  typeof workedExampleFigureShapeSchema
>;
export type WorkedExampleFigureWhen =
  (typeof WORKED_EXAMPLE_FIGURE_WHEN)[number];

export const workedExampleFigureSchema = z
  .object({
    box: z.object({ x: figureRange, y: figureRange }).strict(),
    shapes: z.array(workedExampleFigureShapeSchema).min(1).max(24),
  })
  .strict();
export type WorkedExampleFigure = z.infer<typeof workedExampleFigureSchema>;

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
    /**
     * The one-sentence SETUP, in plain talk, spoken while the question card is on screen: what
     * the question is about, never a reading of it (SCL-267, Karl's ruling 2026-11-02; the key
     * keeps its name so the W45 batch still parses, where it held a reading of the question).
     * shared/worked-examples/rules.ts refuses any run of 6 words it shares with the screen.
     */
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
        /** Spoken last, after the trap: the answer and a quick check (SCL-267). */
        voice: line,
      })
      .strict(),
    trap: z
      .object({
        /** The trap in one sentence (the database's `trap`). */
        summary: line,
        /** Written under the fixed "The trap:" heading. */
        notepad: z.array(notepadLine).min(1).max(3),
        /** Spoken before the answer (SCL-267); opens "The trap" or "Here's where people slip". */
        voice: line,
      })
      .strict(),
    /** How to confirm the answer (the database's check_step). */
    check: line,
    takeaway: line,
    /** The drawn figure, for geometry and graph questions (Karl, 2026-11-11). */
    figure: workedExampleFigureSchema.optional(),
    /** A retired example never posts; its row is seeded as 'retired'. */
    retired: z.literal(true).optional(),
  })
  .strict();
export type WorkedExampleContent = z.infer<typeof workedExampleContentSchema>;

/**
 * The spoken script alone: what the composition draws and the voice says, and what the script
 * rules (shared/worked-examples/rules.ts S1, S2, H1-H6, the trap opener) read. A worked example is
 * one (its content file carries these keys, plus the fields only a worked example has); a QOTD
 * breakdown script is another (packages/shared/src/qotd-breakdown-schema.ts).
 *
 * @spec [SCL-266 as ruled by Karl 2026-11-02 (#1398): "replace the templated script with
 *       authored scripts", under the same content rules as worked examples, reusing the
 *       worked-example functions rather than forking them] | @implemented [2026-11-02]
 *
 * plain English: the same field schemas as workedExampleContentSchema, picked from it (never
 * re-declared), so a change to a worked example's hook, step, answer or trap rules is a change to
 * the breakdown's too. Dropped: the hook type, the answer letter (a breakdown names its letter as
 * correct_display_letter, the stored row's), the trap summary.
 */
export const workedExampleScriptSchema = z
  .object({
    hook: workedExampleContentSchema.shape.hook.pick({
      line: true,
      voice: true,
    }),
    question_voice: workedExampleContentSchema.shape.question_voice,
    steps: workedExampleContentSchema.shape.steps,
    answer: workedExampleContentSchema.shape.answer.pick({
      notepad: true,
      voice: true,
    }),
    trap: workedExampleContentSchema.shape.trap.pick({
      notepad: true,
      voice: true,
    }),
  })
  .strict();
export type WorkedExampleScript = z.infer<typeof workedExampleScriptSchema>;

/**
 * The spoken lines, in spoken order (SCL-267, Karl's ruling 2026-11-02): the hook, the setup
 * (`question_voice`), the steps, the trap, then the answer with its quick check. The call to
 * action on the end card is the kit's line, not the example's. A manifest voiced before the
 * ruling lists the same keys in the old order (answer before trap); lines are matched by key.
 */
export const WORKED_EXAMPLE_VOICE_LINES = [
  "hook",
  "question",
  "steps",
  "trap",
  "answer",
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

/** The words a line was heard to say, with times (the committed transcription). */
export const voiceWordsSchema = z.array(voiceWordSchema).min(1);

export const voiceLineSchema = z
  .object({
    /** hook, question (the setup), step-1..step-6, trap, answer; outro for the kit's line. */
    key: z.string().regex(/^(hook|question|step-[1-6]|answer|trap|outro)$/),
    /** sha256 of the exact text that was voiced. */
    text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    file: z.string().regex(/^[a-z0-9-]+\.wav$/),
    duration: z.number().positive(),
    words: voiceWordsSchema,
    /**
     * Set only when this line is NOT in the manifest's voice: a clone line that failed the quality
     * checks and was re-spoken in the fallback voice (OpenVoice addendum, Karl, 2026-10-27).
     */
    voice: z.string().min(1).optional(),
    /** Why the clone line was replaced; present exactly when `voice` is. */
    fallback_reasons: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine(
    (l) => (l.voice === undefined) === (l.fallback_reasons === undefined),
    {
      message: "a fallback line records both its voice and its reasons",
    },
  );
export type VoiceLine = z.infer<typeof voiceLineSchema>;

export const voiceManifestSchema = z
  .object({
    /** The voice profile the batch was spoken in (video-kit/worked-examples/voice.json profiles). */
    voice: z.string().min(1),
    /**
     * The profile's speaking_rate when the batch was voiced (Karl, 2026-10-27). Absent in batches
     * voiced before the setting existed, which were all spoken at 1.0.
     */
    speaking_rate: z.number().min(0.5).max(2).optional(),
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

/**
 * The Slack set for one example (post.json, written by the daily job only after every check).
 *
 * @spec [SCL-265 (Karl's ruling 2026-11-02): the worked-example set in the SCL-262 format: one
 *       caption per platform, TikTok keywords, the run's warnings; the title is the captions'
 *       headline] | @implemented [2026-10-27, SCL-262 format 2026-11-02]
 *
 * plain English: every caption opens with the title (the headline). `links` stays in post.json
 * for the run's download, as the QOTD's does (SCL-262): it is never posted in the message.
 */
export const workedExamplePostSchema = z
  .object({
    id: z.string().regex(/^we-[a-z0-9]+$/),
    post_on: isoDate,
    /** "Worked example · Percentages · obvious_answer_trap". */
    label: z.string().min(1),
    video: z.string().regex(/^[a-z0-9-]+\.mp4$/),
    /** The captions' headline: "SAT Math worked example · Percentages". */
    title: z.string().min(1).max(WORKED_EXAMPLE_TITLE_MAX).startsWith("SAT"),
    /** The TikTok caption. */
    caption: z.string().min(1),
    instagram_caption: z.string().min(1),
    facebook_caption: z.string().min(1),
    /** TikTok's "Manage keywords", one per entry (shared/social/posts.ts socialKeywords). */
    keywords: z.array(z.string().min(1)).min(1),
    /** QA warnings posted first, outside the copy blocks ("SAT date list needs updating"). */
    warnings: z.array(z.string().min(1)),
    /** The tagged /start links: kept for the run's download, never posted (SCL-262). */
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
  .strict()
  .superRefine((post, ctx) => {
    for (const key of [
      "caption",
      "instagram_caption",
      "facebook_caption",
    ] as const) {
      if (!post[key].startsWith(`${post.title}\n`))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "must open with the title (the headline)",
        });
    }
  });
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
