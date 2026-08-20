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
import { oidcAuthMiddleware } from "../../packages/shared/internal-auth/verify-oidc-middleware";

const router = Router();

// ── OIDC config ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03C_V3 §9.3]
 *
 * Same OIDC pattern as compaction/async memory routes.
 * Uses a distinct env var for audience so each handler can enforce
 * its own audience claim independently.
 */
const OIDC_AUDIENCE =
  process.env.RETENTION_SWEEP_OIDC_AUDIENCE ??
  process.env.CLOUD_TASKS_OIDC_AUDIENCE ??
  "";
const OIDC_SERVICE_ACCOUNT = process.env.CLOUD_TASKS_SERVICE_ACCOUNT ?? "";

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

// ── Tier sweep functions ─────────────────────────────────────────────

type SweepResult =
  | {
      ok: true;
      deleted_count: number;
      tier: string;
      dry_run: boolean;
    }
  | {
      ok: false;
      reason: string;
      tier: string;
    };

/**
 * @spec [Doc-03_V1.1 §14.2, INV-03-19]
 *
 * 7-day tier: hard-delete tutor_conversations where deleted_at expired.
 * FK cascade handles tutor_messages and tutor_question_links.
 * Separate delete for tutor_memory_summaries (no FK cascade from
 * tutor_conversations — linked by student_id).
 *
 * Measure: deleted_at column (set when entitlement lapses).
 * Condition: deleted_at IS NOT NULL AND deleted_at < now() - 7 days.
 */
