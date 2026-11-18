/**
 * @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27), build items
 *        1–2 and rulings 1–3 of 2026-10-27; Doc-03B_V4.1 §6.3/§6.4/§6.9 as amended by SCL-253;
 *        Doc-03B_V4.1 §6.5/§20.2 as amended by SCL-254; Doc-03D_V1.2 §6.7 as amended by the
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
 *  - Quick replies (owner brief "Quick replies in walkthroughs", Karl 2026-11-02; SCL-268):
 *    `step_understood` / `step_stuck` are not guided choices. The same exact-label, review-surface
 *    and question-scope rules apply; instead of "one of the question's choices", the conversation
 *    must be in a walkthrough, read from its STORED student messages (`isWalkthroughOpen`, the
 *    function the panel uses to show the taps). Otherwise `400 invalid_input` ("no_walkthrough").
 *  - `pickIntentVideo`: a video intent's one video. "Desmos video" asks for method `desmos` and
 *    serves the top match only if it IS a Desmos video; otherwise there is no match. On a
 *    sub-skill-tagged item (Phase C, Karl 2026-10-29, ruling Q3; SCL-260) the tap REQUIRES
 *    Desmos: only Desmos segments are candidates, so it gets one whenever one exists even when
 *    an algebraic segment shares more; no matching segment is no match. "Explanation
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
  isStepIntent,
  isVideoIntent,
  isWalkthroughOpen,
  REVIEW_INTENTS,
  reviewIntentSchema,
  VIDEO_INTENT_METHOD,
  type ReviewIntent,
  type VideoIntent,
} from "../../packages/shared/src/tutor-guided-choices";
import { TutorConfig } from "./tutor-config";
import { resolveQuestionSection, sessionTablesFor } from "./tutor-context";
import {
  retrieveOfferedVideos,
  type LibraryVideo,
  type VideoRetrieval,
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
  const choices = await guidedChoicesForQuestion(questionId);
  return withAvailableVideos(choices, questionId, sessionItemId);
}

/**
 * @spec [owner brief "Help-level engine", Karl 2026-11-05, rule 6: "Hide video choices when no
 *       approved video exists for the question's sub-skills or skill. The choices endpoint checks
 *       availability."; SCL-275] | @implemented [2026-11-05]
 *
 * plain English: a video choice stays only when tapping it would serve a video: the same
 * retrieval the tap runs (`pickIntentVideo`: the segment path for a sub-skill-tagged item, the
 * skill path otherwise; Desmos required for "Desmos video"). A retrieval error hides the choice
 * too, so the panel never offers a dead end. The turn's intent check is unchanged, so a video
 * withdrawn after the panel loaded still gets the "no video yet" sentence, never a 400.
 */
async function withAvailableVideos(
  choices: ReviewIntent[],
  questionId: string,
  sessionItemId: string,
): Promise<ReviewIntent[]> {
  const kept: ReviewIntent[] = [];
  for (const intent of choices) {
    if (!isVideoIntent(intent)) {
      kept.push(intent);
      continue;
    }
    // Logged as the review item (the GET has no conversation): ids only.
    const picked = await pickIntentVideo(
      intent,
      questionId,
      `review_item:${sessionItemId}`,
    );
    if (picked.video !== null) kept.push(intent);
  }
  return kept;
}

export type TurnIntentRefusal =
  | "not_review_surface"
  | "no_question_scope"
  | "label_mismatch"
  | "not_offered"
  | "no_walkthrough";

// The taps that open or close a walkthrough: every intent except the quick replies.
const STATE_CHANGING_INTENTS: readonly ReviewIntent[] = REVIEW_INTENTS.filter(
  (intent) => !isStepIntent(intent),
);

// A typed message's row has no intent (NULL in Postgres; absent where a client omits it).
const studentIntentRowsSchema = z.array(
  z.object({ intent: reviewIntentSchema.nullish() }),
);

/**
 * Whether this conversation is in a walkthrough, from its stored student messages (SCL-268).
 * Throws on a DB error (the route's catch answers 500): a quick reply is never accepted on a
 * guess. A stored intent outside the closed list fails the parse and throws too.
 *
 * Only the LAST student tap that is not a quick reply decides (typed rows and quick replies never
 * change the state; `isWalkthroughOpen`), so this reads exactly that one row, newest first with
 * an `id` tie-break, rather than the whole history: a bounded read that no row cap can truncate.
 */
export async function conversationWalkthroughOpen(
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("tutor_messages")
    .select("intent")
    .eq("conversation_id", conversationId)
    .eq("role", "student")
    .in("intent", STATE_CHANGING_INTENTS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  return isWalkthroughOpen(
    studentIntentRowsSchema.parse(data ?? []).map((r) => r.intent ?? null),
  );
}

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
  conversationId: string;
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
  if (isStepIntent(input.intent)) {
    return (await conversationWalkthroughOpen(input.conversationId))
      ? { ok: true }
      : { ok: false, reason: "no_walkthrough" };
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
): Promise<{ video: LibraryVideo | null; retrieval: VideoRetrieval }> {
  const method = VIDEO_INTENT_METHOD[intent];
  const retrieval = await retrieveOfferedVideos(
    questionRowId,
    GUIDED_CHOICE_SURFACE,
    conversationId,
    method,
    { methodRequired: intent === "video_desmos" },
  );
  const top = retrieval.videos[0] ?? null;
  if (top === null) return { video: null, retrieval };
  // Desmos: a non-Desmos video is not what was asked for.
  if (intent === "video_desmos" && !top.methods.includes("desmos")) {
    return { video: null, retrieval };
  }
  return { video: top, retrieval };
}
