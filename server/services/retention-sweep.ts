/**
 * @spec [Doc-03_V1.1 §14.2, INV-03-19; owner ruling 2026-10-05 RS-00]
 * @implemented 2026-08-21 (7d tier moved into SQL 2026-10-05)
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
 * 90d/180d tiers delete outright (owner ruling 2026-09-22; the earlier
 * BigQuery-destination ruling is reversed — see SCL-106 and SCL-108).
 *
 * trade-offs:
 *  - Client injection is the same pattern as server/lib/stale-session-sweep.ts.
 *    The route handler passes supabaseServer; the real-Postgres suite passes
 *    the PG harness.
 *  - 90d/180d tiers delete outright. They used to export every expired row
 *    to BigQuery first and refuse to delete when they could not; the owner
 *    ruling of 2026-09-22 removed the archive (Doc 07B §5.4 — the exported
 *    rows carried student_id, reviewer_id and reviewer free text about
 *    minors). Nothing was ever archived, so nothing was migrated. Neither
 *    tier can decline any more.
 *  - 365d tier is a structured no-op until tables are provisioned.
 *  - 7d tier (RS-00, 2026-10-05): one SQL function,
 *    `sweep_tutor_conversation_retention`. It never deletes a crisis-flagged
 *    conversation (any crisis_review_cases / crisis_review_events row links to
 *    it — Doc 03 §14.2 keeps those for manual purge), and purges a student's
 *    memory summaries only when no live, recoverable or flagged conversation
 *    remains. Tests run it against real Postgres
 *    (tests/ci/retention-sweep.pg.ci.test.ts), not the filtering mock.
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
import { z } from "zod";
import { retentionSweepRowSchema } from "../../packages/shared/src/retention-schema";
import { logger } from "../logger";

// ── Types ─────────────────────────────────────────────────────────────

/** Rows per table a tier deleted (or, in a dry run, would delete). */
export type SweepTableCount = { table: string; count: number };

export type SweepResult =
  | {
      ok: true;
      deleted_count: number;
      tier: string;
      dry_run: boolean;
      /** Per-table counts, cascades included (RS-03). Absent only where a tier has none. */
      per_table?: SweepTableCount[];
    }
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
 * @spec [Doc-03_V1.1 §14.2, INV-03-19; owner ruling 2026-10-05 RS-00 (crisis-flagged
 *       conversations are never swept: manual purge only)] | @implemented [2026-08-20;
 *       crisis hold 2026-10-05]
 *
 * plain English: the 7d tier is ONE SQL function,
 * `sweep_tutor_conversation_retention(p_dry_run)` (migration 20261025000000). It deletes
 * conversations soft-deleted more than 7 days ago — except any a `crisis_review_cases` or
 * `crisis_review_events` row links to — with their cascade rows, and the memory summaries of
 * students left with no live, recoverable or flagged conversation. The check and the delete are
 * one transaction, so a flag cannot land between them; PostgREST could not say that in one
 * statement, which is why the rule moved out of this file.
 *
 * Measure: `deleted_at` (set when entitlement lapses). The cutoff is the function's own `now()`,
 * not `opts.now`: the database clock decides, as for every other SQL-owned sweep.
 *
 * edge cases: an RPC error or an unparsable answer is `ok: false` (the route logs it and answers
 * 200 with the reason, as for every declined tier); nothing is deleted on a dry run.
 */
export async function sweep7d(
  client: SupabaseClient,
  dryRun: boolean,
  _opts: SweepOpts,
): Promise<SweepResult> {
  const tier = "7d";
  const { data, error } = await client.rpc(
    "sweep_tutor_conversation_retention",
    { p_dry_run: dryRun },
  );
  if (error) {
    return { ok: false, reason: `rpc_failed: ${error.message}`, tier };
  }
  const parsed = z.array(retentionSweepRowSchema).safeParse(data);
  if (!parsed.success || parsed.data.length === 0) {
    return { ok: false, reason: "rpc_malformed", tier };
  }
  const per_table = parsed.data.map((r) => ({
    table: r.swept_table,
    count: r.deleted_count,
  }));
  const conversations =
    per_table.find((r) => r.table === "tutor_conversations")?.count ?? 0;
  return {
    ok: true,
    deleted_count: conversations,
    tier,
    dry_run: dryRun,
    per_table,
  };
}

