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
 * @spec [SCL-235, SCL-236 (Doc 05C §12A)] | @implemented [2026-10-17]
 *
 * plain English: the stored diagnostic projection as `/api/progress/projection` prints it to a
 * free student: computed once from the diagnostic's own answers, never changed. No confidence
 * figure (F-51). A paid student never receives it (owner ruling 2026-10-16, 4).
 */
export interface DiagnosticEstimate {
  composite: number;
  math: number;
  rw: number;
  range: {
    low: number;
    high: number;
  };
  computedAt: string | null;
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
 * Re-cut 2026-10-17 (SCL-235 / SCL-236): a free student's number is the STORED diagnostic
 * projection, a paid student's is the live projection, never both.
 * - no_baseline: the diagnostic is not done (both plans).
 * - baseline_pending: diagnostic COMPLETED, its stored projection not written yet (free).
 *   Distinct from no_baseline because the copy must be opposite — there is nothing for the
 *   student to do, and prompting them to take a diagnostic they already took is both false and
 *   unactionable (the start route answers 409 diagnostic_already_completed).
 *   Owner ruling Q2, 2026-08-17.
 * - baseline_only: free — the stored diagnostic projection + upgrade CTA. No live projection.
 * - insufficient_evidence: the diagnostic is done but there is no number: free — the stored
 *   result is below the Doc 05C gate (a skipped question; owner ruling D1 (a)); paid — the live
 *   projection is below the same gate.
 * - computed: paid — the live projection only.
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
  | "baseline_only"
  | "insufficient_evidence";

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
      diagnostic: null;
    })
  | (EstimateResponseBase & {
      estimateStatus: "baseline_only";
      estimate: null;
      diagnostic: DiagnosticEstimate;
      cta: true;
    })
  | (EstimateResponseBase & {
      estimateStatus: "insufficient_evidence";
      estimate: null;
      diagnostic: null;
    })
  | (EstimateResponseBase & {
      estimateStatus: "no_baseline";
      estimate: null;
      diagnostic: null;
    })
  | (EstimateResponseBase & {
      estimateStatus: "baseline_pending";
      estimate: null;
      diagnostic: null;
    });

/**
 * @spec [student-UI register OQ-36 (owner ruling 2026-10-02), §8 F-51, F-55; SCL-235 (owner
 *        ruling 2026-10-16: free sees only the diagnostic projection, paid only the live one)]
 *        | @implemented [2026-10-03; re-cut 2026-10-17]
 *
 * plain English: Home's two projection reads. The NUMBER comes from
 * `GET /api/students/:id/projections/sections`, which now carries `kind`: the live rows for a
 * paid student, the stored diagnostic projection for a free one (the server decides; the client
 * renders what it is given). `/api/progress/projection` is read for `estimateStatus` only — the
 * diagnostic number it also prints reaches Home through the sections route instead, so it is
 * not thrown away: Home shows it. (Until 2026-10-17 this read discarded the frozen baseline
 * and Home showed nobody the diagnostic number.) A body either schema rejects throws: a
 * contract mismatch is an error, not an empty result.
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
