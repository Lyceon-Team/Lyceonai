/**
 * @spec [Doc-03_V1.1 §14.2, INV-03-19; Doc-03C_V3 §9.3]
 * @implemented 2026-08-20
 *
 * plain English: Internal-only route for LISA data retention sweep.
 * Called by Cloud Scheduler (one job per retention tier) to execute
 * time-based deletion of expired tutor records per Doc 03 §14.2
 * retention matrix. Each tier runs independently so a failure in one
 * tier doesn't block others (Karl ruling: per-tier Cloud Scheduler
 * jobs → direct Cloud Run, no Cloud Tasks queue).
 *
 * expected outcome: POST /api/internal/retention/sweep receives
 * `{retention_tier, dry_run, request_id}`, verifies the OIDC token,
 * executes the tier's deletion SQL, and returns the deletion count.
 * In dry_run mode, returns the count without deleting.
 *
 * trade-offs:
 *  - Auth: OIDC per Doc 03C §9.3 (same middleware as compaction/async
 *    memory routes). Cloud Scheduler mints the OIDC token at delivery.
 *  - Tiers map to separate scheduler jobs so partial failure is isolated.
 *    A failing 180d sweep doesn't delay the 7d sweep.
 *  - 7d tier: deletes from tutor_conversations WHERE deleted_at expired.
 *    Cascade FKs handle tutor_messages and tutor_question_links. A
 *    separate delete handles tutor_memory_summaries (no FK cascade from
 *    tutor_conversations).
 *  - 365d tier: tables (cost telemetry, quota appeals) not yet provisioned.
 *    Returns { ok: false, reason: "365d_tables_not_provisioned" }.
 *  - Dry-run returns count only (SELECT COUNT, no DELETE). Used for
 *    negative-control validation before first production run.
 *
 * edge cases:
 *  - Duplicate delivery: DELETE is idempotent — already-deleted rows
 *    don't match the WHERE clause.
 *  - Empty result: normal for tiers with no expired rows. Returns
 *    { ok: true, deleted_count: 0 }.
 *  - tutor_memory_summaries: the spec says "Cascade from account /
 *    entitlement" but tutor_memory_summaries has a student_id FK, not
 *    a conversation FK. The 7d sweep joins on student_id + entitlement
 *    status. However, the 7d tier here only hard-deletes conversations
 *    that were soft-deleted 7+ days ago — the memory summaries for
 *    those students were already soft-deleted alongside conversations
 *    and are cleaned up by the same student_id + deleted_at window.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  oidcAuthMiddlewareWithConfigGuard,
  type OidcConfigReader,
} from "../../packages/shared/internal-auth/verify-oidc-middleware";
import { TIER_HANDLERS } from "../services/retention-sweep";
import {
  createBigQueryArchiveClient,
  ARCHIVE_DATASET_ENV_KEY,
  type ArchiveClient,
} from "../services/retention-archive";

const router = Router();

// ── OIDC config ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03C_V3 §9.3]
 *
 * Same OIDC pattern as compaction/async memory routes.
 * Uses a distinct env var for audience so each handler can enforce
 * its own audience claim independently.
 */
/**
 * @spec [Doc-03C_V3 §9.3, Doc-01A §3]
 *
 * Read per REQUEST, not at import. Mirrors internal-memory-routes.ts —
 * including the reason: LISA-OIDC-001 asked this file to "mirror the
 * memory-route guard exactly", and the guard being mirrored was a
 * module-scope throw. In the shared Vercel bundle that is a process-wide
 * crash, so it took down auth and every other route.
 *
 * Doc 01A §3's fail-fast intent is preserved by the guard: an unset var
 * refuses THIS route with 500 rather than reaching token verification with
 * an empty audience.
 */
const readOidcConfig: OidcConfigReader = () => ({
  expectedAudience:
    process.env.RETENTION_SWEEP_OIDC_AUDIENCE ??
    process.env.CLOUD_TASKS_OIDC_AUDIENCE,
  expectedServiceAccount: process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
});

