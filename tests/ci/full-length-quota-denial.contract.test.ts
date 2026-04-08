import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/middleware/supabase-auth", () => ({
  requireSupabaseAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: "student-1",
      role: "student",
      isAdmin: false,
      isGuardian: false,
    };
    req.requestId = "req-full-length-quota";
    next();
  },
  requireRequestUser: (req: any) => req.user,
}));

vi.mock("../../apps/api/src/services/fullLengthExam", () => ({
  createExamSession: vi.fn(async () => {
    const err: any = new Error("Full-length start limit reached (2 qualifying starts per rolling 7 days).");
    err.code = "FULL_LENGTH_QUOTA_EXCEEDED";
    err.rateLimit = {
      current: 2,
      limit: 2,
      resetAt: "2099-01-01T00:00:00.000Z",
      message: "Full-length start limit reached (2 qualifying starts per rolling 7 days).",
    };
    throw err;
  }),
  listExamSessions: vi.fn(async () => []),
  getCurrentSession: vi.fn(),
  startExam: vi.fn(),
  submitAnswer: vi.fn(),
  persistModuleCalculatorState: vi.fn(),
  submitModule: vi.fn(),
  continueFromBreak: vi.fn(),
  completeExam: vi.fn(),
  getExamReport: vi.fn(),
  getExamReviewAfterCompletion: vi.fn(),
}));

vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser: vi.fn(async () => ({ hasPaidAccess: true, reason: "mock" })),
}));

vi.mock("../../server/services/kpi-truth-layer", () => ({
  buildStudentFullLengthReportView: (x: any) => x,
}));

describe("Full-Length Quota Denial Contract", () => {
  it("returns structured 402 when DB quota gate rejects full-length start", async () => {
    const { default: fullLengthRouter } = await import("../../server/routes/full-length-exam-routes");

    const app = express();
    app.use(express.json());
    app.use("/api/full-length", fullLengthRouter);

    const res = await request(app)
      .post("/api/full-length/sessions")
      .send({});

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("FULL_LENGTH_QUOTA_EXCEEDED");
    expect(res.body.limitType).toBe("full_length");
    expect(res.body.current).toBe(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.requestId).toBe("req-full-length-quota");
  });
});

