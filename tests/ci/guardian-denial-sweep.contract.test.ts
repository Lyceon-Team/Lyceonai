/**
 * A guardian session is refused on EVERY student-only route and every /api/tutor route,
 * with the route list read from the running app's router — never typed out by hand.
 *
 * @spec [Guardian_Closure_Plan G1-11; audit G-AUD-16; Doc 00 :133 / CS §6.2 (guardians never
 *        write learning state); Doc 03 INV-03-05 + Doc 03B §1.3 (tutor endpoints are
 *        student-only; a guardian gets 403)] | @implemented [2026-09-29]
 *
 * plain English: imports the REAL Express app, walks `app._router.stack` (mount-level
 * middleware and every sub-router route), and classifies each /api endpoint by the gate
 * functions actually present in its chain — `requireStudentOrAdmin` or `requireStudentOnly`,
 * matched by function identity, not by name or path. Then it sends each gated endpoint a
 * GUARDIAN session and requires the 403 THAT GATE produces.
 *
 * WHY THE ROUTE LIST CANNOT GO STALE. There is no list in this file. A route added to any
 * student-only mount is swept the moment it exists. And a route added to a NEW mount that
 * forgot the gate fails the classification case below: every /api endpoint must either be
 * gated or live under one of the guardian-reachable prefixes named here, so an ungated
 * learning route has nowhere to hide.
 *
 * WHAT IS SUBSTITUTED. Only two things: the session (`supabaseAuthMiddleware` presents a
 * guardian, as the real one does after reading the profile row) and CSRF (passed through, so
 * a 403 here is the role gate's and never a missing token's — the body assertion enforces
 * that). Every gate, router and mount is the production one.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { Express, NextFunction, Request, Response } from "express";

const GUARDIAN = {
  id: "0a111111-1111-4111-8111-111111111111",
  email: "sweep-guardian@example.test",
  role: "guardian",
  isGuardian: true,
  isAdmin: false,
  is_under_13: false,
  guardian_consent: true,
};

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    supabaseAuthMiddleware: (
      req: Request,
      _res: Response,
      next: NextFunction,
    ) => {
      (req as Request & { user?: unknown }).user = { ...GUARDIAN };
      next();
    },
  };
});

vi.mock(
  "../../server/middleware/csrf-double-submit",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
      ...actual,
      doubleCsrfProtection: (
        _req: Request,
        _res: Response,
        next: NextFunction,
      ) => next(),
    };
  },
);

process.env.VITEST = "true";
process.env.NODE_ENV = "test";

const app = (await import("../../server/index")).default as Express;
const auth = await import("../../server/middleware/supabase-auth");

type Gate = "student_or_admin" | "student_only";
type Endpoint = { method: string; path: string; gates: Gate[] };

type RouteLike = {
  path: string;
  methods: Record<string, boolean>;
  stack: Array<{ handle: unknown }>;
};
type LayerLike = {
  name: string;
  handle: unknown;
  route?: RouteLike;
  regexp?: RegExp & { fast_slash?: boolean };
};

function gateOf(handle: unknown): Gate | null {
  if (handle === auth.requireStudentOrAdmin) return "student_or_admin";
  if (handle === auth.requireStudentOnly) return "student_only";
  return null;
}

/** Express 4 keeps a mount's path only as a regexp; recover the literal prefix. */
function mountPath(layer: LayerLike): string {
  if (!layer.regexp || layer.regexp.fast_slash) return "";
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
}

function collectEndpoints(): Endpoint[] {
  const stack = (app as unknown as { _router: { stack: LayerLike[] } })._router
    .stack;
  const endpoints: Endpoint[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const gates = layer.route.stack
        .map((s) => gateOf(s.handle))
        .filter((g): g is Gate => g !== null);
      for (const method of Object.keys(layer.route.methods)) {
        endpoints.push({ method, path: layer.route.path, gates });
      }
    } else if (layer.name === "router") {
      const mount = mountPath(layer);
      // `app.use(path, a, b, router)` registers a, b and router as sibling layers that share
      // the mount's regexp; the gates among the siblings apply to every route in the router.
      const mountGates = stack
        .filter(
          (l) =>
            !l.route &&
            l.name !== "router" &&
            mountPath(l) === mount &&
            l.regexp?.source === layer.regexp?.source,
        )
        .map((l) => gateOf(l.handle))
        .filter((g): g is Gate => g !== null);
      const sub = (layer.handle as { stack: LayerLike[] }).stack;
      for (const r of sub) {
        if (!r.route) continue;
        const routeGates = r.route.stack
          .map((s) => gateOf(s.handle))
          .filter((g): g is Gate => g !== null);
        for (const method of Object.keys(r.route.methods)) {
          endpoints.push({
            method,
            path: `${mount}${r.route.path}`,
            gates: [...mountGates, ...routeGates],
          });
        }
      }
    }
  }
  return endpoints.filter((e) => e.path.startsWith("/api/"));
}

