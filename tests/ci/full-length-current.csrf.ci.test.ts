import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";

const examMocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(async () => ({
    session: { id: "sess-1", status: "in_progress" },
    currentModule: null,
    currentQuestion: null,
    timeRemaining: null,
    breakTimeRemaining: null,
  })),
}));

vi.mock("../../server/middleware/supabase-auth", () => ({
  requireSupabaseAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "student-1", role: "student" };
    next();
  },
  requireRequestUser: (req: any) => req.user,
}));

vi.mock("../../apps/api/src/services/fullLengthExam", () => ({
  createExamSession: vi.fn(),
  getCurrentSession: examMocks.getCurrentSession,
  startExam: vi.fn(),
  submitAnswer: vi.fn(),
  persistModuleCalculatorState: vi.fn(),
  submitModule: vi.fn(),
  continueFromBreak: vi.fn(),
  completeExam: vi.fn(),
  getExamReport: vi.fn(),
  getExamReviewAfterCompletion: vi.fn(),
}));

const { default: fullLengthExamRouter } = await import("../../server/routes/full-length-exam-routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.requestId = "req-full-length-current-csrf";
    next();
  });
  app.use("/api/full-length", fullLengthExamRouter);
  return app;
}

describe("Full-Length Current Session CSRF", () => {
  it("blocks mutating GET current session without origin", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/full-length/sessions/current").query({ sessionId: "sess-1" });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error.code", "csrf_blocked");
  });

  it("allows mutating GET current session with valid origin", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/full-length/sessions/current")
      .query({ sessionId: "sess-1" })
      .set("Origin", "http://localhost:5000");

    expect(res.status).toBe(200);
    expect(examMocks.getCurrentSession).toHaveBeenCalledWith("sess-1", "student-1", undefined);
  });
});

