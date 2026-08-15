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

// ---------------------------------------------------------------------------
// Stub supabaseServer so calendar handlers respond instead of hanging on
// unreachable HTTP to placeholder.supabase.co.  Every chain method returns
// the builder; terminal calls resolve to empty/null data.
// Matches the pattern in calendar.ownership.contract.test.ts.
// ---------------------------------------------------------------------------
function stubChain(): Record<string, any> {
  const self: Record<string, any> = {};
  const chainMethods = [
    "from",
    "select",
    "insert",
    "upsert",
    "update",
    "delete",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "order",
    "limit",
    "range",
    "match",
    "not",
    "or",
    "filter",
    "contains",
    "containedBy",
    "overlaps",
    "textSearch",
  ];
  for (const m of chainMethods) {
    self[m] = () => self;
  }
  self.maybeSingle = async () => ({ data: null, error: null });
  self.single = async () => ({ data: null, error: null });
  self.then = (resolve: (v: { data: never[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  self.rpc = async () => ({ data: null, error: null });
  return self;
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: stubChain(),
}));

// Stub kpi-access so ensurePremiumAccess resolves instead of reaching
// supabaseServer through getEntitlementForProfile.
vi.mock("../../server/services/kpi-access", () => ({
  resolvePaidKpiAccessForUser: async () => ({
    hasPaidAccess: true,
    accountId: "student-auth-user",
    plan: "paid" as const,
    status: "active" as const,
    currentPeriodEnd: "2099-12-31",
    reason: "csrf-test-stub",
  }),
}));

// Stub notification-authority (calendar emitCalendarEvent calls it best-effort).
vi.mock("../../server/services/notification-authority", () => ({
  publishCalendarEventNotificationBestEffort: async () => {},
}));

vi.mock("../../server/middleware/supabase-auth", () => ({
  enforceDeletionLock: (_req: any, _res: any, next: any) => next(),
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
  requireStudentOnly: (_req: any, _res: any, next: any) => next(),
  requireStudentOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireSupabaseAdmin: (_req: any, _res: any, next: any) => next(),
  requireProfileComplete: (_req: any, _res: any, next: any) => next(),
  requireConsentCompliance: (_req: any, _res: any, next: any) => next(),
  requireRequestUser: requireUser,
  requireRequestAuthContext: (req: any, res: any) => {
    const user = requireUser(req, res);
    if (!user) return null;
    return { user, supabase: req.supabase };
  },
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { id: testUser.id } },
          error: null,
        }),
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
    token: "test-token-123456789012345",
    tokenSource: null,
    cookieKeys: [],
    authHeaderPresent: false,
    tokenLength: 0,
    bearerParsed: false,
  }),
  resolveUserIdFromToken: async () => null,
  sendUnauthenticated: (res: any, requestId?: string) =>
    res.status(401).json({
      error: "Authentication required",
      requestId: requestId ?? "req-calendar-csrf",
    }),
  sendForbidden: (res: any, payload: any) =>
    res.status(403).json({
      error: payload?.error ?? "Forbidden",
      message: payload?.message ?? "Forbidden",
      requestId: payload?.requestId ?? "req-calendar-csrf",
    }),
}));

const { default: app } = await import("../../server/index");

function isCsrfBlocked(res: request.Response): boolean {
  return res.status === 403 && res.body?.error?.code === "csrf_blocked";
}

async function getCsrfToken(agent: request.SuperAgentTest): Promise<string> {
  const res = await agent.get("/api/csrf-token");
  expect(res.status).toBe(200);
  return res.body.csrfToken as string;
}

// ---------------------------------------------------------------------------
// CSRF-passthrough tests for calendar routes.
//
// These tests verify that the doubleCsrfProtection middleware correctly
// blocks or passes requests on calendar endpoints.  They do NOT test
// calendar handler success — that is covered by
// calendar.ownership.contract.test.ts with richer stubs.
//
// The supabase stub returns null/empty data, so POST handlers that reach
// persistence will 500 (e.g. persistGeneratedDays needs a real upserted
// row id).  A non-403 response (even 500) proves CSRF passed the request
// through to the handler — which is the property under test.
// ---------------------------------------------------------------------------
describe("Calendar CSRF CI — middleware passthrough", () => {
  it("POST without CSRF token → 403 csrf_blocked", async () => {
    const res = await request(app)
      .post("/api/calendar/generate")
      .send({ start_date: "2026-03-01", days: 1 });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error.code", "csrf_blocked");
  });

  it("POST with valid CSRF token → not CSRF-blocked (handler runs)", async () => {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);
    const res = await agent
      .post("/api/calendar/generate")
      .set("x-csrf-token", token)
      .send({ start_date: "2026-03-01", days: 1 });

    // The request must NOT be blocked by CSRF middleware.
    expect(isCsrfBlocked(res)).toBe(false);
    // Handler runs (returns 500 from stub, not 403 from CSRF).
    expect(res.status).not.toBe(403);
  });

  it("GET /month → 200, not CSRF-blocked", async () => {
    const res = await request(app).get(
      "/api/calendar/month?start=2026-03-01&end=2026-03-07",
    );

    expect(isCsrfBlocked(res)).toBe(false);
    // GET routes are exempt from CSRF — handler runs to completion.
    expect(res.status).toBe(200);
  });
});
