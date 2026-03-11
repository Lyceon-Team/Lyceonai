/**
 * Active runtime owner for /api/progress/* mounts in server/index.ts.
 * The "legacy" path segment reflects file location history, not runtime deprecation.
 */

import { Request, Response } from "express";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { calculateScore, DomainMastery, ScoreProjection } from "../../services/score-projection";
import {
  KPI_TRUTH_LAYER_VERSION,
  buildCanonicalPracticeKpiSnapshot,
  buildStudentKpiView,
} from "../../services/kpi-truth-layer";
import { resolvePaidKpiAccessForUser } from "../../services/kpi-access";

function projectionExplanation(label: string, detail: string): {
  whatThisMeans: string;
  whyThisChanged: string;
  whatToDoNext: string;
} {
  return {
    whatThisMeans: `${label} is a weighted estimate from your stored mastery evidence, not an official score.`,
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
 * Premium-only mastery projection surface (mastery hexagon / weighted score estimate).
 */
export const getScoreProjection = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required", requestId: req.requestId });
    }

    const access = await resolvePaidKpiAccessForUser(req.user.id, req.user.role);
    if (!access.hasPaidAccess) {
      return premiumKpiRequired(res, req.requestId, "mastery_hexagon", access.reason);
    }

    const { data: masteryRows, error: masteryError } = await supabaseServer
      .from("student_skill_mastery")
      .select("section, domain, skill, mastery_score, attempts, updated_at")
      .eq("user_id", req.user.id);

    if (masteryError) {
      return res.status(500).json({ error: "Failed to fetch mastery data", requestId: req.requestId });
    }

    const domainMastery: Record<string, DomainMastery> = {};
    let totalQuestions = 0;

    for (const row of masteryRows || []) {
      const section = row.section?.toLowerCase() === "math" ? "math" : "rw";
      const domain = row.domain || "unknown";
      const key = `${section}:${domain}`;

      if (!domainMastery[key]) {
        domainMastery[key] = {
          domain,
          section: section as "math" | "rw",
          mastery_score: 0,
          attempts: 0,
          last_activity: null,
        };
      }

      domainMastery[key].mastery_score = Math.max(domainMastery[key].mastery_score, row.mastery_score || 0);
      domainMastery[key].attempts += row.attempts || 0;
      totalQuestions += row.attempts || 0;

      if (row.updated_at) {
        const rowDate = new Date(row.updated_at);
        const existingDate = domainMastery[key].last_activity
          ? new Date(domainMastery[key].last_activity as string)
          : null;
        if (!existingDate || rowDate > existingDate) {
          domainMastery[key].last_activity = row.updated_at;
        }
      }
    }

    const masteryArray = Object.values(domainMastery);

    if (totalQuestions === 0) {
      return res.json({
        modelVersion: KPI_TRUTH_LAYER_VERSION,
        measurementModel: {
          official: ["official_sat_score"],
          weighted: ["estimated_scaled_total", "estimated_scaled_math", "estimated_scaled_rw"],
          diagnostic: ["mastery_evidence_count"],
        },
        projection: {
          composite: 400,
          math: 200,
          rw: 200,
          range: { low: 400, high: 400 },
          confidence: 0,
          breakdown: { math: [], rw: [] },
        },
        explanations: {
          estimated_scaled_total: projectionExplanation(
            "Estimated scaled total",
            "No mastery evidence is available yet, so the estimate remains at the minimum baseline."
          ),
          official_sat_score: {
            whatThisMeans: "Official SAT scores only come from College Board score releases.",
            whyThisChanged: "Lyceon practice projections never replace official reporting.",
            whatToDoNext: "Use this baseline to set your first target and collect practice evidence.",
          },
        },
        totalQuestionsAttempted: 0,
        lastUpdated: new Date().toISOString(),
        officialScore: null,
        requestId: req.requestId,
      });
    }

    const projection: ScoreProjection = calculateScore(masteryArray, totalQuestions);

    return res.json({
      modelVersion: KPI_TRUTH_LAYER_VERSION,
      measurementModel: {
        official: ["official_sat_score"],
        weighted: ["estimated_scaled_total", "estimated_scaled_math", "estimated_scaled_rw"],
        diagnostic: ["mastery_evidence_count"],
      },
      projection,
      explanations: {
        estimated_scaled_total: projectionExplanation(
          "Estimated scaled total",
          "Estimate updates when mastery rollups change from new attempts or decayed evidence weight."
        ),
        estimated_scaled_math: projectionExplanation(
          "Estimated scaled Math",
          "Math estimate moves based on weighted mastery evidence across Math domains."
        ),
        estimated_scaled_rw: projectionExplanation(
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
      lastUpdated: new Date().toISOString(),
      officialScore: null,
      requestId: req.requestId,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to calculate score projection", requestId: req.requestId });
  }
};

/**
 * GET /api/progress/kpis
 * Canonical student KPI snapshot with strict metric-kind separation.
 */
export const getRecencyKpis = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required", requestId: req.requestId });
    }

    const access = await resolvePaidKpiAccessForUser(req.user.id, req.user.role);
    const includeHistoricalTrends = req.user.role === "admin" ? true : access.hasPaidAccess;

    const snapshot = await buildCanonicalPracticeKpiSnapshot(req.user.id);
    const view = buildStudentKpiView(snapshot, includeHistoricalTrends);

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
