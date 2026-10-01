/**
 * Review stale-session sweep.
 *
 * @spec [Doc-02B_V4 §22; ruled plan §2 "inactivity abandonment", ruling 17; brief R3 §2.5]
 * @implemented [2026-09-21]
 *
 * plain English: a review session left idle for longer than the TTL becomes
 * `abandoned`, exactly as a practice session does. expected outcome: abandoned review
 * sessions stop appearing in the open-sessions list and stop counting against the
 * concurrent-session cap, without a student having to end them by hand.
 *
 * WHY THIS IS NOT `sweepStalePracticeSessions` WITH A TABLE PARAMETER. That function
 * carries `.neq("mode", "diagnostic")`, described in its own header as "the whole
 * safety property of this file". Review's modes are `queue | session | filter`
 * (20260921000000_review_queue_runtime.sql:199-201) — there is no diagnostic mode to
 * exclude, and threading a "should I apply the diagnostic exclusion" flag through the
 * shared function would make the safety property conditional, which is precisely how
 * it gets lost. Two small functions, one shared TTL.
 *
 * THE TTL IS NOT DECLARED TWICE. `STALE_PRACTICE_SESSION_TTL_DAYS` is imported from
 * the practice module (brief R3 §2.5: "the TTL is not hard-coded twice"), so the two
 * engines cannot drift. It is 7 days — owner ruling Q4, 2026-08-17. The
 * `inactivity_timeout_hours = 24` config key has no consumer and is not one.
 *
 * trade-offs: sweeping by `last_activity_at` rather than `created_at` means a student
 * who works a session over three weeks keeps it, which is the intent (practice's
 * ruling Q4 reasoning applies unchanged).
 *
 * edge cases:
 *   - QUEUE ENTRIES ARE UNAFFECTED (brief R3 §2.5). Abandoning a session does not
 *     graduate, supersede or close anything in `review_schedule`; the questions stay
 *     queued and appear in the next session's pool. Nothing here touches that table.
 *   - `completed_at: null` is written for the same reason practice writes it:
 *     `review_sessions_abandoned_not_completed` (20260921000000:214-219) rejects an
 *     abandoned row that still carries one, and a single such row would fail the whole
 *     statement.
 *   - an error THROWS rather than reporting zero swept. A failed sweep that reports
 *     success is indistinguishable from a quiet week (CR-STD-01).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  staleSessionCutoff,
  STALE_PRACTICE_SESSION_TTL_DAYS,
} from "./stale-session-sweep";

export type ReviewSessionSweepResult = {
  sweptCount: number;
  cutoff: string;
};

export async function sweepStaleReviewSessions(
  client: SupabaseClient,
  opts: { now: Date; ttlDays?: number },
): Promise<ReviewSessionSweepResult> {
  const cutoff = staleSessionCutoff(
    opts.now,
    opts.ttlDays ?? STALE_PRACTICE_SESSION_TTL_DAYS,
  );
  const nowIso = opts.now.toISOString();

  const { data, error } = await client
    .from("review_sessions")
    .update({
      status: "abandoned",
      abandoned_at: nowIso,
      completed_at: null,
      updated_at: nowIso,
    })
    .in("status", ["created", "active"])
    .lt("last_activity_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`review_stale_session_sweep_failed: ${error.message}`);
  }

  return { sweptCount: (data ?? []).length, cutoff };
}
