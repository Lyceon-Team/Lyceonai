/**
 * @spec [Privacy Policy v3 §6.2 (payment records, 7 years), §6.7 (operational
 *        records not otherwise listed, 90 days); Doc-06D_V1.0 §9 (a retention
 *        rule without a mechanism is retention drift); Doc-01_V8 §5.1;
 *        lyceon-coding-standards §7.1 (parse at the boundary), §12.1 (ids and
 *        counts only, never content), §13 (no silent catch); SCL-101;
 *        owner ruling 2026-09-22 B2]
 * @implemented 2026-09-21, extended 2026-09-22
 *
 * plain English: every retention sweep that deletes rows on a published period,
 * behind ONE runner. Each SQL function owns its own rule — how long, which
 * tables, which time column — and this module owns only the calling, parsing
 * and logging, which is identical for all of them.
 *
 * WHY ONE RUNNER AND NOT A MODULE PER TIER. The second tier (§6.2, seven years)
 * would have been a 120-line copy of the first differing in two string
 * literals. CLAUDE.md forbids forking a second version of a primitive, and the
 * practical reason is sharper than the rule: the unconditional-log property is
 * the thing that makes an unscheduled sweep detectable, and three copies of it
 * is three places for that property to quietly stop holding.
 *
 * WHY THE LOG LINE IS UNCONDITIONAL. Vercel's cron registration cannot be read
 * back from tooling, so a sweep that was never scheduled looks exactly like a
 * sweep that ran and found nothing. Each tier emits on every run with per-table
 * counts and the cutoff; the ABSENCE of that line over a day is the signal.
 *
 * trade-offs:
 *  - No content is logged, only table names and counts. These tables carry
 *    identity and financial references; §12.1 forbids the rows themselves
 *    reaching a log line, and a count answers the operational question.
 *  - Failure is logged at error and rethrown, never swallowed, so the route
 *    turns it into a 500 and the run is visibly absent rather than silently
 *    empty.
 *
 * edge cases:
 *  - `batchFull` is true when ANY table hit its bound, meaning rows remain for
 *    the next run. Reported rather than looped on, so one pathological table
 *    cannot hold the request open.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  OPERATIONAL_LOG_SWEEP_BATCH_SIZE,
  FINANCIAL_RECORD_SWEEP_BATCH_SIZE,
  retentionSweepRowSchema,
} from "../../../packages/shared/src/retention-schema";
import { logger } from "../../logger";

export type RetentionSweepSummary = {
  /** Which published period this run enforced. */
  tier: string;
  /** Per-table deletions, including tables that deleted nothing this run. */
  perTable: ReadonlyArray<{ table: string; deleted: number }>;
  deletedTotal: number;
  /** ISO timestamp: rows older than this were eligible. */
  cutoff: string;
  /** Per-table bound applied this run. */
  batchSize: number;
  /** true when at least one table hit its bound, so rows may remain. */
  batchFull: boolean;
};

/**
 * The one runner. `rpc` names the SQL function that owns the rule; `tier`
 * is the label that appears in the log line and identifies the published
 * sentence being enforced.
 */
async function runTierSweep(
  rpc: string,
  tier: string,
  batchSize: number,
  requestId?: string,
): Promise<RetentionSweepSummary> {
  const { data, error } = await supabaseServer.rpc(rpc, {
    p_batch_size: batchSize,
  });
  if (error) {
    logger.error("RETENTION", "sweep_failed", `${rpc} failed`, {
      requestId,
      tier,
      batchSize,
      code: error.code,
      message: error.message,
    });
    throw new Error(`${rpc} failed: ${error.message}`);
  }

  const parsed = z.array(retentionSweepRowSchema).safeParse(data);
  if (!parsed.success || parsed.data.length === 0) {
    logger.error(
      "RETENTION",
      "sweep_malformed",
      `${rpc} returned no parsable rows`,
      { requestId, tier, batchSize },
    );
    throw new Error(`${rpc} returned no parsable rows`);
  }

  const rows = parsed.data;
  const summary: RetentionSweepSummary = {
    tier,
    perTable: rows.map((r) => ({
      table: r.swept_table,
      deleted: r.deleted_count,
    })),
    deletedTotal: rows.reduce((n, r) => n + r.deleted_count, 0),
    // Every row carries the same cutoff — the function computes it once.
    cutoff: rows[0]!.cutoff,
    batchSize,
    batchFull: rows.some((r) => r.deleted_count >= batchSize),
  };

  // Unconditional — including a run that deleted nothing from every table.
  logger.info(
    "RETENTION",
    "sweep_completed",
    `Retention sweep finished: ${tier}`,
    { requestId, ...summary },
  );

  return summary;
}

/** v3 §6.7 — operational records not covered by an enumerated category, 90 days. */
export async function sweepOperationalLogRetention(
  options: { batchSize?: number; requestId?: string } = {},
): Promise<RetentionSweepSummary> {
  return runTierSweep(
    "sweep_operational_log_retention",
    "operational_logs_90d",
    options.batchSize ?? OPERATIONAL_LOG_SWEEP_BATCH_SIZE,
    options.requestId,
  );
}

/** v3 §6.2 — payment records, 7 years, on tax and financial-record grounds. */
export async function sweepFinancialRecordRetention(
  options: { batchSize?: number; requestId?: string } = {},
): Promise<RetentionSweepSummary> {
  return runTierSweep(
    "sweep_financial_record_retention",
    "financial_records_7y",
    options.batchSize ?? FINANCIAL_RECORD_SWEEP_BATCH_SIZE,
    options.requestId,
  );
}
