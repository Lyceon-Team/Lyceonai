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
import { windowAssessmentSchema } from "./segments";

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

export const PROMPT_VERSION = createHash("sha256")
  .update([GATE_SYSTEM, DESCRIBE_SYSTEM, TAG_SYSTEM].join("\u0000"))
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
