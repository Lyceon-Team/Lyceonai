/**
 * Active runtime owner for /api/progress/* mounts in server/index.ts.
 * The "legacy" path segment reflects file location history, not runtime deprecation.
 */

import { Request, Response } from "express";
import { requireRequestUser } from "../../middleware/supabase-auth";
import {
  buildScoreEstimateFromCanonical,
  buildStudentKpiViewFromCanonical,
} from "../../services/canonical-runtime-views";
import {
  resolvePaidKpiAccessForUser,
  type KpiEntitlementAccess,
} from "../../services/kpi-access";

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

function premiumKpiRequired(
  res: Response,
  requestId: string | undefined,
  feature: string,
  entitlement: {
    reason: string;
    plan: "free" | "paid";
    status: KpiEntitlementAccess["status"];
    currentPeriodEnd: string | null;
  },
) {
  return res.status(402).json({
    error: "Premium feature required",
    code: "PREMIUM_REQUIRED",
    feature,
    message: "Upgrade to an active paid plan to unlock this KPI surface.",
    reason: entitlement.reason,
    entitlement: {
      plan: entitlement.plan,
      status: entitlement.status,
      currentPeriodEnd: entitlement.currentPeriodEnd,
    },
    requestId,
  });
}

/**
 * GET /api/progress/projection
 * Premium-only mastery estimate surface (mastery hexagon / weighted score estimate).
 */
export const getScoreEstimate = async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const access = await resolvePaidKpiAccessForUser(user.id, user.role);
    if (!access.hasPaidAccess) {
      return premiumKpiRequired(res, req.requestId, "mastery_hexagon", {
        reason: access.reason,
        plan: access.plan,
        status: access.status,
        currentPeriodEnd: access.currentPeriodEnd,
      });
    }

    const scoreProjection = await buildScoreEstimateFromCanonical(user.id);
    const totalQuestions = scoreProjection.totalQuestionsAttempted;

    // LC-AM3-001 honest-signal: when the score estimate is UNCOMPUTED (05C projections deferred
    // (AM-3) or not yet generated), return an explicit not-yet-available status with NO fabricated
    // score — never a 200/400 baseline. The UI hides or labels the surface.
    if (scoreProjection.status === "uncomputed") {
      return res.json({
        modelVersion: "kpi_truth_v1",
        measurementModel: {
          official: ["official_sat_score"],
          weighted: [
            "estimated_scaled_total",
            "estimated_scaled_math",
            "estimated_scaled_rw",
          ],
          diagnostic: ["mastery_evidence_count"],
        },
        estimate: null,
        estimateStatus: "not_yet_available",
        explanations: {
          estimated_scaled_total: {
            whatThisMeans:
              "Your weighted score estimate isn't available yet — not a score of zero or a baseline.",
            whyThisChanged:
              "It computes once mastery rollups (section projections) are generated from your scored practice evidence.",
            whatToDoNext:
              "Keep practicing; the estimate appears once enough scored evidence accumulates.",
          },
          official_sat_score: {
            whatThisMeans:
              "Official SAT scores only come from College Board score releases.",
            whyThisChanged:
              "Practice estimates never replace official reporting.",
            whatToDoNext:
              "Set your first target now; the estimate fills in as evidence accumulates.",
          },
        },
        totalQuestionsAttempted: totalQuestions,
        lastUpdated: scoreProjection.lastUpdated,
        officialScore: null,
        requestId: req.requestId,
      });
    }

    return res.json({
      modelVersion: "kpi_truth_v1",
      measurementModel: {
        official: ["official_sat_score"],
        weighted: [
          "estimated_scaled_total",
          "estimated_scaled_math",
          "estimated_scaled_rw",
        ],
        diagnostic: ["mastery_evidence_count"],
      },
      estimate: {
        composite: scoreProjection.estimate.composite,
        math: scoreProjection.estimate.math,
        rw: scoreProjection.estimate.rw,
        range: scoreProjection.estimate.range,
        confidence: scoreProjection.estimate.confidence,
        breakdown: scoreProjection.estimate.breakdown,
      },
      estimateStatus: "computed",
      explanations: {
        estimated_scaled_total: estimateExplanation(
          "Estimated scaled total",
          "Estimate updates when mastery rollups change from new attempts or decayed evidence weight.",
        ),
        estimated_scaled_math: estimateExplanation(
          "Estimated scaled Math",
          "Math estimate moves based on weighted mastery evidence across Math domains.",
        ),
        estimated_scaled_rw: estimateExplanation(
          "Estimated scaled Reading & Writing",
          "RW estimate moves based on weighted mastery evidence across RW domains.",
        ),
        official_sat_score: {
          whatThisMeans:
            "Official SAT scores only come from College Board score releases.",
          whyThisChanged:
            "This route intentionally separates official and diagnostic values to avoid conflation.",
          whatToDoNext:
            "Treat this as planning input and verify with your next proctored benchmark.",
        },
      },
      totalQuestionsAttempted: totalQuestions,
      lastUpdated: scoreProjection.lastUpdated,
      officialScore: null,
      requestId: req.requestId,
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        error: "Failed to calculate score estimate",
        requestId: req.requestId,
      });
  }
};

/**
 * GET /api/progress/kpis
 * Canonical student KPI snapshot with strict metric-kind separation.
 */
export const getRecencyKpis = async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const access = await resolvePaidKpiAccessForUser(user.id, user.role);
    const includeHistoricalTrends =
      user.role === "admin" ? true : access.hasPaidAccess;

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
    return res
      .status(500)
      .json({ error: "Failed to calculate KPIs", requestId: req.requestId });
  }
};
