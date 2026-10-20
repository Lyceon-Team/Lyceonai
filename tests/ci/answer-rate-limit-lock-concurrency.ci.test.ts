/**
 * Answer submit: the rate limiter's config read runs alongside the deletion lock, and every
 * denial is what it was.
 *
 * @spec [owner ruling (Karl) 2026-10-20 on #1257, ruling B ("Run `answer_rate_limit` CONCURRENTLY
 *        with `deletion_lock` on answer submit ... Denial behaviour must be identical: same status
 *        codes, same precedence when both would deny ... state whether a denied request still
 *        consumes a rate-limit token"); Doc-01_V8 §40.3; Doc-02B_V4 §41] | @implemented [2026-10-20]
 *
 * plain English: the PRODUCTION app (`server/index.ts`) with the deletion lock ON and only its
 * seams replaced — the session (a signed-in student), the deletion resolver (a controllable stub
 * that takes time), CSRF, and the database transport behind `practice_runtime_config` (which
 * records when each config read starts and can be told to fail). Asserted:
 *   - the config read STARTS before the deletion lock's resolver finishes (the overlap);
 *   - when both would deny, the client sees the lock's 403 / 503 — never the 429 or the config
 *     503 — exactly today's order;
 *   - a request the lock refuses consumes NO rate-limit token: after any number of them the
 *     bucket still admits its full `max`, then 429s, as before;
 *   - a failed config read is still a 503 CONFIG_UNAVAILABLE when the lock admits the request,
 *     and is invisible behind a lock refusal (today that read never happened at all).
 *
 * Each of the four routes that mount the limiter — practice answer and skip, review answer and
 * skip — runs the same four tests (owner ruling Q1 on #1271, Karl, 2026-10-20: "apply the early
 * config read to the skip and review-answer routes too ... tests mirroring the answer-route ones").
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import request from "supertest";
import type { Express, Request, Response, NextFunction } from "express";
import type {
  DeletionStatusResult,
  SupabaseUser,
} from "../../server/middleware/supabase-auth";

const cfg = vi.hoisted(() => ({
  max: 3,
  windowMs: 60000,
  fail: false,
  delayMs: 0,
  /** performance.now() at the start of each practice_runtime_config read. */
  readStarts: [] as number[],
}));

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const configRows = (): Array<{ key: string; value: number }> => [
    { key: "max_concurrent_sessions", value: 5 },
    { key: "default_session_count_web", value: 20 },
    { key: "max_session_count_premium", value: 60 },
    { key: "target_seconds_per_question", value: 90 },
    { key: "answer_rate_limit_window_ms", value: cfg.windowMs },
    { key: "answer_rate_limit_max", value: cfg.max },
  ];
  const makeChain = (isConfig: boolean) => {
    const run = async (): Promise<{ data: unknown; error: unknown }> => {
      if (isConfig) {
        cfg.readStarts.push(performance.now());
        if (cfg.delayMs > 0)
          await new Promise((r) => setTimeout(r, cfg.delayMs));
        if (cfg.fail)
          return { data: null, error: { message: "config read failed" } };
        return { data: configRows(), error: null };
      }
      return { data: [], error: null };
    };
    const terminal = {
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (
        resolve: (v: { data: unknown; error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) => run().then(resolve, reject),
    };
    const chain: object = new Proxy(terminal, {
      get(target, prop) {
        if (prop in target) return Reflect.get(target, prop);
        return (..._args: unknown[]) => chain;
      },
    });
    return chain;
  };
  return {
    supabaseServer: {
      from: (table: string) => makeChain(table === "practice_runtime_config"),
    },
  };
});

const lock = {
  status: "active" as DeletionStatusResult["status"],
  delayMs: 0,
  startedAt: 0,
  endedAt: 0,
};

const BODY = {
  sessionId: "00000000-0000-0000-0000-000000000001",
  sessionItemId: "00000000-0000-0000-0000-000000000101",
  clientAttemptId: "attempt-lock-concurrency",
};

// 2026-10-20 (owner ruling Q1 on #1271): every route that mounts the answer limiter takes the
// early config read, so each is run through the same four tests.
const ROUTES = [
  { route: "practice answer", path: "/api/practice/answer", windowMs: 60_001 },
  {
    route: "practice skip",
    path: "/api/practice/sessions/00000000-0000-0000-0000-000000000001/skip",
    windowMs: 60_002,
  },
  { route: "review answer", path: "/api/review/answer", windowMs: 60_003 },
  {
    route: "review skip",
    path: "/api/review/sessions/00000000-0000-0000-0000-000000000001/skip",
    windowMs: 60_004,
  },
] as const;

