/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1: "Extend
 *        route_timing across the whole reply path: ... time-to-first-visible-text, total ... No
 *        message content in logs"; Coding Standards §7.2, §12.1] | @implemented [2026-10-23]
 *
 * plain English: the body of the client's turn-timing beacon (POST /api/perf/tutor-turn). The
 * server cannot see when LISA's reply reaches the screen — the reply renders from the thread's
 * refetch after the send resolves — so the client reports, for one reply turn, two numbers
 * measured from the moment the student pressed send:
 *   post_ms     the send request resolved;
 *   visible_ms  the first frame after the reply's row was rendered.
 * `request_id` is the id the client gave the send request (`X-Request-Id`), so the beacon's log
 * line joins that turn's `route_timing` line. Nothing else: no message, no reply, no
 * conversation or turn id. `.strict()` refuses any extra field, so nothing can ride along.
 *
 * trade-offs: the numbers are the client's own claim. They are observability only — logged,
 * never stored, never read by any decision — so a false value misleads a chart and nothing else.
 * The bounds keep a broken clock from writing absurd values (10 minutes is far past the 35 s
 * client timeout plus a slow refetch).
 */
import { z } from "zod";

const TURN_MS = z.number().finite().nonnegative().max(600_000);

export const tutorTurnTimingSchema = z
  .object({
    request_id: z.string().uuid(),
    post_ms: TURN_MS,
    visible_ms: TURN_MS,
  })
  .strict();

export type TutorTurnTiming = z.infer<typeof tutorTurnTimingSchema>;
