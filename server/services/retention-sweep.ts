/**
 * @spec [Doc-03_V1.1 §14.2, INV-03-19; owner rulings 2026-10-05 RS-00, RS-04, RS-05]
 * @implemented 2026-08-21 (7d tier moved into SQL, 90d shown_at, 180d crisis cases removed:
 *   2026-10-05)
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
 *  - 180d tier (RS-05, 2026-10-05): tutor_injection_log only. Crisis cases
 *    and their audit rows are manual purge (Doc 03 §14.2); no tier deletes
 *    them. Tests run against real Postgres.
 *
 * edge cases:
 *  - Duplicate delivery: DELETE is idempotent — already-deleted rows don't
 *    match the WHERE clause.
 *  - Empty result: normal for tiers with no expired rows. Returns
 *    { ok: true, deleted_count: 0 }.
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
      /** Per-table counts, cascades included (RS-03). Every tier that runs reports them. */
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
  return sweepByRpc(
    client,
    "sweep_tutor_conversation_retention",
    "7d",
    dryRun,
    (perTable) =>
      perTable.find((r) => r.table === "tutor_conversations")?.count ?? 0,
  );
}

/**
 * Shared body of the SQL-owned tiers (7d, 90d): call the function, parse its rows with
 * the shared schema, and return them as `per_table`. An RPC error or an unparsable or empty answer
 * is `ok: false`; nothing in TypeScript decides what is deleted. `headline` picks the
 * `deleted_count` the route logs (7d: conversations; 90d: every row).
 */
async function sweepByRpc(
  client: SupabaseClient,
  fn: string,
  tier: string,
  dryRun: boolean,
  headline: (perTable: SweepTableCount[]) => number,
): Promise<SweepResult> {
  const { data, error } = await client.rpc(fn, { p_dry_run: dryRun });
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
  return {
    ok: true,
    deleted_count: headline(per_table),
    tier,
    dry_run: dryRun,
    per_table,
  };
}

// ── 90-day tier ───────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2 ("90 days from creation" for both tables); owner ruling 2026-09-22
 *       (Doc 07B §5.4); owner rulings 2026-10-05 RS-04 (exposures measured by shown_at) and
 *       RS-03 (the dry run counts exactly what the live run removes)]
 * @implemented [2026-09-22; shown_at and SQL 2026-10-05]
 *
 * Delete tutor_instruction_assignments and tutor_instruction_exposures older
 * than 90 days from creation. Creation is `created_at` for assignments and
 * `shown_at` for exposures, which have no `created_at` column: until RS-04
 * every run, dry or live, failed with "column does not exist" and the mock
 * tests could not see it (tests/ci/retention-sweep.pg.ci.test.ts now runs
 * this tier against real Postgres).
 *
 * ONE SQL FUNCTION (RS-03): `sweep_tutor_instruction_retention(p_dry_run)`
 * (migration 20261025000001). Deleting an assignment cascades every exposure
 * of it, including one shown inside the window; PostgREST could neither
 * count nor report those, so the dry run under-counted the live run. The
 * function counts and deletes with one predicate and returns per-table rows.
 * The cutoff is the database clock, not `opts.now`.
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
  _opts: SweepOpts,
): Promise<SweepResult> {
  const result = await sweepByRpc(
    client,
    "sweep_tutor_instruction_retention",
    "90d",
    dryRun,
    (perTable) => perTable.reduce((n, r) => n + r.count, 0),
  );
  if (result.ok && !dryRun) {
    logger.info(
      "RETENTION_SWEEP",
      "sweep_90d_delete",
      `90d sweep: deleted ${result.deleted_count} rows`,
      { perTable: result.per_table, totalDeleted: result.deleted_count },
    );
  }
  return result;
}
// ── 180-day tier ──────────────────────────────────────────────────────

/**
 * @spec [Doc-03_V1.1 §14.2 ("Crisis-flagged conversations | 180 days (extended for safety
 *       review) | Manual purge by safety review queue owner after incident closure");
 *       owner ruling 2026-09-22 (Doc 07B §5.4); owner ruling 2026-10-05 RS-05 (the 180d tier
 *       stops deleting crisis_review_cases: cases and their audit rows are manual purge only;
 *       it keeps deleting tutor_injection_log past 180 days)]
 * @implemented [2026-09-22; crisis cases removed 2026-10-05]
 *
 * plain English: delete tutor_injection_log rows detected more than 180 days ago. Nothing else.
 *
 * WHY CRISIS CASES ARE NOT HERE ANY MORE. Until RS-05 this tier also deleted resolved crisis
 * cases older than 180 days. That was wrong twice over: the spec makes their purge manual (the
 * safety review queue owner, after incident closure), and every resolved case carries the
 * `disposition_set` audit row SCL-025 requires, which references it ON DELETE RESTRICT — so the
 * delete failed and took the whole tier down with it, injection logs included. The Privacy
 * Policy's "up to ninety (90) days after resolution" for flagged content disagrees with Doc 03
 * §14.2; that is on the counsel backlog (docs/plans/Guardian_Closure_Plan.md), not decided here.
 *
 * Archive: none (owner ruling 2026-09-22, Doc 07B §5.4) — the rows are deleted outright.
 *
 * expected outcome: injection rows past 180 days go, younger ones stay, every crisis case and
 * audit row stays at any age; the tier cannot decline except on a database error.
 */
