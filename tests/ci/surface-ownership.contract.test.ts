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
 *   - Full-length report/view       → buildStudentFullLengthReportView in canonical-runtime-views
 *   - Calendar month view           → buildCalendarMonthView (getMonthPayload alias in calendar route)
 *   - KPI summary/progress view     → buildStudentKpiViewFromCanonical
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
// Surface 2: Full-length report — buildStudentFullLengthReportView is the only
//            assembler called by the /report route.
// ---------------------------------------------------------------------------
describe("Full-length report: single canonical builder", () => {
  const kpiMocks = vi.hoisted(() => ({
    buildStudentFullLengthReportView: vi.fn(),
    resolvePaidKpiAccessForUser: vi.fn(),
  }));

  const examMocks = vi.hoisted(() => ({
    getExamReport: vi.fn(),
  }));

  vi.mock("../../server/services/canonical-runtime-views", () => ({
    buildStudentFullLengthReportView: (...args: any[]) =>
      kpiMocks.buildStudentFullLengthReportView(...args),
    buildStudentKpiViewFromCanonical: vi.fn(),
    buildScoreEstimateFromCanonical: vi.fn(),
    projectGuardianFullLengthReportView: vi.fn(),
  }));

  vi.mock("../../apps/api/src/services/fullLengthExam", () => ({
    getExamReport: (...args: any[]) => examMocks.getExamReport(...args),
    createExamSession: vi.fn(),
    getCurrentSession: vi.fn(),
    startExam: vi.fn(),
    submitAnswer: vi.fn(),
    submitModule: vi.fn(),
    continueFromBreak: vi.fn(),
    completeExam: vi.fn(),
    getExamReviewAfterCompletion: vi.fn(),
    persistModuleCalculatorState: vi.fn(),
  }));

  vi.mock("../../server/services/kpi-access", async () => {
    const actual = await vi.importActual<
      typeof import("../../server/services/kpi-access")
    >("../../server/services/kpi-access");
    return {
      ...actual,
      resolvePaidKpiAccessForUser: (...args: any[]) =>
        kpiMocks.resolvePaidKpiAccessForUser(...args),
    };
  });

  vi.mock("../../server/middleware/csrf-double-submit", () => ({
    doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
    generateToken: () => "test-csrf-token",
  }));

  function buildReportApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: "student-1", role: "student" };
      req.requestId = "req-test";
      next();
    });
    // Inline auth stub for requireSupabaseAuth
    app.use((req: any, _res: any, next: any) => {
      (req as any).__authPassed = true;
      next();
    });
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    kpiMocks.resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: true,
      reason: "active",
      plan: "paid",
      status: "active",
      currentPeriodEnd: null,
    });
  });

  it("report route calls buildStudentFullLengthReportView with exam service result", async () => {
    const fakeReport = {
      sessionId: "sess-1",
      scaledScore: { total: 1400, rw: 700, math: 700 },
      rawScore: { total: { correct: 90, total: 98 } },
      completedAt: new Date().toISOString(),
    };
    examMocks.getExamReport.mockResolvedValue(fakeReport);
    kpiMocks.buildStudentFullLengthReportView.mockReturnValue({
      ...fakeReport,
      kpis: [],
      measurementModel: { official: [], weighted: [], diagnostic: [] },
    });

    // Import here to pick up the hoisted mocks
    const { default: fullLengthRouter } =
      await import("../../server/routes/full-length-exam-routes");

    const app = buildReportApp();
    app.use("/api/full-length", fullLengthRouter);

    const res = await request(app).get(
      "/api/full-length/sessions/sess-1/report",
    );

    expect(examMocks.getExamReport).toHaveBeenCalledWith({
      sessionId: "sess-1",
      userId: "student-1",
    });
    // The route MUST call the canonical builder, not inline-assemble
    expect(kpiMocks.buildStudentFullLengthReportView).toHaveBeenCalledWith(
      fakeReport,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("kpis");
    expect(res.body).toHaveProperty("measurementModel");
  }, 15000);

  it("report route fails closed when buildStudentFullLengthReportView throws", async () => {
    examMocks.getExamReport.mockResolvedValue({
      sessionId: "sess-err",
      scaledScore: { total: 1200, rw: 600, math: 600 },
      rawScore: { total: { correct: 50, total: 98 } },
      completedAt: new Date().toISOString(),
    });
    kpiMocks.buildStudentFullLengthReportView.mockImplementation(() => {
      throw new Error("kpi_builder_exploded");
    });

    const { default: fullLengthRouter } =
      await import("../../server/routes/full-length-exam-routes");
    const app = buildReportApp();
    app.use("/api/full-length", fullLengthRouter);

    const res = await request(app).get(
      "/api/full-length/sessions/sess-err/report",
    );

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  }, 15000);

  // The weakness skills route is GONE (owner ruling 2026-08-27, OQ4). Nothing specified it,
  // and it ordered by `mastery_score` — a column Parent AC#20 confines to admin/internal.
  // Ordering by a forbidden column is a projection of it: the ranking carries the column's
  // information content even though the value never appeared in the body.
});

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
// Surface 4: Calendar month view — getMonthPayload MUST be the buildCalendarMonthView
//            alias and NOT any inline forked assembler.
// ---------------------------------------------------------------------------
describe("Calendar month view: getMonthPayload is buildCalendarMonthView alias", async () => {
  it("calendar route exports getMonthPayload as the buildCalendarMonthView function", async () => {
    // We import both the route alias and the service builder and confirm they're
    // the exact same function reference (no forking).
    const calendarRoute = await import("../../apps/api/src/routes/calendar");
    const calendarService =
      await import("../../apps/api/src/services/calendar-month-view");

    expect(calendarRoute.getMonthPayload).toBe(
      calendarService.buildCalendarMonthView,
    );
  });
});

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
      buildStudentFullLengthReportView: vi.fn(),
      projectGuardianFullLengthReportView: vi.fn(),
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
      buildStudentFullLengthReportView: vi.fn(),
      projectGuardianFullLengthReportView: vi.fn(),
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
