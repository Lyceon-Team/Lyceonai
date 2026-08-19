/**
 * @spec [Doc-01A_V1.0 §18 alert routing; Doc-05C_V1.0 §7.4; owner ruling Q2
 *        "an operator alert on staleness", 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: reads public.student_baseline_pending (migration 20260817030000)
 * and decides which of those students have been waiting long enough that the
 * pipeline, not the clock, is the explanation.
 *
 * expected outcome: the stale subset, oldest first, plus the total pending count
 * so the alert can say "3 of 11 pending are stale" rather than just "3".
 *
 * WHY THE THRESHOLD IS HERE AND NOT IN THE VIEW
 *   A threshold is policy. In the view it could not be changed without a
 *   migration, and every change to it would rewrite a database object to alter a
 *   number. The view reports the age; this module decides what age is too much.
 *
 * edge cases: pending_seconds is computed by the view from
 * COALESCE(completed_at, last_activity_at), which is NOT NULL on
 * practice_sessions — so a row can reach here with a small age but never a null
 * one. A row that somehow arrives with a null age is treated as NOT stale: an
 * unknown age is not evidence of a problem, and alerting on it would train the
 * operator to ignore the alert.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 24 hours. A healthy diagnostic completion is pending for seconds to minutes —
 * the gap between the last answer and the projection refresh. A day is far beyond
 * any legitimate delay and still catches a real outage on the same day it starts.
 * Not owner-ruled; see the open question on the PR.
 */
export const BASELINE_PENDING_STALE_SECONDS = 24 * 60 * 60;

export type BaselinePendingRow = {
  student_id: string;
  diagnostic_finished_at: string | null;
  baseline_scored_sections: number;
  pending_seconds: number | null;
};

export type BaselinePendingReport = {
  pendingCount: number;
  staleCount: number;
  /** Oldest first. */
  stale: BaselinePendingRow[];
  oldestPendingSeconds: number | null;
  thresholdSeconds: number;
};

/** Pure. The stale/not-stale split, so the rule is provable without a database. */
export function selectStaleBaselinePending(
  rows: readonly BaselinePendingRow[],
  thresholdSeconds: number = BASELINE_PENDING_STALE_SECONDS,
): BaselinePendingReport {
  const stale = rows
    .filter(
      (r) =>
        typeof r.pending_seconds === "number" &&
        r.pending_seconds >= thresholdSeconds,
    )
    .sort((a, b) => (b.pending_seconds ?? 0) - (a.pending_seconds ?? 0));

  const ages = rows
    .map((r) => r.pending_seconds)
    .filter((s): s is number => typeof s === "number");

  return {
    pendingCount: rows.length,
    staleCount: stale.length,
    stale,
    oldestPendingSeconds: ages.length > 0 ? Math.max(...ages) : null,
    thresholdSeconds,
  };
}

export async function readBaselinePendingReport(
  client: SupabaseClient,
  thresholdSeconds: number = BASELINE_PENDING_STALE_SECONDS,
): Promise<BaselinePendingReport> {
  const { data, error } = await client
    .from("student_baseline_pending")
    .select(
      "student_id, diagnostic_finished_at, baseline_scored_sections, pending_seconds",
    );

  if (error) {
    throw new Error(`baseline_pending_read_failed: ${error.message}`);
  }

  return selectStaleBaselinePending(
    (data ?? []) as BaselinePendingRow[],
    thresholdSeconds,
  );
}
