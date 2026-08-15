/**
 * @spec [Doc-03A_V3 §9.4, §7.6 Layer A; Doc-03C_V3 §8.3; Doc-01A Part VII §62–§67]
 * @implemented 2026-08-14
 *
 * plain English: Internal-only route for memory compaction writeback.
 * Called by Cloud Tasks (or directly in local dev) to execute the four-step
 * chat compaction algorithm. This route is mounted under `/api/internal`
 * behind HMAC-SHA256 service auth (01A Part VII) — it is never publicly
 * accessible. The `compaction-worker → main-api` service pair is verified
 * by the shared `internalAuthMiddleware`.
 *
 * expected outcome: POST /api/internal/memory/compact-writeback receives
 * the Cloud Tasks payload `{job_type, conversation_id, trigger_reason,
 * request_id}`, verifies the HMAC signature, executes compaction (which
 * derives student_id from the conversation row), and returns the result.
 *
 * trade-offs:
 *  - Auth: HMAC-SHA256 per 01A Part VII. Secrets loaded from
 *    `service_auth_secrets` table per §64. Timestamp tolerance 5min (§66).
 *    Rotation overlap supported — verification tries all active secrets.
 *  - §67: all auth failures return 401 with minimal body
 *    `{error:{code:"internal_auth_failed",message:"Internal authentication failed"}}`.
 *    Failure reasons logged server-side at WARN (never in response).
 *
 * edge cases:
 *  - Duplicate delivery (Cloud Tasks at-least-once): compaction is idempotent
 *    via UPSERT on (student_id, summary_type). No harm from duplicates.
 *  - Compaction failure: returns 200 with `{ ok: false, reason }` so Cloud
 *    Tasks does not retry (the failure is logged and the stale-summary sweep
 *    will catch it). Only unexpected errors return 500 (triggers retry).
 *  - HMAC timestamp set at Cloud Tasks enqueue time; first delivery is within
 *    seconds (well within 5-min tolerance). Retries after 5min fail on
 *    timestamp — acceptable because stale-summary sweep catches orphans.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { executeCompaction } from "../services/tutor-compaction";
import { internalAuthMiddleware } from "../../packages/shared/internal-auth/verify-middleware";

const router = Router();

// ── Request schema ────────────────────────────────────────────────────

/**
 * Cloud Tasks compaction payload per Doc 03C §8.3.
 */
const compactionTaskSchema = z.object({
  job_type: z.literal("compaction"),
  conversation_id: z.string().uuid(),
  trigger_reason: z.enum(["close", "threshold", "stale"]),
  request_id: z.string().uuid(),
});

// ── Route ─────────────────────────────────────────────────────────────

router.post(
  "/memory/compact-writeback",
  internalAuthMiddleware("main-api"),
  async (req: Request, res: Response): Promise<void> => {
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

    const { conversation_id, request_id, trigger_reason } = parsed.data;

    try {
      const result = await executeCompaction(conversation_id, request_id);

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
