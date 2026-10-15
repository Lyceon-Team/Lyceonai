/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §10] | @implemented 2026-10-15
 *
 * plain English: the link-check handler itself, past its guard (the OIDC guard is pinned in
 * video-link-check.contract.test.ts; here it is a pass-through). No key → 500, nothing read.
 * With a key: the real YouTube response shape comes back, the missing video is written
 * unavailable, the rest available, each with last_checked_at; a breaker run writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../packages/shared/internal-auth/verify-oidc-middleware", () => ({
  oidcAuthMiddlewareWithConfigGuard:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
}));

const db = vi.hoisted(() => ({
  ids: [] as string[],
  updates: [] as { values: Record<string, unknown>; ids: unknown }[],
}));
vi.mock("../../server/middleware/supabase-auth", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "video_resources") throw new Error(`unexpected ${table}`);
      return {
        select: () => ({
          order: async () => ({
            data: db.ids.map((video_id) => ({ video_id })),
            error: null,
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          in: async (_col: string, ids: unknown) => {
            db.updates.push({ values, ids });
            return { error: null };
          },
        }),
      };
    },
  }),
}));

import internalCronRoutes from "../../server/routes/internal-cron-routes";

const REAL = fs.readFileSync(
  path.resolve(__dirname, "fixtures/youtube-videos-list.status.json"),
  "utf8",
);
const savedEnv = { ...process.env };

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use("/api/internal", internalCronRoutes);
  return a;
}

beforeEach(() => {
  process.env = { ...savedEnv };
  db.ids = [];
  db.updates = [];
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

describe("POST /api/internal/video-link-check", () => {
  it("no API key → 500, nothing read or written", async () => {
    delete process.env.YOUTUBE_DATA_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await request(app()).post("/api/internal/video-link-check");
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("writes available and unavailable with last_checked_at", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "k";
    db.ids = ["f9DxgfyvRKg", "o8mfb_2bQ50", "AAAAAAAAAAA"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(REAL, { status: 200 })),
    );
    const res = await request(app()).post("/api/internal/video-link-check");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, checked: 3, unavailable: 1 });
    expect(db.updates.map((u) => [u.values.status, u.ids])).toEqual([
      ["available", ["f9DxgfyvRKg", "o8mfb_2bQ50"]],
      ["unavailable", ["AAAAAAAAAAA"]],
    ]);
    for (const u of db.updates)
      expect(typeof u.values.last_checked_at).toBe("string");
  });

  it("the breaker run → 500, nothing written", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "k";
    db.ids = Array.from(
      { length: 12 },
      (_, i) => `gone${String(i).padStart(7, "0")}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(REAL, { status: 200 })),
    );
    const res = await request(app()).post("/api/internal/video-link-check");
    expect(res.status).toBe(500);
    expect(db.updates).toEqual([]);
  });

  it("YouTube refusing → 500, nothing written", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "k";
    db.ids = ["f9DxgfyvRKg"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    const res = await request(app()).post("/api/internal/video-link-check");
    expect(res.status).toBe(500);
    expect(db.updates).toEqual([]);
  });
});