async function sweep7d(dryRun: boolean): Promise<SweepResult> {
  const tier = "7d";

  if (dryRun) {
    // Count conversations eligible for hard-delete
    const { count, error } = await supabaseServer
      .from("tutor_conversations")
      .select("id", { count: "exact", head: true })
      .not("deleted_at", "is", null)
      .lt(
        "deleted_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );

    if (error) {
      return { ok: false, reason: `count_failed: ${error.message}`, tier };
    }
    return { ok: true, deleted_count: count ?? 0, tier, dry_run: true };
  }

  // Hard-delete expired soft-deleted conversations (FK cascades messages + question_links)
  const { data: deletedConvos, error: deleteConvosError } = await supabaseServer
    .from("tutor_conversations")
    .delete()
    .not("deleted_at", "is", null)
    .lt(
      "deleted_at",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .select("id, student_id");

  if (deleteConvosError) {
    return {
      ok: false,
      reason: `delete_failed: ${deleteConvosError.message}`,
      tier,
    };
  }

  const deletedCount = deletedConvos?.length ?? 0;

  // Also clean up memory summaries for affected students
  // tutor_memory_summaries links by student_id, not conversation FK.
  // Per spec: "retained for 7 days, then purged" — same window.
  if (deletedConvos && deletedConvos.length > 0) {
    const studentIds = [
      ...new Set(
        deletedConvos.map((c) => (c as { student_id: string }).student_id),
      ),
    ];
    for (const sid of studentIds) {
      // Check if student has any remaining non-deleted conversations
      const { count: remainingConvos } = await supabaseServer
        .from("tutor_conversations")
        .select("id", { count: "exact", head: true })
        .eq("student_id", sid)
        .is("deleted_at", null);

      // Only purge memory summaries if the student has zero active conversations
      if (remainingConvos === 0) {
        const { error: memError } = await supabaseServer
          .from("tutor_memory_summaries")
          .delete()
          .eq("student_id", sid);

        if (memError) {
          logger.warn(
            "RETENTION_SWEEP",
            "memory_summary_delete_failed",
            "Failed to delete memory summaries for student with no remaining conversations",
            { studentId: sid, dbError: memError.message },
          );
        }
      }
    }
  }

  return { ok: true, deleted_count: deletedCount, tier, dry_run: false };
}

/**
 * @spec [Doc-03_V1.1 §14.2]
 *
 * 90-day tier: delete tutor_instruction_assignments and
 * tutor_instruction_exposures older than 90 days from creation.
 *
 * Spec: "90 days from creation, then aggregated" / "Automatic archival
 * at 90 days." We delete (no cold-storage archival at V1).
 */
async function sweep90d(dryRun: boolean): Promise<SweepResult> {
  const tier = "90d";
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  if (dryRun) {
    const { count: assignmentCount, error: e1 } = await supabaseServer
      .from("tutor_instruction_assignments")
      .select("id", { count: "exact", head: true })
      .lt("created_at", cutoff);

    const { count: exposureCount, error: e2 } = await supabaseServer
      .from("tutor_instruction_exposures")
      .select("id", { count: "exact", head: true })
      .lt("created_at", cutoff);

    if (e1 || e2) {
      return {
        ok: false,
        reason: `count_failed: ${e1?.message ?? e2?.message}`,
        tier,
      };
    }
    return {
      ok: true,
      deleted_count: (assignmentCount ?? 0) + (exposureCount ?? 0),
      tier,
      dry_run: true,
    };
  }

  const { data: delAssignments, error: e1 } = await supabaseServer
    .from("tutor_instruction_assignments")
    .delete()
    .lt("created_at", cutoff)
    .select("id");

  const { data: delExposures, error: e2 } = await supabaseServer
    .from("tutor_instruction_exposures")
    .delete()
    .lt("created_at", cutoff)
    .select("id");

  if (e1 || e2) {
    return {
      ok: false,
      reason: `delete_failed: ${e1?.message ?? e2?.message}`,
      tier,
    };
  }

  return {
    ok: true,
    deleted_count: (delAssignments?.length ?? 0) + (delExposures?.length ?? 0),
    tier,
    dry_run: false,
  };
}

/**
 * @spec [Doc-03_V1.1 §14.2]
 *
 * 180-day tier: delete crisis_review_cases and tutor_injection_log
 * older than 180 days.
 *
 * crisis_review_cases: "180 days (extended for safety review). Manual
 * purge by safety review queue owner after incident closure."
 * For automated sweep: only delete CLOSED cases older than 180 days.
 * Open cases are retained regardless of age (safety review ongoing).
 *
 * tutor_injection_log: "Automatic archival at 180 days."
 */
async function sweep180d(dryRun: boolean): Promise<SweepResult> {
  const tier = "180d";
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  if (dryRun) {
    // Crisis cases: only closed cases older than 180 days
    const { count: crisisCount, error: e1 } = await supabaseServer
      .from("crisis_review_cases")
      .select("id", { count: "exact", head: true })
      .eq("status", "closed")
      .lt("flagged_at", cutoff);

    const { count: injectionCount, error: e2 } = await supabaseServer
      .from("tutor_injection_log")
      .select("id", { count: "exact", head: true })
      .lt("detected_at", cutoff);

    if (e1 || e2) {
      return {
        ok: false,
        reason: `count_failed: ${e1?.message ?? e2?.message}`,
        tier,
      };
    }
    return {
      ok: true,
      deleted_count: (crisisCount ?? 0) + (injectionCount ?? 0),
      tier,
      dry_run: true,
    };
  }

  // Crisis: only delete CLOSED cases. Open/in-review cases are retained.
  // crisis_review_audit_log cascades via FK.
  const { data: delCrisis, error: e1 } = await supabaseServer
    .from("crisis_review_cases")
    .delete()
    .eq("status", "closed")
    .lt("flagged_at", cutoff)
    .select("id");

  const { data: delInjection, error: e2 } = await supabaseServer
    .from("tutor_injection_log")
    .delete()
    .lt("detected_at", cutoff)
    .select("id");

  if (e1 || e2) {
    return {
      ok: false,
      reason: `delete_failed: ${e1?.message ?? e2?.message}`,
      tier,
    };
  }

  return {
    ok: true,
    deleted_count: (delCrisis?.length ?? 0) + (delInjection?.length ?? 0),
    tier,
    dry_run: false,
  };
}

/**
 * @spec [Doc-03_V1.1 §14.2]
 *
 * 365-day tier: LISA cost telemetry and quota appeal records.
 * Tables not yet provisioned — returns a structured no-op.
 */
async function sweep365d(_dryRun: boolean): Promise<SweepResult> {
  return {
    ok: false,
    reason: "365d_tables_not_provisioned",
    tier: "365d",
  };
}

// ── Tier dispatch ────────────────────────────────────────────────────

const TIER_HANDLERS: Record<string, (dryRun: boolean) => Promise<SweepResult>> =
  {
    "7d": sweep7d,
    "90d": sweep90d,
    "180d": sweep180d,
    "365d": sweep365d,
  };

// ── Route ─────────────────────────────────────────────────────────────

router.post(
  "/retention/sweep",
  oidcAuthMiddleware({
    expectedAudience: OIDC_AUDIENCE,
    expectedServiceAccount: OIDC_SERVICE_ACCOUNT,
  }),
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
      const result = await handler(dry_run);

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
