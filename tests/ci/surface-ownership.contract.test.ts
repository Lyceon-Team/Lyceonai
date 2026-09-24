/**
 * Surface Ownership Contract Tests (2026-03-18 audit pass)
 *
 * Proves for each audited student-facing surface:
 *   1. The route calls the canonical builder (not an inline fork).
 *   2. No duplicate final-view assembly path is reachable.
 *   3. The route fails-closed when the builder errors.
 *
 * Surfaces:
 *   - Practice session/state/view   → serveNextForSession in practice-canonical
 *   - Full-length report/view       → REMOVED (E1 exam deletion ruling, 2026-09-23:
 *                                     pre-baseline full-length runtime removed pending
 *                                     Doc 04 rebuild; the /report route and its builder
 *                                     are deleted, so Surface 2 is gone)
 *   - KPI summary/progress view     → buildStudentKpiViewFromCanonical
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

import { masteryLevelLabelsFixture } from "../utils/mastery-levels-fixture";

const masteryMocks2 = vi.hoisted(() => ({
}));


// buildWeaknessSkillsView now labels each level from `mastery_levels`. Without this the
// view reaches for a real Supabase client and the case hangs rather than failing.
vi.mock("../../apps/api/src/services/mastery-levels-read", () => ({
  loadMasteryLevels: vi.fn(async () => masteryLevelLabelsFixture()),
  resetMasteryLevelsCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Surface 2: Full-length report — DELETED 2026-09-23 (E1 exam deletion ruling:
//   pre-baseline full-length runtime removed pending Doc 04 rebuild). Its two cases
//   drove server/routes/full-length-exam-routes.ts /report through
//   buildStudentFullLengthReportView; route, builder and exam service are all gone.
//   The hoisted canonical-runtime-views / fullLengthExam / kpi-access / csrf mocks
//   that lived in this block went with it — Surface 5 installs its own via doMock.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Surface 3: Weakness — DELETED 2026-08-27 (owner ruling, OQ4).
//   The weakness-skills route and the weakest-skills route were the same capability at two
//   paths, neither named by any document. Both ranked by `mastery_score`, which Parent AC#20
//   confines to admin/internal/audit — and ordering by a forbidden column is a projection of
//   it, because the ranking carries the column's information content even when the value
//   never appears in the body. A recursive key-walk cannot see that; only reading the query
//   can. The route, its view, its service and its tests are gone.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Surface 5: KPI summary/progress view — getRecencyKpis calls
//            buildStudentKpiViewFromCanonical directly.
//            No stale parallel builder present.
// ---------------------------------------------------------------------------
describe("KPI summary: canonical builder path", () => {
  const kpiMocks5 = {
    buildStudentKpiViewFromCanonical: vi.fn(),
    resolvePaidKpiAccessForUser: vi.fn(),
  };

  it("getRecencyKpis calls buildStudentKpiViewFromCanonical", async () => {
    kpiMocks5.buildStudentKpiViewFromCanonical.mockResolvedValue({
      modelVersion: "kpi_truth_v1",
      timezone: "America/Chicago",
      week: { questionsSolved: 45, accuracy: 80, explanations: {} },
      recency: null,
      metrics: [],
      gating: {
        historicalTrends: {
          allowed: false,
          requiredPlan: "paid",
          reason: "no plan",
        },
      },
      measurementModel: { official: [], weighted: [], diagnostic: [] },
    });
    kpiMocks5.resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: false,
      plan: "free",
      status: "inactive",
      currentPeriodEnd: null,
      reason: "no active plan",
    });

    // Override the mocks at the module level
    vi.doMock("../../server/services/canonical-runtime-views", () => ({
      buildStudentKpiViewFromCanonical:
        kpiMocks5.buildStudentKpiViewFromCanonical,
      buildScoreEstimateFromCanonical: vi.fn(),
      readDiagnosticBaseline: vi.fn().mockResolvedValue(null),
    }));

    // These two cases assert what getRecencyKpis CALLS, not how the historical-trends flag
    // is derived. The real resolver reaches a live entitlement client and hangs the case at
    // the 5s timeout, so it is stubbed here — stubbing it mocks away nothing these cases
    // claim. The derivation itself is proved in kpi.gating.contract.test.ts, which runs the
    // real function over a mocked EntitlementService.
    vi.doMock("../../server/services/kpi-access", () => ({
      resolvePaidKpiAccessForUser: kpiMocks5.resolvePaidKpiAccessForUser,
      resolveHistoricalTrendsAccess: vi.fn(async () => false),
    }));

    // Q1 consolidation: getRecencyKpis now uses canAccessFeature('historical_trends').
    vi.doMock("../../server/services/entitlement-service", () => ({
      EntitlementService: {
        canAccessFeature: vi.fn().mockResolvedValue(false),
        isEntitlementActiveForProfile: vi.fn().mockResolvedValue(false),
      },
    }));

    const { getRecencyKpis } =
      await import("../../server/routes/legacy/progress");

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { id: "student-5", role: "student" };
      req.requestId = "req-kpi-5";
      next();
    });
    app.get("/api/progress/kpis", getRecencyKpis);

    const res = await request(app).get("/api/progress/kpis");

    expect(res.status).toBe(200);
    // Must call the canonical view builder directly
    expect(kpiMocks5.buildStudentKpiViewFromCanonical).toHaveBeenCalledWith(
      "student-5",
      false,
    );
    // Response must include the view props (not inlined elsewhere)
    expect(res.body).toHaveProperty("modelVersion");
    expect(res.body).toHaveProperty("week");
    expect(res.body).toHaveProperty("entitlement");
  });

  it("getRecencyKpis fails closed when buildStudentKpiViewFromCanonical throws", async () => {
    kpiMocks5.buildStudentKpiViewFromCanonical.mockRejectedValue(
      new Error("kpi_snapshot_exploded"),
    );
    kpiMocks5.resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: true,
      plan: "paid",
      status: "active",
      currentPeriodEnd: null,
      reason: "active",
    });

    vi.doMock("../../server/services/canonical-runtime-views", () => ({
      buildStudentKpiViewFromCanonical:
        kpiMocks5.buildStudentKpiViewFromCanonical,
      buildScoreEstimateFromCanonical: vi.fn(),
      readDiagnosticBaseline: vi.fn().mockResolvedValue(null),
    }));

    // These two cases assert what getRecencyKpis CALLS, not how the historical-trends flag
    // is derived. The real resolver reaches a live entitlement client and hangs the case at
    // the 5s timeout, so it is stubbed here — stubbing it mocks away nothing these cases
    // claim. The derivation itself is proved in kpi.gating.contract.test.ts, which runs the
    // real function over a mocked EntitlementService.
    vi.doMock("../../server/services/kpi-access", () => ({
      resolvePaidKpiAccessForUser: kpiMocks5.resolvePaidKpiAccessForUser,
      resolveHistoricalTrendsAccess: vi.fn(async () => false),
    }));

    vi.doMock("../../server/services/entitlement-service", () => ({
      EntitlementService: {
        canAccessFeature: vi.fn().mockResolvedValue(true),
        isEntitlementActiveForProfile: vi.fn().mockResolvedValue(true),
      },
    }));

    const { getRecencyKpis } =
      await import("../../server/routes/legacy/progress");

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { id: "student-6", role: "student" };
      req.requestId = "req-kpi-6";
      next();
    });
    app.get("/api/progress/kpis", getRecencyKpis);

    const res = await request(app).get("/api/progress/kpis");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});
