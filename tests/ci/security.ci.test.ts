/**
 * CI Security Tests - CSRF Protection
 *
 * Validates the double-submit CSRF token pattern at the HTTP boundary.
 *
 * SECURITY GUARANTEES TESTED:
 * 1. POST requests without CSRF token -> 403
 * 2. POST requests with valid CSRF token -> allowed
 * 3. GET/HEAD/OPTIONS requests are not CSRF-blocked
 * 4. Deprecated/unmounted routes still return 404
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request, { type SuperAgentTest } from "supertest";
import type { Express } from "express";

async function getCsrfToken(agent: SuperAgentTest): Promise<string> {
  const res = await agent.get("/api/csrf-token");
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("csrfToken");
  return res.body.csrfToken as string;
}

describe("CI Security Tests - CSRF", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";

    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  describe("CSRF Protection - Missing Token", () => {
    it("should block POST requests without CSRF token (403)", async () => {
      const res = await request(app).post("/api/auth/signout");

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error", "csrf_blocked");
      expect(res.body).toHaveProperty("requestId");
    });

    it("should return 404 for deprecated exchange-session endpoint", async () => {
      const res = await request(app)
        .post("/api/auth/exchange-session")
        .send({
          access_token: "test-token",
          refresh_token: "test-refresh",
        });

      expect(res.status).toBe(404);
    });
  });

  describe("CSRF Protection - Valid Token", () => {
    it("should allow POST with a valid CSRF token", async () => {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent);

      const res = await agent
        .post("/api/auth/signout")
        .set("x-csrf-token", token);

      expect(res.status).not.toBe(403);
      expect([200, 401]).toContain(res.status);
    });
  });

  describe("CSRF Protection - GET/HEAD/OPTIONS", () => {
    it("should allow GET requests without CSRF token", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
    });

    it("should not CSRF-block GET to /api/profile without token", async () => {
      const res = await request(app).get("/api/profile");
      expect(res.status).toBe(401);
    });

    it("should allow HEAD requests without CSRF token", async () => {
      const res = await request(app).head("/api/health");
      expect([200, 404]).toContain(res.status);
    });

    it("should allow OPTIONS requests without CSRF token", async () => {
      const res = await request(app).options("/api/health");
      expect([200, 204, 404]).toContain(res.status);
    });
  });
});
