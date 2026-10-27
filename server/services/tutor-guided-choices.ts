/**
 * @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27), build items
 *        1–2 and rulings 1–3 of 2026-10-27; Doc-03B_V4.1 §6.3/§6.4/§6.9 as amended by SCL-252;
 *        Doc-03B_V4.1 §6.5/§20.2 as amended by SCL-253; Doc-03D_V1.2 §6.7 as amended by the
 *        video-method SCLs (SCL-248/249)] | @implemented [2026-10-27]
 *
 * plain English: the server half of the review panel's guided choices.
 *  - `guidedChoicesForQuestion`: the choices a review item offers, from the question's own
 *    `section` (never the client's) and the Phase B flag. The GET the panel draws its buttons
 *    from and the turn's check below both use it, so a button the student sees is one the
 *    server will accept.
 *  - `checkTurnIntent`: an intent is accepted only on a review conversation scoped to a question,
 *    only when it is one of that question's choices (section and flag), and only when the message
 *    is exactly the intent's label (ruling 1). Anything else is `400 invalid_input`; it is never
 *    processed as free text.
 *  - `pickIntentVideo`: a video intent's one video. "Desmos video" asks for method `desmos` and
 *    serves the top match only if it IS a Desmos video; otherwise there is no match. "Explanation
 *    video" asks for `algebraic`; when the skill has no algebraic video, the ranking with that
 *    method is exactly the ranking with none (the method is the first sort key, false for every
 *    row), so the top row is already the brief's fallback ("no method and the normal ranking").
 *  - The fixed sentences a video intent is answered with. Server-written, no model call (build 2).
 *    Videos are served before and after submit alike (ruling 3): a library video teaches a skill,
 *    not this item's solution.
 *
 * Edge cases: a question with no `section`, or one outside {M, RW}, offers no choices and accepts
 * no intent. A DB error reading the section throws (the route's catch answers 500): an intent is
 * never accepted on a guess. Logs carry codes only, never message text.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  guidedChoicesFor,
  isExactIntentLabel,
  VIDEO_INTENT_METHOD,
  type QuestionSection,
  type ReviewIntent,
  type VideoIntent,
} from "../../packages/shared/src/tutor-guided-choices";
import { TutorConfig } from "./tutor-config";
import { sessionTablesFor } from "./tutor-context";
import {
  retrieveOfferedVideos,
  type LibraryVideo,
} from "./tutor-video-library";

/** The only surface the choices are offered on (owner brief: "the review LISA panel only"). */
export const GUIDED_CHOICE_SURFACE = "review";

/** The fixed reply to a video intent that found its video. */
export const VIDEO_INTENT_REPLY: Readonly<Record<VideoIntent, string>> = {
  video_desmos:
    "Here's a video that shows how to solve this kind of question on Desmos.",
  video_explanation:
    "Here's a video that explains the skill behind this question.",
};

/** The fixed reply to a video intent with no matching video. The panel shows the choices again. */
export const VIDEO_INTENT_NO_MATCH =
  "I don't have a video for this skill yet. Pick another way below, or ask me anything about the question.";

const sectionRowSchema = z
  .object({ section: z.string().nullable() })
  .nullable();

/** `questions.section` for a question row: "M", "RW", or null (unknown). Throws on a DB error. */
export async function resolveQuestionSection(
  questionRowId: string,
): Promise<QuestionSection | null> {
  const { data, error } = await supabaseServer
    .from("questions")
    .select("section")
    .eq("id", questionRowId)
    .maybeSingle();
  if (error) throw error;
  const section = sectionRowSchema.parse(data)?.section ?? null;
  return section === "M" || section === "RW" ? section : null;
}

/** The choices this question offers now (section and the Phase B flag). Throws on a DB error. */
export async function guidedChoicesForQuestion(
  questionRowId: string,
): Promise<ReviewIntent[]> {
  const section = await resolveQuestionSection(questionRowId);
  if (section === null) return [];
  return guidedChoicesFor(
    section,
    TutorConfig.get("review_guided_choices_phase_b_enabled"),
  );
}

/**
 * The choices a student's own review item offers. Null when the item is not theirs (or does not
 * exist): the route answers that as "no choices", never as another student's item.
 */
export async function guidedChoicesForReviewItem(
  studentId: string,
  sessionItemId: string,
): Promise<ReviewIntent[] | null> {
  const tables = sessionTablesFor(GUIDED_CHOICE_SURFACE);
  const { data, error } = await supabaseServer
    .from(tables.items)
    .select("question_id")
    .eq("id", sessionItemId)
    .eq(tables.owner, studentId)
    .maybeSingle();
  if (error) throw error;
  const questionId = z
    .object({ question_id: z.string().nullable() })
    .nullable()
    .parse(data)?.question_id;
  if (questionId === undefined || questionId === null) return null;
  return guidedChoicesForQuestion(questionId);
}

export type TurnIntentRefusal =
  | "not_review_surface"
  | "no_question_scope"
  | "label_mismatch"
  | "not_offered";

/**
 * Whether a turn may carry this intent. `surface` and `questionRowId` are the conversation's
 * STORED scope (never the client's supplement). The label check is pure and runs first, so a
 * mismatched message is refused without a DB read.
 */
export async function checkTurnIntent(input: {
  intent: ReviewIntent;
  message: string;
  surface: string;
  questionRowId: string | null;
}): Promise<{ ok: true } | { ok: false; reason: TurnIntentRefusal }> {
  if (!isExactIntentLabel(input.intent, input.message)) {
    return { ok: false, reason: "label_mismatch" };
  }
  if (input.surface !== GUIDED_CHOICE_SURFACE) {
    return { ok: false, reason: "not_review_surface" };
  }
  if (input.questionRowId === null) {
    return { ok: false, reason: "no_question_scope" };
  }
  const offered = await guidedChoicesForQuestion(input.questionRowId);
  return offered.includes(input.intent)
    ? { ok: true }
    : { ok: false, reason: "not_offered" };
}

/**
 * A video intent's video, or null for no match. Never throws: retrieval fails open (an error is
 * logged by `retrieveOfferedVideos` and reads as no match).
 */
export async function pickIntentVideo(
  intent: VideoIntent,
  questionRowId: string,
  conversationId: string,
): Promise<{ video: LibraryVideo | null; offered: LibraryVideo[] }> {
  const method = VIDEO_INTENT_METHOD[intent];
  const offered = await retrieveOfferedVideos(
    questionRowId,
    GUIDED_CHOICE_SURFACE,
    conversationId,
    method,
  );
  const top = offered[0] ?? null;
  if (top === null) return { video: null, offered };
  // Desmos: a non-Desmos video is not what was asked for.
  if (intent === "video_desmos" && !top.methods.includes("desmos")) {
    return { video: null, offered };
  }
  return { video: top, offered };
}
