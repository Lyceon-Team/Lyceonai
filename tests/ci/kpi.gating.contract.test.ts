import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const resolvePaidKpiAccessForUser = vi.fn();
const buildStudentKpiViewFromCanonical = vi.fn();
const buildScoreEstimateFromCanonical = vi.fn();
const readDiagnosticBaseline = vi.fn();
const buildStudentFullLengthReportView = vi.fn((x: any) => x);
const getExamReport = vi.fn();
const supabaseFrom = vi.fn();
const canAccessFeature = vi.fn();

vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser,
}));

vi.mock("../../server/services/canonical-runtime-views", () => ({
  buildScoreEstimateFromCanonical,
  buildStudentKpiViewFromCanonical,
  buildStudentFullLengthReportView,
  readDiagnosticBaseline,
}));

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature,
    isEntitlementActiveForProfile: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: supabaseFrom,
  },
}));

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");

  return {
    ...actual,
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.user = {
        id: "student-1",
        role: "student",
        isGuardian: false,
        isAdmin: false,
      };
      req.requestId ??= "req-kpi-gating";
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../apps/api/src/services/fullLengthExam", () => ({
  createExamSession: vi.fn(),
  getCurrentSession: vi.fn(),
  startExam: vi.fn(),
  submitAnswer: vi.fn(),
  submitModule: vi.fn(),
  continueFromBreak: vi.fn(),
  completeExam: vi.fn(),
  getExamReport,
  getExamReviewAfterCompletion: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({ from: vi.fn() })),
}));

