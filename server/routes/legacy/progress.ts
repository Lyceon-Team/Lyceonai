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
import { resolvePaidKpiAccessForUser } from "../../services/kpi-access";

function estimateExplanation(label: string, detail: string): {
  whatThisMeans: string;
  whyThisChanged: string;
  whatToDoNext: string;
} {
  return {
    whatThisMeans: `${label} is a weighted estimate from stored mastery evidence, not an official score.`,
    whyThisChanged: detail,
    whatToDoNext: "Use the lower section estimate to prioritize your next focused practice block.",
  };
}

function premiumKpiRequired(res: Response, requestId: string | undefined, feature: string, reason: string) {
  return res.status(402).json({
    error: "Premium KPI feature required",
    code: "PREMIUM_KPI_REQUIRED",
    feature,
    message: "Upgrade to an active paid plan to unlock this KPI surface.",
    reason,
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
      return premiumKpiRequired(res, req.requestId, "mastery_hexagon", access.reason);
    }

    const scoreProjection = await buildScoreEstimateFromCanonical(user.id);
    const totalQuestions = scoreProjection.totalQuestionsAttempted;

    if (totalQuestions === 0) {
      return res.json({
        modelVersion: "kpi_truth_v1",
        measurementModel: {
          official: ["official_sat_score"],
          weighted: ["estimated_scaled_total", "estimated_scaled_math", "estimated_scaled_rw"],
          diagnostic: ["mastery_evidence_count"],
        },
        estimate: {
          composite: 400,
          math: 200,
          rw: 200,
          range: { low: 400, high: 400 },
          confidence: 0,
          breakdown: { math: [], rw: [] },
        },
        explanations: {
          estimated_scaled_total: estimateExplanation(
            "Estimated scaled total",
            "No mastery evidence is available yet, so the estimate remains at the minimum baseline."
          ),
          official_sat_score: {
            whatThisMeans: "Official SAT scores only come from College Board score releases.",
            whyThisChanged: "Practice estimates never replace official reporting.",
            whatToDoNext: "Use this baseline to set your first target and collect practice evidence.",
          },
        },
        totalQuestionsAttempted: 0,
        lastUpdated: new Date().toISOString(),
        officialScore: null,
        requestId: req.requestId,
      });
    }

    return res.json({
      modelVersion: "kpi_truth_v1",
      measurementModel: {
        official: ["official_sat_score"],
        weighted: ["estimated_scaled_total", "estimated_scaled_math", "estimated_scaled_rw"],
        diagnostic: ["mastery_evidence_count"],
      },
      estimate: scoreProjection.estimate,
      explanations: {
        estimated_scaled_total: estimateExplanation(
          "Estimated scaled total",
          "Estimate updates when mastery rollups change from new attempts or decayed evidence weight."
        ),
        estimated_scaled_math: estimateExplanation(
          "Estimated scaled Math",
          "Math estimate moves based on weighted mastery evidence across Math domains."
        ),
        estimated_scaled_rw: estimateExplanation(
          "Estimated scaled Reading & Writing",
          "RW estimate moves based on weighted mastery evidence across RW domains."
        ),
        official_sat_score: {
          whatThisMeans: "Official SAT scores only come from College Board score releases.",
          whyThisChanged: "This route intentionally separates official and diagnostic values to avoid conflation.",
          whatToDoNext: "Treat this as planning input and verify with your next proctored benchmark.",
        },
      },
      totalQuestionsAttempted: totalQuestions,
      lastUpdated: scoreProjection.lastUpdated,
      officialScore: null,
      requestId: req.requestId,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to calculate score estimate", requestId: req.requestId });
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
    const includeHistoricalTrends = user.role === "admin" ? true : access.hasPaidAccess;

    const view = await buildStudentKpiViewFromCanonical(user.id, includeHistoricalTrends);

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
    return res.status(500).json({ error: "Failed to calculate KPIs", requestId: req.requestId });
  }
};
