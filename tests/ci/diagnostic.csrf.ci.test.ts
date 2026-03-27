import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../server/middleware/supabase-auth", () => ({
  supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: "student-diagnostic-user",
      email: "student@test.local",
      role: "student",
      isAdmin: false,
      isGuardian: false,
    };
    req.requestId ??= "req-diagnostic-disabled";
    next();
  },
  requireSupabaseAuth: (_req: any, _res: any, next: any) => next(),
  requireStudentOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireSupabaseAdmin: (_req: any, _res: any, next: any) => next(),
  requireRequestUser: (req: any) => req.user,
  requireRequestAuthContext: (req: any) => ({ user: req.user, supabase: req.supabase }),
  getSupabaseAdmin: () => ({ from: () => ({}) }),
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
    res.status(401).json({ error: "Authentication required", requestId: requestId ?? "req-diagnostic-disabled" }),
  sendForbidden: (res: any, payload: any) =>
    res.status(403).json({
      error: payload?.error ?? "Forbidden",
      message: payload?.message ?? "Forbidden",
      requestId: payload?.requestId ?? "req-diagnostic-disabled",
    }),
}));

const { default: app } = await import("../../server/index");

describe("Diagnostic Runtime Hard Kill CI", () => {
  it("diagnostic mutation returns terminal runtime disable without origin", async () => {
    const res = await request(app).post("/api/me/mastery/diagnostic/start").send({});
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: "DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT",
      message: "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.",
    });
  });

  it("diagnostic mutation returns terminal runtime disable with valid origin", async () => {
    const res = await request(app)
      .post("/api/me/mastery/diagnostic/start")
      .set("Origin", "http://localhost:5000")
      .send({});
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: "DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT",
      message: "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.",
    });
  });
});

