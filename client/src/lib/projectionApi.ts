import { apiRequest } from "./queryClient";

export interface ScoreEstimate {
  composite: number;
  math: number;
  rw: number;
  range: {
    low: number;
    high: number;
  };
  confidence: number;
}

/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20 entitlement_features, Vertical-B Slice 2]
 * @implemented 2026-08-12
 *
 * plain English: frozen diagnostic baseline from the once-only snapshot capture.
 * Served in baseline_only and computed branches so the UI can show starting point
 * alongside live progression.
 */
export interface BaselineEstimate {
  composite: number;
  math: number;
  rw: number;
  range: {
    low: number;
    high: number;
  };
  confidence: number;
  capturedAt: string;
}

/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20 entitlement_features, Vertical-B Slice 2]
 * @implemented 2026-08-12
 *
 * plain English: discriminated estimate status for the tiered projection surface.
 *
 * LC-AM3-UI-001 honest-signal: mirror the server's discriminated response. The weighted score
 * estimate is UNCOMPUTED while 05C projections are deferred/not-yet-generated — `estimate` is null
 * then, so consumers MUST narrow on estimateStatus/estimate before dereferencing. Once `estimate`
 * can be null, TS forbids .composite/.range/.confidence without a guard — render honest-uncomputed.
 *
 * - no_baseline: student hasn't completed the diagnostic yet. No baseline, no projection.
 * - baseline_pending: diagnostic COMPLETED, baseline not computed yet. Distinct from
 *   no_baseline because the copy must be opposite — there is nothing for the student to
 *   do, and prompting them to take a diagnostic they already took is both false and
 *   unactionable (the start route answers 409 diagnostic_already_completed).
 *   Owner ruling Q2, 2026-08-17.
 * - baseline_only: diagnostic done (baseline exists) but no mastery_detail feature (unpaid).
 *   Frozen baseline + upgrade CTA. No live projection served.
 * - computed: paid — live projection + baseline for comparison.
 *
 * DRIFT: this union is the client-side mirror of ESTIMATE_STATUSES in
 * packages/shared/src/diagnostic-state.ts. The client has no module path to
 * packages/shared, so the two are kept in step by scripts/ci/diagnostic-state-gate.sh
 * rather than by a shared import — a status the server can emit and the client cannot
 * name renders as an unhandled branch, which is a blank card, not a type error.
 */
export type EstimateStatus =
  | "computed"
  | "no_baseline"
  | "baseline_pending"
  | "baseline_only";

interface EstimateResponseBase {
  /**
   * How many questions the student has actually answered, in EVERY branch —
   * owner ruling 2026-08-17. It previously read 0 in every branch but `computed`,
   * which told a student who had answered forty questions that they had answered
   * none.
   *
   * `null` means the server could not establish the count. It is NOT zero, and it
   * must never be rendered as one: every consumer omits the figure instead.
   * Absent beats wrong.
   */
  totalQuestionsAttempted: number | null;
  lastUpdated: string;
  entitlement: {
    hasPaidAccess: boolean;
    plan: "free" | "paid";
    status: string;
    reason: string;
    currentPeriodEnd?: string | null;
  };
}

export type EstimateResponse =
  | (EstimateResponseBase & {
      estimateStatus: "computed";
      estimate: ScoreEstimate;
      baseline: BaselineEstimate;
    })
  | (EstimateResponseBase & {
      estimateStatus: "baseline_only";
      estimate: null;
      baseline: BaselineEstimate;
      cta: true;
    })
  | (EstimateResponseBase & {
      estimateStatus: "no_baseline";
      estimate: null;
      baseline: null;
    })
  | (EstimateResponseBase & {
      estimateStatus: "baseline_pending";
      estimate: null;
      baseline: null;
    });

export async function fetchScoreEstimate(): Promise<EstimateResponse> {
  const response = await apiRequest("/api/progress/projection");
  return response.json();
}

export function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return "High";
  if (confidence >= 0.7) return "Medium";
  if (confidence >= 0.5) return "Low";
  return "Very Low";
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return "text-green-600";
  if (confidence >= 0.7) return "text-yellow-600";
  if (confidence >= 0.5) return "text-orange-600";
  return "text-amber-700";
}