export async function sweep180d(
  client: SupabaseClient,
  dryRun: boolean,
  opts: SweepOpts,
): Promise<SweepResult> {
  const tier = "180d";
  const cutoff = retentionCutoff(opts.now, 180);

  if (dryRun) {
    const { count: injectionCount, error } = await client
      .from("tutor_injection_log")
      .select("id", { count: "exact", head: true })
      .lt("detected_at", cutoff);

    if (error) {
      return { ok: false, reason: `count_failed: ${error.message}`, tier };
    }
    return {
      ok: true,
      deleted_count: injectionCount ?? 0,
      tier,
      dry_run: true,
      per_table: [{ table: "tutor_injection_log", count: injectionCount ?? 0 }],
    };
  }

  const { data: deletedInjections, error: delInjErr } = await client
    .from("tutor_injection_log")
    .delete()
    .lt("detected_at", cutoff)
    .select("id");

  if (delInjErr) {
    return { ok: false, reason: `delete_failed: ${delInjErr.message}`, tier };
  }
  const totalDeleted = deletedInjections?.length ?? 0;

  logger.info(
    "RETENTION_SWEEP",
    "sweep_180d_delete",
    `180d sweep: deleted ${totalDeleted} rows`,
    { injectionsDeleted: totalDeleted, totalDeleted },
  );

  return {
    ok: true,
    deleted_count: totalDeleted,
    tier,
    dry_run: false,
    per_table: [{ table: "tutor_injection_log", count: totalDeleted }],
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

// ── Completion record ─────────────────────────────────────────────────

/** `audit_logs.action` for a finished live sweep. One row per tier per successful run. */
export const SWEEP_COMPLETED_ACTION = "retention_sweep_completed" as const;

/**
 * @spec [Doc-03_V1.1 §14.2; owner ruling 2026-10-05 RS-02 (record each successful sweep's
 *       completion time per tier in an existing ledger)] | @implemented [2026-10-05]
 *
 * plain English: after a live sweep succeeds, write one `audit_logs` row — action
 * `retention_sweep_completed`, no actor, no target, context `{tier, deleted_count, per_table,
 * request_id}`. `created_at` is the completion time. "When did the 7d tier last succeed?" is then
 * one query instead of a log search:
 *   SELECT context->>'tier' AS tier, max(created_at) FROM audit_logs
 *    WHERE action = 'retention_sweep_completed' GROUP BY 1;
 *
 * trade-offs: `audit_logs` (append-only; existing) rather than a new table — the brief asked for
 * an existing ledger. Counts only: no ids, no student data. A dry run, or a tier that declined,
 * records nothing, so the row means "rows past the window were actually removed".
 *
 * edge cases: an insert failure returns false and is logged at ERROR
 * (`sweep_completion_record_failed`); it does not undo or fail the sweep, which has already
 * committed.
 */
export async function recordSweepCompletion(
  client: SupabaseClient,
  result: Extract<SweepResult, { ok: true }>,
  requestId: string,
): Promise<boolean> {
  const { error } = await client.from("audit_logs").insert({
    actor_profile_id: null,
    target_profile_id: null,
    action: SWEEP_COMPLETED_ACTION,
    context: {
      tier: result.tier,
      deleted_count: result.deleted_count,
      per_table: result.per_table ?? null,
      request_id: requestId,
    },
  });
  if (error) {
    logger.error(
      "RETENTION_SWEEP",
      "sweep_completion_record_failed",
      "Retention sweep succeeded but its completion row was not written",
      undefined,
      { tier: result.tier, requestId, error: error.message },
    );
    return false;
  }
  return true;
}

// ── Tier dispatch ─────────────────────────────────────────────────────

export const TIER_HANDLERS: Record<string, TierHandler> = {
  "7d": sweep7d,
  "90d": sweep90d,
  "180d": sweep180d,
  "365d": sweep365d,
};
