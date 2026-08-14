/**
 * Active runtime owner for /api/progress/* mounts in server/index.ts.
 * The "legacy" path segment reflects file location history, not runtime deprecation.
 */

import { Request, Response } from "express";
import { requireRequestUser } from "../../middleware/supabase-auth";
import {
  buildScoreEstimateFromCanonical,
  buildStudentKpiViewFromCanonical,
  readDiagnosticBaseline,
} from "../../services/canonical-runtime-views";
import { resolvePaidKpiAccessForUser } from "../../services/kpi-access";
import { EntitlementService } from "../../services/entitlement-service";

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

/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20 entitlement_features, Vertical-B Slice 2]
 * @implemented 2026-08-12
 *
 * plain English: GET /api/progress/projection — tiered score estimate surface.
 *
 * - no_baseline: the student hasn't completed the diagnostic yet (no baseline
 *   captured, no progression to show). The honest-signal contract stands: never
 *   fabricate a score.
 * - baseline_only: the student completed the diagnostic (baseline exists) but does
 *   NOT have the mastery_detail entitlement feature. Show the frozen diagnostic
 *   baseline + upgrade CTA. Do NOT serve the live rolling projection.
 * - computed: the student has the mastery_detail feature (paid or admin). Show the
 *   live rolling projection AND the baseline for comparison.
 *
 * FAIL-CLOSED: if canAccessFeature errors, the student sees baseline_only (never
 * the live projection). An entitlement-read failure must never accidentally grant
 * the paid view.
 */
export const getScoreEstimate = async (req: Request, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const access = await resolvePaidKpiAccessForUser(user.id, user.role);

    // Read the frozen diagnostic baseline (null if no diagnostic completed yet).
    const baseline = await readDiagnosticBaseline(user.id);

    // Feature-scoped gate: admin bypass at call site, then canAccessFeature.
    // Semantic equivalence confirmed (2026-08-12): for students, hasPaidAccess
    // and canAccessFeature('mastery_detail') both resolve to the same canonical
    // entitlement_active() predicate. The admin bypass in resolvePaidKpiAccessForUser
    // is mirrored here to avoid an extra DB call for admins.
    //
    // FAIL-CLOSED (Doc-05C §7.4): an entitlement-read failure must degrade to the
    // unpaid view (baseline_only), never 500 and never the paid view. canAccessFeature
    // itself fails closed, but we double-guard here so a thrown entitlement-read
    // cannot reach the outer catch and 500 the entire projection page.
    let canSeeLiveProgression: boolean;
    if (user.role === "admin") {
      canSeeLiveProgression = true;
    } else {
      try {
        canSeeLiveProgression = await EntitlementService.canAccessFeature(
          user.id,
          "mastery_detail",
        );
      } catch {
        // Entitlement-read failure → degrade to unpaid view, never 500.
        canSeeLiveProgression = false;
      }
    }

    // ── Branch 1: no diagnostic baseline exists yet ──────────────────────
    if (!baseline) {
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
        baseline: null,
        estimateStatus: "no_baseline",
        explanations: {
          estimated_scaled_total: {
            whatThisMeans:
              "Your score estimate isn't available yet — complete the diagnostic to establish your starting point.",
            whyThisChanged:
              "The estimate requires a completed diagnostic assessment to calibrate.",
            whatToDoNext:
              "Complete the diagnostic to unlock your baseline score.",
          },
          official_sat_score: {
            whatThisMeans:
              "Official SAT scores only come from College Board score releases.",
            whyThisChanged:
              "Practice estimates never replace official reporting.",
            whatToDoNext:
              "Set your first target now; the estimate fills in after the diagnostic.",
          },
        },
        totalQuestionsAttempted: 0,
        lastUpdated: new Date().toISOString(),
        officialScore: null,
        entitlement: {
          hasPaidAccess: access.hasPaidAccess,
          plan: access.plan,
          status: access.status,
          reason: access.reason,
        },
        requestId: req.requestId,
      });
    }

    // ── Branch 2: baseline exists, but no mastery_detail feature (unpaid) ─
    if (!canSeeLiveProgression) {
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
        baseline: {
          composite: baseline.composite,
          math: baseline.math,
          rw: baseline.rw,
          range: baseline.range,
          confidence: baseline.confidence,
          capturedAt: baseline.capturedAt,
        },
        estimateStatus: "baseline_only",
        cta: true,
        explanations: {
          estimated_scaled_total: {
            whatThisMeans:
              "This is your starting point from the diagnostic. Upgrade to track your progression over time.",
            whyThisChanged:
              "Your baseline score was captured when you completed the diagnostic assessment.",
            whatToDoNext:
              "Upgrade to see how your score improves as you practice.",
          },
          official_sat_score: {
            whatThisMeans:
              "Official SAT scores only come from College Board score releases.",
            whyThisChanged:
              "This route intentionally separates official and diagnostic values to avoid conflation.",
            whatToDoNext:
              "Treat this as planning input and verify with your next proctored benchmark.",
          },
        },
        totalQuestionsAttempted: 0,
        lastUpdated: baseline.capturedAt,
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

    // ── Branch 3: paid — serve live projection + baseline for comparison ─
    const scoreProjection = await buildScoreEstimateFromCanonical(user.id);
    const totalQuestions = scoreProjection.totalQuestionsAttempted;

    // LC-AM3-001 honest-signal: even for paid users, if the live projection is
    // uncomputed (e.g. mastery_constants changed, evidence gate re-evaluated),
    // show baseline only. This is a transient edge — the projection should exist
    // if the baseline does, but we defend against it.
    const liveEstimate =
      scoreProjection.status === "computed" ? scoreProjection.estimate : null;

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
      estimate: liveEstimate
        ? {
            composite: liveEstimate.composite,
            math: liveEstimate.math,
            rw: liveEstimate.rw,
            range: liveEstimate.range,
            confidence: liveEstimate.confidence,
          }
        : null,
      baseline: {
        composite: baseline.composite,
        math: baseline.math,
        rw: baseline.rw,
        range: baseline.range,
        confidence: baseline.confidence,
        capturedAt: baseline.capturedAt,
      },
      estimateStatus: liveEstimate ? "computed" : "baseline_only",
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

    const access = await resolvePaidKpiAccessForUser(user.id, user.role);

    // FAIL-CLOSED (Doc-05C §7.4): if canAccessFeature throws (entitlement-read
    // failure), degrade to includeHistoricalTrends=false — hide the premium
    // surface rather than 500-ing the entire endpoint. Same pattern as
    // getScoreEstimate's canSeeLiveProgression guard.
    let includeHistoricalTrends: boolean;
    if (user.role === "admin") {
      includeHistoricalTrends = true;
    } else {
      try {
        includeHistoricalTrends = await EntitlementService.canAccessFeature(
          user.id,
          "historical_trends",
        );
      } catch {
        // Entitlement-read failure → hide historical trends, never 500.
        includeHistoricalTrends = false;
      }
    }

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
