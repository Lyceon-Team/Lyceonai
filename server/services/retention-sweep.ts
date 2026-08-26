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
 *
 * trade-offs:
 *  - Client injection is the same pattern as server/lib/stale-session-sweep.ts.
 *    The route handler passes supabaseServer; tests pass a filtering mock.
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

// ── Types ─────────────────────────────────────────────────────────────

export type SweepResult =
  | { ok: true; deleted_count: number; tier: string; dry_run: boolean }
  | { ok: false; reason: string; tier: string };

export type SweepOpts = {
  now: Date;
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
 * Delete tutor_instruction_assignments and tutor_instruction_exposures
 * older than 90 days from creation.
 *
 * Spec: "90 days from creation, then aggregated" / "Automatic archival
 * at 90 days." We delete (no cold-storage archival at V1).
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

  const { data: delAssignments, error: e1 } = await client
    .from("tutor_instruction_assignments")
    .delete()
    .lt("created_at", cutoff)
    .select("id");

  const { data: delExposures, error: e2 } = await client
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

// ── 180-day tier ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2]
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

  // Crisis: only delete RESOLVED cases. Open/in-review cases are retained.
  // crisis_review_audit_log cascades via FK.
  const { data: delCrisis, error: e1 } = await client
    .from("crisis_review_cases")
    .delete()
    .eq("status", CRISIS_STATUS.RESOLVED)
    .lt("created_at", cutoff)
    .select("id");

  const { data: delInjection, error: e2 } = await client
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
