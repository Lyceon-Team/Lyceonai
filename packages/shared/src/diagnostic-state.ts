/**
 * @spec [Doc-05C_V1.0 §7.4 tiered score estimate; Doc-05A_V1.0 §11 diagnostic
 *        seeding; owner rulings Q1 + Q2, 2026-08-17] | @implemented [2026-08-17]
 *
 * plain English: the TypeScript half of ONE diagnostic-lifecycle definition. The
 * derivation itself lives in SQL (public.student_diagnostic_state, migration
 * 20260817010000) because two of its three consumers — the operator staleness
 * alert and the prod-verify files — cannot call TypeScript. This module is the
 * boundary contract for the third consumer and the pure mapping from that state
 * to what a surface renders.
 *
 * expected outcome: every surface that asks "has this student taken the
 * diagnostic" gets the same answer, and a student who completed a diagnostic is
 * never told to take one.
 *
 * trade-offs: the state literals are declared in two places — this enum and the
 * CASE in the migration. That is unavoidable across a language boundary, so it is
 * GATED rather than trusted: scripts/ci/diagnostic-state-gate.sh fails if the two
 * sets diverge, the same drift check step 3 applied to session modes.
 *
 * edge cases: baseline_pending vs no_baseline is decided by evidence, not by
 * optimism — see resolveEstimateStatus.
 */
import { z } from "zod";

/**
 * The four states, in lifecycle order. MUST match the CASE arms in
 * public.student_diagnostic_states (migration 20260817010000).
 *
 *  not_taken        no diagnostic that still counts (includes abandoned-only —
 *                   per ruling Q1 an abandoned diagnostic is not spent)
 *  in_progress      a 'created' or 'active' diagnostic exists; resumable
 *  baseline_pending COMPLETED, but no usable baseline snapshot yet
 *  baseline_ready   COMPLETED and both sections carry a non-NULL baseline mid
 */
export const DIAGNOSTIC_STATES = [
  "not_taken",
  "in_progress",
  "baseline_pending",
  "baseline_ready",
] as const;

export const diagnosticStateSchema = z.enum(DIAGNOSTIC_STATES);
export type DiagnosticState = z.infer<typeof diagnosticStateSchema>;

/**
 * What /api/progress/projection reports. `baseline_pending` is the member added
 * by step 6; the other three are the shipped contract and their meaning is
 * unchanged.
 *
 *  computed         live rolling projection (paid / admin)
 *  baseline_only    frozen diagnostic baseline, no live projection
 *  baseline_pending diagnostic done, numbers not ready yet
 *  no_baseline      no diagnostic to show a score from
 */
export const ESTIMATE_STATUSES = [
  "computed",
  "baseline_only",
  "baseline_pending",
  "no_baseline",
] as const;

export const estimateStatusSchema = z.enum(ESTIMATE_STATUSES);
export type EstimateStatus = z.infer<typeof estimateStatusSchema>;

/**
 * The one sentence a student in baseline_pending sees. Owner-ruled copy (Q2) —
 * exported as a constant so the server explanation, the card, and the test that
 * proves the card renders it cannot drift into three near-identical sentences.
 */
export const BASELINE_PENDING_HEADLINE = "Your baseline is being calculated.";

export type EstimateStatusInputs = {
  /** From public.student_diagnostic_state(). */
  diagnosticState: DiagnosticState;
  /** A usable diagnostic_baseline snapshot exists (both sections, non-NULL mid). */
  hasBaseline: boolean;
  /** Entitlement decision for the live rolling projection. */
  canSeeLiveProgression: boolean;
  /** A live section projection was computable right now. */
  hasLiveEstimate: boolean;
};

/**
 * WHY hasBaseline OUTRANKS diagnosticState
 *
 * The two are read from different places — readDiagnosticBaseline queries the
 * snapshots directly, student_diagnostic_state() aggregates them — so a baseline
 * written between the two reads makes them disagree for one request. When they
 * do, real numbers win: showing "your baseline is being calculated" to a student
 * whose baseline we are holding would be a lie in the safe-sounding direction.
 *
 * WHY baseline_pending IS CHECKED BEFORE no_baseline
 *
 * They are the same absence with different causes, and the causes need opposite
 * copy. no_baseline invites the student to take a diagnostic; for a student who
 * already took one that invitation is both wrong and unactionable — the start
 * route refuses it (409 diagnostic_already_completed). baseline_pending tells
 * them the truth: the work is done, the numbers are not ready.
 *
 * in_progress deliberately maps to no_baseline. A student mid-diagnostic has no
 * score to show and the CTA is the correct affordance; making it its own surface
 * state would be new product copy nobody has ruled on.
 */
export function resolveEstimateStatus(
  inputs: EstimateStatusInputs,
): EstimateStatus {
  if (!inputs.hasBaseline) {
    // baseline_ready belongs here too, and the reason is not symmetry.
    // readDiagnosticBaseline collapses a READ ERROR into null
    // (server/services/canonical-runtime-views.ts: `if (error || !snapshots) return null`).
    // So a student whose baseline genuinely exists lands here whenever that query
    // fails transiently — and mapping them to no_baseline would tell a student who
    // finished the diagnostic to go take one, which is the exact defect this
    // module exists to remove, reachable through a dropped connection instead of
    // through a missing snapshot. "The numbers are not on screen right now" is
    // true in both cases; "you have not taken it" is true in neither.
    const diagnosticIsDone =
      inputs.diagnosticState === "baseline_pending" ||
      inputs.diagnosticState === "baseline_ready";
    return diagnosticIsDone ? "baseline_pending" : "no_baseline";
  }

  if (!inputs.canSeeLiveProgression) return "baseline_only";

  return inputs.hasLiveEstimate ? "computed" : "baseline_only";
}
