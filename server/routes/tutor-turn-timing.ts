/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1
 *        ("time-to-first-visible-text ... No message content in logs"); Coding Standards §8.1,
 *        §12.1; packages/shared/src/tutor-turn-timing-schema.ts] | @implemented [2026-10-23]
 *
 * plain English: POST /api/perf/tutor-turn — the client reports how long one LISA reply took to
 * reach the screen. The handler parses the body against the shared strict schema and writes one
 * INFO line, event `tutor_turn_visible`, component `PERF`, carrying the three parsed fields and
 * nothing else; it reads and writes no table and returns 204. `turn_request_id` is the send
 * request's id, the same value the turn's `route_timing` line carries as `request_id`, so the
 * two lines join.
 *
 * Mounted beside — not inside — /api/tutor (server/index.ts), with the same auth, student-only
 * gate and CSRF, but its own rate limiter: inside, every beacon would spend a slot of the 30/min
 * tutor limiter and leave the student fewer turns, which is a behaviour change H1 must not make.
 * No entitlement gate: the endpoint grants nothing, serves nothing and changes no state, and a
 * student without an entitlement has no reply turn to time.
 */
import { Router, type Request, type Response } from "express";
import { tutorTurnTimingSchema } from "../../packages/shared/src/tutor-turn-timing-schema";
import { logger } from "../logger";

export function postTutorTurnTiming(req: Request, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: { message: "Unauthenticated" } });
    return;
  }
  const parsed = tutorTurnTimingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Invalid input" } });
    return;
  }
  const { request_id, post_ms, visible_ms } = parsed.data;
  logger.info(
    "PERF",
    "tutor_turn_visible",
    "LISA reply time to first visible text",
    { turn_request_id: request_id, post_ms, visible_ms },
    { requestId: req.requestId },
  );
  res.status(204).end();
}

const router = Router();
router.post("/tutor-turn", postTutorTurnTiming);

export default router;
