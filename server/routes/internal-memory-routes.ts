/**
 * @spec [Doc-03A_V3 §9.4, §7.6 Layer A; Doc-03C_V3 §8.3, §9.3]
 * @implemented 2026-08-15
 *
 * plain English: Internal-only route for memory compaction writeback.
 * Called by Cloud Tasks to execute the four-step chat compaction algorithm.
 * This route is mounted under `/api/internal` behind OIDC token verification
 * per Doc 03C §9.3 — Cloud Tasks mints the OIDC token at delivery time using
 * the `lisa-cloud-tasks@PROJECT.iam` service account.
 *
 * expected outcome: POST /api/internal/memory/compact-writeback receives
 * the Cloud Tasks payload `{job_type, conversation_id, student_id,
 * trigger_reason, request_id}`, verifies the OIDC token, executes
 * compaction, and returns the result.
 *
 * trade-offs:
 *  - Auth: OIDC per Doc 03C §9.3 (replaces HMAC per 01A Part VII). OIDC
 *    tokens are minted at DELIVERY time, not enqueue time — retries get
 *    fresh credentials instead of permanently failing on stale timestamps.
 *  - §9.3: the handler validates audience (handler URL), issuer
 *    (accounts.google.com), and service account email. Cloud Run IAM
 *    (`roles/run.invoker`) provides the first layer; this is defense-in-depth.
 *  - §67-style response: all auth failures return 401 with minimal body.
 *    Failure reasons logged server-side at WARN (never in response).
 *
 * edge cases:
 *  - Duplicate delivery (Cloud Tasks at-least-once): compaction is idempotent
 *    via UPSERT on (student_id, summary_type). No harm from duplicates.
 *  - Compaction failure: returns 200 with `{ ok: false, reason }` so Cloud
 *    Tasks does not retry (the failure is logged and the stale-summary sweep
 *    will catch it). Only unexpected errors return 500 (triggers retry).
 *  - Missing OIDC env vars (CLOUD_TASKS_OIDC_AUDIENCE, CLOUD_TASKS_SERVICE_ACCOUNT):
 *    startup crashes with a descriptive error (fail-fast per Doc 01A §3).
 *    In test mode the check is skipped — tests mock the middleware.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { executeCompaction } from "../services/tutor-compaction";
import { oidcAuthMiddleware } from "../../packages/shared/internal-auth/verify-oidc-middleware";

const router = Router();

// ── OIDC config ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03C_V3 §9.3, Doc-01A §3 fail-fast]
 *
 * OIDC audience: the handler URL that Cloud Tasks targets. The token's
 * audience claim must match this value. Configured per deployment.
 *
 * OIDC service account: the SA that Cloud Tasks uses to mint tokens.
 * Must match `lisa-cloud-tasks@PROJECT.iam.gserviceaccount.com`.
 *
 * Fail-fast (Doc 01A §3): missing env vars crash the process at startup
 * instead of running with empty strings that silently disable auth.
 * Guarded by NODE_ENV — test mode skips (tests mock the middleware).
 */
const IS_TEST = process.env.NODE_ENV === "test" || !!process.env.VITEST;

const OIDC_AUDIENCE = process.env.CLOUD_TASKS_OIDC_AUDIENCE ?? "";
const OIDC_SERVICE_ACCOUNT = process.env.CLOUD_TASKS_SERVICE_ACCOUNT ?? "";

if (!IS_TEST) {
  if (!OIDC_AUDIENCE) {
    throw new Error(
      "CLOUD_TASKS_OIDC_AUDIENCE is not set. " +
        "Internal OIDC routes require this env var per Doc 03C §9.3. " +
        "Set it to the Cloud Run handler URL.",
    );
  }
  if (!OIDC_SERVICE_ACCOUNT) {
    throw new Error(
      "CLOUD_TASKS_SERVICE_ACCOUNT is not set. " +
        "Internal OIDC routes require this env var per Doc 03C §9.3. " +
        "Set it to lisa-cloud-tasks@PROJECT.iam.gserviceaccount.com.",
    );
  }
}

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
  oidcAuthMiddleware({
    expectedAudience: OIDC_AUDIENCE,
    expectedServiceAccount: OIDC_SERVICE_ACCOUNT,
  }),
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
