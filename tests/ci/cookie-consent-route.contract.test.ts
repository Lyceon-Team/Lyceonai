/**
 * @spec [Doc 10 §9.11 (consent log: timestamp + category); legal-drafts README banner
 *       requirements ("Consent log: timestamp, categories accepted, banner text version");
 *       SCL-202 (public endpoints rate-limited on the anonymous ledger); Coding Standards §8.1,
 *       §12.1, §14] | @implemented [2026-10-05]
 *
 * plain English: the real router over a fake Supabase that records every call. A valid choice
 * writes exactly one row with exactly the logged fields — no user id, no IP, no user agent — and
 * answers 204; a malformed body writes nothing; an exhausted bucket answers 429 and writes
 * nothing; a failed insert answers 503.
 */
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const fake = vi.hoisted(() => {
  const state = {
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    ledger: new Map<string, number>(),
    buckets: {} as Record<string, unknown>,
    failInsert: false,
  };
  const client = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      if (fn !== "rate_limit_check_and_increment_anon") {
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }
      const key = `${String(args.p_subject_hmac)}|${String(args.p_bucket_key)}|${String(args.p_window_start)}`;
      const used = state.ledger.get(key) ?? 0;
      const limit = Number(args.p_limit);
      if (used + 1 <= limit) {
        state.ledger.set(key, used + 1);
        return {
          data: [
            { allowed: true, used: used + 1, remaining: limit - used - 1 },
          ],
          error: null,
        };
      }
      return { data: [{ allowed: false, used, remaining: 0 }], error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, key: unknown) => ({
          maybeSingle: async () =>
            table === "rate_limit_runtime_config" &&
            key === "bucket_definitions"
              ? { data: { value: state.buckets }, error: null }
              : { data: null, error: null },
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        if (state.failInsert)
          return { error: { code: "XX000", message: "down" } };
        state.inserts.push({ table, row });
        return { error: null };
      },
    }),
  };
  return { state, client };
});

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: fake.client,
}));

/** The cookie_consent_ip limit, read from the migration that seeds it (no second copy). */
function bucketFromMigration(): Record<string, unknown> {
  const sql = readFileSync(
    "supabase/migrations/20261026000000_analytics_identity_and_cookie_consent.sql",
    "utf8",
  );
  const m =
    /'cookie_consent_ip',\s*jsonb_build_object\('limit',\s*(\d+),\s*'window_seconds',\s*(\d+)\)/.exec(
      sql,
    );
  if (!m)
    throw new Error("cookie_consent_ip bucket not found in the migration");
  return {
    cookie_consent_ip: { limit: Number(m[1]), window_seconds: Number(m[2]) },
  };
}

let app: express.Express;
const VALID = {
  consent_id: "0d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a",
  analytics: false,
  banner_version: 1,
  source: "banner",
};

beforeAll(async () => {
  process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = "test-hmac-secret-not-real";
  const router = (await import("../../server/routes/cookie-consent-routes"))
    .default;
  app = express();
  app.use(express.json());
  app.use("/api/public/cookie-consent", router);
});

beforeEach(() => {
  fake.state.inserts.length = 0;
  fake.state.ledger.clear();
  fake.state.failInsert = false;
  fake.state.buckets = bucketFromMigration();
});

describe("POST /api/public/cookie-consent", () => {
  it("logs one row with exactly the consent fields and answers 204", async () => {
    const res = await request(app)
      .post("/api/public/cookie-consent")
      .set("x-vercel-forwarded-for", "203.0.113.10")
      .set("User-Agent", "probe-agent")
      .send(VALID);
    expect(res.status).toBe(204);
    expect(fake.state.inserts).toEqual([
      {
        table: "cookie_consent_log",
        row: {
          consent_id: VALID.consent_id,
          analytics: false,
          banner_version: "1",
          source: "banner",
        },
      },
    ]);
    const written = JSON.stringify(fake.state.inserts);
    expect(written).not.toContain("203.0.113.10");
    expect(written).not.toContain("probe-agent");
  });

  it.each([
    ["no consent id", { ...VALID, consent_id: undefined }],
    ["a non-uuid id", { ...VALID, consent_id: "abc" }],
    ["a non-boolean choice", { ...VALID, analytics: "yes" }],
    ["an unknown source", { ...VALID, source: "gpc" }],
    ["an extra field", { ...VALID, user_id: "x" }],
  ])("refuses %s with 400 and writes nothing", async (_label, body) => {
    const res = await request(app)
      .post("/api/public/cookie-consent")
      .set("x-vercel-forwarded-for", "203.0.113.11")
      .send(body);
    expect(res.status).toBe(400);
    expect(fake.state.inserts).toEqual([]);
  });

  it("answers 429 past the bucket and writes nothing more", async () => {
    const limit = (
      bucketFromMigration()["cookie_consent_ip"] as { limit: number }
    ).limit;
    for (let i = 0; i < limit; i += 1) {
      const ok = await request(app)
        .post("/api/public/cookie-consent")
        .set("x-vercel-forwarded-for", "203.0.113.12")
        .send(VALID);
      expect(ok.status).toBe(204);
    }
    const res = await request(app)
      .post("/api/public/cookie-consent")
      .set("x-vercel-forwarded-for", "203.0.113.12")
      .send(VALID);
    expect(res.status).toBe(429);
    expect(fake.state.inserts).toHaveLength(limit);
  });

  it("answers 503 when the log cannot be written", async () => {
    fake.state.failInsert = true;
    const res = await request(app)
      .post("/api/public/cookie-consent")
      .set("x-vercel-forwarded-for", "203.0.113.13")
      .send(VALID);
    expect(res.status).toBe(503);
  });
});
