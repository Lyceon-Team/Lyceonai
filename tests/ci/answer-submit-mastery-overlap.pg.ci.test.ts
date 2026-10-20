/**
 * Answer submit: the stats read and the NON-finishing session update run alongside mastery_emit;
 * the FINISHING update still waits for it.
 *
 * @spec [owner ruling (Karl) 2026-10-19 on #1257, ruling 3 (relayed 2026-10-20): "Run the stats read
 *        and the NON-finishing session update concurrently with mastery_emit. The FINISHING session
 *        update stays sequential after mastery_emit, so no session ever shows 'completed' before
 *        its last mastery event is saved ... Prove: the finishing case is still ordered ..., the
 *        non-finishing case overlaps ..., idempotency/replay unchanged"; Doc-05A §11]
 * | @implemented [2026-10-20]
 *
 * plain English: the REAL practice router over real PostgreSQL (the hot-path harness: auth
 * stand-in, counted transport). The mastery write is the REAL `applyMasteryEvent` with 60 ms added
 * in front of it, so "during the emission" is a window wide enough to see. Each answer's own
 * `route_timing` line gives the steps' start offsets and durations. Asserted:
 *   - a NON-finishing answer: `stats` and `session_update` both START before `mastery_emit` ENDS,
 *     and the session row is `active` afterwards;
 *   - a FINISHING answer (a one-question session): `session_update` starts only after
 *     `mastery_emit` ended, and the mastery event for that item is already in
 *     `mastery_event_audit_log` at the moment the session is first seen `completed`;
 *   - replays as before: the non-finishing answer replays 200 `idempotentRetried`; the finishing
 *     one, its session closed, answers 409; either way still exactly one mastery event for the item.
 *     (The finishing test, replay included, also passes in full against the pre-ruling-3 route;
 *     the non-finishing replay's body is pinned by the unchanged golden
 *     `__golden__/hot-paths.answer_submit.json`.)
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
import request from "supertest";
import type { Express } from "express";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  STUDENT,
  bootHarness,
  buildApp,
  closeOpenSessions,
  correctTokenFor,
  harness,
  shutdownHarness,
} from "../perf/hot-paths.harness";

const MASTERY_EXTRA_MS = 60;

const watch = vi.hoisted(() => ({
  /** For a finishing answer: was the item's mastery event saved when completion was first seen? */
  sessionToWatch: null as string | null,
  itemToWatch: null as string | null,
  sawCompletedBeforeEvent: false,
  polls: 0,
}));

vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { supabaseServer: h.transportProxy() };
});
vi.mock("../../apps/api/src/lib/supabase-admin", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { getSupabaseAdmin: () => h.transport() };
});
vi.mock("../../server/middleware/supabase-auth.js", async () => {
  const h = await import("../perf/hot-paths.harness");
  return h.authStub();
});
vi.mock("../../server/middleware/supabase-auth", async () => {
  const h = await import("../perf/hot-paths.harness");
  return h.authStub();
});
vi.mock("../../server/middleware/rate-limit", () => ({
  singleBucketRateLimit:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
  applyRateLimitHeaders: vi.fn(),
  denyRateLimited: vi.fn(),
}));
// The real mastery write, made slower so its window is visible.
vi.mock("../../apps/api/src/services/mastery-write", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/services/mastery-write")
    >();
  return {
    ...actual,
    applyMasteryEvent: async (
      ...args: Parameters<typeof actual.applyMasteryEvent>
    ) => {
      await new Promise((r) => setTimeout(r, 60));
      return actual.applyMasteryEvent(...args);
    },
  };
});

type Step = { step: string; ms: number | null; at_ms: number };

