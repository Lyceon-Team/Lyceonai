import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * @spec [owner ruling F-27, 2026-09-30; register F-27] | @implemented [2026-09-30] |
 * plain English: through the REAL server app, a signed-in `/api` response carries
 * `Cache-Control: private, no-store`, as do 404s. The one listed public route keeps its own
 * header, and no other server code sets a public cache header. Only the two auth IO seams (the
 * SSR client's getUser and the profile bootstrap) and the Resend suppression lookup are stubbed,
 * so the request runs the real middleware chain.
 */

vi.mock("../../server/lib/supabase-ssr", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "auth-user-cache", email: "cache@example.test" } },
        error: null,
      }),
    },
  }),
}));

vi.mock("../../server/lib/profile-bootstrap", () => ({
  AccountEmailConflictError: class AccountEmailConflictError extends Error {},
  ensureProfileForAuthUser: async () => ({
    id: "profile-cache-1",
    email: "cache@example.test",
    display_name: "Cache Student",
    role: "student",
    is_under_13: false,
    guardian_consent: false,
    profile_completed_at: "2026-09-01T00:00:00.000Z",
    student_link_code: null,
    actor_id: "actor-cache-1",
  }),
}));

vi.mock("../../server/lib/notifications/transport", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../server/lib/notifications/transport")
    >();
  return {
    ...actual,
    defaultSuppressionTransport: () => ({
      get: async () => ({ ok: true, value: null }),
      add: async () => ({ ok: true, value: { id: "sup" } }),
      remove: async () => ({ ok: true, value: { deleted: true } }),
    }),
  };
});

describe("/api responses are private, no-store by default (F-27)", () => {
  let app: Express;
  let cacheableRoutes: ReadonlyArray<{ path: string }>;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    app = (await import("../../server/index")).default;
    cacheableRoutes = (
      await import("../../server/middleware/api-cache-control")
    ).API_CACHEABLE_ROUTES;
  });

  it("a signed-in /api response carries Cache-Control: private, no-store", async () => {
    const res = await request(app).get("/api/account/email-suppression");
    // Presence first: this is the signed-in user's own answer, not a denial.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, suppressed: false });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("an unknown /api route (404) carries it too", async () => {
    const res = await request(app).get("/api/no-such-route-for-cache-test");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("the listed public route keeps its public header", async () => {
    expect(cacheableRoutes.map((r) => r.path)).toEqual([
      "/api/public/pricing",
      "/api/public/qotd/today",
      "/api/public/qotd/archive",
      "/api/public/qotd/:date",
    ]);
    const res = await request(app).get("/api/public/pricing");
    expect(String(res.headers["cache-control"])).toMatch(
      /^public, max-age=\d+$/,
    );
  });

  it("no server code outside the listed route sets a public cache header", () => {
    const ROOT = join(__dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
          const src = readFileSync(full, "utf8");
          if (/Cache-Control"\s*,\s*"public/.test(src)) {
            offenders.push(relative(ROOT, full));
          }
        }
      }
    };
    walk(join(ROOT, "server"));
    expect(offenders.sort()).toEqual([
      "server/routes/public-pricing-routes.ts",
      "server/routes/public-qotd-routes.ts",
    ]);
  });
});
