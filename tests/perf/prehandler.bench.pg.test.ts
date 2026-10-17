/**
 * Hot paths through the REAL middleware chain — local benchmark of pre_handler, opt-in.
 *
 * @spec [owner brief (Karl) 2026-10-15 "next perf PR" item 1 and proofs ("local before/after
 *        p50/p95 at 0 ms and 10 ms injected latency including pre_handler, round-trip counts")]
 * | @implemented [2026-10-15]
 *
 * plain English: the hot-path bench (`hot-paths.bench.pg.test.ts`) stubs authentication out, so
 * its `pre_handler` is ~0. This one mounts the chain production runs in front of the four timed
 * routes — `requestIdMiddleware`, `cookieParser`, `express.json`, the REAL
 * `supabaseAuthMiddleware` and `enforceDeletionLock`, then each router behind the real
 * `requireSupabaseAuth` / `requireStudentOrAdmin` and its own per-route middleware — with exactly
 * one seam replaced: the Auth server. `getUser()` is a stand-in that costs ONE counted round trip
 * (the injected latency, like every database call) and returns the acting student; the profile
 * read behind `req.user` is the real `ensureProfileForAuthUser` over the counted transport.
 * Not mounted: CSRF (a synchronous HMAC check, no I/O) and the in-memory global limiter.
 *
 * Reported per path: total ms, `pre_handler_ms` (from the route's own `route_timing` line), round
 * trips (database + the Auth stand-in), and sequential depth (`sequentialDepth`).
 *
 * OPT-IN: skipped unless HOT_PATHS_BENCH=1 (and PGHOST).
 *   HOT_PATHS_BENCH=1 HOT_PATHS_N=40 HOT_PATHS_BENCH_OUT=out.json \
 *     pnpm exec vitest run tests/perf/prehandler.bench.pg.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import request from "supertest";
import fs from "node:fs";
import http from "node:http";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  STUDENT,
  bootHarness,
  closeOpenSessions,
  correctTokenFor,
  harness,
  sequentialDepth,
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
// The service-role client `supabase-auth.ts` builds for the profile read: the counted transport.
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const original = await importOriginal<object>();
  const h = await import("./hot-paths.harness");
  return { ...original, createClient: () => h.transportProxy() };
});
// The Auth server: one counted, slowed round trip per getUser().
vi.mock("../../server/lib/supabase-ssr", async () => {
  const h = await import("./hot-paths.harness");
  return {
    createSupabaseServerClient: () => ({
      auth: {
        getUser: async () => {
          h.harness.roundTrips += 1;
          h.harness.calls.set(
            "auth:getUser",
            (h.harness.calls.get("auth:getUser") ?? 0) + 1,
          );
          const start = performance.now();
          if (h.harness.latencyMs > 0)
            await new Promise((r) => setTimeout(r, h.harness.latencyMs));
          h.harness.intervals.push({ start, end: performance.now() });
          return {
            data: {
              user: {
                id: h.harness.actingStudent,
                email: `${h.harness.actingStudent}@example.test`,
              },
            },
            error: null,
          };
        },
      },
    }),
  };
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

type Sample = {
  ms: number;
  preHandlerMs: number;
  roundTrips: number;
  depth: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? Number.NaN;
}
const round = (v: number): number => Math.round(v * 10) / 10;

async function buildRealChainApp(): Promise<Express> {
  const { requestIdMiddleware } =
    await import("../../server/middleware/request-id");
  const {
    supabaseAuthMiddleware,
    enforceDeletionLock,
    requireSupabaseAuth,
    requireStudentOrAdmin,
  } = await import("../../server/middleware/supabase-auth");
  const { default: practiceRouter } =
    await import("../../server/routes/practice-canonical");
  const { default: reviewRouter } =
    await import("../../server/routes/review-canonical");
  const { calendarRouter } =
    await import("../../server/routes/calendar-routes");
  const { doubleCsrfProtection, generateToken } =
    await import("../../server/middleware/csrf-double-submit");

  const app = express();
  // The production global limiter's shape (server/index.ts: 1000 per 15 min), raised to the run's
  // own request count so it can never trip mid-run: setup (token, profile, first read) plus four
  // timed requests per round, N + 2 rounds per latency.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Math.max(1000, 10 + (N + 2) * 4 * Math.max(1, LATENCIES.length)),
  });
  app.use(requestIdMiddleware);
  // codeql[js/missing-token-validation]: false positive. CSRF *is* enforced — by the production
  // double-submit middleware `doubleCsrfProtection` (server/middleware/csrf-double-submit), mounted
  // in this app exactly where server/index.ts mounts it (per route, after the session check), which
  // CodeQL's default model does not recognise (it matches only `csurf`). Same pattern and note as
  // the `app.use(cookieParser())` in server/index.ts.
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(limiter);
  // The CSRF token bootstrap, as production serves it (server/index.ts `/api/csrf-token`).
  app.get("/api/csrf-token", (req, res) => {
    res.json({ csrfToken: generateToken(req, res) });
  });
  app.use(supabaseAuthMiddleware);
  app.use(enforceDeletionLock);
  // The three mounts exactly as server/index.ts has them, CSRF included and in the same place:
  // calendar checks CSRF before the role, practice and review after it.
  app.use(
    "/api/calendar",
    requireSupabaseAuth,
    doubleCsrfProtection,
    requireStudentOrAdmin,
    calendarRouter,
  );
  app.use(
    "/api/practice",
    requireSupabaseAuth,
    requireStudentOrAdmin,
    doubleCsrfProtection,
    practiceRouter,
  );
  app.use(
    "/api/review",
    requireSupabaseAuth,
    requireStudentOrAdmin,
    doubleCsrfProtection,
    reviewRouter,
  );
  return app;
}

describe.skipIf(!ENABLED)(
  "pre-handler: local benchmark (real middleware chain)",
  () => {
    let server: http.Server;
    /** One cookie jar for the whole run, so the CSRF cookie travels like a browser's. */
    let agent: ReturnType<typeof request.agent>;
    /** The token every mutating request sends, obtained from `/api/csrf-token`. */
    let csrfToken = "";
    const ORIGIN = "http://localhost:5000";
    const results: Array<Record<string, unknown>> = [];
    const preHandler: number[] = [];

    beforeAll(async () => {
      await bootHarness("prehandler_bench");
      await harness.setup!.query(
        `UPDATE public.practice_runtime_config SET value = '100000'::jsonb
        WHERE key = 'answer_rate_limit_max'`,
      );
      // `requireProfileComplete`: a finished profile with a known, adult date of birth.
      await harness.setup!.query(
        `UPDATE public.profiles SET profile_completed_at = now(), is_under_13 = false,
              date_of_birth = '2008-01-01', display_name = 'Bench'`,
      );
      const { logger } = await import("../../server/logger");
      const original = logger.info.bind(logger);
      vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
        if (args[0] === "PERF" && args[1] === "route_timing") {
          const data = args[3] as { pre_handler_ms?: unknown };
          if (typeof data.pre_handler_ms === "number")
            preHandler.push(data.pre_handler_ms);
          return;
        }
        if (args[1] === "user_authenticated" || args[1] === "api_request")
          return;
        return (original as (...a: unknown[]) => void)(...args);
      }) as typeof logger.info);

      server = (await buildRealChainApp()).listen(0);
      agent = request.agent(server);
      const tokenRes = await agent.get("/api/csrf-token");
      expect(tokenRes.status).toBe(200);
      csrfToken = String(tokenRes.body.csrfToken);
      harness.actingStudent = STUDENT;
      const put = await agent
        .put("/api/calendar/profile")
        .set("x-csrf-token", csrfToken)
        .set("Origin", ORIGIN)
        .send(setupBody());
      expect(put.status).toBe(200);
      expect((await agent.get("/api/calendar")).status).toBe(200);
    }, 240_000);

    afterAll(async () => {
      const out = process.env.HOT_PATHS_BENCH_OUT;
      if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
      console.table(results);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await shutdownHarness();
    });

    async function timed(
      fn: () => PromiseLike<{ status: number }>,
    ): Promise<{ status: number; sample: Sample }> {
      const rt = harness.roundTrips;
      const from = harness.intervals.length;
      const pre = preHandler.length;
      const start = performance.now();
      const res = await fn();
      return {
        status: res.status,
        sample: {
          ms: performance.now() - start,
          preHandlerMs: preHandler[pre] ?? Number.NaN,
          roundTrips: harness.roundTrips - rt,
          depth: sequentialDepth(harness.intervals.slice(from)),
        },
      };
    }

    it("runs each path N times at each modelled latency", async () => {
      let sessionId = "";
      for (const latencyMs of LATENCIES) {
        const samples: Record<string, Sample[]> = {
          "practice.session_start": [],
          "practice.answer_submit": [],
          "review.session_start": [],
          "calendar.read": [],
        };
        for (let i = 0; i < N + 2; i += 1) {
          const keep = i >= 2;
          harness.latencyMs = 0;
          harness.actingStudent = STUDENT;
          await closeOpenSessions();

          harness.latencyMs = latencyMs;
          const start = await timed(() =>
            agent
              .post("/api/practice/sessions")
              .set("x-csrf-token", csrfToken)
              .set("Origin", ORIGIN)
              .send({
                sections: ["M"],
                target_question_count: 10,
                idempotency_key: `ph-${latencyMs}-${i}`,
                client_instance_id: "bench",
              })
              .then((r) => {
                sessionId = String(r.body.sessionId);
                return r;
              }),
          );
          expect(start.status).toBe(200);

          harness.latencyMs = 0;
          const firstItem = await harness.setup!.query(
            `SELECT id FROM public.practice_session_items WHERE session_id = $1 AND ordinal = 1`,
            [sessionId],
          );
          const itemId = String(firstItem.rows[0].id);
          const token = await correctTokenFor(itemId);

          harness.latencyMs = latencyMs;
          const answer = await timed(() =>
            agent
              .post("/api/practice/answer")
              .set("x-csrf-token", csrfToken)
              .set("Origin", ORIGIN)
              .send({
                sessionId,
                sessionItemId: itemId,
                selectedAnswer: token,
                clientAttemptId: `ph-attempt-${latencyMs}-${i}`,
              }),
          );
          expect(answer.status).toBe(200);
          const review = await timed(() =>
            agent
              .post("/api/review/sessions")
              .set("x-csrf-token", csrfToken)
              .set("Origin", ORIGIN)
              .send({
                mode: "queue",
                idempotency_key: `ph-review-${latencyMs}-${i}`,
                client_instance_id: "bench",
              }),
          );
          expect(review.status).toBe(200);
          const calendar = await timed(() => agent.get("/api/calendar"));
          expect(calendar.status).toBe(200);

          if (keep) {
            samples["practice.session_start"]!.push(start.sample);
            samples["practice.answer_submit"]!.push(answer.sample);
            samples["review.session_start"]!.push(review.sample);
            samples["calendar.read"]!.push(calendar.sample);
          }
        }
        for (const [path, s] of Object.entries(samples)) {
          const sorted = (k: keyof Sample): number[] =>
            s.map((x) => x[k]).sort((a, b) => a - b);
          results.push({
            path,
            latencyMs,
            n: s.length,
            p50: round(percentile(sorted("ms"), 50)),
            p95: round(percentile(sorted("ms"), 95)),
            preP50: round(percentile(sorted("preHandlerMs"), 50)),
            preP95: round(percentile(sorted("preHandlerMs"), 95)),
            roundTripsP50: percentile(sorted("roundTrips"), 50),
            depthP50: percentile(sorted("depth"), 50),
          });
        }
      }
      harness.latencyMs = 0;
    }, 1_800_000);
  },
);