describe.skipIf(!PG_AVAILABLE)(
  "answer submit: stats and the non-finishing update overlap mastery_emit (ruling 3)",
  () => {
    let app: Express;
    const lines: Array<{ route: string; steps: Step[] }> = [];

    beforeAll(async () => {
      await bootHarness("answer_mastery_overlap");
      const { logger } = await import("../../server/logger");
      const original = logger.info.bind(logger);
      vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
        if (args[0] === "PERF" && args[1] === "route_timing") {
          lines.push(args[3] as { route: string; steps: Step[] });
          return;
        }
        return (original as (...a: unknown[]) => void)(...args);
      }) as typeof logger.info);
      app = await buildApp();
    }, 240_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      await shutdownHarness();
    });

    beforeEach(async () => {
      harness.actingStudent = STUDENT;
      harness.latencyMs = 0;
      lines.length = 0;
      await closeOpenSessions();
    });

    async function start(target: number, key: string): Promise<string> {
      const res = await request(app)
        .post("/api/practice/sessions")
        .send({
          sections: ["M"],
          target_question_count: target,
          idempotency_key: key,
          client_instance_id: "overlap-client",
        });
      expect(res.status).toBe(200);
      return String(res.body.sessionId);
    }

    async function firstItem(sessionId: string): Promise<string> {
      const r = await harness.setup!.query(
        `SELECT id FROM public.practice_session_items WHERE session_id = $1 AND ordinal = 1`,
        [sessionId],
      );
      return String(r.rows[0].id);
    }

    async function masteryEvents(itemId: string): Promise<number> {
      const r = await harness.setup!.query(
        `SELECT count(*)::int AS c FROM public.mastery_event_audit_log WHERE event_id = $1`,
        [itemId],
      );
      return Number(r.rows[0].c);
    }

    function answerSteps(): Record<string, Step> {
      const line = lines.find((l) => l.route === "practice.answer_submit");
      expect(line).toBeDefined();
      const out: Record<string, Step> = {};
      for (const s of line!.steps) out[s.step] = s;
      return out;
    }
    const endOf = (s: Step): number => s.at_ms + (s.ms ?? Number.NaN);

    async function answer(sessionId: string, itemId: string, attempt: string) {
      return request(app)
        .post("/api/practice/answer")
        .send({
          sessionId,
          sessionItemId: itemId,
          selectedAnswer: await correctTokenFor(itemId),
          clientAttemptId: attempt,
        });
    }

    it("a NON-finishing answer: stats and session_update start before mastery_emit ends", async () => {
      const sessionId = await start(10, "overlap-nonfinishing");
      const itemId = await firstItem(sessionId);
      harness.latencyMs = 5;
      const res = await answer(sessionId, itemId, "overlap-attempt-1");
      harness.latencyMs = 0;
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("active");

      const steps = answerSteps();
      const mastery = steps.mastery_emit!;
      expect(mastery.ms!).toBeGreaterThanOrEqual(MASTERY_EXTRA_MS - 2); // presence
      expect(steps.stats!.at_ms).toBeLessThan(endOf(mastery));
      expect(steps.session_update!.at_ms).toBeLessThan(endOf(mastery));
      expect(endOf(steps.session_update!)).toBeLessThan(endOf(mastery));

      const row = await harness.setup!.query(
        `SELECT status FROM public.practice_sessions WHERE id = $1`,
        [sessionId],
      );
      expect(row.rows[0].status).toBe("active");
      expect(await masteryEvents(itemId)).toBe(1);

      // Replay: same answer, same attempt id — idempotent, still one mastery event.
      const replay = await answer(sessionId, itemId, "overlap-attempt-1");
      expect(replay.status).toBe(200);
      expect(replay.body.idempotentRetried).toBe(true);
      expect(replay.body.isCorrect).toBe(res.body.isCorrect);
      expect(await masteryEvents(itemId)).toBe(1);
    });

    it("a FINISHING answer: session_update waits for mastery_emit, and completion follows the saved event", async () => {
      const sessionId = await start(1, "overlap-finishing");
      const itemId = await firstItem(sessionId);
      // Watch the session row while the answer runs: the first time it reads `completed`, the
      // item's mastery event must already be saved.
      let stop = false;
      const poll = (async () => {
        while (!stop) {
          const r = await harness.setup!.query(
            `SELECT s.status,
                    EXISTS (SELECT 1 FROM public.mastery_event_audit_log m
                             WHERE m.event_id = $2) AS has_event
               FROM public.practice_sessions s WHERE s.id = $1`,
            [sessionId, itemId],
          );
          watch.polls += 1;
          if (r.rows[0]?.status === "completed") {
            if (!r.rows[0].has_event) watch.sawCompletedBeforeEvent = true;
            return;
          }
          await new Promise((res) => setTimeout(res, 2));
        }
      })();
      const res = await answer(sessionId, itemId, "overlap-attempt-2");
      stop = true;
      await poll;
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("completed");
      expect(watch.polls).toBeGreaterThan(1); // presence: the watcher really ran during the answer
      expect(watch.sawCompletedBeforeEvent).toBe(false);

      const steps = answerSteps();
      const mastery = steps.mastery_emit!;
      expect(mastery.ms!).toBeGreaterThanOrEqual(MASTERY_EXTRA_MS - 2);
      expect(steps.session_update!.at_ms).toBeGreaterThanOrEqual(
        endOf(mastery) - 0.2,
      );
      expect(await masteryEvents(itemId)).toBe(1);

      // Replay after completion: the session is no longer open, so the route answers 409 — as it did
      // before this change (the replay path is untouched) — and writes no second mastery event.
      const replay = await answer(sessionId, itemId, "overlap-attempt-2");
      expect(replay.status).toBe(409);
      expect(await masteryEvents(itemId)).toBe(1);
    });
  },
);
