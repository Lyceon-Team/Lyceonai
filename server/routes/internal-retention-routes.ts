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
 *  - 7d tier: `sweep_tutor_conversation_retention` (SQL, RS-00 2026-10-05)
 *    deletes expired soft-deleted conversations EXCEPT crisis-flagged ones,
 *    with their cascade rows, and memory summaries only for students left
 *    with no live, recoverable or flagged conversation.
 *  - 90d/180d tiers delete outright. They used to archive every expired row
 *    to BigQuery first and decline when they could not; the owner ruling of
 *    2026-09-22 removed the archive (Doc 07B §5.4). Neither tier can decline
 *    any more, which is why both are scheduled for the first time. 90d
 *    measures exposures by `shown_at` (RS-04); 180d deletes injection logs
 *    only — crisis cases and their audit rows are manual purge (RS-05).
 *  - 365d tier: tables (cost telemetry, quota appeals) not yet provisioned.
 *    Returns { ok: false, reason: "365d_tables_not_provisioned" }.
 *  - Dry-run (RS-03, 2026-10-05) returns `per_table`: for every tier that
 *    runs, exactly the rows its live run would delete, cascades included
 *    (7d and 90d are SQL functions that count and delete with one
 *    predicate; 180d is one table). Nothing is deleted. Before the first
 *    production run Karl runs the read-only backlog SQL in the PR and
 *    approves the counts.
 *
 * edge cases:
 *  - Duplicate delivery: DELETE is idempotent — already-deleted rows
 *    don't match the WHERE clause.
 *  - Empty result: normal for tiers with no expired rows. Returns
 *    { ok: true, deleted_count: 0 }.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { validationFieldPaths } from "../lib/validation-log";
import {
  oidcAuthMiddlewareWithConfigGuard,
  type OidcConfigReader,
} from "../../packages/shared/internal-auth/verify-oidc-middleware";
import {
  recordSweepCompletion,
  TIER_HANDLERS,
} from "../services/retention-sweep";

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
 *
 * NO FALLBACK (owner ruling 2026-10-05, RS-01). This used to read
 * `RETENTION_SWEEP_OIDC_AUDIENCE ?? CLOUD_TASKS_OIDC_AUDIENCE`. The second is
 * the compact-writeback URL, so with the first unset every Cloud Scheduler
 * token (aud = the sweep URL) was refused as "Wrong recipient" — and a token
 * minted for compact-writeback was ADMITTED to the sweep. An unset audience
 * is now a 500 naming RETENTION_SWEEP_OIDC_AUDIENCE, logged at ERROR. The
 * comparison stays an exact match (google-auth-library `aud ===`): no
 * second audience, no normalisation.
 * Proof: tests/ci/retention-sweep-oidc.contract.test.ts (real RS256 tokens).
 */
const readOidcConfig: OidcConfigReader = () => ({
  expectedAudience: process.env.RETENTION_SWEEP_OIDC_AUDIENCE,
  expectedServiceAccount: process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
  audienceEnvName: "RETENTION_SWEEP_OIDC_AUDIENCE",
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
        // FIELD PATHS, NOT `flatten()`. `fieldErrors` holds Zod's MESSAGE strings, and a
        // `z.enum` failure renders as "Invalid enum value. Expected 'a' | 'b', received
        // 'xyz'" — the rejected value, verbatim, in the line. These payloads are
        // system-generated and the surface is OIDC-authenticated, so this was hygiene
        // rather than a student-data breach; it is still the one thing
        // `validationFieldPaths` exists to make impossible.
        { fields: validationFieldPaths(parsed.error.flatten()) },
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
      // RS-02: the per-tier completion time lives in audit_logs. A failed insert is logged at
      // ERROR inside; the sweep has already committed, so the answer stays 200.
      if (!dry_run) {
        await recordSweepCompletion(supabaseServer, result, request_id);
      }
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
