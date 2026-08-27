/**
 * @spec [Doc-03_V1.1 §14.2, INV-03-19]
 * @implemented 2026-08-21
 *
 * plain English: Retention sweep tier functions for LISA data. Each function
 * deletes only rows that have crossed the retention boundary for its tier,
 * returns the deletion count, and leaves unexpired rows untouched.
 *
 * Extracted from the route handler for testability — each function accepts a
 * SupabaseClient parameter and a controllable clock, following the established
 * stale-session-sweep.ts pattern.
 *
 * expected outcome: given a clock time, each tier function deletes only rows
 * whose retention timestamp is strictly before (now − tier_window).
 * 90d/180d tiers export rows to BigQuery before deletion (Karl ruling:
 * archival destination is BigQuery, aggregation at query time).
 *
 * trade-offs:
 *  - Client injection is the same pattern as server/lib/stale-session-sweep.ts.
 *    The route handler passes supabaseServer; tests pass a filtering mock.
 *  - 90d/180d tiers require an injected ArchiveClient (opts.archiveClient).
 *    If undefined, they return ok: false — same safe-default as before.
 *    Archive failure blocks delete — no data loss.
 *  - 365d tier is a structured no-op until tables are provisioned.
 *  - 7d tier: memory summaries are only purged when a student has zero
 *    remaining active conversations (conservative — spec says "cascade
 *    from account / entitlement").
 *  - 180d crisis: only RESOLVED cases are swept. Open/in-review cases are
 *    retained regardless of age (safety review ongoing). Spec: "hard delete
 *    at 180 days or on closure, whichever is later." The crisis_review_cases
 *    CHECK constraint allows ('open', 'in_review', 'resolved') — there is
 *    no 'closed' status.
 *
 * edge cases:
 *  - Duplicate delivery: DELETE is idempotent — already-deleted rows don't
 *    match the WHERE clause.
 *  - Empty result: normal for tiers with no expired rows. Returns
 *    { ok: true, deleted_count: 0 }.
 *  - 180d crisis: open cases older than 180 days are retained (safety review
 *    ongoing). The dual condition (status=resolved AND created_at<cutoff)
 *    naturally implements "hard delete at 180 days or on closure, whichever
 *    is later" — both conditions must be met.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../logger";
import { type ArchiveClient, archiveRows } from "./retention-archive";

// ── Types ─────────────────────────────────────────────────────────────

export type SweepResult =
  | { ok: true; deleted_count: number; tier: string; dry_run: boolean }
  | { ok: false; reason: string; tier: string };

export type SweepOpts = {
  now: Date;
  /**
   * BigQuery archive client for 90d/180d tiers. If undefined, tiers
   * that require archival return ok: false with reason
   * "archive_client_not_configured" — same safe-default as the previous
   * "archival_destination_pending." Injected by the route handler in
   * production; tests pass a recording mock.
   */
  archiveClient?: ArchiveClient;
};

export type TierHandler = (
  client: SupabaseClient,
  dryRun: boolean,
  opts: SweepOpts,
) => Promise<SweepResult>;

// ── Constants ─────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * crisis_review_cases status lifecycle: open → in_review → resolved.
 * Source of truth: migration 20260813000000_crisis_review_queue.sql,
 * CHECK (status IN ('open', 'in_review', 'resolved')).
 *
 * Exported so tests derive valid status values from the code that uses
 * them rather than hardcoding strings that can silently drift (LISA-GCP-002).
 */
export const CRISIS_STATUS = {
  /** Initial state when a crisis case is created. */
  OPEN: "open" as const,
  /** Reviewer has claimed the case. */
  IN_REVIEW: "in_review" as const,
  /** Terminal: incident resolved by reviewer. Only resolved cases are swept. */
  RESOLVED: "resolved" as const,
};

/**
 * Pure. Returns ISO cutoff timestamp for a given number of days before now.
 * Separated from IO so the boundary itself is testable — an off-by-one in
 * the window is the failure mode that would quietly sweep live data or
 * silently retain expired data.
 */
export function retentionCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

// ── 7-day tier ────────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2, INV-03-19]
 *
 * Hard-delete tutor_conversations where deleted_at expired (soft-deleted
 * 7+ days ago). FK cascade handles tutor_messages and tutor_question_links.
 * Separate cleanup for tutor_memory_summaries (linked by student_id, not
 * conversation FK).
 *
 * Measure: deleted_at column (set when entitlement lapses).
 * Condition: deleted_at IS NOT NULL AND deleted_at < now() − 7 days.
 */
