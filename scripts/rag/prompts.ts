/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 C (content gate, Karl 2026-10-13; description
 *       rules; boundary_confidence) and §D.2 D (tagging constrained to the 29 taxonomy names);
 *       §D.6 (a confidently wrong description from a bad auto-caption is the failure that
 *       matters)] | @implemented [2026-10-15]
 *
 * plain English: the three prompts of the build-time pipeline and their response schemas, in
 * one place so they can be read and reviewed together. `PROMPT_VERSION` is stamped on every
 * cached result; changing any prompt means bumping it, which invalidates the cache.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { proposedSegmentSchema, windowAssessmentSchema } from "./segments";

export const GATE_SYSTEM = `You review one window of a transcript from an SAT preparation video, for Lyceon, an SAT practice platform. The window was cut at a fixed time, not at a topic boundary. Decide three things.

1. teaches_sat_content: does this window teach SAT content a student would practise? That means a math or reading-and-writing concept, method, or worked example, including how to do it in the Desmos graphing calculator. Answer false for channel promotion, sponsorship, advertisements for a course or tutoring, greetings or sign-offs with no teaching in them, test registration or admissions logistics, and general motivation. A window that mixes a short intro or outro with real teaching is true.

2. starts_mid_explanation: does the window begin partway through an explanation (a worked example, a derivation, or a multi-step procedure) that started before it? Use the text just before the window to judge.

3. ends_mid_explanation: does the window end partway through such an explanation, with its next steps continuing after the window? Use the text just after the window to judge. A window that ends after a complete step, right before a new example or a new topic, does not end mid-explanation.

gate_reason: one short sentence, at most 20 words, saying why the window does or does not teach SAT content. Do not quote the transcript.`;

export const gateResponseSchema = {
  type: "OBJECT",
  properties: {
    teaches_sat_content: { type: "BOOLEAN" },
    gate_reason: { type: "STRING" },
    starts_mid_explanation: { type: "BOOLEAN" },
    ends_mid_explanation: { type: "BOOLEAN" },
  },
  required: [
    "teaches_sat_content",
    "gate_reason",
    "starts_mid_explanation",
    "ends_mid_explanation",
  ],
} as const;
export const gateSchema = windowAssessmentSchema;

export const DESCRIBE_SYSTEM = `You write the index text for one segment of an SAT preparation video. Lyceon stores your text, never the video's words. A student's question is matched against your text, and the student is then offered this segment of the video.

Return:
- description: two to four sentences stating what this segment teaches, written as instructional content: the concept, the method, and the condition under which it applies. Write as though explaining the concept directly to a student. Never say "the speaker", "the instructor", "the video", "in this video" or "this segment", and never attribute anything to a person. Never quote the transcript beyond a single technical term or a formula. If the segment teaches nothing self-contained, return null for description.
- concepts: at most six short names of the concepts covered.
- starts_mid_explanation and ends_mid_explanation: whether the segment begins or ends partway through a worked example, derivation or multi-step procedure, judged from the segment and the text around it.

The transcript is automatic captions and contains errors, especially in numbers and mathematical notation. Never state a number, formula or mathematical fact you cannot confirm is correct from the context. Describe the method instead of repeating a value that may be garbled.`;

export const describeResponseSchema = {
  type: "OBJECT",
  properties: {
    description: { type: "STRING", nullable: true },
    concepts: { type: "ARRAY", items: { type: "STRING" } },
    starts_mid_explanation: { type: "BOOLEAN" },
    ends_mid_explanation: { type: "BOOLEAN" },
  },
  required: [
    "description",
    "concepts",
    "starts_mid_explanation",
    "ends_mid_explanation",
  ],
} as const;
export const describeSchema = z.object({
  description: z.string().nullable(),
  concepts: z.array(z.string()).max(6),
  starts_mid_explanation: z.boolean(),
  ends_mid_explanation: z.boolean(),
});
export type DescribeResult = z.infer<typeof describeSchema>;

export const TAG_SYSTEM = `Choose the SAT skills that a segment of an SAT preparation video teaches. You are given the segment's description, its concepts and the video's title. Choose from the list in the response schema only: one to three skills that a student practising them would benefit from this segment for. Choose only skills the segment actually teaches, not skills it merely mentions. If none fits, return an empty list.`;

export function tagResponseSchema(
  skills: readonly string[],
): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      skill_codes: {
        type: "ARRAY",
        items: { type: "STRING", enum: [...skills] },
      },
    },
    required: ["skill_codes"],
  };
}
export function tagSchema(
  skills: readonly [string, ...string[]],
): z.ZodType<{ skill_codes: string[] }> {
  return z.object({ skill_codes: z.array(z.enum(skills)).max(3) });
}

// ── Video source (R-14, Karl 2026-10-15: Gemini reads the video; replaces §D.2 B for
// tiers that teach on screen). The model watches the video, so on-screen work counts. ──

