/**
 * @spec [Doc-03C_V3 §8.4]
 * @implemented 2026-08-19
 *
 * plain English: placeholder for the two-transaction memory refresh algorithm.
 * Doc 03C §8.4 defines the full flow:
 *   T1: mark invalidation + insert pending row
 *   T2: fill content + transition to ready
 * Advisory lock (pg_try_advisory_lock, session-scoped) spans both transactions.
 *
 * expected outcome: returns { ok: false, reason: "not_implemented" } until
 * the full memory-refresh domain logic is built.
 *
 * trade-offs: the route is wired now so Cloud Scheduler → Cloud Tasks can
 * target it as soon as the job is provisioned. The handler returns 200 with
 * ok=false so Cloud Tasks does not retry a not-yet-implemented path.
 *
 * edge cases:
 *  - previous_attempt_summary_version=null on first refresh for a student.
 *  - Advisory lock contention: §8.4 says fail the task, let reconciliation
 *    sweep pick it up.
 */
import { logger } from "../logger";

export type MemoryRefreshParams = {
  studentId: string;
  summaryType: string;
  triggerReason: string;
  requestId: string;
  previousAttemptSummaryVersion: number | null;
};

export type MemoryRefreshResult =
  | { ok: true; summaryId: string }
  | { ok: false; reason: string };

/**
 * Execute a memory refresh for a student's summary.
 *
 * @spec [Doc-03C_V3 §8.4]
 */
export async function executeMemoryRefresh(
  params: MemoryRefreshParams,
): Promise<MemoryRefreshResult> {
  logger.info(
    "MEMORY_REFRESH",
    "memory_refresh_invoked",
    "Memory refresh task received; not yet implemented",
    {
      studentId: params.studentId,
      summaryType: params.summaryType,
      triggerReason: params.triggerReason,
      requestId: params.requestId,
    },
  );

  return { ok: false, reason: "not_implemented" };
}