export async function sweep7d(
  client: SupabaseClient,
  dryRun: boolean,
  opts: SweepOpts,
): Promise<SweepResult> {
  const tier = "7d";
  const cutoff = retentionCutoff(opts.now, 7);

  if (dryRun) {
    const { count, error } = await client
      .from("tutor_conversations")
      .select("id", { count: "exact", head: true })
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);

    if (error) {
      return { ok: false, reason: `count_failed: ${error.message}`, tier };
    }
    return { ok: true, deleted_count: count ?? 0, tier, dry_run: true };
  }

  // Hard-delete expired soft-deleted conversations (FK cascades messages + question_links)
  const { data: deletedConvos, error: deleteConvosError } = await client
    .from("tutor_conversations")
    .delete()
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .select("id, student_id");

  if (deleteConvosError) {
    return {
      ok: false,
      reason: `delete_failed: ${deleteConvosError.message}`,
      tier,
    };
  }

  const deletedCount = deletedConvos?.length ?? 0;

  // Also clean up memory summaries for affected students.
  // tutor_memory_summaries links by student_id, not conversation FK.
  //
  // Purge ONLY when a student has:
  //   (a) zero active conversations (deleted_at IS NULL), AND
  //   (b) zero soft-deleted conversations still inside the 7-day recovery
  //       window (deleted_at >= cutoff).
  //
  // Without (b), a student with ALL conversations soft-deleted — some only
  // 2 days old — would lose memory summaries even though the spec promises
  // "LISA data is recovered with conversation history intact" during the
  // 7-day window (§14.2, INV-03-19). The summaries are per-student, not
  // per-conversation, so they must survive as long as ANY conversation is
  // still recoverable.
  if (deletedConvos && deletedConvos.length > 0) {
    const studentIds = [
      ...new Set(
        deletedConvos.map((c) => (c as { student_id: string }).student_id),
      ),
    ];
    for (const sid of studentIds) {
      // (a) any active conversations?
      const { count: activeConvos } = await client
        .from("tutor_conversations")
        .select("id", { count: "exact", head: true })
        .eq("student_id", sid)
        .is("deleted_at", null);

      if ((activeConvos ?? 0) > 0) continue;

      // (b) any soft-deleted conversations still within the recovery window?
      // Those have deleted_at >= cutoff (i.e. deleted less than 7 days ago).
      const { count: recoverableConvos } = await client
        .from("tutor_conversations")
        .select("id", { count: "exact", head: true })
        .eq("student_id", sid)
        .not("deleted_at", "is", null)
        .gte("deleted_at", cutoff);

      if ((recoverableConvos ?? 0) > 0) continue;

      const { error: memError } = await client
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

  return { ok: true, deleted_count: deletedCount, tier, dry_run: false };
}

// ── 90-day tier ───────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2]
 *
 * Archive then delete tutor_instruction_assignments and
 * tutor_instruction_exposures older than 90 days from creation.
 *
 * Spec: "90 days from creation, then aggregated" / "Automatic archival
 * at 90 days." Karl ruling: archival destination is BigQuery; aggregation
 * at query time (not at sweep time). Raw rows are exported to BQ tables
 * `retention__tutor_instruction_assignments` and
 * `retention__tutor_instruction_exposures` in the archive dataset,
 * then deleted from Supabase.
 *
 * Safety invariant: archive failure blocks delete. If BigQuery insert
 * fails for either table, the function returns ok: false and no rows
 * are deleted from either table. Previously LISA-RET-001.
 */
export async function sweep90d(
  client: SupabaseClient,
  dryRun: boolean,
  opts: SweepOpts,
): Promise<SweepResult> {
  const tier = "90d";
  const cutoff = retentionCutoff(opts.now, 90);

  if (dryRun) {
    const { count: assignmentCount, error: e1 } = await client
      .from("tutor_instruction_assignments")
      .select("id", { count: "exact", head: true })
      .lt("created_at", cutoff);

    const { count: exposureCount, error: e2 } = await client
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

  // ── Archive client guard ──────────────────────────────────────────
  // Without an archive client, deletion is blocked — same safe-default
  // as the previous "archival_destination_pending" behaviour.
  if (!opts.archiveClient) {
    return {
      ok: false,
      reason:
        "archive_client_not_configured: §14.2 requires archival before deletion (LISA-RET-001)",
      tier,
    };
  }

  // ── Step 1: Select expired rows ───────────────────────────────────

  const { data: expiredAssignments, error: selAssignErr } = await client
    .from("tutor_instruction_assignments")
    .select("*")
    .lt("created_at", cutoff);

  if (selAssignErr) {
    return {
      ok: false,
      reason: `select_failed: ${selAssignErr.message}`,
      tier,
    };
  }

  const { data: expiredExposures, error: selExposeErr } = await client
    .from("tutor_instruction_exposures")
    .select("*")
    .lt("created_at", cutoff);

  if (selExposeErr) {
    return {
      ok: false,
      reason: `select_failed: ${selExposeErr.message}`,
      tier,
    };
  }

  const assignRows = (expiredAssignments ?? []) as Record<string, unknown>[];
  const exposeRows = (expiredExposures ?? []) as Record<string, unknown>[];

  // Nothing to sweep
  if (assignRows.length === 0 && exposeRows.length === 0) {
    return { ok: true, deleted_count: 0, tier, dry_run: false };
  }

  // ── Step 2: Archive to BigQuery ───────────────────────────────────
  // Both tables must archive successfully before ANY delete proceeds.

  if (assignRows.length > 0) {
    const archResult = await archiveRows(
      opts.archiveClient,
      "tutor_instruction_assignments",
      assignRows,
      opts.now,
    );
    if (!archResult.ok) {
      return {
        ok: false,
        reason: `archive_blocked_delete: ${archResult.reason}`,
        tier,
      };
    }
  }

  if (exposeRows.length > 0) {
    const archResult = await archiveRows(
      opts.archiveClient,
      "tutor_instruction_exposures",
      exposeRows,
      opts.now,
    );
    if (!archResult.ok) {
      return {
        ok: false,
        reason: `archive_blocked_delete: ${archResult.reason}`,
        tier,
      };
    }
  }

  // ── Step 3: Delete from Supabase ──────────────────────────────────
  // Same predicates as select — guaranteed to match the same rows because
  // the cutoff is in the past (no new rows can match).

  let totalDeleted = 0;

  if (assignRows.length > 0) {
    const { data: deletedAssign, error: delAssignErr } = await client
      .from("tutor_instruction_assignments")
      .delete()
      .lt("created_at", cutoff)
      .select("id");

    if (delAssignErr) {
      return {
        ok: false,
        reason: `delete_failed: ${delAssignErr.message}`,
        tier,
      };
    }
    totalDeleted += deletedAssign?.length ?? 0;
  }

  if (exposeRows.length > 0) {
    const { data: deletedExpose, error: delExposeErr } = await client
      .from("tutor_instruction_exposures")
      .delete()
      .lt("created_at", cutoff)
      .select("id");

    if (delExposeErr) {
      return {
        ok: false,
        reason: `delete_failed: ${delExposeErr.message}`,
        tier,
      };
    }
    totalDeleted += deletedExpose?.length ?? 0;
  }

  logger.info(
    "RETENTION_SWEEP",
    "sweep_90d_archive_delete",
    `90d sweep: archived and deleted ${totalDeleted} rows`,
    {
      assignmentsArchived: assignRows.length,
      exposuresArchived: exposeRows.length,
      totalDeleted,
    },
  );

  return { ok: true, deleted_count: totalDeleted, tier, dry_run: false };
}

// ── 180-day tier ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2]
 *
 * Archive then delete crisis review cases and injection logs older than
 * 180 days.
 *
 * Crisis review cases: only RESOLVED cases older than 180 days from created_at
 * (the crisis flag timestamp). Open/in-review cases retained regardless of
 * age — safety review ongoing. Spec: "hard delete at 180 days or on closure,
 * whichever is later" — the dual condition (status=resolved AND created_at<cutoff)
 * naturally implements this.
 *
 * Note: the crisis_review_cases CHECK constraint allows ('open', 'in_review',
 * 'resolved'). The terminal lifecycle state is "resolved", NOT "closed".
 * Prior to this fix, the sweep filtered on status='closed' which matched
 * zero rows — resolved cases accumulated indefinitely (LISA-GCP-002).
 *
 * Injection log: older than 180 days from detected_at.
 *
 * Karl ruling: archival destination is BigQuery; aggregation at query time.
 * Raw rows exported to BQ archive dataset before deletion.
 *
 * Safety invariant: archive failure blocks delete. If BigQuery insert
 * fails for either table, no rows are deleted. Previously LISA-RET-002.
 *
 * Privacy note: crisis review cases are minors' data (students 13–18).
 * Archived copies in BigQuery are subject to Doc 07E retention classes.
 */
export async function sweep180d(
  client: SupabaseClient,
  dryRun: boolean,
  opts: SweepOpts,
): Promise<SweepResult> {
  const tier = "180d";
  const cutoff = retentionCutoff(opts.now, 180);

  if (dryRun) {
    // Crisis cases: only resolved cases older than 180 days
    const { count: crisisCount, error: e1 } = await client
      .from("crisis_review_cases")
      .select("id", { count: "exact", head: true })
      .eq("status", CRISIS_STATUS.RESOLVED)
      .lt("created_at", cutoff);

    const { count: injectionCount, error: e2 } = await client
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

  // ── Archive client guard ──────────────────────────────────────────
  if (!opts.archiveClient) {
    return {
      ok: false,
      reason:
        "archive_client_not_configured: §14.2 requires archival before deletion (LISA-RET-002)",
      tier,
    };
  }

  // ── Step 1: Select expired rows ───────────────────────────────────

  // Crisis cases: resolved AND older than 180 days
  const { data: expiredCrisis, error: selCrisisErr } = await client
    .from("crisis_review_cases")
    .select("*")
    .eq("status", CRISIS_STATUS.RESOLVED)
    .lt("created_at", cutoff);

  if (selCrisisErr) {
    return {
      ok: false,
      reason: `select_failed: ${selCrisisErr.message}`,
      tier,
    };
  }

  // Injection log: older than 180 days from detected_at
  const { data: expiredInjections, error: selInjErr } = await client
    .from("tutor_injection_log")
    .select("*")
    .lt("detected_at", cutoff);

  if (selInjErr) {
    return {
      ok: false,
      reason: `select_failed: ${selInjErr.message}`,
      tier,
    };
  }

  const crisisRows = (expiredCrisis ?? []) as Record<string, unknown>[];
  const injectionRows = (expiredInjections ?? []) as Record<string, unknown>[];

  // Nothing to sweep
  if (crisisRows.length === 0 && injectionRows.length === 0) {
    return { ok: true, deleted_count: 0, tier, dry_run: false };
  }

  // ── Step 2: Archive to BigQuery ───────────────────────────────────
  // Both tables must archive successfully before ANY delete proceeds.

  if (crisisRows.length > 0) {
    const archResult = await archiveRows(
      opts.archiveClient,
      "crisis_review_cases",
      crisisRows,
      opts.now,
    );
    if (!archResult.ok) {
      return {
        ok: false,
        reason: `archive_blocked_delete: ${archResult.reason}`,
        tier,
      };
    }
  }

  if (injectionRows.length > 0) {
    const archResult = await archiveRows(
      opts.archiveClient,
      "tutor_injection_log",
      injectionRows,
      opts.now,
    );
    if (!archResult.ok) {
      return {
        ok: false,
        reason: `archive_blocked_delete: ${archResult.reason}`,
        tier,
      };
    }
  }

  // ── Step 3: Delete from Supabase ──────────────────────────────────

  let totalDeleted = 0;

  if (crisisRows.length > 0) {
    const { data: deletedCrisis, error: delCrisisErr } = await client
      .from("crisis_review_cases")
      .delete()
      .eq("status", CRISIS_STATUS.RESOLVED)
      .lt("created_at", cutoff)
      .select("id");

    if (delCrisisErr) {
      return {
        ok: false,
        reason: `delete_failed: ${delCrisisErr.message}`,
        tier,
      };
    }
    totalDeleted += deletedCrisis?.length ?? 0;
  }

  if (injectionRows.length > 0) {
    const { data: deletedInjections, error: delInjErr } = await client
      .from("tutor_injection_log")
      .delete()
      .lt("detected_at", cutoff)
      .select("id");

    if (delInjErr) {
      return {
        ok: false,
        reason: `delete_failed: ${delInjErr.message}`,
        tier,
      };
    }
    totalDeleted += deletedInjections?.length ?? 0;
  }

  logger.info(
    "RETENTION_SWEEP",
    "sweep_180d_archive_delete",
    `180d sweep: archived and deleted ${totalDeleted} rows`,
    {
      crisisArchived: crisisRows.length,
      injectionsArchived: injectionRows.length,
      totalDeleted,
    },
  );

  return { ok: true, deleted_count: totalDeleted, tier, dry_run: false };
}

// ── 365-day tier ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2]
 *
 * LISA cost telemetry and quota appeal records. Tables not yet provisioned —
 * returns a structured no-op.
 */
export async function sweep365d(
  _client: SupabaseClient,
  _dryRun: boolean,
  _opts: SweepOpts,
): Promise<SweepResult> {
  return {
    ok: false,
    reason: "365d_tables_not_provisioned",
    tier: "365d",
  };
}

// ── Tier dispatch ─────────────────────────────────────────────────────

export const TIER_HANDLERS: Record<string, TierHandler> = {
  "7d": sweep7d,
  "90d": sweep90d,
  "180d": sweep180d,
  "365d": sweep365d,
};
