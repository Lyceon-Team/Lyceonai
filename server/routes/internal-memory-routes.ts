/**
 * @spec [Doc-03A_V3 §9.4, §7.6 Layer A; Doc-03C_V3 §8.3, §8.4, §8.5, §9.3]
 * @implemented 2026-08-19
 *
 * plain English: Internal-only routes for memory operations. All routes are
 * mounted under `/api/internal` behind OIDC token verification per Doc 03C
 * §9.3 — Cloud Tasks mints the OIDC token at delivery time using the
 * `lisa-cloud-tasks@PROJECT.iam` service account.
 *
 * Routes:
 *   POST /memory/compact-writeback — §8.3 four-step chat compaction
 *   POST /async/memory-refresh     — §8.4 two-transaction memory refresh
 *   POST /async/pending-reconciliation — §8.5 stale-pending sweep (every 5 min)
 *
 * expected outcome: each route receives the Cloud Tasks payload, verifies
 * the OIDC token, and delegates to the domain service.
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
 *    via UPSERT on (student_id, summary_type). Memory refresh uses advisory
 *    locks (§8.4). No harm from duplicates.
 *  - Expected failures: return 200 with `{ ok: false, reason }` so Cloud
 *    Tasks does not retry. Only unexpected errors return 500 (triggers retry).
 *  - Missing OIDC env vars (CLOUD_TASKS_OIDC_AUDIENCE, CLOUD_TASKS_SERVICE_ACCOUNT):
 *    middleware construction fails at startup with a clear error log.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { executeCompaction } from "../services/tutor-compaction";
import { executeMemoryRefresh } from "../services/tutor-memory-refresh";
import { executePendingReconciliation } from "../services/tutor-pending-reconciliation";
import { oidcAuthMiddleware } from "../../packages/shared/internal-auth/verify-oidc-middleware";

const router = Router();

// ── OIDC config ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03C_V3 §9.3]
 *
 * OIDC audience: the handler URL that Cloud Tasks targets. The token's
 * audience claim must match this value. Configured per deployment.
 *
 * OIDC service account: the SA that Cloud Tasks uses to mint tokens.
 * Must match `lisa-cloud-tasks@PROJECT.iam.gserviceaccount.com`.
 */
const OIDC_AUDIENCE = process.env.CLOUD_TASKS_OIDC_AUDIENCE ?? "";
const OIDC_SERVICE_ACCOUNT = process.env.CLOUD_TASKS_SERVICE_ACCOUNT ?? "";

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

// ── §8.4 Memory refresh ──────────────────────────────────────────────

/**
 * Cloud Tasks memory-refresh payload per Doc 03C §8.4.
 * @spec [Doc-03C_V3 §8.4]
 */
const memoryRefreshTaskSchema = z.object({
  job_type: z.literal("memory_refresh"),
  student_id: z.string().uuid(),
  summary_type: z.string().min(1),
  trigger_reason: z.enum(["close", "threshold", "stale", "reconciliation"]),
  request_id: z.string().uuid(),
  previous_attempt_summary_version: z.number().int().nonnegative().nullable(),
});

/**
 * @spec [Doc-03C_V3 §8.4, §9.3]
 * @implemented 2026-08-19
 *
 * plain English: receives the Cloud Tasks memory-refresh payload, validates
 * OIDC token and payload schema, delegates to executeMemoryRefresh.
 * Returns 200 on expected outcomes (including not_implemented) so Cloud Tasks
 * does not retry. Returns 500 on unexpected errors to trigger retry.
 */
