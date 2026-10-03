import { estimateStatusReadSchema } from "@lyceon/shared/diagnostic-state";
import {
  sectionProjectionsResponseSchema,
  studentResourceUrl,
  type SectionProjectionsResponse,
} from "@lyceon/shared/student-resources";
import { apiRequest } from "./queryClient";

/**
 * DRIFT NOTE: `confidenceBand` is a STRING, not a number, and that is deliberate —
 * owner ruling 2026-08-20 RULE 9. The server bands the 0–1 confidence figure before
 * serialization (packages/shared/src/projection-confidence.ts) so the float never
 * reaches a client that could render, chart, or compare it. Do not reintroduce a
 * numeric `confidence` field here; there is nothing on the wire to populate it.
 */
export type ConfidenceBand = "High" | "Medium" | "Low" | "Very Low";

export interface ScoreEstimate {
  composite: number;
  math: number;
  rw: number;
  range: {
    low: number;
    high: number;
  };
  confidenceBand: ConfidenceBand;
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
  confidenceBand: ConfidenceBand;
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
 * can be null, TS forbids .composite/.range/.confidenceBand without a guard — render honest-uncomputed.
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

/**
 * @spec [student-UI register OQ-36 (owner ruling 2026-10-02), §8 F-51; Doc 05C (a student reads
 *        their own projection with no entitlement check)] | @implemented [2026-10-03]
 *
 * plain English: Home's two projection reads. The range comes from
 * `GET /api/students/:id/projections/sections` (ungated, both plans), summed by
 * `projectedRange`. `/api/progress/projection` is read for `estimateStatus` ONLY, parsed through
 * a schema that keeps that one field, so its `confidenceBand` never reaches the page (F-51).
 * A body either schema rejects throws: a contract mismatch is an error, not an empty result.
 */
export async function fetchSectionProjections(
  studentId: string,
): Promise<SectionProjectionsResponse> {
  const response = await apiRequest(
    studentResourceUrl(studentId, "projectionsSections"),
  );
  return sectionProjectionsResponseSchema.parse(await response.json());
}

export const ESTIMATE_STATUS_PATH = "/api/progress/projection";

export async function fetchEstimateStatus(): Promise<EstimateStatus> {
  const response = await apiRequest(ESTIMATE_STATUS_PATH);
  return estimateStatusReadSchema.parse(await response.json()).estimateStatus;
}
