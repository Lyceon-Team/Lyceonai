import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const testUser = {
  id: "student-auth-user",
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
      requestId: req.requestId ?? "req-calendar-csrf",
    });
    return null;
  }
  return req.user;
}

vi.mock("../../server/middleware/supabase-auth", () => ({
  supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
    req.user = testUser;
    req.requestId ??= "req-calendar-csrf";
    next();
  },
  requireSupabaseAuth: (req: any, _res: any, next: any) => {
    req.user = testUser;
    req.requestId ??= "req-calendar-csrf";
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
    res.status(401).json({ error: "Authentication required", requestId: requestId ?? "req-calendar-csrf" }),
  sendForbidden: (res: any, payload: any) =>
    res.status(403).json({
      error: payload?.error ?? "Forbidden",
      message: payload?.message ?? "Forbidden",
      requestId: payload?.requestId ?? "req-calendar-csrf",
    }),
}));

const { default: app } = await import("../../server/index");

function isCsrfBlocked(res: request.Response): boolean {
  return res.status === 403 && res.body?.error === "csrf_blocked";
}

describe("Calendar CSRF CI", () => {
  it("calendar_mutation_blocks_without_origin", async () => {
    const res = await request(app)
      .post("/api/calendar/generate")
      .send({ start_date: "2026-03-01", days: 1 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error", "csrf_blocked");
  });

  it("calendar_mutation_allows_with_valid_origin", async () => {
    const res = await request(app)
      .post("/api/calendar/generate")
      .set("Origin", "http://localhost:5000")
      .send({ start_date: "2026-03-01", days: 1 });

    expect(isCsrfBlocked(res)).toBe(false);
  });

  it("calendar_get_routes_not_csrf_blocked", async () => {
    const res = await request(app).get("/api/calendar/month?start=2026-03-01&end=2026-03-07");
    expect(isCsrfBlocked(res)).toBe(false);
  });
});
