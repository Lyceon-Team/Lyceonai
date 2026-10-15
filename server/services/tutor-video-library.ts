/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §6 (one query, no embedding;
 *       Step 13d, after crisis and the Model Armor input scan; fails open), §7 (the model
 *       never emits a video identifier: it offers by index; the BFF attaches video_id, title,
 *       channel and start; the serializer redacts any YouTube link not in the turn's set)]
 *       | @implemented [2026-10-15]
 *
 * plain English: the BFF half of the video library.
 *  - `retrieveOfferedVideos(questionRowId, surface)`: the item's `skill_codes`, then
 *    `video_resources_for_skills` (available + approved + skill filter in the statement,
 *    shortest first, at most 3). Only on the surfaces the brief names (§8: the review panel,
 *    so `review` and `test_review`; standalone chat is `dashboard`, which has no item and so
 *    no skill to match — it gets videos only if a later ruling keys them on something else).
 *    Practice is excluded: the brief does not name it, and a worked video on the item's skill
 *    while the item is unanswered is a call for Karl, not a default. No item, no skills, or
 *    any error → no videos; an error is logged at ERROR and the turn proceeds (fail open).
 *  - `toWireVideos`: what the worker sees — a 1-based index, title, channel, length. The id
 *    and start stay here, so no identifier is ever on the wire to be repeated.
 *  - `resolveVideoAction`: the worker's `recommend_video` + index becomes the client action
 *    with the video attached. An index that names no offered video becomes no action.
 *
 * edge cases: the student only ever sees videos Karl approved (approved_by set) for the item's
 * own skills. Logs carry ids and counts only, never message text.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import type {
  OfferedVideo,
  OrchestrateRequest,
  OrchestrateResponse,
} from "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated";
import { logger } from "../logger";
import { resolveQuestionSkillCodes } from "./tutor-context";

export const libraryVideoSchema = z.object({
  video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string(),
  channel_name: z.string(),
  duration_seconds: z.number().int().positive(),
  start_seconds: z.number().int().nonnegative().nullable(),
});
export type LibraryVideo = z.infer<typeof libraryVideoSchema>;

/** At most this many videos are offered per turn (brief §6: `limit 3`). */
export const MAX_OFFERED_VIDEOS = 3;

type SourceSurface = OrchestrateRequest["source_surface"];

/** The surfaces a video may be offered on (brief §8: the review panel and standalone chat). */
export const VIDEO_SURFACES: ReadonlySet<SourceSurface> = new Set([
  "review",
  "test_review",
  "dashboard",
]);

/** Step 13d. Never throws: any failure is logged and yields no videos. */
export async function retrieveOfferedVideos(
  questionRowId: string | null,
  surface: SourceSurface,
  conversationId: string,
): Promise<LibraryVideo[]> {
  if (questionRowId === null || !VIDEO_SURFACES.has(surface)) return [];
  try {
    const skills = await resolveQuestionSkillCodes(questionRowId);
    if (skills.length === 0) return [];
    const r = await supabaseServer.rpc("video_resources_for_skills", {
      p_skill_codes: skills,
      p_limit: MAX_OFFERED_VIDEOS,
    });
    if (r.error) throw r.error;
    return z
      .array(libraryVideoSchema)
      .max(MAX_OFFERED_VIDEOS)
      .parse(r.data ?? []);
  } catch (err: unknown) {
    logger.error(
      "TUTOR_RUNTIME",
      "video_library_retrieval_failed",
      "video retrieval failed; the turn proceeds with no videos (fail open)",
      err instanceof Error ? err : undefined,
      { conversationId },
    );
    return [];
  }
}

/** The worker's view: index, title, channel, length. No id, no start. */
export function toWireVideos(videos: readonly LibraryVideo[]): OfferedVideo[] {
  return videos.map((v, i) => ({
    index: i + 1,
    title: v.title,
    channel_name: v.channel_name,
    duration_seconds: v.duration_seconds,
  }));
}

type WorkerAction = OrchestrateResponse["response"]["suggested_action"];

/** The client's action: the worker's, with the offered video attached for recommend_video. */
export type ClientSuggestedAction =
  | {
      type: Exclude<WorkerAction["type"], "recommend_video">;
      label: string | null;
    }
  | {
      type: "recommend_video";
      label: string | null;
      video: LibraryVideo;
    };

/**
 * Pure. recommend_video with an index that names an offered video → the action with that
 * video attached; any other index (or none) → no action. A reply the serializer substituted
 * (`replyBlocked`) loses its video offer too: the offer belonged to text the student no longer
 * sees. Other types pass through without `video_index`.
 */
export function resolveVideoAction(
  action: WorkerAction,
  offered: readonly LibraryVideo[],
  replyBlocked: boolean,
): ClientSuggestedAction {
  if (action.type !== "recommend_video") {
    return { type: action.type, label: action.label };
  }
  const video =
    action.video_index === undefined || replyBlocked
      ? undefined
      : offered[action.video_index - 1];
  return video === undefined
    ? { type: "none", label: null }
    : { type: "recommend_video", label: action.label, video };
}
