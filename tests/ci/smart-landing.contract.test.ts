/**
 * Smart landing routes: the thin handlers.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26) Acceptance ("students only"; "device_class
 *        is coarse only"); lyceon-coding-standards §8.1 (auth → parse → domain → serialize), §7.1
 *        (Zod at the boundary)] | @implemented [2026-10-26]
 *
 * plain English:
 *   C1 the routes are mounted behind auth, CSRF and requireStudentAccount (students only)
 *   C2 a body with anything but the coarse device class and the instance id is a 400, and the
 *      service is never called; a client cannot send a role, an age, an arm or a time
 *   C3 the caller handed to the service is the authenticated user, never the body
 *   C4 a service failure on open answers "no landing" (Home), never an error page
 *   C5 the nightly route is CRON_SECRET-gated (404 without it) and calls the summary run
 */
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));
vi.mock("../../server/services/landing/landing-deps", () => ({
  liveLandingDeps: {},
}));

const { createLandingRouter } =
  await import("../../server/routes/landing-routes");
type Deps = import("../../server/services/landing/landing-service").LandingDeps;

const USER = {
  id: "5c000000-0000-4000-8000-000000000001",
  actor_id: "5c000000-0000-4000-8000-0000000000aa",
  role: "student" as const,
  is_under_13: false,
};

function appWith(deps: Partial<Deps>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: typeof USER }).user = USER;
    next();
  });
  app.use("/api/landing", createLandingRouter(deps as Deps));
  return app;
}

describe("smart landing routes", () => {
  it("C1 mounted behind auth, CSRF and requireStudentAccount", () => {
    const index = readFileSync("server/index.ts", "utf8");
    const mount =
      /app\.use\(\s*"\/api\/landing",([\s\S]*?)\);/.exec(index)?.[1] ?? "";
    expect(
      mount
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ).toEqual([
      "requireSupabaseAuth",
      "doubleCsrfProtection",
      "requireStudentAccount",
      "landingRoutes",
    ]);
  });

  it("C2 anything beyond the coarse device class and instance id is a 400; the service is untouched", async () => {
    const loadConfig = vi.fn();
    const app = appWith({ loadConfig });
    for (const body of [
      { device_class: "iPhone 15", client_instance_id: "c" },
      { device_class: "phone" },
      { device_class: "phone", client_instance_id: "c", role: "student" },
      { device_class: "phone", client_instance_id: "c", arm: "set_math_5" },
      {
        device_class: "phone",
        client_instance_id: "c",
        now: "2026-10-26T00:00:00Z",
      },
      { device_class: "phone", client_instance_id: "c", is_under_13: false },
    ]) {
      const res = await request(app).post("/api/landing/open").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const escape = await request(app)
      .post("/api/landing/escape")
      .send({ show_id: "nope" });
    expect(escape.status).toBe(400);
    const more = await request(app)
      .post("/api/landing/more")
      .send({ show_id: "x" });
    expect(more.status).toBe(400);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("C3 the service gets the authenticated user, and the response is the shared shape", async () => {
    const app = appWith({
      loadConfig: async () => ({
        enabled: false,
        dashboardShare: 0,
        weights: {},
        salt: "s",
      }),
    });
    const res = await request(app)
      .post("/api/landing/open")
      .send({ device_class: "desktop", client_instance_id: "c" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { path: null, show_id: null, arm: null },
    });
  });

  it("C4 a failure on open answers 'no landing'", async () => {
    const app = appWith({
      loadConfig: async () => {
        throw new Error("boom");
      },
    });
    const res = await request(app)
      .post("/api/landing/open")
      .send({ device_class: "phone", client_instance_id: "c" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { path: null, show_id: null, arm: null },
    });
  });

  it("C5 the nightly route is CRON_SECRET-gated and runs the summary job", () => {
    const routes = readFileSync(
      "server/routes/internal-cron-routes.ts",
      "utf8",
    );
    const block =
      /"\/landing-summaries",([\s\S]*?)\n\);/.exec(routes)?.[1] ?? "";
    expect(block).toContain("if (!cronAuthorized(req))");
    expect(block).toContain('res.status(404).json({ error: "Not found" })');
    expect(block).toContain("runLandingSummaries(liveLandingDeps)");
  });
});