/**
 * The prefixes a guardian session MAY reach. Every other /api endpoint must be gated. Adding a
 * prefix here is a statement that guardians belong on it — a review question, not a fix.
 */
const GUARDIAN_REACHABLE: ReadonlyArray<string> = [
  "/api/_whoami", // 404 in production; diagnostics
  "/api/account/", // the caller's own account
  "/api/admin/", // admin-gated (requireSupabaseAdmin)
  "/api/auth/",
  "/api/billing/", // guardians pay for linked students
  "/api/csrf-token",
  "/api/guardian/", // guardian-role gated
  "/api/health",
  "/api/internal/", // server-to-server (CRON_SECRET / OIDC)
  "/api/legal/", // the caller's own acceptances
  "/api/notifications/", // the caller's own feed
  "/api/profile/", // the caller's own profile
  "/api/public/",
  "/api/questions/recent", // anonymous public preview, no answers
  "/api/students/", // subject resolver: guardian reads only when linked + entitled; writes require via=self
  "/api/webhooks/", // signature-verified
];

const endpoints = collectEndpoints();
const gated = endpoints.filter((e) => e.gates.length > 0);
const tutor = endpoints.filter((e) => e.path.startsWith("/api/tutor"));

function concrete(path: string): string {
  return (
    path
      .replace(/:[A-Za-z_]+/g, "00000000-0000-4000-8000-0000000000aa")
      .replace(/\/$/, "") || "/"
  );
}

describe("G1-11 guardian denial sweep (routes read from the router)", () => {
  it("the sweep is non-trivial: it found the routes a guardian must never reach", () => {
    // Presence before absence: these anchors exist, so an empty sweep cannot pass.
    const has = (m: string, p: string) =>
      gated.some((e) => e.method === m && e.path === p);
    expect(has("post", "/api/practice/answer")).toBe(true);
    expect(has("post", "/api/tutor/messages")).toBe(true);
    expect(has("put", "/api/calendar/profile")).toBe(true);
    expect(has("post", "/api/tests/sessions")).toBe(true);
    expect(has("post", "/api/review/answer")).toBe(true);
    expect(tutor.length).toBeGreaterThan(0);
    expect(gated.length).toBeGreaterThanOrEqual(50);
  });

  it("every /api/tutor route is gated", () => {
    const ungatedTutor = tutor
      .filter((e) => e.gates.length === 0)
      .map((e) => `${e.method.toUpperCase()} ${e.path}`);
    expect(ungatedTutor).toEqual([]);
  });

  it("every /api endpoint is either student-gated or on a guardian-reachable prefix", () => {
    const unclassified = endpoints
      .filter((e) => e.gates.length === 0)
      .filter(
        (e) =>
          !GUARDIAN_REACHABLE.some((p) => e.path === p || e.path.startsWith(p)),
      )
      .map((e) => `${e.method.toUpperCase()} ${e.path}`);
    expect(unclassified).toEqual([]);
  });

  it.each(gated.map((e) => [e.method.toUpperCase(), e.path, e] as const))(
    "guardian → 403 on %s %s",
    async (_m, _p, e) => {
      const agent = request(app);
      const url = concrete(e.path);
      const call =
        e.method === "get"
          ? agent.get(url)
          : e.method === "post"
            ? agent.post(url).send({})
            : e.method === "put"
              ? agent.put(url).send({})
              : e.method === "patch"
                ? agent.patch(url).send({})
                : e.method === "delete"
                  ? agent.delete(url)
                  : null;
      expect(call, `unsupported method ${e.method}`).not.toBeNull();
      const res = await call!;
      expect(res.status).toBe(403);
      // The ROLE gate's refusal, not a CSRF or any other 403.
      if (e.gates[0] === "student_only") {
        expect(res.body.code).toBe("ROLE_NOT_PERMITTED");
      } else {
        expect(res.body.error).toBe("Student access required");
      }
    },
  );
});
