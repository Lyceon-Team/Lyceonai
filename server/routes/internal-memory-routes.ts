/**
 * @spec [Doc-03A_V3 §9.4, §7.6 Layer A; Doc-03C_V3 §8.3]
 * @implemented 2026-08-14
 *
 * plain English: Internal-only route for memory compaction writeback.
 * Called by Cloud Tasks (or directly in local dev) to execute the four-step
 * chat compaction algorithm. This route is mounted under `/api/internal`
 * behind CRON_SECRET auth — it is never publicly accessible.
 *
 * expected outcome: POST /api/internal/memory/compact-writeback receives
 * the Cloud Tasks payload `{job_type, conversation_id, student_id,
 * trigger_reason, request_id}`, executes compaction, and returns the result.
 *
 * trade-offs:
 *  - Per the boundary report (WS-L4 pre-implementation report §5), the
 *    spec envisions a separate Cloud Run service (`lisa-memory-worker`) with
 *    HMAC callback to this endpoint. Until the HMAC infrastructure (01A Part VII)
 *    is wired, the BFF handles compaction directly and Cloud Tasks targets
 *    this route. When HMAC lands, the handler logic migrates to the standalone
 *    worker and this route becomes a thin HMAC-verified writeback receiver.
 *  - Auth: reuses the CRON_SECRET timing-safe auth from internal-cron-routes.ts.
 *    Cloud Tasks sends `Authorization: Bearer <CRON_SECRET>` header. In local
 *    dev, the route can be called directly for testing.
 *
 * edge cases:
 *  - Duplicate delivery (Cloud Tasks at-least-once): compaction is idempotent
 *    via UPSERT on (student_id, summary_type). No harm from duplicates.
 *  - Compaction failure: returns 200 with `{ ok: false, reason }` so Cloud
 *    Tasks does not retry (the failure is logged and the stale-summary sweep
 *    will catch it). Only unexpected errors return 500 (triggers retry).
 */
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { executeCompaction } from "../services/tutor-compaction";

const router = Router();

// ── Auth ──────────────────────────────────────────────────────────────

/**
 * Cloud Tasks auth via CRON_SECRET (same pattern as internal-cron-routes.ts).
 * When the HMAC infrastructure (01A Part VII) lands, this is replaced by
 * HMAC-SHA256 verification for the `compaction-worker → main-api` service pair.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.get("authorization") ?? "");
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}

// ── Request schema ────────────────────────────────────────────────────

/**
 * Cloud Tasks compaction payload per Doc 03C §8.3.
 */
const compactionTaskSchema = z.object({
  job_type: z.literal("compaction"),
  conversation_id: z.string().uuid(),
  student_id: z.string().uuid(),
  trigger_reason: z.enum(["close", "threshold", "stale"]),
  request_id: z.string().uuid(),
});

// ── Route ─────────────────────────────────────────────────────────────

router.post(
  "/memory/compact-writeback",
  async (req: Request, res: Response): Promise<void> => {
    if (!isAuthorized(req)) {
      // Return 404 (not 401/403) to reveal nothing about the endpoint's existence
      res.status(404).json({ error: "Not found" });
      return;
    }

    const parsed = compactionTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn(
        "INTERNAL_MEMORY",
        "compact_writeback_invalid_payload",
        "Compaction task payload failed validation",
        { errors: parsed.error.flatten() },
      );
      // 400 so Cloud Tasks does not retry a malformed payload
      res.status(400).json({
        error: {
          message: "Invalid compaction task payload",
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    const { conversation_id, student_id, request_id, trigger_reason } =
      parsed.data;

    try {
      const result = await executeCompaction(
        conversation_id,
        student_id,
        request_id,
      );

      if (!result.ok) {
        // Expected failures (below threshold, Vertex error, etc.): return 200
        // so Cloud Tasks does not retry. The reason is logged inside
        // executeCompaction.
        logger.info(
          "INTERNAL_MEMORY",
          "compact_writeback_skipped",
          `Compaction did not produce a summary: ${result.reason}`,
          {
            conversationId: conversation_id,
            reason: result.reason,
            requestId: request_id,
          },
        );
        res.status(200).json({ ok: false, reason: result.reason });
        return;
      }

      logger.info(
        "INTERNAL_MEMORY",
        "compact_writeback_success",
        "Compaction writeback completed",
        {
          conversationId: conversation_id,
          summaryId: result.summaryId,
          triggerReason: trigger_reason,
          requestId: request_id,
        },
      );
      res.status(200).json({ ok: true, summary_id: result.summaryId });
    } catch (err: unknown) {
      logger.error(
        "INTERNAL_MEMORY",
        "compact_writeback_error",
        "Unexpected error during compaction writeback",
        err instanceof Error ? err : undefined,
        { conversationId: conversation_id, requestId: request_id },
      );
      // 500 triggers Cloud Tasks retry — appropriate for unexpected errors
      res.status(500).json({ error: { message: "Internal error" } });
    }
  },
);

export default router;
