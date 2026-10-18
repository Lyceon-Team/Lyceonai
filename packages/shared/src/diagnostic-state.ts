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
import type { DiagnosticProjectionStatus } from "./diagnostic-projection.js";

/**
 * The four states, in lifecycle order. MUST match the CASE arms in
 * public.student_diagnostic_states (migration 20260817010000).
 *
 *  not_taken        no diagnostic that still counts (includes abandoned-only —
 *                   per ruling Q1 an abandoned diagnostic is not spent)
 *  in_progress      a 'created' or 'active' diagnostic exists; resumable
 *  baseline_pending COMPLETED, but the stored diagnostic projection is not written yet
 *  baseline_ready   COMPLETED and the stored diagnostic projection exists for both sections
 *                   (computed or insufficient_evidence; SCL-236, migration 20261106010000)
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
 * What /api/progress/projection reports. Re-cut 2026-10-17 for SCL-235 / SCL-236: the number a
 * free student sees is the STORED diagnostic projection, the number a paid student sees is the
 * live projection, and neither is ever shown alongside the other.
 *
 *  computed              paid: the live projection
 *  baseline_only         free: the stored diagnostic projection (both sections scored)
 *  insufficient_evidence the diagnostic is done but there is no number to show: free — the
 *                        stored diagnostic projection is `insufficient_evidence` (a skipped
 *                        question left a domain under the Doc 05C gate; owner ruling D1 (a));
 *                        paid — the live projection is below the same gate
 *  baseline_pending      free: diagnostic done, its stored projection not written yet
 *  no_baseline           the diagnostic is not done (both plans)
 */
export const ESTIMATE_STATUSES = [
  "computed",
  "baseline_only",
  "insufficient_evidence",
  "baseline_pending",
  "no_baseline",
] as const;

export const estimateStatusSchema = z.enum(ESTIMATE_STATUSES);
export type EstimateStatus = z.infer<typeof estimateStatusSchema>;

/**
 * @spec [student-UI register OQ-36 (owner ruling 2026-10-02: Home reads the range from
 *        `GET /api/students/:id/projections/sections`; `/api/progress/projection` is used only
 *        for `estimateStatus` until it is retired), §8 F-51 (no confidence metric)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the one field Home reads from `/api/progress/projection`. Zod's default strip
 * mode drops everything else at the parse, so the route's `confidenceBand`, its estimate and its
 * baseline never reach the page's data, let alone its markup.
 */
export const estimateStatusReadSchema = z.object({
  estimateStatus: estimateStatusSchema,
});

/**
 * The one sentence a student in baseline_pending sees. Owner-ruled copy (Q2) —
 * exported as a constant so the server explanation, the card, and the test that
 * proves the card renders it cannot drift into three near-identical sentences.
 */
export const BASELINE_PENDING_HEADLINE = "Your baseline is being calculated.";

export type EstimateStatusInputs = {
  /** From public.student_diagnostic_state(). */
  diagnosticState: DiagnosticState;
  /**
   * The stored diagnostic projection's aggregate status (`readDiagnosticProjection`), or null
   * when no row is stored. Only consulted for a subject who cannot see the live projection.
   */
  diagnosticProjectionStatus: DiagnosticProjectionStatus | null;
  /** Entitlement decision for the live projection (`LIVE_PROJECTION_FEATURE_KEY`). */
  canSeeLiveProgression: boolean;
  /** A live section projection was computable right now. */
  hasLiveEstimate: boolean;
};

/**
 * WHY A STORED ROW OUTRANKS diagnosticState
 *
 * The two are read separately, so a row written between the reads makes them disagree for one
 * request. Rows exist only for a completed diagnostic, so a stored row proves the diagnostic is
 * done whatever the state read said.
 *
 * WHY baseline_pending IS CHECKED BEFORE no_baseline
 *
 * They are the same absence with different causes, and the causes need opposite copy.
 * no_baseline invites the student to take a diagnostic; for a student who already took one that
 * invitation is both wrong and unactionable — the start route refuses it (409
 * diagnostic_already_completed). baseline_pending tells them the truth: the work is done, the
 * numbers are not ready. (A failed read no longer reaches here as an absence: the diagnostic
 * read throws, which is a 500, not a guess.)
 *
 * WHY A PAID STUDENT WHO HAS NOT DONE THE DIAGNOSTIC IS no_baseline
 *
 * The status also decides whether Home offers the diagnostic (home-model.ts `freeHomeStage`),
 * on both plans. Paid Home is unchanged by SCL-235, so this is unchanged too.
 *
 * in_progress deliberately maps to no_baseline. A student mid-diagnostic has no score to show
 * and the CTA is the correct affordance.
 */
export function resolveEstimateStatus(
  inputs: EstimateStatusInputs,
): EstimateStatus {
  const diagnosticIsDone =
    inputs.diagnosticState === "baseline_pending" ||
    inputs.diagnosticState === "baseline_ready" ||
    (!inputs.canSeeLiveProgression &&
      inputs.diagnosticProjectionStatus !== null);
  if (!diagnosticIsDone) return "no_baseline";

  if (inputs.canSeeLiveProgression) {
    return inputs.hasLiveEstimate ? "computed" : "insufficient_evidence";
  }

  if (inputs.diagnosticProjectionStatus === null) return "baseline_pending";
  return inputs.diagnosticProjectionStatus === "computed"
    ? "baseline_only"
    : "insufficient_evidence";
}
