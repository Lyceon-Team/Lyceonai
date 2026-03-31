import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<typeof import("../../server/middleware/supabase-auth")>(
    "../../server/middleware/supabase-auth"
  );

  return {
    ...actual,
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.user = {
        id: "student-1",
        role: "student",
        isGuardian: false,
        isAdmin: false,
      };
      req.requestId ??= "req-full-length-history";
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf", () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

const serviceMocks = {
  listExamSessions: vi.fn(),
};

const kpiAccessMocks = {
  resolvePaidKpiAccessForUser: vi.fn(),
};

vi.mock("../../apps/api/src/services/fullLengthExam", () => serviceMocks);
vi.mock("../../server/services/kpi-access", () => kpiAccessMocks);

describe("Full-Length History Route Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns canonical session history with entitlement-aware report/review flags", async () => {
    serviceMocks.listExamSessions.mockResolvedValue([
      {
        sessionId: "session-completed-1",
        status: "completed",
        currentSection: "math",
        currentModule: 2,
        testFormId: "form-1",
        startedAt: "2026-03-20T10:00:00.000Z",
        completedAt: "2026-03-20T12:10:00.000Z",
        createdAt: "2026-03-20T09:55:00.000Z",
        updatedAt: "2026-03-20T12:10:00.000Z",
      },
      {
        sessionId: "session-live-1",
        status: "in_progress",
        currentSection: "rw",
        currentModule: 1,
        testFormId: "form-1",
        startedAt: "2026-03-21T08:00:00.000Z",
        completedAt: null,
        createdAt: "2026-03-21T07:55:00.000Z",
        updatedAt: "2026-03-21T08:15:00.000Z",
      },
    ]);
    kpiAccessMocks.resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: false,
      reason: "inactive",
    });

    const router = (await import("../../server/routes/full-length-exam-routes")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/full-length", router);

    const res = await request(app).get("/api/full-length/sessions?limit=15&include_incomplete=true");

    expect(res.status).toBe(200);
    expect(serviceMocks.listExamSessions).toHaveBeenCalledWith({
      userId: "student-1",
      limit: 15,
      includeIncomplete: true,
    });
    expect(kpiAccessMocks.resolvePaidKpiAccessForUser).toHaveBeenCalledWith("student-1", "student");
    expect(res.body.reportAccess).toEqual({
      hasPaidAccess: false,
      reason: "inactive",
    });
    expect(res.body.sessions).toEqual([
      expect.objectContaining({
        sessionId: "session-completed-1",
        reportAvailable: false,
        reviewAvailable: true,
      }),
      expect.objectContaining({
        sessionId: "session-live-1",
        reportAvailable: false,
        reviewAvailable: false,
      }),
    ]);
  });

  it("clamps invalid limit input and defaults includeIncomplete to false", async () => {
    serviceMocks.listExamSessions.mockResolvedValue([]);
    kpiAccessMocks.resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: true,
      reason: "active",
    });

    const router = (await import("../../server/routes/full-length-exam-routes")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/full-length", router);

    const res = await request(app).get("/api/full-length/sessions?limit=500");

    expect(res.status).toBe(200);
    expect(serviceMocks.listExamSessions).toHaveBeenCalledWith({
      userId: "student-1",
      limit: 50,
      includeIncomplete: false,
    });
  });

  it("fails closed with stable 500 error on service failure", async () => {
    serviceMocks.listExamSessions.mockRejectedValue(new Error("db exploded"));
    kpiAccessMocks.resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: true,
      reason: "active",
    });

    const router = (await import("../../server/routes/full-length-exam-routes")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/full-length", router);

    const res = await request(app).get("/api/full-length/sessions");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: "Internal error",
      requestId: "req-full-length-history",
    });
  });
});
