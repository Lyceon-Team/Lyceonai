/**
 * @spec [Doc-03C_V3 §8.5]
 * @implemented 2026-08-19
 *
 * plain English: placeholder for the pending-reconciliation sweep.
 * Doc 03C §8.5 defines the sweep:
 *   SELECT pending rows > 10 min old with FOR UPDATE SKIP LOCKED.
 *   Mark failed, re-enqueue fresh refresh via Cloud Tasks.
 * Runs every 5 minutes via Cloud Scheduler → Cloud Tasks.
 *
 * expected outcome: returns { ok: false, reason: "not_implemented" } until
 * the full reconciliation domain logic is built.
 *
 * trade-offs: wired now so the Cloud Scheduler job can be provisioned
 * alongside the memory-refresh job. The handler returns 200 with ok=false
 * so Cloud Tasks does not retry.
 *
 * edge cases:
 *  - Zero stale rows is a valid no-op (ok: true, reconciledCount: 0).
 *  - SKIP LOCKED ensures concurrent sweeps don't double-mark rows.
 */
import { logger } from "../logger";

export type PendingReconciliationResult =
  | { ok: true; reconciledCount: number }
  | { ok: false; reason: string };

/**
 * Sweep pending memory-refresh rows that have been stuck > 10 minutes.
 *
 * @spec [Doc-03C_V3 §8.5]
 */
export async function executePendingReconciliation(
  requestId: string,
): Promise<PendingReconciliationResult> {
  logger.info(
    "PENDING_RECONCILIATION",
    "pending_reconciliation_invoked",
    "Pending reconciliation sweep received; not yet implemented",
    { requestId },
  );

  return { ok: false, reason: "not_implemented" };
}
