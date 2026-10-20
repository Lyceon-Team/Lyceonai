/**
 * Active runtime owner for /api/progress/* mounts in server/index.ts.
 * The "legacy" path segment reflects file location history, not runtime deprecation.
 */

import { Request, Response } from "express";
import { requireRequestUser } from "../../middleware/supabase-auth";
import {
  buildScoreEstimateFromCanonical,
  buildStudentKpiViewFromCanonical,
  readDiagnosticState,
  readAnsweredQuestionCount,
} from "../../services/canonical-runtime-views";
import {
  resolveEstimateStatus,
  BASELINE_PENDING_HEADLINE,
  type EstimateStatus,
} from "../../../packages/shared/src/diagnostic-state";
import { LIVE_PROJECTION_FEATURE_KEY } from "../../../packages/shared/src/diagnostic-projection";
import type {
  DiagnosticProjectionRead,
  SectionProjectionDto,
} from "../../../packages/shared/src/student-resources";
import { readDiagnosticProjection } from "../../../apps/api/src/services/projection-read";
import {
  resolvePaidKpiAccessForUser,
  resolveHistoricalTrendsAccess,
} from "../../services/kpi-access";
import { EntitlementService } from "../../services/entitlement-service";
import { logger } from "../../logger";
import { confidenceBandFromScore } from "../../../packages/shared/src/projection-confidence";

function estimateExplanation(
  label: string,
  detail: string,
): {
  whatThisMeans: string;
  whyThisChanged: string;
  whatToDoNext: string;
} {
  return {
    whatThisMeans: `${label} is a weighted estimate from stored mastery evidence, not an official score.`,
    whyThisChanged: detail,
    whatToDoNext:
      "Use the lower section estimate to prioritize your next focused practice block.",
  };
}

const MEASUREMENT_MODEL = {
  official: ["official_sat_score"],
  weighted: [
    "estimated_scaled_total",
    "estimated_scaled_math",
    "estimated_scaled_rw",
  ],
  diagnostic: ["mastery_evidence_count"],
} as const;

const OFFICIAL_SCORE_EXPLANATION = {
  whatThisMeans:
    "Official SAT scores only come from College Board score releases.",
  whyThisChanged:
    "This route intentionally separates official and diagnostic values to avoid conflation.",
  whatToDoNext:
    "Treat this as planning input and verify with your next proctored benchmark.",
};

/** The stored diagnostic projection as the route prints it. No confidence figure (F-51). */
type DiagnosticEstimate = {
  composite: number;
  math: number;
  rw: number;
  range: { low: number; high: number };
  computedAt: string | null;
};

function scoredBand(
  section: SectionProjectionDto | undefined,
): {
  mid: number;
  low: number;
  high: number;
  computedAt: string | null;
} | null {
  if (
    section === undefined ||
    section.projectedScoreMid === null ||
    section.projectedScoreLow === null ||
    section.projectedScoreHigh === null
  ) {
    return null;
  }
  return {
    mid: section.projectedScoreMid,
    low: section.projectedScoreLow,
    high: section.projectedScoreHigh,
    computedAt: section.computedAt,
  };
}

/**
 * Both sections scored, or nothing: a composite from one section would be invented. The values
 * are the stored ones, summed — nothing here recomputes the diagnostic projection.
 */
function diagnosticEstimate(
  read: DiagnosticProjectionRead,
): DiagnosticEstimate | null {
  if (read.status !== "computed") return null;
  const math = scoredBand(read.sections.find((s) => s.section === "M"));
  const rw = scoredBand(read.sections.find((s) => s.section === "RW"));
  if (!math || !rw) return null;
  return {
    composite: math.mid + rw.mid,
    math: math.mid,
    rw: rw.mid,
    range: { low: math.low + rw.low, high: math.high + rw.high },
    computedAt: math.computedAt ?? rw.computedAt,
  };
}

function totalExplanation(status: EstimateStatus): {
  whatThisMeans: string;
  whyThisChanged: string;
  whatToDoNext: string;
} {
  switch (status) {
    case "baseline_pending":
      return {
        whatThisMeans: `${BASELINE_PENDING_HEADLINE} You have finished the diagnostic, so there is nothing left for you to do here.`,
        whyThisChanged:
          "Your result comes from the diagnostic you completed. It appears as soon as the calculation finishes.",
        whatToDoNext:
          "Keep practicing if you like — your result will appear on its own.",
      };
    case "no_baseline":
      return {
        whatThisMeans:
          "Your score estimate isn't available yet — complete the diagnostic to establish your starting point.",
        whyThisChanged:
          "The estimate requires a completed diagnostic assessment to calibrate.",
        whatToDoNext: "Complete the diagnostic to get your score estimate.",
      };
    case "baseline_only":
      return {
        whatThisMeans:
          "This is your result from the diagnostic. It is based only on your diagnostic answers and does not change.",
        whyThisChanged:
          "It was calculated once, when you completed the diagnostic.",
        whatToDoNext:
          "Upgrade to see an estimate that updates as you practice.",
      };
    case "insufficient_evidence":
      return {
        whatThisMeans:
          "We need more answers in some areas before we can estimate your score.",
        whyThisChanged:
          "An estimate needs enough answered questions in every area of the test.",
        whatToDoNext:
          "Keep practicing across every area; skipped questions do not count as answers.",
      };
    case "computed":
      return estimateExplanation(
        "Estimated scaled total",
        "Estimate updates when mastery rollups change from new attempts or decayed evidence weight.",
      );
  }
}

