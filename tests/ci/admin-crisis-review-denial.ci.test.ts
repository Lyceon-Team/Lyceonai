/**
 * Admin crisis review — a non-admin is refused on every route, server-side.
 *
 * @spec [Doc-03_V3 §21.3, SCL-025; Coding Standards §6.1, §11.3, §14 ("Auth / roles /
 *        entitlements → add denial tests"); owner decision 2026-10-07, CI audit item 7]
 * @implemented [2026-10-07]
 *
 * plain English: /api/admin/crisis-review/* exposes crisis-flagged conversations of minors. The
 * only test of who may reach it checked client-side route strings (RequireRole), which is not the
 * enforcement point. This drives the REAL Express app (server/index.ts) with supertest: only the
 * identity step and the crisis-review service are replaced. The router's REAL
 * `requireSupabaseAuth` → `requireSupabaseAdmin` chain decides access.
 *
 * expected outcome, for every route (list, detail, claim, disposition, SLA breaches):
 *   - a student and a guardian get 403 with the admin-required body, and the service is never
 *     called: no case is read, no audit row written, no case claimed or resolved;
 *   - an anonymous caller gets 401, and the service is never called;
 *   - an admin reaches the handler (the matching service function is called once) — presence
 *     before absence, so the denials above cannot pass because nothing is reachable.
 *
 * trade-offs: the two POSTs sit behind doubleCsrfProtection, which also answers 403. Every POST
 * here carries a valid CSRF token and an allowed Origin, and every denial asserts the
 * admin-required body, so a CSRF refusal can never satisfy an admin-denial assertion.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import type { Express, NextFunction, Request, Response } from "express";
import type { SupabaseUser } from "../../server/middleware/supabase-auth";

const ROLE_HEADER = "x-test-role";
const CASE_ID = "00000000-0000-4000-8000-0000000000c1";
const ORIGIN = "http://localhost:5000";

const service = vi.hoisted(() => ({
  listCrisisReviewCases: vi.fn(),
  getCrisisReviewCaseById: vi.fn(),
  getCaseAuditLog: vi.fn(),
  claimCaseForReview: vi.fn(),
  updateCaseDisposition: vi.fn(),
  getBreachedCases: vi.fn(),
  writeAuditLogEntry: vi.fn(),
}));

function userFor(req: Request): SupabaseUser | undefined {
  const role = req.header(ROLE_HEADER);
  if (role === "student") {
    return {
      id: "crisis-student",
      email: "crisis-student@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      actor_id: "crisis-student-actor",
      is_under_13: false,
    };
  }
  if (role === "guardian") {
    return {
      id: "crisis-guardian",
      email: "crisis-guardian@example.test",
      display_name: null,
      role: "guardian",
      isAdmin: false,
      isGuardian: true,
      actor_id: "crisis-guardian-actor",
    };
  }
  if (role === "admin") {
    return {
      id: "crisis-admin",
      email: "crisis-admin@example.test",
      display_name: null,
      role: "admin",
      isAdmin: true,
      isGuardian: false,
      actor_id: "crisis-admin-actor",
    };
  }
  return undefined;
}

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");
  const attach = (req: Request, _res: Response, next: NextFunction): void => {
    const user = userFor(req);
    if (user) req.user = user;
    next();
  };
  return {
    ...actual,
    supabaseAuthMiddleware: attach,
    requireSupabaseAuth: (req: Request, res: Response, next: NextFunction) => {
      const user = userFor(req);
      if (!user) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      req.user = user;
      next();
    },
    // requireSupabaseAdmin is the REAL implementation.
  };
});

vi.mock("../../server/services/crisis-review-queue", () => service);

type Route = {
  label: string;
  method: "get" | "post";
  path: string;
  body?: Record<string, unknown>;
  reaches: keyof typeof service;
};

const ROUTES: readonly Route[] = [
  {
    label: "list cases",
    method: "get",
    path: "/api/admin/crisis-review/cases",
    reaches: "listCrisisReviewCases",
  },
  {
    label: "case detail",
    method: "get",
    path: `/api/admin/crisis-review/cases/${CASE_ID}`,
    reaches: "getCrisisReviewCaseById",
  },
  {
    label: "claim",
    method: "post",
    path: `/api/admin/crisis-review/cases/${CASE_ID}/claim`,
    reaches: "claimCaseForReview",
  },
  {
    label: "disposition",
    method: "post",
    path: `/api/admin/crisis-review/cases/${CASE_ID}/disposition`,
    body: { disposition: "false_positive", notes: null },
    reaches: "updateCaseDisposition",
  },
  {
    label: "SLA breaches",
    method: "get",
    path: "/api/admin/crisis-review/sla-breaches",
    reaches: "getBreachedCases",
  },
];

let app: Express;

/** Sends `route` as `role` (or anonymously), with a valid CSRF token on POSTs. */
async function send(
  route: Route,
  role: string | null,
): Promise<request.Response> {
  const agent = request.agent(app);
  if (route.method === "get") {
    const req = agent.get(route.path);
    return role ? req.set(ROLE_HEADER, role) : req;
  }
  const tokenRes = await agent.get("/api/csrf-token");
  expect(tokenRes.status).toBe(200);
  const token = String(tokenRes.body.csrfToken);
  expect(token.length).toBeGreaterThan(0);
  const req = agent
    .post(route.path)
    .set("x-csrf-token", token)
    .set("Origin", ORIGIN)
    .send(route.body ?? {});
  return role ? req.set(ROLE_HEADER, role) : req;
}

function serviceCalls(): number {
  return Object.values(service).reduce((n, fn) => n + fn.mock.calls.length, 0);
}

describe("admin crisis review: non-admins are refused server-side", () => {
  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const serverModule = await import("../../server/index");
    app = serverModule.default;
  }, 30_000);

  afterAll(() => {
    delete process.env.VITEST;
  });

  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockReset();
    service.listCrisisReviewCases.mockResolvedValue({ cases: [], total: 0 });
    service.getCrisisReviewCaseById.mockResolvedValue({
      id: CASE_ID,
      status: "open",
    });
    service.getCaseAuditLog.mockResolvedValue([]);
    service.claimCaseForReview.mockResolvedValue({
      id: CASE_ID,
      status: "in_review",
    });
    service.updateCaseDisposition.mockResolvedValue({
      id: CASE_ID,
      status: "resolved",
    });
    service.getBreachedCases.mockResolvedValue([]);
    service.writeAuditLogEntry.mockResolvedValue(undefined);
  });

  describe.each(ROUTES)("$label ($method $path)", (route) => {
    it("an admin reaches the handler (presence before absence)", async () => {
      const res = await send(route, "admin");
      expect(res.status).toBe(200);
      expect(service[route.reaches]).toHaveBeenCalledTimes(1);
    });

    it.each(["student", "guardian"])(
      "a %s gets 403 and the service is never called",
      async (role) => {
        const res = await send(route, role);
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ error: "Admin access required" });
        expect(serviceCalls()).toBe(0);
      },
    );

    it("an anonymous caller gets 401 and the service is never called", async () => {
      const res = await send(route, null);
      expect(res.status).toBe(401);
      expect(serviceCalls()).toBe(0);
    });
  });
});