function createRes() {
  let statusCode = 200;
  let body: any = null;

  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

describe("KPI Gating Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: false,
      accountId: "acc-free",
      plan: "free",
      status: "inactive",
      currentPeriodEnd: null,
      reason:
        "Student entitlement is free/inactive/expired for premium KPI surfaces.",
    });

    // Vertical-B Slice 2: default baseline exists (diagnostic completed) + unpaid.
    readDiagnosticBaseline.mockResolvedValue({
      composite: 1000,
      math: 500,
      rw: 500,
      range: { low: 940, high: 1060 },
      confidence: 0.6,
      capturedAt: "2026-07-01T00:00:00.000Z",
    });

    // Free tier → canAccessFeature('mastery_detail') returns false.
    canAccessFeature.mockResolvedValue(false);

    buildStudentKpiViewFromCanonical.mockResolvedValue({
      modelVersion: "kpi_truth_v1",
      timezone: "America/Chicago",
      week: {
        questionsSolved: 24,
        accuracy: 58,
        explanations: {
          week_questions: {
            whatThisMeans: "Questions attempted in 7 days",
            whyThisChanged: "Increased by 14",
            whatToDoNext: "Keep review time fixed",
            ruleId: "RULE_WEEK_QUESTIONS",
          },
          week_accuracy: {
            whatThisMeans: "Correct percent in 7 days",
            whyThisChanged: "Up by 8 pts",
            whatToDoNext: "Focus next set on weakest skill",
            ruleId: "RULE_WEEK_ACCURACY",
          },
          current_streak: {
            whatThisMeans: "Consecutive active days",
            whyThisChanged: "Active again today",
            whatToDoNext: "Protect the streak with one short scored block",
            ruleId: "RULE_CURRENT_STREAK",
          },
        },
      },
      recency: null,
      metrics: [],
      gating: {
        historicalTrends: {
          allowed: false,
          requiredPlan: "paid",
          reason: "Historical trend KPIs require an active paid entitlement.",
        },
      },
      measurementModel: {
        official: [],
        weighted: [],
        diagnostic: ["week_questions", "week_accuracy", "current_streak"],
      },
    });

    buildScoreEstimateFromCanonical.mockResolvedValue({
      status: "computed",
      totalQuestionsAttempted: 40,
      lastUpdated: "2026-03-10T00:00:00.000Z",
      estimate: {
        composite: 1080,
        math: 540,
        rw: 540,
        range: { low: 1040, high: 1120 },
        confidence: 0.7,
      },
    });
  });

  // Vertical-B Slice 2 (2026-08-12): 402→200 contract change. Free-tier students
  // with a completed diagnostic get baseline_only (frozen baseline + CTA), not 402.
  it("gates free-tier student to baseline_only (frozen baseline + CTA, no live projection)", async () => {
    const { getScoreEstimate } =
      await import("../../server/routes/legacy/progress");

    const req: any = {
      user: {
        id: "student-1",
        role: "student",
        isGuardian: false,
        isAdmin: false,
      },
      requestId: "req-1",
    };
    const { res, getStatus, getBody } = createRes();

    await getScoreEstimate(req, res as any);

    expect(getStatus()).toBe(200);
    const payload = getBody();
    expect(payload.estimateStatus).toBe("baseline_only");
    expect(payload.cta).toBe(true);
    // Baseline is served (frozen diagnostic capture).
    expect(payload.baseline).toMatchObject({
      composite: 1000,
      math: 500,
      rw: 500,
    });
    // Live estimate is NOT served.
    expect(payload.estimate).toBeNull();
    expect(payload.requestId).toBe("req-1");
    expect(payload.entitlement).toMatchObject({
      plan: "free",
      status: "inactive",
    });
    // buildScoreEstimateFromCanonical must NOT be called (unpaid → no live projection).
    expect(buildScoreEstimateFromCanonical).not.toHaveBeenCalled();
  }, 15_000);

  it("returns computed estimate payload when paid access is active", async () => {
    resolvePaidKpiAccessForUser.mockResolvedValueOnce({
      hasPaidAccess: true,
      accountId: "acc-paid",
      plan: "paid",
      status: "active",
      currentPeriodEnd: null,
      reason: "Active paid entitlement.",
    });
    // Paid → canAccessFeature('mastery_detail') returns true.
    canAccessFeature.mockResolvedValueOnce(true);

    const { getScoreEstimate } =
      await import("../../server/routes/legacy/progress");

    const req: any = {
      user: {
        id: "student-1",
        role: "student",
        isGuardian: false,
        isAdmin: false,
      },
      requestId: "req-estimate",
    };
    const { res, getBody, getStatus } = createRes();

    await getScoreEstimate(req, res as any);

    expect(getStatus()).toBe(200);
    const payload = getBody();
    expect(payload.estimateStatus).toBe("computed");
    expect(payload.estimate).toBeDefined();
    expect(payload.estimate.range).toEqual({ low: 1040, high: 1120 });
    // Baseline is also served for comparison.
    expect(payload.baseline).toMatchObject({ composite: 1000 });
    expect(payload.projection).toBeUndefined();
  }, 15_000);

  // Q1 consolidation (2026-08-12): historical_trends gate now uses canAccessFeature
  // instead of ad-hoc hasPaidAccess binary.
  it("hides historical trends for free-tier KPI view", async () => {
    // canAccessFeature('historical_trends') → false for free-tier.
    canAccessFeature.mockResolvedValueOnce(false);

    const { getRecencyKpis } =
      await import("../../server/routes/legacy/progress");

    const req: any = {
      user: {
        id: "student-1",
        role: "student",
        isGuardian: false,
        isAdmin: false,
      },
      requestId: "req-2",
    };
    const { res, getBody } = createRes();

    await getRecencyKpis(req, res as any);

    const payload = getBody();
    expect(payload.recency).toBeNull();
    expect(payload.gating.historicalTrends.allowed).toBe(false);
    expect(payload.week.explanations.week_questions.whatThisMeans).toEqual(
      expect.stringMatching(/\S/),
    );
    expect(payload.week.explanations.week_questions.whyThisChanged).toEqual(
      expect.stringMatching(/\S/),
    );
    expect(payload.week.explanations.week_questions.whatToDoNext).toEqual(
      expect.stringMatching(/\S/),
    );
    expect(buildStudentKpiViewFromCanonical).toHaveBeenCalledWith(
      "student-1",
      false,
    );
  });

  it("denies free-tier full-test analytics report route", async () => {
    const router = (await import("../../server/routes/full-length-exam-routes"))
      .default;

    const app = express();
    app.use(express.json());
    app.use("/api/full-length", router);

    const res = await request(app).get(
      "/api/full-length/sessions/session-free-1/report",
    );

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(res.body.feature).toBe("full_test_analytics");
    expect(getExamReport).not.toHaveBeenCalled();
  });

  it("denies free-tier mastery skills route (mastery hexagon)", async () => {
    const { masteryRouter } = await import("../../apps/api/src/routes/mastery");

    const app = express();
    app.use((req: any, _res, next) => {
      req.user = {
        id: "student-1",
        role: "student",
        isGuardian: false,
        isAdmin: false,
      };
      req.requestId ??= "req-mastery-skills";
      next();
    });
    app.use("/api/me/mastery", masteryRouter);

    const res = await request(app).get("/api/me/mastery/skills");

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(res.body.feature).toBe("mastery_hexagon");
  });

  it("denies free-tier full-length session creation surface", async () => {
    const router = (await import("../../server/routes/full-length-exam-routes"))
      .default;

    const app = express();
    app.use(express.json());
    app.use("/api/full-length", router);

    const res = await request(app).post("/api/full-length/sessions").send({});

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(res.body.feature).toBe("full_length");
  });
});