/**
 * @spec [SCL-235 (Doc 02B §12 as amended: free sees only the stored diagnostic projection; the
 *        ongoing projection is Premium-only), SCL-236 (Doc 05C §12A); owner rulings 2026-10-16
 *        (1, 4) and 2026-10-17 (constraints 4 and 5, D1 (a), D3); Doc-05C §7.4 tiered surface]
 *        | @implemented [2026-08-12; re-cut 2026-10-17]
 *
 * plain English: GET /api/progress/projection — one number per plan, never both.
 *
 * - A student who CANNOT see the live projection (free; `LIVE_PROJECTION_FEATURE_KEY`) gets the
 *   stored diagnostic projection, read by `readDiagnosticProjection` — the same and only read
 *   `/projections/sections` uses. `baseline_only` with `diagnostic` set, `insufficient_evidence`
 *   when the stored result is below the gate, `baseline_pending` when the diagnostic is done but
 *   nothing is stored yet, `no_baseline` before the diagnostic. The live projection is not read.
 * - A student who CAN (paid / admin) gets the live projection only: `computed`, or
 *   `insufficient_evidence` when it is below the gate. The diagnostic number is not read and not
 *   served (ruling 4). Before the diagnostic it is `no_baseline`, as before (Home's diagnostic
 *   card keys on it).
 *
 * The old frozen baseline (`diagnostic_baseline` snapshots) is not read: those rows are audit
 * history only (constraint 4).
 *
 * FAIL-CLOSED: if the entitlement read errors, the student gets the free view (never the live
 * projection). A failed diagnostic read throws to the outer catch — a 500, never a guessed
 * status.
 */
