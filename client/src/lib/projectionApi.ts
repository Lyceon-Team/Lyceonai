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
 * - baseline_only: diagnostic done (baseline exists) but no mastery_detail feature (unpaid).
 *   Frozen baseline + upgrade CTA. No live projection served.
 * - computed: paid — live projection + baseline for comparison.
 */
export type EstimateStatus = "computed" | "no_baseline" | "baseline_only";

interface EstimateResponseBase {
  totalQuestionsAttempted: number;
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