// ── Request schema ────────────────────────────────────────────────────

/**
 * Cloud Scheduler retention sweep payload.
 *
 * retention_tier: which tier to sweep (one scheduler job per tier).
 * dry_run: if true, return count without deleting.
 * request_id: correlation ID from Cloud Scheduler for tracing.
 */
const retentionSweepSchema = z.object({
  retention_tier: z.enum(["7d", "90d", "180d", "365d"]),
  dry_run: z.boolean().default(false),
  request_id: z.string().uuid(),
});

// ── Tier sweep functions: server/services/retention-sweep.ts ─────────
// Extracted for testability — injectable client + controllable clock.
// TIER_HANDLERS imported above; each handler takes (client, dryRun, opts).

// ── BigQuery archive client ─────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2, Doc-07B_V1.0 §dataset naming]
 *
 * Lazily created BigQuery client for 90d/180d archival.
 * Created once on first use — the @google-cloud/bigquery package is
 * dynamically required by createBigQueryArchiveClient(), so it doesn't
 * fail at import time in test mode or before the dependency is installed.
 *
 * When BIGQUERY_ARCHIVE_DATASET is not set, archiveClient stays undefined
 * and archive-requiring tiers return ok: false with a clear reason —
 * same safe behaviour as the previous "archival_destination_pending."
 */
let archiveClient: ArchiveClient | undefined;

function getArchiveClient(): ArchiveClient | undefined {
  if (archiveClient) return archiveClient;

  const datasetEnv = process.env[ARCHIVE_DATASET_ENV_KEY];
  if (!datasetEnv) {
    // No dataset configured — archive client not available. Tiers that
    // require archival will return ok: false, reason: "archive_client_not_configured".
    return undefined;
  }

  try {
    archiveClient = createBigQueryArchiveClient();
    return archiveClient;
  } catch (err: unknown) {
    logger.warn(
      "RETENTION_SWEEP",
      "archive_client_init_failed",
      "Failed to create BigQuery archive client — 90d/180d tiers will be disabled",
      {
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return undefined;
  }
}

// ── Route ─────────────────────────────────────────────────────────────

router.post(
  "/retention/sweep",
  oidcAuthMiddlewareWithConfigGuard(readOidcConfig),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = retentionSweepSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn(
        "RETENTION_SWEEP",
        "sweep_invalid_payload",
        "Retention sweep payload failed validation",
        { errors: parsed.error.flatten() },
      );
      res.status(400).json({
        error: {
          message: "Invalid retention sweep payload",
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    const { retention_tier, dry_run, request_id } = parsed.data;
    const handler = TIER_HANDLERS[retention_tier];

    if (!handler) {
      // Should be unreachable due to Zod enum, but defense-in-depth
      res.status(400).json({
        error: { message: `Unknown retention tier: ${retention_tier}` },
      });
      return;
    }

    try {
      const result = await handler(supabaseServer, dry_run, {
        now: new Date(),
        archiveClient: getArchiveClient(),
      });

      if (!result.ok) {
        logger.info(
          "RETENTION_SWEEP",
          "sweep_skipped",
          `Retention sweep did not execute: ${result.reason}`,
          {
            tier: retention_tier,
            reason: result.reason,
            requestId: request_id,
          },
        );
        res.status(200).json(result);
        return;
      }

      logger.info(
        "RETENTION_SWEEP",
        "sweep_completed",
        `Retention sweep completed for tier ${retention_tier}`,
        {
          tier: retention_tier,
          deletedCount: result.deleted_count,
          dryRun: dry_run,
          requestId: request_id,
        },
      );
      res.status(200).json(result);
    } catch (err: unknown) {
      logger.error(
        "RETENTION_SWEEP",
        "sweep_error",
        "Unexpected error during retention sweep",
        err instanceof Error ? err : undefined,
        { tier: retention_tier, requestId: request_id },
      );
      // 500 triggers Cloud Scheduler retry — appropriate for unexpected errors
      res.status(500).json({ error: { message: "Internal error" } });
    }
  },
);

export default router;
