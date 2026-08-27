import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { setupSecurityMocks } from "../utils/securityTestUtils";

setupSecurityMocks();

vi.doMock("../../server/middleware/guardian-role", () => ({
  requireGuardianRole: () => (_req: any, _res: any, next: any) => next(),
}));

const { default: app } = await import("../../server/index");

describe.sequential("Production Debug Surface Hardening", () => {
  const previousNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterAll(() => {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("production_hides_public_debug_surfaces", async () => {
    // NOTE: /api/auth/google/debug was removed with the custom Google OAuth flow (AUTH-001 /
    // OAUTH-001 native conversion). Native Supabase OAuth has no app-side debug surface.
    const paths = ["/api/_whoami", "/api/auth/debug", "/api/health/practice"];

    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    }
  });

  it("public_health_remains_minimal_in_production", async () => {
    const healthz = await request(app).get("/healthz");
    expect(healthz.status).toBe(200);
    expect(healthz.body).toEqual({ status: "ok" });

    const apiHealth = await request(app).get("/api/health");
    expect(apiHealth.status).toBe(200);
    expect(apiHealth.body).toEqual({ status: "ok" });
  });

  // Phase C (2026-08-20): the billing debug routes were DELETED, not hidden.
  // They previously returned `secretKeyLast4` behind a NODE_ENV check — a
  // key-material fragment guarded by a runtime branch. The stronger property is
  // that no such route is registered at all, so this asserts absence rather than
  // a 404 body emitted by a route that still exists.
  it("production_hides_billing_debug_routes", async () => {
    const envRes = await request(app).get("/api/billing/debug/env");
    expect(envRes.status).toBe(404);

    const validateRes = await request(app).get("/api/billing/debug/validate");
    expect(validateRes.status).toBe(404);

    // Absence proof: re-adding a debug route to the billing surface fails here,
    // in production or otherwise.
    const billingSource = readFileSync(
      path.resolve(__dirname, "..", "..", "server", "routes", "billing-routes.ts"),
      "utf8",
    );
    expect(billingSource).not.toContain("/debug/");
    expect(billingSource).not.toContain("secretKeyLast4");
  });
});
