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
 *   - Weakness view                 → buildWeaknessSkillsView → getWeakestSkills
 *   - Calendar month view           → buildCalendarMonthView (getMonthPayload alias in calendar route)
 *   - KPI summary/progress view     → buildStudentKpiViewFromCanonical
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const masteryMocks2 = vi.hoisted(() => ({
  getWeakestSkills: vi.fn(),
}));

vi.mock("../../apps/api/src/services/studentMastery", () => ({
  getWeakestSkills: (...args: any[]) => masteryMocks2.getWeakestSkills(...args),
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

  vi.mock("../../server/services/kpi-access", () => ({
    resolvePaidKpiAccessForUser: (...args: any[]) =>
      kpiMocks.resolvePaidKpiAccessForUser(...args),
  }));

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

  it("report is premium-gated: returns 402 when entitlement resolves to free", async () => {
    kpiMocks.resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: false,
      reason: "no active plan",
      plan: "free",
      status: "inactive",
      currentPeriodEnd: null,
    });

    const { default: fullLengthRouter } =
      await import("../../server/routes/full-length-exam-routes");
    const app = buildReportApp();
    app.use("/api/full-length", fullLengthRouter);

    const res = await request(app).get(
      "/api/full-length/sessions/sess-gate/report",
    );

    expect(res.status).toBe(402);
    // Builder must NOT be called if gating fails
    expect(kpiMocks.buildStudentFullLengthReportView).not.toHaveBeenCalled();
    expect(examMocks.getExamReport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Surface 3: Weakness — /skills route through canonical builder only.
//            buildWeaknessSkillsView owns the skills shape. No inline fork.
//            Clusters deprecated (post-launch revisit); table retained, code removed.
// ---------------------------------------------------------------------------
describe("Weakness view: single canonical builder per sub-surface", () => {
  it("skills route calls buildWeaknessSkillsView scoped to the session student, with no caller-supplied threshold", async () => {
    masteryMocks2.getWeakestSkills.mockResolvedValue([]);

    const { weaknessRouter } =
      await import("../../apps/api/src/routes/weakness");

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { id: "student-2", role: "student" };
      next();
    });
    app.use("/api/me/weakness", weaknessRouter);

    await request(app).get("/api/me/weakness/skills");

    // The skills route owns its own student scope. failOnError is no longer part of the
    // contract — fetchWeakestSkills always throws on a query error — so what is asserted
    // here is the scoping, plus the absence of any caller-supplied evidence threshold.
    expect(masteryMocks2.getWeakestSkills).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "student-2" }),
    );
    const call = masteryMocks2.getWeakestSkills.mock.calls[0]?.[0] ?? {};
    expect(call).not.toHaveProperty("minAttempts");
    expect(call).not.toHaveProperty("failOnError");
  });
});

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

    vi.doMock("../../server/services/kpi-access", () => ({
      resolvePaidKpiAccessForUser: kpiMocks5.resolvePaidKpiAccessForUser,
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

    vi.doMock("../../server/services/kpi-access", () => ({
      resolvePaidKpiAccessForUser: kpiMocks5.resolvePaidKpiAccessForUser,
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
