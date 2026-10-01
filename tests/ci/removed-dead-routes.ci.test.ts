/**
 * Removed dead routes — route-inventory test (UI-05, UI-06 server half).
 *
 * @spec [Coding Standards §5.2 pre-submit responses never reveal answers, §17 hard stops;
 *        student-ui register UI-05, UI-06] | @implemented [2026-09-29]
 *
 * plain English: every route listed below was deleted because nothing called it. This test
 * asserts each one is ABSENT from the running app, not hidden behind a runtime branch.
 *
 * How absence is told apart from a handler's own 404:
 *  - Auth and CSRF are passed through (setupSecurityMocks), so a request reaches the router
 *    it was mounted on. A 401/403 would prove nothing about whether the route exists.
 *  - NODE_ENV is "test", not "production". Several of these handlers (`/api/_whoami`,
 *    `/api/auth/debug`, `/api/health/practice`) answered 404 only in production; outside it
 *    they served a body. Running here proves the route is gone, not that a branch hid it.
 *  - A GET must land on the app's `/api/*` fallback, whose body is exactly
 *    `{ error: "API endpoint not found" }`. That separates it from handler-emitted 404s such
 *    as `getQuestionById`'s `{ error: "Question not found" }` or the old
 *    `/api/legal/accept` stub's `{ success: false, error: "Not found" }`.
 *  - A POST has no JSON fallback; it lands on Express's default final handler (404, HTML,
 *    so no JSON body). Asserting an empty parsed body separates it from any handler JSON.
 *
 * Held routes (owner, UI-06) are asserted to still answer, so this file cannot pass by
 * breaking the whole surface.
 */
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { setupSecurityMocks } from "../utils/securityTestUtils";

setupSecurityMocks();

vi.doMock("../../server/middleware/guardian-role", () => ({
  requireGuardianRole:
    () => (_req: Request, _res: Response, next: NextFunction) =>
      next(),
}));

// A hermetic stand-in for the service-role client: every query chain resolves to an empty
// result, so no request in this file opens a socket. `/api/questions/stats` (the surviving
// route) then answers 200 with zero counts instead of timing out on a placeholder host.
type EmptyResult = { data: never[]; error: null; count: number };
function emptyQueryChain(): unknown {
  const result: EmptyResult = { data: [], error: null, count: 0 };
  const chain: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: EmptyResult) => unknown) => resolve(result);
        }
        return () => chain;
      },
    },
  );
  return chain;
}
vi.doMock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: { from: () => emptyQueryChain() },
}));

process.env.NODE_ENV = "test";

const { default: app } = await import("../../server/index");

const API_FALLBACK_BODY = { error: "API endpoint not found" };

const REMOVED_GET_PATHS: readonly string[] = [
  // UI-05: the unused /api/questions* surface (only /api/questions/stats survives).
  "/api/questions",
  "/api/questions/recent",
  "/api/questions/random",
  "/api/questions/count",
  "/api/questions/feed",
  "/api/questions/00000000-0000-0000-0000-000000000123",
  // UI-06 server half.
  "/api/auth/debug",
  "/api/legal/acceptances",
  "/api/billing/publishable-key",
  "/api/account/status",
  "/api/health/practice",
  "/api/_whoami",
];

const REMOVED_POST_PATHS: readonly string[] = [
  "/api/questions/feedback",
  "/api/auth/admin-provision",
  "/api/legal/accept",
  "/api/account/select",
];

describe("Removed dead routes (UI-05, UI-06) are not registered", () => {
  it.each(REMOVED_GET_PATHS)(
    "GET %s falls through to the API 404",
    async (p) => {
      const res = await request(app).get(p);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(API_FALLBACK_BODY);
    },
  );

  it.each(REMOVED_POST_PATHS)(
    "POST %s reaches no handler (Express default 404)",
    async (p) => {
      const res = await request(app)
        .post(p)
        .set("Content-Type", "application/json")
        .send({});
      expect(res.status).toBe(404);
      expect(res.headers["content-type"] ?? "").not.toContain(
        "application/json",
      );
      expect(res.body).toEqual({});
    },
  );

  it("keeps the held health routes and the surviving /api/questions/stats mount", async () => {
    const healthz = await request(app).get("/healthz");
    expect(healthz.status).toBe(200);
    expect(healthz.body).toEqual({ status: "ok" });

    const apiHealth = await request(app).get("/api/health");
    expect(apiHealth.status).toBe(200);
    expect(apiHealth.body).toEqual({ status: "ok" });

    // /api/questions/stats is still mounted and still served by its handler.
    const stats = await request(app).get("/api/questions/stats");
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ total: 0, math: 0, reading_writing: 0 });
  });
});