describe.each(ROUTES)(
  "$route: limiter config read ∥ deletion lock, denials unchanged",
  ({ path, windowMs }) => {
    let app: Express;
    let resetConfigCache: () => void;
    let restoreResolver: () => void;

    beforeAll(async () => {
      process.env.VITEST = "true";
      process.env.NODE_ENV = "test";
      process.env.ACCOUNT_DELETION_LIFECYCLE_V2 = "true";

      const authModule = await import("../../server/middleware/supabase-auth");
      vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
        (req: Request, _res: Response, next: NextFunction) => {
          req.user = {
            id: "lock-concurrency-user",
            email: "lock@example.com",
            role: "student",
            isAdmin: false,
            isGuardian: false,
            display_name: "Lock Test",
            // The mocked user carries only the fields these routes read.
          } as SupabaseUser;
          next();
        },
      );
      for (const name of [
        "requireSupabaseAuth",
        "requireStudentOrAdmin",
        "requireProfileComplete",
        "requireGuardianLinkForUnder13",
      ] as const) {
        vi.spyOn(authModule, name).mockImplementation(
          (_req: Request, _res: Response, next: NextFunction) => {
            next();
          },
        );
      }
      authModule.setDeletionStatusResolverForTests(async () => {
        lock.startedAt = performance.now();
        if (lock.delayMs > 0)
          await new Promise((r) => setTimeout(r, lock.delayMs));
        lock.endedAt = performance.now();
        return { status: lock.status, executedAt: null };
      });
      restoreResolver = () =>
        authModule.setDeletionStatusResolverForTests(null);

      const practice = await import("../../server/routes/practice-canonical");
      resetConfigCache = practice.resetPracticeConfigCacheForTests;
      const serverModule = await import("../../server/index");
      app = serverModule.default;
    });

    afterAll(() => {
      restoreResolver();
      delete process.env.ACCOUNT_DELETION_LIFECYCLE_V2;
      delete process.env.VITEST;
      vi.restoreAllMocks();
    });

    beforeEach(() => {
      lock.status = "active";
      lock.delayMs = 0;
      cfg.fail = false;
      cfg.delayMs = 0;
      cfg.readStarts = [];
    });

    /**
     * A fresh bucket: a new (window, max) builds a new limiter, and a cleared cache re-reads it. Each
     * test uses its own `max` and each route its own window, because the limiter is cached per
     * (window, max) and its bucket is shared by every route that mounts it.
     */
    function freshBucket(max: number): void {
      cfg.max = max;
      cfg.windowMs = windowMs;
      resetConfigCache();
    }

    const answer = () =>
      request(app).post(path).set("Origin", "http://localhost:5000").send(BODY);

    it("starts the limiter's config read before the deletion lock's reads finish", async () => {
      freshBucket(50);
      lock.delayMs = 40;
      cfg.delayMs = 40;
      const res = await answer();
      // Presence: the request passed the lock and the limiter (the body is not a valid answer, so
      // the handler refuses it — but not with a lock, config or rate-limit status).
      expect([403, 429, 503]).not.toContain(res.status);
      expect(cfg.readStarts.length).toBeGreaterThanOrEqual(1);
      expect(lock.endedAt).toBeGreaterThan(lock.startedAt);
      // The overlap: the config read began while the lock's resolver was still running.
      expect(cfg.readStarts[0]!).toBeLessThan(lock.endedAt);
    });

    it("both would deny (bucket spent AND account deleted): the client sees the lock's 403", async () => {
      freshBucket(2);
      expect((await answer()).status).not.toBe(429);
      expect((await answer()).status).not.toBe(429);
      const limited = await answer();
      expect(limited.status).toBe(429); // the limiter would deny now
      expect(limited.body).toEqual({
        error: "rate_limited",
        message: "Too many practice submissions. Please slow down.",
      });

      lock.status = "deleted";
      const deleted = await answer();
      expect(deleted.status).toBe(403);
      expect(deleted.body).toMatchObject({ code: "ACCOUNT_DELETED" });

      lock.status = "pending_deletion";
      const pending = await answer();
      expect(pending.status).toBe(403);
      expect(pending.body).toMatchObject({ code: "PENDING_DELETION" });

      lock.status = "unavailable";
      const unavailable = await answer();
      expect(unavailable.status).toBe(503);
      expect(unavailable.body).toMatchObject({
        code: "DELETION_STATUS_UNAVAILABLE",
      });
    });

    it("a request the lock refuses consumes no rate-limit token", async () => {
      freshBucket(3);
      lock.status = "deleted";
      for (let i = 0; i < 5; i += 1) {
        const refused = await answer();
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ code: "ACCOUNT_DELETED" });
      }
      lock.status = "unavailable";
      expect((await answer()).status).toBe(503);

      // The bucket is untouched: its full max is admitted, then the next is limited.
      lock.status = "active";
      expect((await answer()).status).not.toBe(429);
      expect((await answer()).status).not.toBe(429);
      expect((await answer()).status).not.toBe(429);
      expect((await answer()).status).toBe(429);
    });

    it("a failed config read: 503 CONFIG_UNAVAILABLE when the lock admits, the lock's refusal when it does not", async () => {
      freshBucket(40);
      cfg.fail = true;

      lock.status = "deleted";
      const refused = await answer();
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: "ACCOUNT_DELETED" });

      lock.status = "unavailable";
      const lockDown = await answer();
      expect(lockDown.status).toBe(503);
      expect(lockDown.body).toMatchObject({
        code: "DELETION_STATUS_UNAVAILABLE",
      });

      lock.status = "active";
      const admitted = await answer();
      expect(admitted.status).toBe(503);
      expect(admitted.body).toEqual({
        error: {
          message: "Service temporarily unavailable",
          code: "CONFIG_UNAVAILABLE",
        },
      });
    });
  },
);
