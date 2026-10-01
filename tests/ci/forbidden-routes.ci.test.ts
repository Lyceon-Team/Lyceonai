/**
 * CI Forbidden Routes Tests - Permanent Invariant Enforcement
 *
 * This test file enforces that deprecated endpoints are permanently removed
 * and always return 404 (not found). This prevents regression where removed
 * endpoints are accidentally re-introduced.
 *
 * SECURITY GUARANTEES TESTED:
 * 1. exchange-session endpoint must not exist (404)
 * 2. All variants of exchange-session must be 404
 * 3. No endpoint bypasses this check
 */

import fs from "node:fs";
import path from "node:path";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("CI Forbidden Routes - Permanent Invariants", () => {
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

  describe("Exchange-Session Endpoint - Must Not Exist", () => {
    it("should return 404 for POST /api/auth/exchange-session", async () => {
      const res = await request(app)
        .post("/api/auth/exchange-session")
        .set("Origin", "http://localhost:5000")
        .send({
          access_token: "test-token",
          refresh_token: "test-refresh",
        });

      // Endpoint is permanently deprecated and removed
      expect(res.status).toBe(404);
    });

    it("should return 404 for POST /api/auth/exchange_session (underscore variant)", async () => {
      const res = await request(app)
        .post("/api/auth/exchange_session")
        .set("Origin", "http://localhost:5000")
        .send({
          access_token: "test-token",
          refresh_token: "test-refresh",
        });

      // Endpoint must not exist in any naming variant
      expect(res.status).toBe(404);
    });

    it("should return 404 for POST /api/exchange-session (no auth prefix)", async () => {
      const res = await request(app)
        .post("/api/exchange-session")
        .set("Origin", "http://localhost:5000")
        .send({
          access_token: "test-token",
          refresh_token: "test-refresh",
        });

      // Endpoint must not exist at any path
      expect(res.status).toBe(404);
    });

    it("should return 404 for GET /api/auth/exchange-session", async () => {
      const res = await request(app).get("/api/auth/exchange-session");

      // Endpoint must not exist for any HTTP method
      expect(res.status).toBe(404);
    });
  });

  describe("Forbidden Endpoints - Security Invariants", () => {
    it("should never return 200/201 for exchange-session", async () => {
      const res = await request(app)
        .post("/api/auth/exchange-session")
        .set("Origin", "http://localhost:5000")
        .send({
          access_token: "valid-looking-token-12345678901234567890",
          refresh_token: "valid-looking-refresh-12345678901234567890",
        });

      // Must never succeed - endpoint should not exist
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
      expect(res.status).toBe(404);
    });

    it("should not leak information about removed endpoints", async () => {
      const res = await request(app)
        .post("/api/auth/exchange-session")
        .set("Origin", "http://localhost:5000")
        .send({});

      // Should return generic 404, not detailed error messages
      expect(res.status).toBe(404);
      // Should not contain implementation details (case-insensitive check)
      const body = JSON.stringify(res.body).toLowerCase();
      expect(body).not.toContain("deprecated");
      expect(body).not.toContain("removed");
      expect(body).not.toContain("exchange");
    });
  });

  describe("Path Traversal Prevention", () => {
    it("should return 404 for /api/auth/../exchange-session", async () => {
      const res = await request(app)
        .post("/api/auth/../exchange-session")
        .set("Origin", "http://localhost:5000")
        .send({});

      expect(res.status).toBe(404);
    });

    it("should return 404 for /api/./auth/exchange-session", async () => {
      const res = await request(app)
        .post("/api/./auth/exchange-session")
        .set("Origin", "http://localhost:5000")
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe("Notification and diagnostic guards", () => {
    it("mounts diagnostic at /api/practice/diagnostic with no legacy path or disable-contract", () => {
      const serverIndex = readRepoFile("server/index.ts");

      // New diagnostic router mounts at /api/practice/diagnostic (Vertical B, Slice 1)
      expect(serverIndex).toContain("diagnosticRouter");
      expect(serverIndex).toContain("/api/practice/diagnostic");

      // Legacy path /api/me/mastery/diagnostic does NOT exist (not "returns 404" — removed entirely)
      expect(serverIndex).not.toContain("/api/me/mastery/diagnostic");

      // No DIAGNOSTIC_RUNTIME_DISABLED_BY_CONTRACT disable-contract remains
      expect(serverIndex).not.toContain("DIAGNOSTIC_RUNTIME_DISABLED");
      expect(serverIndex).not.toContain(
        'runtimeContractDisableMiddleware("diagnostic")',
      );
    });

    /**
     * @spec [register UI-06] | @implemented [2026-09-29] | plain English: the
     * runtime-contract disable mechanism is gone on BOTH sides. The server helper
     * (`server/lib/runtime-contract-disable.ts`) was deleted earlier; UI-06 deleted
     * the client half (`client/src/lib/runtime-contract-disable.ts`, the
     * `RuntimeContractDisabledCard`, and the hooks' 503 branches), which listened for
     * codes no route emitted. This pins both halves: no source file emits or handles
     * a `*_RUNTIME_DISABLED_BY_CONTRACT` code or names the deleted helpers. Comments
     * are stripped first, so files may still record the deletion in prose.
     */
    it("no server or client source emits or handles a runtime-contract disable code", () => {
      const roots = ["server", "apps", "client/src", "packages", "shared"];
      const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
      const sources: { file: string; code: string }[] = [];
      const walk = (relative: string): void => {
        const absolute = path.join(repoRoot, relative);
        if (!fs.existsSync(absolute)) return;
        for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
          const child = path.join(relative, entry.name);
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(child);
            continue;
          }
          if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
          if (/\.test\.(ts|tsx|js)$/.test(entry.name)) continue;
          sources.push({
            file: child,
            code: readRepoFile(child)
              .replace(/\/\*[\s\S]*?\*\//g, "")
              .replace(/(^|[^:])\/\/.*$/gm, "$1"),
          });
        }
      };
      roots.forEach(walk);

      // Presence before absence: the sweep must actually cover both halves.
      const scanned = sources.map((s) => s.file);
      expect(scanned).toContain(path.join("server", "index.ts"));
      expect(scanned).toContain(
        path.join("client", "src", "hooks", "useCanonicalPractice.ts"),
      );

      const forbidden =
        /[A-Z]+_RUNTIME_DISABLED_BY_CONTRACT|runtime-contract-disable|RuntimeContractDisabled|parseRuntimeContractDisabled/;
      const offenders = sources
        .filter(({ code }) => forbidden.test(code))
        .map(({ file }) => file);
      expect(offenders, offenders.join("\n")).toEqual([]);
    });
  });
});
