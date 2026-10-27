/**
 * @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27) and its rulings
 *       1–6 of 2026-10-27; Doc-03B_V4.1 §6.3/§6.4 as amended by SCL-252; Doc-03B_V4.1 §6.5/§20.2
 *       as amended by SCL-253] | @implemented [2026-10-27]
 *
 * plain English: THE one definition of the review panel's guided choices, read by the client
 * (which buttons to draw, and the message a tap sends) and by the server (which `intent` a turn
 * may carry, and whether its message is that intent's label). One list, so the button a student
 * taps and the check the server runs cannot drift.
 *
 *  - `REVIEW_INTENTS`: the closed set. A turn typed by the student carries no intent.
 *  - `REVIEW_INTENT_LABELS`: the fixed label of each choice. A tap sends exactly this text as the
 *    message (ruling 1); the server rejects an intent whose message is anything else, so no text
 *    the student typed can ride on an intent.
 *  - Section: Desmos intents are math-only, `explain_rule` is Reading and Writing-only;
 *    `walkthrough` and `video_explanation` are both.
 *  - Phase B (`desmos_walkthrough`, `explain_rule`): hidden, and refused by the server, while the
 *    runtime flag `review_guided_choices_phase_b_enabled` is off (ruling 2: it stays off until
 *    Phase B's prompt work lands).
 *  - `VIDEO_INTENT_METHOD`: the two video intents and the video method each asks for
 *    (`packages/shared/src/video-methods.ts`). They are served by the server with no model call.
 *
 * Nothing here is recorded as anything but the intent code itself (ruling 5): no memory field,
 * no `preferred_explanation_style`, no `explanation_form`, no mastery.
 */
import { z } from "zod";
import type { VideoMethod } from "./video-methods";

export const REVIEW_INTENTS = [
  "walkthrough",
  "desmos_walkthrough",
  "explain_rule",
  "video_desmos",
  "video_explanation",
] as const;
export const reviewIntentSchema = z.enum(REVIEW_INTENTS);
export type ReviewIntent = z.infer<typeof reviewIntentSchema>;

/** The text a tap sends, and the only message the server accepts with that intent. */
export const REVIEW_INTENT_LABELS: Readonly<Record<ReviewIntent, string>> = {
  walkthrough: "Walk me through it",
  desmos_walkthrough: "Show me on Desmos",
  explain_rule: "Explain the rule",
  video_desmos: "Desmos video",
  video_explanation: "Explanation video",
};

/** `questions.section`: math or Reading and Writing. */
export type QuestionSection = "M" | "RW";

/** Each section's choices, in the order the panel shows them (owner brief). */
const SECTION_CHOICES: Readonly<
  Record<QuestionSection, readonly ReviewIntent[]>
> = {
  M: ["walkthrough", "desmos_walkthrough", "video_desmos", "video_explanation"],
  RW: ["walkthrough", "explain_rule", "video_explanation"],
};

/** Built behind the flag; hidden and refused while it is off. */
export const PHASE_B_INTENTS: ReadonlySet<ReviewIntent> = new Set([
  "desmos_walkthrough",
  "explain_rule",
]);

export type VideoIntent = "video_desmos" | "video_explanation";

/** The video method each video intent asks for. */
export const VIDEO_INTENT_METHOD: Readonly<Record<VideoIntent, VideoMethod>> = {
  video_desmos: "desmos",
  video_explanation: "algebraic",
};

export function isVideoIntent(intent: ReviewIntent): intent is VideoIntent {
  return intent === "video_desmos" || intent === "video_explanation";
}

/** The choices a review item of this section offers, in order. Pure. */
export function guidedChoicesFor(
  section: QuestionSection,
  phaseBEnabled: boolean,
): ReviewIntent[] {
  return SECTION_CHOICES[section].filter(
    (intent) => phaseBEnabled || !PHASE_B_INTENTS.has(intent),
  );
}

/** True only when the message is exactly the intent's label (no trimming, no case folding). */
export function isExactIntentLabel(
  intent: ReviewIntent,
  message: string,
): boolean {
  return message === REVIEW_INTENT_LABELS[intent];
}

/** What GET /api/tutor/guided-choices returns: the choices this review item offers now. */
export const guidedChoicesResponseSchema = z.object({
  intents: z.array(reviewIntentSchema),
});
export type GuidedChoicesResponse = z.infer<typeof guidedChoicesResponseSchema>;
