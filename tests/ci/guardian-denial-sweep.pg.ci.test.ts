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
 * WHAT IS SUBSTITUTED. Three things: the DATABASE TRANSPORT (`supabaseServer` → real SQL via
 * tests/helpers/pg-supabase, against genesis + every migration); the SESSION —
 * `supabaseAuthMiddleware` skips the Auth-server `getUser()` call and instead reads the
 * guardian's `profiles` row back from that Postgres, attaching it with the same field mapping
 * the real middleware uses (server/middleware/supabase-auth.ts, "Attach user to request"), so
 * the role under test is a row the schema accepted, never a hand-written object; and CSRF
 * (passed through, so a 403 here is the role gate's and never a missing token's — the body
 * assertion enforces that). Every gate, router and mount is the production one.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "pg";
import request from "supertest";
import type { Express, NextFunction, Request, Response } from "express";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { collectEndpoints } from "../helpers/router-endpoints";

const DB_NAME = "guardian_denial_sweep_ci";
const GUARDIAN_ID = "0a111111-1111-4111-8111-111111111111";

let pg: Client;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    supabaseAuthMiddleware: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ) => {
      try {
        const r = await pg.query(
          `SELECT id, email, display_name, role::text AS role, is_under_13,
                  student_link_code, actor_id
             FROM public.profiles WHERE id = $1`,
          [GUARDIAN_ID],
        );
        const p = r.rows[0];
        // No row → no user → 401, which fails every 403 assertion below. Fail loud.
        if (p) {
          (req as Request & { user?: unknown }).user = {
            id: p.id,
            email: p.email,
            display_name: p.display_name,
            role: p.role,
            isAdmin: p.role === "admin",
            isGuardian: p.role === "guardian",
            is_under_13: p.is_under_13,
            profile_completed_at: null,
            student_link_code: p.student_link_code,
            actor_id: p.actor_id,
          };
        }
        next();
      } catch (err) {
        next(err);
      }
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

function gateOf(handle: unknown): Gate | null {
  if (handle === auth.requireStudentOrAdmin) return "student_or_admin";
  if (handle === auth.requireStudentOnly) return "student_only";
  return null;
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

const endpoints = collectEndpoints(app, gateOf);
const gated = endpoints.filter((e) => e.gates.length > 0);
const tutor = endpoints.filter((e) => e.path.startsWith("/api/tutor"));

function concrete(path: string): string {
  return (
    path
      .replace(/:[A-Za-z_]+/g, "00000000-0000-4000-8000-0000000000aa")
      .replace(/\/$/, "") || "/"
  );
}

describe.skipIf(!PG_AVAILABLE)("G1-11 guardian denial sweep (routes read from the router)", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);
    await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
      GUARDIAN_ID,
      "sweep-guardian@example.test",
    ]);
    await pg.query(
      `INSERT INTO public.profiles (id, email, role, date_of_birth)
       VALUES ($1, $2, 'guardian', DATE '1980-01-01')`,
      [GUARDIAN_ID, "sweep-guardian@example.test"],
    );
    // Presence before absence: the principal every case presents is a real guardian row.
    const back = await pg.query(
      `SELECT role::text AS role FROM public.profiles WHERE id = $1`,
      [GUARDIAN_ID],
    );
    expect(back.rows[0]?.role).toBe("guardian");
  });

  afterAll(async () => {
    if (pg) await pg.end();
  });

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
