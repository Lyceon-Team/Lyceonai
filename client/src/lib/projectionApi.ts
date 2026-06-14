import { apiRequest } from "./queryClient";

export interface DomainBreakdown {
  domain: string;
  weight: number;
  rawMastery: number;
  decayedMastery: number;
  contribution: number;
}

export interface ScoreEstimate {
  composite: number;
  math: number;
  rw: number;
  range: {
    low: number;
    high: number;
  };
  confidence: number;
  breakdown: {
    math: DomainBreakdown[];
    rw: DomainBreakdown[];
  };
}

// LC-AM3-UI-001 honest-signal: mirror the server's discriminated response. The weighted score
// estimate is UNCOMPUTED while 05C projections are deferred/not-yet-generated — `estimate` is null
// then, so consumers MUST narrow on estimateStatus/estimate before dereferencing. Once `estimate`
// can be null, TS forbids .composite/.range/.confidence without a guard — render honest-uncomputed.
export type EstimateStatus = "computed" | "not_yet_available";

interface EstimateResponseBase {
  totalQuestionsAttempted: number;
  lastUpdated: string;
}

export type EstimateResponse =
  | (EstimateResponseBase & { estimateStatus: "computed"; estimate: ScoreEstimate })
  | (EstimateResponseBase & { estimateStatus: "not_yet_available"; estimate: null });

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
