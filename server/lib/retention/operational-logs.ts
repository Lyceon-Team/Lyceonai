/**
 * @spec [Privacy Policy v3 §6.7 ("Where we keep operational records that include
 *        information about you and are not listed above, we keep them for no more
 *        than 90 days"); Doc-06D_V1.0 §9 (a retention rule without a mechanism is
 *        retention drift); Doc-01_V8 §5.1 (90-day security forensics window);
 *        lyceon-coding-standards §7.1 (parse at the boundary), §12.1 (ids and
 *        counts only, never content), §13 (no silent catch); SCL-101]
 * @implemented 2026-09-21
 *
 * plain English: the one code path that enforces the published 90-day ceiling on
 * operational records. It calls the SQL function that owns the rule and reports
 * what happened, per table. Deliberately shaped after
 * `server/lib/notifications/retention.ts` — same window-in-SQL split, same
 * unconditional log, same rethrow — because a second sweep that behaved
 * differently would be a second pattern to reason about.
 *
 * expected outcome: rows older than the window disappear from the four
 * identity-bearing operational tables; a per-table summary is logged on every
 * run.
 *
 * WHY THE LOG LINE IS UNCONDITIONAL. Vercel's cron registration cannot be read
 * back from tooling, so a sweep that was never scheduled looks exactly like a
 * sweep that runs and finds nothing. `operational_log_sweep_completed` is
 * emitted on every run with per-table counts and the cutoff; its ABSENCE over a
 * day is the signal that the job is not running. That is the only reason the
 * SQL function returns a row for a table it deleted nothing from.
 *
 * trade-offs:
 *  - No content is logged, only table names and counts. These tables carry
 *    identity (student_user_id, profile_id, conversation_id); §12.1 forbids the
 *    rows themselves reaching a log line, and a count answers the operational
 *    question without them.
 *  - Failure is logged at error and rethrown, never swallowed, so the route
 *    turns it into a 500 and the run is visibly absent rather than silently
 *    empty.
 *
 * edge cases:
 *  - `batchFull` is true when ANY table hit its bound, meaning more rows remain
 *    and the next run will take them. It is reported rather than looped on, so
 *    one pathological table cannot hold the request open indefinitely.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  OPERATIONAL_LOG_SWEEP_BATCH_SIZE,
  operationalLogSweepRowSchema,
} from "../../../packages/shared/src/retention-schema";
import { logger } from "../../logger";

export type OperationalLogSweepSummary = {
  /** Per-table deletions, including tables that deleted nothing this run. */
  perTable: ReadonlyArray<{ table: string; deleted: number }>;
  /** Total across every swept table. */
  deletedTotal: number;
  /** ISO timestamp: rows older than this were eligible. */
  cutoff: string;
  /** Per-table bound applied this run. */
  batchSize: number;
  /** true when at least one table hit its bound, so more rows may remain. */
  batchFull: boolean;
};

export async function sweepOperationalLogRetention(
  options: { batchSize?: number; requestId?: string } = {},
): Promise<OperationalLogSweepSummary> {
  const batchSize = options.batchSize ?? OPERATIONAL_LOG_SWEEP_BATCH_SIZE;

  const { data, error } = await supabaseServer.rpc(
    "sweep_operational_log_retention",
    { p_batch_size: batchSize },
  );
  if (error) {
    logger.error(
      "RETENTION",
      "operational_log_sweep_failed",
      "sweep_operational_log_retention failed",
      {
        requestId: options.requestId,
        batchSize,
        code: error.code,
        message: error.message,
      },
    );
    throw new Error(`sweep_operational_log_retention failed: ${error.message}`);
  }

  const parsed = z.array(operationalLogSweepRowSchema).safeParse(data);
  if (!parsed.success || parsed.data.length === 0) {
    logger.error(
      "RETENTION",
      "operational_log_sweep_malformed",
      "sweep_operational_log_retention returned no parsable rows",
      { requestId: options.requestId, batchSize },
    );
    throw new Error(
      "sweep_operational_log_retention returned no parsable rows",
    );
  }

  const rows = parsed.data;
  const summary: OperationalLogSweepSummary = {
    perTable: rows.map((r) => ({
      table: r.swept_table,
      deleted: r.deleted_count,
    })),
    deletedTotal: rows.reduce((n, r) => n + r.deleted_count, 0),
    // Every row carries the same cutoff — the function computes it once per call.
    cutoff: rows[0]!.cutoff,
    batchSize,
    batchFull: rows.some((r) => r.deleted_count >= batchSize),
  };

  // Unconditional — including a run that deleted nothing from every table.
  logger.info(
    "RETENTION",
    "operational_log_sweep_completed",
    "Operational-log retention sweep finished",
    { requestId: options.requestId, ...summary },
  );

  return summary;
}