export const SEGMENT_VIDEO_SYSTEM = `You segment an SAT preparation video into the units a student would be sent to. Watch the whole video, using what is shown on screen as well as what is said: in a calculator lesson the method is what is typed and done on screen.

Return segments that tile the video from 0 to its end, in order, with no gaps or overlaps. Cut only between problems, worked examples or concepts, never inside one: a segment starts where a problem or idea is introduced and ends once its result is reached. Reading a problem, setting it up, working it (for example, entering it in Desmos), reading off the result and checking it are ONE segment, not several. Two short problems may share a segment. Only when a single problem's explanation runs longer than 180 seconds, cut it at its clearest completed step.

teaches_sat_content: true when the segment teaches SAT content a student would practise (a math or reading-and-writing concept, method or worked example, including how to do it in the Desmos graphing calculator). False for intros, channel promotion, sponsorship, course or tutoring advertisements, sign-offs, test registration or admissions logistics, and general motivation. A segment that mixes a few seconds of intro or outro with real teaching is true.

summary: one sentence, at most 20 words, naming what the segment covers, or why it does not teach. Do not quote the speaker. Times are whole seconds from the start of the video.`;

export const segmentResponseSchema = {
  type: "OBJECT",
  properties: {
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          start_seconds: { type: "INTEGER" },
          end_seconds: { type: "INTEGER" },
          teaches_sat_content: { type: "BOOLEAN" },
          summary: { type: "STRING" },
        },
        required: [
          "start_seconds",
          "end_seconds",
          "teaches_sat_content",
          "summary",
        ],
      },
    },
  },
  required: ["segments"],
} as const;
export const segmentSchema = z.object({
  segments: z.array(proposedSegmentSchema),
});

export const DESCRIBE_VIDEO_SYSTEM = `You watch one segment of an SAT preparation video and write its index text. Lyceon stores your text, never the video's words. A student's question is matched against your text, and the student is then offered this segment of the video.

Return:
- description: two to four sentences stating what this segment teaches, written as instructional content: the concept, the method and the condition under which it applies. Where the method is done on screen (for example, in the Desmos graphing calculator), describe the steps a student would take, as the video shows them. Write as though explaining the concept directly to a student. Never say "the speaker", "the instructor", "the video", "in this video" or "this segment", and never attribute anything to a person. Do not quote the speaker. If the segment teaches nothing self-contained, return null for description.
- concepts: at most six short names of the concepts covered.
- starts_mid_explanation and ends_mid_explanation: whether the segment opens partway through a worked example, derivation or multi-step procedure that began before it, or stops before that explanation reaches its result.

Never state a number, formula or mathematical fact you cannot read clearly or confirm from the segment. Describe the method rather than a value you are unsure of.`;

/**
 * The boundary tie-break: run only when the describe call says a segment starts or ends
 * mid-explanation, contradicting the whole-video segmentation that placed that cut. The
 * model watches 20 s either side of the cut and decides whether one explanation spans it.
 */
export const BOUNDARY_VIDEO_SYSTEM = `You check one cut point in an SAT preparation video. The clip runs about 20 seconds either side of the cut. Decide whether a single worked example, derivation or multi-step procedure is in progress across the cut: begun before it and continued after it, so that cutting there would split the explanation. If one problem's result is reached and a new problem, step-by-step topic or recap begins at or near the cut, the explanation does not span the cut. Give a reason of at most 20 words.`;

export const boundaryResponseSchema = {
  type: "OBJECT",
  properties: {
    explanation_spans_cut: { type: "BOOLEAN" },
    reason: { type: "STRING" },
  },
  required: ["explanation_spans_cut", "reason"],
} as const;
export const boundarySchema = z.object({
  explanation_spans_cut: z.boolean(),
  reason: z.string(),
});

/**
 * The tag audit: an independent check of the tagging, made by watching the segment rather
 * than reading the description the tagger saw. Each assigned skill is judged taught,
 * mentioned only, or absent. It measures over-tagging; it does not replace Karl's sample.
 */
export const TAG_AUDIT_SYSTEM = `You check skill tags on a segment of an SAT preparation video. Watch the segment. For each skill listed, decide whether the segment actually teaches it:
- "taught": the segment explains or works through this skill, so a student practising it would learn from the segment;
- "mentioned": the skill is named, used incidentally, or is a side remark, but the segment does not teach it;
- "absent": the skill does not appear.
Judge each skill on its own. Give a reason of at most 15 words for each.`;

export const tagAuditResponseSchema = {
  type: "OBJECT",
  properties: {
    verdicts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          skill: { type: "STRING" },
          verdict: { type: "STRING", enum: ["taught", "mentioned", "absent"] },
          reason: { type: "STRING" },
        },
        required: ["skill", "verdict", "reason"],
      },
    },
  },
  required: ["verdicts"],
} as const;
export const tagAuditSchema = z.object({
  verdicts: z.array(
    z.object({
      skill: z.string(),
      verdict: z.enum(["taught", "mentioned", "absent"]),
      reason: z.string(),
    }),
  ),
});
export type TagAudit = z.infer<typeof tagAuditSchema>;

export const PROMPT_VERSION = createHash("sha256")
  .update(
    [
      GATE_SYSTEM,
      DESCRIBE_SYSTEM,
      TAG_SYSTEM,
      SEGMENT_VIDEO_SYSTEM,
      DESCRIBE_VIDEO_SYSTEM,
      TAG_AUDIT_SYSTEM,
      BOUNDARY_VIDEO_SYSTEM,
    ].join("\u0000"),
  )
  .digest("hex")
  .slice(0, 12);

export function formatSeconds(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function lastWords(text: string, n: number): string {
  return text.split(/\s+/).slice(-n).join(" ");
}
export function firstWords(text: string, n: number): string {
  return text.split(/\s+/).slice(0, n).join(" ");
}
