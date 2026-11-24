/**
 * @spec [owner brief "Phase C follow-up: show the segment, not the whole video", Karl
 *       2026-11-04, build 4 ("Record whether 'Watch full video' was used, as an ID and a flag
 *       only. It's an early signal of whether segments are cut too tight.")] | @implemented [2026-11-04]
 *
 * plain English: the body of the client's "Watch full video" beacon (POST
 * /api/perf/video-full-watch): the served segment's id, nothing else. The press itself is the
 * flag. `.strict()` refuses any extra field, so nothing can ride along.
 *
 * trade-offs: the id is the client's claim. It is observability only (logged, never stored,
 * never read by any decision), so a false id misleads a count and nothing else.
 */
import { z } from "zod";

export const videoFullWatchSchema = z
  .object({ segment_id: z.string().uuid() })
  .strict();

export type VideoFullWatch = z.infer<typeof videoFullWatchSchema>;
