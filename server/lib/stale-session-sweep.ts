/**
 * @spec [Doc-02B_V4 §14 session lifecycle; owner rulings Q1 + Q4, 2026-08-17]
 * @implemented [2026-08-17]
 *
 * plain English: a practice session a student walked away from stays 'active'
 * forever. Nothing closes it. That leaves the student's own state ambiguous
 * (resumable? finished?) and leaves any "sessions in flight" read counting work
 * nobody is doing. This sweep closes them deterministically after a fixed idle
 * window.
 *
 * expected outcome: practice sessions idle beyond the TTL move to 'abandoned'
 * with an honest abandoned_at. Diagnostics are never touched.
 *
 * WHY DIAGNOSTICS ARE EXCLUDED (ruling Q1)
 *   A diagnostic is taken once. If a timer silently abandoned an in-flight
 *   diagnostic, the student would lose their one baseline attempt to inactivity —
 *   and per ruling Q1 an abandoned diagnostic does not spend the diagnostic, so
 *   they would be offered it again and lose the answers they had already given.
 *   The mode <> 'diagnostic' predicate is the whole safety property of this file;
 *   scripts/ci/stale-session-sweep-gate.sh removes it as its named mutation.
 *
 * WHY last_activity_at AND NOT created_at (ruling Q4)
 *   created_at measures how long ago the student started, which for a session
 *   they are actively working through is exactly the wrong signal — a diligent
 *   student spreading one session over eight days would be swept mid-question.
 *   last_activity_at is written by every lifecycle update, so it measures
 *   idleness, which is what "abandoned" means.
 *
 * trade-offs: one UPDATE per run, no per-row metadata rewrite. The manual abandon
 * endpoint also clears active_session_item_id / client_instance_id / calculator_state
 * from filters; the sweep does not, because the session is terminal and every
 * read surface gates on status (readOnly) rather than on that metadata. Doing it
 * would turn one statement into N with no behavioural difference.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Owner ruling Q4, 2026-08-17. */
export const STALE_PRACTICE_SESSION_TTL_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pure. The instant before which an idle session is considered abandoned.
 * Separated from the IO so the boundary itself is testable without a database —
 * an off-by-one in the window is the failure mode that would quietly sweep live
 * sessions.
 */
export function staleSessionCutoff(
  now: Date,
  ttlDays: number = STALE_PRACTICE_SESSION_TTL_DAYS,
): string {
  return new Date(now.getTime() - ttlDays * MS_PER_DAY).toISOString();
}

export type StaleSessionSweepResult = {
  sweptCount: number;
  cutoff: string;
};

export async function sweepStalePracticeSessions(
  client: SupabaseClient,
  opts: { now: Date; ttlDays?: number },
): Promise<StaleSessionSweepResult> {
  const cutoff = staleSessionCutoff(opts.now, opts.ttlDays);
  const nowIso = opts.now.toISOString();

  const { data, error } = await client
    .from("practice_sessions")
    .update({
      status: "abandoned",
      abandoned_at: nowIso,
      // Belt and braces: practice_sessions_abandoned_not_completed rejects an
      // abandoned row that still carries completed_at, and a single such row
      // anywhere in the swept set would fail the whole statement. created/active
      // rows should never have one; this makes "should" unnecessary.
      completed_at: null,
      updated_at: nowIso,
    })
    .in("status", ["created", "active"])
    .neq("mode", "diagnostic")
    .lt("last_activity_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`stale_session_sweep_failed: ${error.message}`);
  }

  return { sweptCount: (data ?? []).length, cutoff };
}