router.post(
  "/async/memory-refresh",
  oidcAuthMiddleware({
    expectedAudience: OIDC_AUDIENCE,
    expectedServiceAccount: OIDC_SERVICE_ACCOUNT,
  }),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = memoryRefreshTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn(
        "INTERNAL_MEMORY",
        "memory_refresh_invalid_payload",
        "Memory refresh task payload failed validation",
        { errors: parsed.error.flatten() },
      );
      res.status(400).json({
        error: {
          message: "Invalid memory refresh task payload",
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    const {
      student_id,
      summary_type,
      trigger_reason,
      request_id,
      previous_attempt_summary_version,
    } = parsed.data;

    try {
      const result = await executeMemoryRefresh({
        studentId: student_id,
        summaryType: summary_type,
        triggerReason: trigger_reason,
        requestId: request_id,
        previousAttemptSummaryVersion: previous_attempt_summary_version,
      });

      if (!result.ok) {
        logger.info(
          "INTERNAL_MEMORY",
          "memory_refresh_skipped",
          `Memory refresh did not complete: ${result.reason}`,
          {
            studentId: student_id,
            summaryType: summary_type,
            reason: result.reason,
            requestId: request_id,
          },
        );
        res.status(200).json({ ok: false, reason: result.reason });
        return;
      }

      logger.info(
        "INTERNAL_MEMORY",
        "memory_refresh_success",
        "Memory refresh completed",
        {
          studentId: student_id,
          summaryType: summary_type,
          summaryId: result.summaryId,
          triggerReason: trigger_reason,
          requestId: request_id,
        },
      );
      res.status(200).json({ ok: true, summary_id: result.summaryId });
    } catch (err: unknown) {
      logger.error(
        "INTERNAL_MEMORY",
        "memory_refresh_error",
        "Unexpected error during memory refresh",
        err instanceof Error ? err : undefined,
        { studentId: student_id, requestId: request_id },
      );
      res.status(500).json({ error: { message: "Internal error" } });
    }
  },
);

// ── §8.5 Pending reconciliation ──────────────────────────────────────

/**
 * Cloud Tasks pending-reconciliation payload per Doc 03C §8.5.
 * @spec [Doc-03C_V3 §8.5]
 */
const pendingReconciliationTaskSchema = z.object({
  job_type: z.literal("pending_reconciliation"),
  request_id: z.string().uuid(),
});

/**
 * @spec [Doc-03C_V3 §8.5, §9.3]
 * @implemented 2026-08-19
 *
 * plain English: receives the Cloud Tasks pending-reconciliation sweep
 * payload. Runs every 5 minutes via Cloud Scheduler → Cloud Tasks.
 * Selects pending memory-refresh rows older than 10 minutes, marks them
 * failed, and re-enqueues fresh refresh tasks. SKIP LOCKED ensures
 * concurrent sweeps don't double-mark.
 */
router.post(
  "/async/pending-reconciliation",
  oidcAuthMiddleware({
    expectedAudience: OIDC_AUDIENCE,
    expectedServiceAccount: OIDC_SERVICE_ACCOUNT,
  }),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = pendingReconciliationTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn(
        "INTERNAL_MEMORY",
        "pending_reconciliation_invalid_payload",
        "Pending reconciliation task payload failed validation",
        { errors: parsed.error.flatten() },
      );
      res.status(400).json({
        error: {
          message: "Invalid pending reconciliation task payload",
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    const { request_id } = parsed.data;

    try {
      const result = await executePendingReconciliation(request_id);

      if (!result.ok) {
        logger.info(
          "INTERNAL_MEMORY",
          "pending_reconciliation_skipped",
          `Pending reconciliation did not complete: ${result.reason}`,
          { reason: result.reason, requestId: request_id },
        );
        res.status(200).json({ ok: false, reason: result.reason });
        return;
      }

      logger.info(
        "INTERNAL_MEMORY",
        "pending_reconciliation_success",
        "Pending reconciliation sweep completed",
        {
          reconciledCount: result.reconciledCount,
          requestId: request_id,
        },
      );
      res.status(200).json({
        ok: true,
        reconciled_count: result.reconciledCount,
      });
    } catch (err: unknown) {
      logger.error(
        "INTERNAL_MEMORY",
        "pending_reconciliation_error",
        "Unexpected error during pending reconciliation sweep",
        err instanceof Error ? err : undefined,
        { requestId: request_id },
      );
      res.status(500).json({ error: { message: "Internal error" } });
    }
  },
);

export default router;
