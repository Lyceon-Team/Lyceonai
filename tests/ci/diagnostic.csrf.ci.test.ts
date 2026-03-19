import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const testUser = {
  id: "student-diagnostic-user",
  email: "student@test.local",
  role: "student",
  isAdmin: false,
  isGuardian: false,
  is_under_13: false,
  guardian_consent: true,
};

function requireUser(req: any, res: any) {
  if (!req.user?.id) {
    res.status(401).json({
      error: "Authentication required",
      requestId: req.requestId ?? "req-diagnostic-csrf",
    });
    return null;
  }
  return req.user;
}

vi.mock("../../server/middleware/supabase-auth", () => ({
  supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
    req.user = testUser;
    req.requestId ??= "req-diagnostic-csrf";
    next();
  },
  requireSupabaseAuth: (req: any, _res: any, next: any) => {
    req.user = testUser;
    req.requestId ??= "req-diagnostic-csrf";
    next();
  },
  requireStudentOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireSupabaseAdmin: (_req: any, _res: any, next: any) => next(),
  requireRequestUser: requireUser,
  requireRequestAuthContext: (req: any, res: any) => {
    const user = requireUser(req, res);
    if (!user) return null;
    return { user, supabase: req.supabase };
  },
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: testUser.id } }, error: null }),
      },
    },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
          limit: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
  resolveTokenFromRequest: () => ({
    token: null,
    tokenSource: null,
    cookieKeys: [],
    authHeaderPresent: false,
    tokenLength: 0,
    bearerParsed: false,
  }),
  resolveUserIdFromToken: async () => null,
  sendUnauthenticated: (res: any, requestId?: string) =>
    res.status(401).json({ error: "Authentication required", requestId: requestId ?? "req-diagnostic-csrf" }),
  sendForbidden: (res: any, payload: any) =>
    res.status(403).json({
      error: payload?.error ?? "Forbidden",
      message: payload?.message ?? "Forbidden",
      requestId: payload?.requestId ?? "req-diagnostic-csrf",
    }),
}));

vi.mock("../../apps/api/src/lib/supabase-admin", () => {
  const chain: any = {
    then: (resolve: any) => resolve({ data: null, error: null }),
  };
  const identity = () => chain;
  Object.assign(chain, {
    eq: identity,
    single: async () => ({ data: { student_id: testUser.id }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    order: identity,
    limit: identity,
    insert: identity,
    update: identity,
    select: identity,
  });
  return {
    getSupabaseAdmin: () => ({
      from: () => chain,
    }),
  };
});

vi.mock("../../apps/api/src/services/diagnostic-service", () => ({
  startDiagnosticSession: async () => ({
    sessionId: "diag-session-1",
    questionIds: ["q-1"],
    currentIndex: 0,
  }),
  getCurrentDiagnosticQuestion: async () => ({
    questionId: "q-1",
    questionIndex: 0,
    totalQuestions: 1,
    isComplete: false,
  }),
  recordDiagnosticAnswer: async () => ({
    success: true,
    nextQuestionId: null,
    isComplete: true,
  }),
}));

vi.mock("../../apps/api/src/services/mastery-write", () => ({
  applyMasteryUpdate: async () => undefined,
}));

const { default: app } = await import("../../server/index");

function isCsrfBlocked(res: request.Response): boolean {
  return res.status === 403 && res.body?.error === "csrf_blocked";
}

describe("Diagnostic CSRF CI", () => {
  it("diagnostic_mutation_blocks_without_origin", async () => {
    const res = await request(app).post("/api/me/mastery/diagnostic/start").send({});
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error", "csrf_blocked");
  });

  it("diagnostic_mutation_allows_with_valid_origin", async () => {
    const res = await request(app)
      .post("/api/me/mastery/diagnostic/start")
      .set("Origin", "http://localhost:5000")
      .send({});

    expect(isCsrfBlocked(res)).toBe(false);
  });
});

