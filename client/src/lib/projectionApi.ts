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

export interface EstimateResponse {
  estimate: ScoreEstimate;
  totalQuestionsAttempted: number;
  lastUpdated: string;
}

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
