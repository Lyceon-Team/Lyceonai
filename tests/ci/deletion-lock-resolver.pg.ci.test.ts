/**
 * The deletion lock's REAL default resolver, over real PostgreSQL: both reads at once, every
 * outcome unchanged.
 *
 * @spec [owner ruling (Karl) 2026-10-20 on #1257, ruling 2 ("run its two reads IN PARALLEL. Same
 *        decisions, same denial behaviour and ordering of outcomes ... add a narrow test seam that
 *        lets a test exercise the REAL default resolver's two reads (against real Postgres via the
 *        existing pg harness) — prove both the parallel shape ... and that every existing lock
 *        outcome is unchanged"); Doc-01_V8 §40.3] | @implemented [2026-10-20]
 *
 * plain English: every other suite replaces the resolver with a stub, because test environments
 * get `testDefaultDeletionResolver`. Here the production resolver is handed to the lock through
 * `defaultDeletionStatusResolverForTests`, and its service-role client is the hot-path harness's
 * counted, slowable transport over a database built from this repo's migrations. Nothing else in
 * the resolver or the lock is replaced.
 *
 * Asserted, with ACCOUNT_DELETION_LIFECYCLE_V2 on:
 *   - SHAPE: both reads (`account_deletion_requests`, `profiles`) are issued and overlap —
 *     sequential depth 1 at an injected 25 ms per round trip (it was 2) — and the lock's
 *     `deletion_lock` pre-step lasts about one round trip, not two;
 *   - OUTCOMES, each as the sequential code decided it: active; pending_deletion (with
 *     `deleted_at`); deleted (with `completion_at`) even when `deleted_at` is also set AND even
 *     when the profile read fails; a failed completed-request read → unavailable with only its own
 *     log line, even when `deleted_at` is set or the profile read fails too; a failed profile read →
 *     unavailable; a thrown read
 *     → unavailable; and with the flag off, the profile read is never issued;
 *   - THE LOCK'S RESPONSES on those outcomes: 403 ACCOUNT_DELETED, 403 PENDING_DELETION, the
 *     pending allowlist still admitted, 503 DELETION_STATUS_UNAVAILABLE, active admitted.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  NEW_STUDENT,
  STUDENT,
  bootHarness,
  callsTo,
  harness,
  sequentialDepth,
  shutdownHarness,
} from "../perf/hot-paths.harness";

vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { supabaseServer: h.transportProxy() };
});
// The service-role client `supabase-auth.ts` builds (getSupabaseAdmin): the counted transport.
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const original = await importOriginal<object>();
  const h = await import("../perf/hot-paths.harness");
  return { ...original, createClient: () => h.transportProxy() };
});

const LATENCY_MS = 25;
const FLAG = "ACCOUNT_DELETION_LIFECYCLE_V2";

type Auth = typeof import("../../server/middleware/supabase-auth");
type Logger = typeof import("../../server/logger");
type PreStep = { step: string; ms: number | null; at_ms: number };

describe.skipIf(!PG_AVAILABLE)(
  "deletion lock: the real default resolver (parallel reads, unchanged outcomes)",
  () => {
    let auth: Auth;
    let logger: Logger["logger"];
    let app: Express;
    const timingLines: Array<{ pre_steps: PreStep[] }> = [];

    beforeAll(async () => {
      process.env[FLAG] = "true";
      await bootHarness("deletion_lock_resolver");
      auth = await import("../../server/middleware/supabase-auth");
      ({ logger } = await import("../../server/logger"));
      const { requestIdMiddleware } =
        await import("../../server/middleware/request-id");
      const { timedRoute } = await import("../../server/lib/step-timer");
      auth.setDeletionStatusResolverForTests(
        auth.defaultDeletionStatusResolverForTests,
      );
      const original = logger.info.bind(logger);
      vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
        if (args[0] === "PERF" && args[1] === "route_timing") {
          timingLines.push(args[3] as { pre_steps: PreStep[] });
          return;
        }
        return (original as (...a: unknown[]) => void)(...args);
      }) as typeof logger.info);

      // The lock as server/index.ts mounts it: after req.user is set, before every router.
      app = express();
      app.use(requestIdMiddleware);
      app.use((req, _res, next) => {
        const id = req.header("x-test-user") ?? STUDENT;
        (req as unknown as { user: { id: string } }).user = { id };
        next();
      });
      app.use(auth.enforceDeletionLock);
      app.get(
        "/api/calendar",
        timedRoute("calendar.read", async (_req, res) => {
          res.json({ ok: true });
        }),
      );
      app.get("/api/profile", (_req, res) => {
        res.json({ ok: true });
      });
    }, 240_000);

    afterAll(async () => {
      auth.setDeletionStatusResolverForTests(null);
      delete process.env[FLAG];
      vi.restoreAllMocks();
      await shutdownHarness();
    });

    beforeEach(async () => {
      process.env[FLAG] = "true";
      harness.latencyMs = 0;
      timingLines.length = 0;
      await harness.setup!.query(
        `DELETE FROM public.account_deletion_requests`,
      );
      await harness.setup!.query(
        `UPDATE public.profiles SET deleted_at = NULL WHERE id = ANY($1::uuid[])`,
        [[STUDENT, NEW_STUDENT]],
      );
    });

    async function markPending(id: string): Promise<string> {
      const r = await harness.setup!.query(
        `UPDATE public.profiles SET deleted_at = '2026-10-18T09:30:00.123456+00'
          WHERE id = $1 RETURNING deleted_at::text AS d`,
        [id],
      );
      await harness.setup!.query(
        `INSERT INTO public.account_deletion_requests
           (profile_id, actor_profile_id, status, scheduled_hard_delete_at)
         VALUES ($1, $1, 'pending', now() + interval '7 days')`,
        [id],
      );
      return String(r.rows[0].d);
    }

    async function markCompleted(id: string): Promise<void> {
      await harness.setup!.query(
        `UPDATE public.profiles SET deleted_at = now() - interval '8 days' WHERE id = $1`,
        [id],
      );
      await harness.setup!.query(
        `INSERT INTO public.account_deletion_requests
           (profile_id, actor_profile_id, status, scheduled_hard_delete_at, completion_at)
         VALUES ($1, $1, 'completed', now() - interval '1 day', '2026-10-19T12:00:00+00')`,
        [id],
      );
    }

    /** Run `fn` with a table or column renamed away, so the real read fails in Postgres. */
    async function withBroken<T>(
      breakSql: string,
      restoreSql: string,
      fn: () => Promise<T>,
    ): Promise<T> {
      await harness.setup!.query(breakSql);
      try {
        return await fn();
      } finally {
        await harness.setup!.query(restoreSql);
      }
    }
    const breakRequests = [
      `ALTER TABLE public.account_deletion_requests RENAME TO account_deletion_requests_x`,
      `ALTER TABLE public.account_deletion_requests_x RENAME TO account_deletion_requests`,
    ] as const;
    const breakDeletedAt = [
      `ALTER TABLE public.profiles RENAME COLUMN deleted_at TO deleted_at_x`,
      `ALTER TABLE public.profiles RENAME COLUMN deleted_at_x TO deleted_at`,
    ] as const;

    const resolve = (userId: string) =>
      auth.defaultDeletionStatusResolverForTests({ userId, requestId: "r-1" });

    function errorEvents(spy: ReturnType<typeof vi.spyOn>): string[] {
      return spy.mock.calls
        .filter((c: unknown[]) => c[0] === "DELETION")
        .map((c: unknown[]) => String(c[1]));
    }

    // ── shape ────────────────────────────────────────────────────────────────

    it("issues both reads at once: two round trips, depth 1", async () => {
      const requestsBefore = callsTo("account_deletion_requests");
      const profilesBefore = callsTo("profiles");
      const from = harness.intervals.length;
      harness.latencyMs = LATENCY_MS;
      const result = await resolve(STUDENT);
      harness.latencyMs = 0;

      expect(result).toEqual({ status: "active", executedAt: null });
      // Presence: both reads really ran.
      expect(callsTo("account_deletion_requests") - requestsBefore).toBe(1);
      expect(callsTo("profiles") - profilesBefore).toBe(1);
      const intervals = harness.intervals.slice(from);
      expect(intervals).toHaveLength(2);
      expect(sequentialDepth(intervals)).toBe(1);
    });

    it("the lock's deletion_lock pre-step lasts about one round trip, not two", async () => {
      harness.latencyMs = LATENCY_MS;
      const res = await request(app).get("/api/calendar");
      harness.latencyMs = 0;
      expect(res.status).toBe(200);
      expect(timingLines).toHaveLength(1);
      const lock = timingLines[0]!.pre_steps.find(
        (s) => s.step === "deletion_lock",
      );
      expect(lock).toBeDefined();
      expect(lock!.ms!).toBeGreaterThanOrEqual(LATENCY_MS - 2);
      expect(lock!.ms!).toBeLessThan(2 * LATENCY_MS - 5);
    });

    it("with the flag off, the profile read is never issued (and deleted_at is not consulted)", async () => {
      await markPending(STUDENT);
      delete process.env[FLAG];
      const profilesBefore = callsTo("profiles");
      const requestsBefore = callsTo("account_deletion_requests");
      const result = await resolve(STUDENT);
      expect(callsTo("account_deletion_requests") - requestsBefore).toBe(1);
      expect(callsTo("profiles") - profilesBefore).toBe(0);
      expect(result).toEqual({ status: "active", executedAt: null });
    });

    // ── outcomes ─────────────────────────────────────────────────────────────

    it("pending deletion: pending_deletion, executedAt = deleted_at", async () => {
      await markPending(STUDENT);
      const result = await resolve(STUDENT);
      expect(result.status).toBe("pending_deletion");
      expect(result.executedAt).toBe("2026-10-18T09:30:00.123456+00:00");
    });

    it("completed request: deleted (executedAt = completion_at), over a set deleted_at", async () => {
      await markCompleted(STUDENT);
      const result = await resolve(STUDENT);
      expect(result).toEqual({
        status: "deleted",
        executedAt: "2026-10-19T12:00:00+00:00",
      });
    });

    it("completed request AND a failing profile read: still deleted (the profile read is never decided on)", async () => {
      await markCompleted(STUDENT);
      const errorSpy = vi.spyOn(logger, "error");
      errorSpy.mockClear();
      const result = await withBroken(...breakDeletedAt, () =>
        resolve(STUDENT),
      );
      expect(result).toEqual({
        status: "deleted",
        executedAt: "2026-10-19T12:00:00+00:00",
      });
      expect(errorEvents(errorSpy)).toEqual([]);
    });

    it("a failed completed-request read: unavailable, its own log only — even with deleted_at set", async () => {
      await markPending(STUDENT);
      const errorSpy = vi.spyOn(logger, "error");
      errorSpy.mockClear();
      const result = await withBroken(...breakRequests, () => resolve(STUDENT));
      expect(result).toEqual({ status: "unavailable", executedAt: null });
      expect(errorEvents(errorSpy)).toEqual(["auth_check_failed"]);
    });

    it("both reads fail: unavailable, and only the first read's failure is logged (as before)", async () => {
      const errorSpy = vi.spyOn(logger, "error");
      errorSpy.mockClear();
      const result = await withBroken(...breakRequests, () =>
        withBroken(...breakDeletedAt, () => resolve(STUDENT)),
      );
      expect(result).toEqual({ status: "unavailable", executedAt: null });
      expect(errorEvents(errorSpy)).toEqual(["auth_check_failed"]);
    });

    it("a failed profile read: unavailable, logged as the soft-delete check", async () => {
      const errorSpy = vi.spyOn(logger, "error");
      errorSpy.mockClear();
      const result = await withBroken(...breakDeletedAt, () =>
        resolve(STUDENT),
      );
      expect(result).toEqual({ status: "unavailable", executedAt: null });
      expect(errorEvents(errorSpy)).toEqual(["soft_delete_check_failed"]);
    });

    it("a thrown read: unavailable, logged as the unhandled error", async () => {
      const errorSpy = vi.spyOn(logger, "error");
      errorSpy.mockClear();
      const pool = harness.pool;
      harness.pool = null; // the transport now throws when a read is built
      try {
        const result = await resolve(STUDENT);
        expect(result).toEqual({ status: "unavailable", executedAt: null });
      } finally {
        harness.pool = pool;
      }
      expect(errorEvents(errorSpy)).toEqual(["auth_check_error"]);
    });

    // ── the lock's responses over the real resolver ──────────────────────────

    it("the lock answers each outcome as before", async () => {
      await markCompleted(STUDENT);
      await markPending(NEW_STUDENT);

      const deleted = await request(app).get("/api/calendar");
      expect(deleted.status).toBe(403);
      expect(deleted.body).toMatchObject({ code: "ACCOUNT_DELETED" });

      const pending = await request(app)
        .get("/api/calendar")
        .set("x-test-user", NEW_STUDENT);
      expect(pending.status).toBe(403);
      expect(pending.body).toMatchObject({ code: "PENDING_DELETION" });

      const allowlisted = await request(app)
        .get("/api/profile")
        .set("x-test-user", NEW_STUDENT);
      expect(allowlisted.status).toBe(200);

      const unavailable = await withBroken(...breakRequests, () =>
        request(app).get("/api/calendar").set("x-test-user", NEW_STUDENT),
      );
      expect(unavailable.status).toBe(503);
      expect(unavailable.body).toMatchObject({
        code: "DELETION_STATUS_UNAVAILABLE",
      });

      await harness.setup!.query(
        `DELETE FROM public.account_deletion_requests`,
      );
      await harness.setup!.query(
        `UPDATE public.profiles SET deleted_at = NULL WHERE id = $1`,
        [STUDENT],
      );
      const active = await request(app).get("/api/calendar");
      expect(active.status).toBe(200);
    });
  },
);