// ── 90-day tier ───────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2; owner ruling 2026-09-22 (Doc 07B §5.4)]
 * @implemented [2026-09-22]
 *
 * Delete tutor_instruction_assignments and tutor_instruction_exposures older
 * than 90 days from creation.
 *
 * plain English: the rows go. Nothing is copied anywhere first.
 *
 * WHY THERE IS NO ARCHIVE STEP ANY MORE. From 2026-08-26 this tier exported
 * every expired row to BigQuery before deleting it, and refused to delete at
 * all when it could not (LISA-RET-001, "archive failure blocks delete — no
 * data loss"). The owner ruling of 2026-09-22 removed the archive outright:
 * "stop archiving, delete outright ... the archive carries student_id,
 * reviewer_id and free-text notes about minors in crisis. BigQuery is the
 * worst home for those. Nothing has ever been archived, so there's nothing to
 * migrate." Doc 07B §5.4 bans identity-bearing columns in the warehouse
 * absolutely, and these rows are not pseudonymized — so the safe-default that
 * blocked deletion was protecting a copy that should never have existed.
 *
 * expected outcome: rows past 90 days are gone; rows inside the window stay.
 * The tier can no longer decline: there is nothing left to be unconfigured.
 *
 * trade-offs: the aggregate analytics Doc 03 §14.2 contemplated ("archived
 * data is moved to cold storage in aggregated form for analytics") are not
 * produced by anything. That sentence is superseded by the ruling and filed
 * as SCL-108; it was never true in the build either, because the archive
 * client's dependency was never installed.
 *
 * edge cases: the delete is idempotent — a second run matches nothing, since
 * the cutoff is in the past and the rows are gone.
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

  let totalDeleted = 0;

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

  logger.info(
    "RETENTION_SWEEP",
    "sweep_90d_delete",
    `90d sweep: deleted ${totalDeleted} rows`,
    {
      assignmentsDeleted: deletedAssign?.length ?? 0,
      exposuresDeleted: deletedExpose?.length ?? 0,
      totalDeleted,
    },
  );

  return { ok: true, deleted_count: totalDeleted, tier, dry_run: false };
}
// ── 180-day tier ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2; owner ruling 2026-09-22 (Doc 07B §5.4)]
 * @implemented [2026-09-22]
 *
 * Delete resolved crisis review cases and injection logs older than 180 days.
 *
 * Crisis review cases: only RESOLVED cases older than 180 days from created_at
 * (the crisis flag timestamp). Open/in-review cases are retained regardless of
 * age — safety review ongoing. Spec: "hard delete at 180 days or on closure,
 * whichever is later" — the dual condition (status=resolved AND
 * created_at<cutoff) naturally implements this.
 *
 * Note: the crisis_review_cases CHECK constraint allows ('open', 'in_review',
 * 'resolved'). The terminal lifecycle state is "resolved", NOT "closed".
 * Filtering on 'closed' matched zero rows and let resolved cases accumulate
 * indefinitely (LISA-GCP-002).
 *
 * Injection log: older than 180 days from detected_at.
 *
 * WHY THERE IS NO ARCHIVE STEP ANY MORE, AND WHY IT MATTERS MOST HERE. This
 * tier used to export every expired row to BigQuery first (LISA-RET-002).
 * `crisis_review_cases` is the table that ended the practice: it carries
 * `student_id`, `reviewer_id` and `review_notes` — free text written by a
 * human reviewer about a minor in crisis — and Doc 07B §5.4 bans
 * identity-bearing columns in the warehouse outright. The owner ruling of
 * 2026-09-22: "BigQuery is the worst home for those." Nothing was ever
 * archived, so nothing was migrated; the rows are simply deleted now.
 *
 * expected outcome: resolved cases past 180 days go, open and in-review cases
 * stay at any age, and the tier can no longer decline.
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

  let totalDeleted = 0;

  // Resolved AND older than 180 days. Both conditions, every time: an open
  // case is never deleted by age alone.
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

  const { data: deletedInjections, error: delInjErr } = await client
    .from("tutor_injection_log")
    .delete()
    .lt("detected_at", cutoff)
    .select("id");

  if (delInjErr) {
    return { ok: false, reason: `delete_failed: ${delInjErr.message}`, tier };
  }
  totalDeleted += deletedInjections?.length ?? 0;

  logger.info(
    "RETENTION_SWEEP",
    "sweep_180d_delete",
    `180d sweep: deleted ${totalDeleted} rows`,
    {
      crisisDeleted: deletedCrisis?.length ?? 0,
      injectionsDeleted: deletedInjections?.length ?? 0,
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
