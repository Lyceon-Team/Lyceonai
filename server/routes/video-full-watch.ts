/**
 * @spec [owner brief "Phase C follow-up: show the segment, not the whole video", Karl
 *       2026-11-04, build 4; packages/shared/src/video-full-watch-schema.ts; Coding Standards
 *       §8.1, §12.1] | @implemented [2026-11-04]
 *
 * plain English: POST /api/perf/video-full-watch — the student pressed "Watch full video" on a
 * served segment. The handler parses the body against the shared strict schema and writes one
 * INFO line, event `video_watch_full`, component `PERF`: the segment id and the flag, nothing
 * else. It reads and writes no table and returns 204. Count the lines per `segment_id` to see
 * which segments students widen.
 *
 * Mounted on the /api/perf router beside the turn-timing beacon (server/index.ts): the tutor
 * mount's auth, student-only gate and CSRF, the beacon limiter. No entitlement gate: it grants
 * nothing, serves nothing and changes no state.
 */
import type { Request, Response } from "express";
import { videoFullWatchSchema } from "../../packages/shared/src/video-full-watch-schema";
import { logger } from "../logger";

export function postVideoFullWatch(req: Request, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: { message: "Unauthenticated" } });
    return;
  }
  const parsed = videoFullWatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Invalid input" } });
    return;
  }
  logger.info(
    "PERF",
    "video_watch_full",
    "Student widened a served segment to the full video",
    { segment_id: parsed.data.segment_id, watched_full: true },
    { requestId: req.requestId },
  );
  res.status(204).end();
}