export const getScoreEstimate = async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const access = await resolvePaidKpiAccessForUser(user.id);

    // @spec [owner rulings Q1 + Q2, 2026-08-17] @implemented 2026-08-17
    // The canonical lifecycle state: never took one, versus took one and the numbers are not
    // ready, need opposite copy. null means the read failed and is treated as not_taken —
    // unless a stored diagnostic row proves otherwise (resolveEstimateStatus).
    const diagnosticState = await readDiagnosticState(user.id);

    // @spec [owner ruling 2026-08-17: "report the true count of answered items in
    // EVERY branch"] @implemented 2026-08-17
    // null means the count could not be established, which is not "none": every surface omits
    // the figure rather than printing a number nobody verified.
    const answeredQuestionCount = await readAnsweredQuestionCount(user.id);

    // Feature-scoped gate: admin bypass at call site, then canAccessFeature.
    //
    // FAIL-CLOSED (Doc-05C §7.4): an entitlement-read failure must degrade to the
    // unpaid view, never 500 and never the paid view. canAccessFeature itself fails
    // closed, but we double-guard here so a thrown entitlement-read cannot reach the
    // outer catch and 500 the entire projection page.
    let canSeeLiveProgression: boolean;
    if (user.role === "admin") {
      canSeeLiveProgression = true;
    } else {
      try {
        canSeeLiveProgression = await EntitlementService.canAccessFeature(
          user.id,
          LIVE_PROJECTION_FEATURE_KEY,
        );
      } catch (error) {
        // Entitlement-read failure → degrade to unpaid view, never 500.
        //
        // @spec [Coding Standards §13 (no silent catch), §12.1 (redacted logs); student-UI
        //        register UI-10] | @implemented [2026-10-08]: the degrade is logged, so a
        //        paid student shown the unpaid view because the read failed is visible in
        //        the logs. Only the request id, the feature and the error's class name are
        //        written: no user id, no token, no error message (an RPC message can echo
        //        its arguments).
        logger.warn(
          "PROGRESS",
          "score_estimate_entitlement_read_failed",
          "Entitlement read failed; serving the unpaid projection view",
          {
            feature: LIVE_PROJECTION_FEATURE_KEY,
            errorName: error instanceof Error ? error.name : typeof error,
          },
          { requestId: req.requestId },
        );
        canSeeLiveProgression = false;
      }
    }

    // ── Paid: the live projection only ───────────────────────────────────
    if (canSeeLiveProgression) {
      const scoreProjection = await buildScoreEstimateFromCanonical(user.id);
      const liveEstimate =
        scoreProjection.status === "computed" ? scoreProjection.estimate : null;
      const estimateStatus = resolveEstimateStatus({
        diagnosticState: diagnosticState ?? "not_taken",
        diagnosticProjectionStatus: null,
        canSeeLiveProgression: true,
        hasLiveEstimate: liveEstimate !== null,
      });
      const estimate =
        estimateStatus === "computed" && liveEstimate
          ? {
              composite: liveEstimate.composite,
              math: liveEstimate.math,
              rw: liveEstimate.rw,
              range: liveEstimate.range,
              confidenceBand: confidenceBandFromScore(liveEstimate.confidence),
            }
          : null;
      return res.json({
        modelVersion: "kpi_truth_v1",
        measurementModel: MEASUREMENT_MODEL,
        estimate,
        diagnostic: null,
        estimateStatus,
        explanations: {
          estimated_scaled_total: totalExplanation(estimateStatus),
          ...(estimate
            ? {
                estimated_scaled_math: estimateExplanation(
                  "Estimated scaled Math",
                  "Math estimate moves based on weighted mastery evidence across Math domains.",
                ),
                estimated_scaled_rw: estimateExplanation(
                  "Estimated scaled Reading & Writing",
                  "RW estimate moves based on weighted mastery evidence across RW domains.",
                ),
              }
            : {}),
          official_sat_score: OFFICIAL_SCORE_EXPLANATION,
        },
        totalQuestionsAttempted: answeredQuestionCount,
        lastUpdated: scoreProjection.lastUpdated,
        officialScore: null,
        entitlement: {
          hasPaidAccess: access.hasPaidAccess,
          plan: access.plan,
          status: access.status,
          reason: access.reason,
          currentPeriodEnd: access.currentPeriodEnd,
        },
        requestId: req.requestId,
      });
    }

    // ── Free: the stored diagnostic projection only ──────────────────────
    const diagnosticRead = await readDiagnosticProjection({
      studentId: user.id,
    });
    const resolved = resolveEstimateStatus({
      diagnosticState: diagnosticState ?? "not_taken",
      diagnosticProjectionStatus: diagnosticRead.status,
      canSeeLiveProgression: false,
      hasLiveEstimate: false,
    });
    const diagnostic =
      resolved === "baseline_only" ? diagnosticEstimate(diagnosticRead) : null;
    // A computed status whose sections cannot form a composite would be a contract break
    // between the table's CHECK and this route; it is reported as insufficient, never as a
    // number.
    const estimateStatus: EstimateStatus =
      resolved === "baseline_only" && diagnostic === null
        ? "insufficient_evidence"
        : resolved;
    return res.json({
      modelVersion: "kpi_truth_v1",
      measurementModel: MEASUREMENT_MODEL,
      estimate: null,
      diagnostic,
      estimateStatus,
      cta: true,
      explanations: {
        estimated_scaled_total: totalExplanation(estimateStatus),
        official_sat_score: OFFICIAL_SCORE_EXPLANATION,
      },
      totalQuestionsAttempted: answeredQuestionCount,
      lastUpdated: diagnostic?.computedAt ?? new Date().toISOString(),
      officialScore: null,
      entitlement: {
        hasPaidAccess: access.hasPaidAccess,
        plan: access.plan,
        status: access.status,
        reason: access.reason,
        currentPeriodEnd: access.currentPeriodEnd,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error(
      "PROGRESS",
      "score_estimate_failed",
      "Failed to calculate score estimate",
      error,
      undefined,
      { requestId: req.requestId },
    );
    return res.status(500).json({
      error: "Failed to calculate score estimate",
      requestId: req.requestId,
    });
  }
};

/**
 * @spec [Doc-01_V8 §20 entitlement_features, Vertical-B Slice 2]
 * @implemented 2026-08-12
 *
 * plain English: GET /api/progress/kpis — canonical student KPI snapshot.
 *
 * Q1 consolidation: historical_trends gate now delegates to canAccessFeature
 * instead of the ad-hoc hasPaidAccess binary. For students, these resolve to
 * the same entitlement_active() predicate (semantic equivalence confirmed
 * 2026-08-12). The admin bypass mirrors getScoreEstimate — check role before
 * canAccessFeature to avoid an extra DB call for admins.
 */
export const getRecencyKpis = async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const access = await resolvePaidKpiAccessForUser(user.id);

    // FAIL-CLOSED (Doc-05C §7.4) — now via the SHARED resolver in services/kpi-access.
    // The guardian route calls the same function with the linked student's id; the subject
    // is the student on both paths. It used to be inline here and hardcoded `true` there.
    const includeHistoricalTrends =
      user.role === "admin"
        ? true
        : await resolveHistoricalTrendsAccess(user.id);

    const view = await buildStudentKpiViewFromCanonical(
      user.id,
      includeHistoricalTrends,
    );

    return res.json({
      modelVersion: view.modelVersion,
      timezone: view.timezone,
      week: view.week,
      recency: view.recency,
      metrics: view.metrics,
      gating: view.gating,
      measurementModel: view.measurementModel,
      entitlement: {
        hasPaidAccess: access.hasPaidAccess,
        plan: access.plan,
        status: access.status,
        reason: access.reason,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error(
      "PROGRESS",
      "recency_kpis_failed",
      "Failed to calculate KPIs",
      error,
      undefined,
      { requestId: req.requestId },
    );
    return res
      .status(500)
      .json({ error: "Failed to calculate KPIs", requestId: req.requestId });
  }
};
