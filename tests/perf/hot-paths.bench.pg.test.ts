/**
 * Hot paths — local benchmark (p50 / p95 per path), opt-in.
 *
 * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2: "write a small local
 *        benchmark ... that runs each of the four paths N times before and after, and report
 *        p50/p95 per path"] | @implemented [2026-10-13]
 *
 * plain English: runs practice session start, answer submit, review session start and the
 * calendar read (plus the two reads the brief names for caching: the pre-setup calendar read
 * that resolves a device timezone, and the practice-topics catalog) N times each through the
 * REAL routers over local Postgres, and records wall time and Supabase round trips per request.
 * Each path runs at every latency in HOT_PATHS_LATENCY_MS (default "0,10"): 0 is raw local
 * Postgres, and a positive value models the network distance to PostgREST per round trip (see
 * the harness header). Results print as a table and, with HOT_PATHS_BENCH_OUT set, are written as
 * JSON.
 *
 * OPT-IN: skipped unless HOT_PATHS_BENCH=1 (and PGHOST), so it never lengthens `pnpm test`.
 *   HOT_PATHS_BENCH=1 HOT_PATHS_N=40 HOT_PATHS_BENCH_OUT=out.json \
 *     pnpm exec vitest run tests/perf/hot-paths.bench.pg.test.ts
 *
 * Timing is measured at the HTTP client (one listening server, no per-call server start), so it
 * includes Express and JSON work but not auth: the auth middleware is a stand-in here.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import http from "node:http";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  NEW_STUDENT,
  STUDENT,
  bootHarness,
  buildApp,
  closeOpenSessions,
  correctTokenFor,
  harness,
  setupBody,
  shutdownHarness,
} from "./hot-paths.harness";

vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const h = await import("./hot-paths.harness");
  return { supabaseServer: h.transportProxy() };
});
vi.mock("../../apps/api/src/lib/supabase-admin", async () => {
  const h = await import("./hot-paths.harness");
  return { getSupabaseAdmin: () => h.transport() };
});
vi.mock("../../server/middleware/supabase-auth.js", async () => {
  const h = await import("./hot-paths.harness");
  return h.authStub();
});
vi.mock("../../server/middleware/supabase-auth", async () => {
  const h = await import("./hot-paths.harness");
  return h.authStub();
});
vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
  applyRateLimitHeaders: vi.fn(),
  denyRateLimited: vi.fn(),
}));

const ENABLED = PG_AVAILABLE && process.env.HOT_PATHS_BENCH === "1";
const N = Number(process.env.HOT_PATHS_N ?? "30");
const LATENCIES = (process.env.HOT_PATHS_LATENCY_MS ?? "0,10")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v >= 0);

type Sample = { ms: number; roundTrips: number };
type PathResult = {
  path: string;
  latencyMs: number;
  n: number;
  p50: number;
  p95: number;
  mean: number;
  roundTripsP50: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  // Nearest-rank: the smallest value with at least p% of samples at or below it.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? Number.NaN;
}

function summarise(
  path: string,
  latencyMs: number,
  samples: Sample[],
): PathResult {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const rts = samples.map((s) => s.roundTrips).sort((a, b) => a - b);
  const round = (v: number): number => Math.round(v * 10) / 10;
  return {
    path,
    latencyMs,
    n: samples.length,
    p50: round(percentile(ms, 50)),
    p95: round(percentile(ms, 95)),
    mean: round(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)),
    roundTripsP50: percentile(rts, 50),
  };
}

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; sample: Sample }> {
  const before = harness.roundTrips;
  const start = performance.now();
  const value = await fn();
  return {
    value,
    sample: {
      ms: performance.now() - start,
      roundTrips: harness.roundTrips - before,
    },
  };
}

describe.skipIf(!ENABLED)("hot paths: local benchmark", () => {
  let server: http.Server;
  const results: PathResult[] = [];

  beforeAll(async () => {
    await bootHarness("hot_paths_bench");
    // The answer limiter is a resource guard, not what is measured; lift it for N answers.
    await harness.setup!.query(
      `UPDATE public.practice_runtime_config SET value = '100000'::jsonb
        WHERE key = 'answer_rate_limit_max'`,
    );
    const app = await buildApp();
    server = app.listen(0);
    // Calendar setup and the first-open plan generation are not the read being measured.
    harness.actingStudent = STUDENT;
    const put = await request(server)
      .put("/api/calendar/profile")
      .send(setupBody());
    expect(put.status).toBe(200);
    const first = await request(server).get("/api/calendar");
    expect(first.status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    const out = process.env.HOT_PATHS_BENCH_OUT;
    if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
    console.table(results);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await shutdownHarness();
  });

  it("runs each path N times at each modelled latency", async () => {
    for (const latencyMs of LATENCIES) {
      const samples: Record<string, Sample[]> = {
        "practice.session_start": [],
        "practice.answer_submit": [],
        "review.session_start": [],
        "calendar.read": [],
        "calendar.read_presetup_tz": [],
        "practice.topics": [],
      };
      for (let i = 0; i < N + 2; i += 1) {
        const keep = i >= 2; // two warm-up rounds per latency, discarded
        harness.latencyMs = 0;
        harness.actingStudent = STUDENT;
        await closeOpenSessions();

        harness.latencyMs = latencyMs;
        const start = await timed(() =>
          request(server)
            .post("/api/practice/sessions")
            .send({
              sections: ["M"],
              target_question_count: 10,
              idempotency_key: `bench-${latencyMs}-${i}`,
              client_instance_id: "bench",
            }),
        );
        expect(start.value.status).toBe(200);

        harness.latencyMs = 0;
        const sessionId = String(start.value.body.sessionId);
        const firstItem = await harness.setup!.query(
          `SELECT id FROM public.practice_session_items WHERE session_id = $1 AND ordinal = 1`,
          [sessionId],
        );
        const itemId = String(firstItem.rows[0].id);
        const token = await correctTokenFor(itemId);

        harness.latencyMs = latencyMs;
        const answer = await timed(() =>
          request(server)
            .post("/api/practice/answer")
            .send({
              sessionId,
              sessionItemId: itemId,
              selectedAnswer: token,
              clientAttemptId: `bench-attempt-${latencyMs}-${i}`,
            }),
        );
        expect(answer.value.status).toBe(200);

        const review = await timed(() =>
          request(server)
            .post("/api/review/sessions")
            .send({
              mode: "queue",
              idempotency_key: `bench-review-${latencyMs}-${i}`,
              client_instance_id: "bench",
            }),
        );
        expect(review.value.status).toBe(200);

        const calendar = await timed(() =>
          request(server).get("/api/calendar"),
        );
        expect(calendar.value.status).toBe(200);

        harness.actingStudent = NEW_STUDENT;
        const presetup = await timed(() =>
          request(server).get("/api/calendar?device_timezone=America/New_York"),
        );
        expect(presetup.value.status).toBe(200);

        harness.actingStudent = STUDENT;
        const topics = await timed(() =>
          request(server).get("/api/practice/topics"),
        );
        expect(topics.value.status).toBe(200);

        if (keep) {
          samples["practice.session_start"]!.push(start.sample);
          samples["practice.answer_submit"]!.push(answer.sample);
          samples["review.session_start"]!.push(review.sample);
          samples["calendar.read"]!.push(calendar.sample);
          samples["calendar.read_presetup_tz"]!.push(presetup.sample);
          samples["practice.topics"]!.push(topics.sample);
        }
      }
      for (const [path, s] of Object.entries(samples)) {
        results.push(summarise(path, latencyMs, s));
      }
    }
    harness.latencyMs = 0;
  }, 1_800_000);
});
