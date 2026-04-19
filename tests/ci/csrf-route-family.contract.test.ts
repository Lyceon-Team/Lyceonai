import { beforeAll, describe, expect, it, vi } from "vitest";
import request, { type Response, type SuperAgentTest } from "supertest";
import type { Express } from "express";

const testUser = {
  id: "csrf-contract-user",
  email: "student@test.local",
  role: "student",
  isAdmin: false,
  isGuardian: false,
  is_under_13: false,
  guardian_consent: true,
};

vi.mock("../../server/middleware/supabase-auth", () => ({
  supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
    req.user = testUser;
    req.requestId ??= "req-csrf-route-family";
    next();
  },
  requireSupabaseAuth: (req: any, _res: any, next: any) => {
    req.user = testUser;
    req.requestId ??= "req-csrf-route-family";
    next();
  },
  requireStudentOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireSupabaseAdmin: (_req: any, _res: any, next: any) => next(),
  requireRequestUser: (req: any, res: any) => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Authentication required", requestId: req.requestId ?? "req-csrf-route-family" });
      return null;
    }
    return req.user;
  },
  requireRequestAuthContext: (req: any, res: any) => {
    if (!req.user?.id) {
      res.status(401).json({ error: "Authentication required", requestId: req.requestId ?? "req-csrf-route-family" });
      return null;
    }
    return { user: req.user, supabase: req.supabase };
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
      update: () => ({
        eq: () => ({
          select: () => ({ data: [], error: null }),
        }),
      }),
    }),
  }),
  resolveTokenFromRequest: () => ({
    token: "csrf-contract-token",
    tokenSource: null,
    cookieKeys: [],
    authHeaderPresent: false,
    tokenLength: 0,
    bearerParsed: false,
  }),
  resolveUserIdFromToken: async () => testUser.id,
  sendUnauthenticated: (res: any, requestId?: string) =>
    res.status(401).json({ error: "Authentication required", requestId: requestId ?? "req-csrf-route-family" }),
  sendForbidden: (res: any, payload: any) =>
    res.status(403).json({
      error: payload?.error ?? "Forbidden",
      message: payload?.message ?? "Forbidden",
      requestId: payload?.requestId ?? "req-csrf-route-family",
    }),
}));

vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser: async () => ({
    hasPaidAccess: false,
    reason: "premium_required",
    plan: "free",
    status: "inactive",
    currentPeriodEnd: null,
  }),
}));

const { default: app } = await import("../../server/index");

type MutationCase = {
  name: string;
  method: "post" | "put" | "patch";
  path: string;
  body?: Record<string, unknown>;
};

const mutationCases: MutationCase[] = [
  { name: "auth signup", method: "post", path: "/api/auth/signup", body: { email: "student@test.local", password: "pass12345" } },
  { name: "auth signin", method: "post", path: "/api/auth/signin", body: { email: "student@test.local", password: "pass12345" } },
  { name: "auth signout", method: "post", path: "/api/auth/signout" },
  { name: "auth refresh", method: "post", path: "/api/auth/refresh" },
  { name: "tutor conversation create", method: "post", path: "/api/tutor/conversations", body: {} },
  { name: "tutor message append", method: "post", path: "/api/tutor/messages", body: {} },
  { name: "calendar generate", method: "post", path: "/api/calendar/generate", body: { start_date: "2026-03-01", days: 1 } },
  { name: "billing checkout", method: "post", path: "/api/billing/checkout", body: {} },
  { name: "billing portal", method: "post", path: "/api/billing/portal", body: {} },
  { name: "practice session start", method: "post", path: "/api/practice/sessions", body: { section: "invalid" } },
  { name: "full-length create session", method: "post", path: "/api/full-length/sessions", body: {} },
];

async function getCsrfToken(agent: SuperAgentTest): Promise<string> {
  const res = await agent.get("/api/csrf-token");
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("csrfToken");
  return res.body.csrfToken as string;
}

function isCsrfBlocked(res: Response): boolean {
  return res.status === 403 && res.body?.error?.code === "csrf_blocked";
}

async function executeMutation(
  agent: SuperAgentTest,
  testCase: MutationCase,
  csrfToken?: string,
): Promise<Response> {
  let req = agent[testCase.method](testCase.path);
  if (csrfToken) {
    req = req.set("x-csrf-token", csrfToken);
  }
  if (testCase.body) {
    req = req.send(testCase.body);
  }
  return req;
}

describe("CSRF route-family contract", () => {
  let testedApp: Express;

  beforeAll(() => {
    testedApp = app;
  });

  it("blocks route-family browser mutations without CSRF token", async () => {
    for (const testCase of mutationCases) {
      const res = await executeMutation(request.agent(testedApp), testCase);
      expect(
        isCsrfBlocked(res),
        `${testCase.name} should be csrf_blocked when token is missing (status=${res.status})`,
      ).toBe(true);
    }
  });

  it("allows route-family mutations to reach route logic with valid CSRF token", async () => {
    const agent = request.agent(testedApp);
    const csrfToken = await getCsrfToken(agent);

    for (const testCase of mutationCases) {
      const res = await executeMutation(agent, testCase, csrfToken);
      expect(
        isCsrfBlocked(res),
        `${testCase.name} should not be csrf_blocked when token is valid (status=${res.status})`,
      ).toBe(false);
    }
  });

  it("keeps billing webhook exempt from browser CSRF and guarded by signature", async () => {
    const res = await request(testedApp)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_test" }));

    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty("error.code", "csrf_blocked");
  });
});
