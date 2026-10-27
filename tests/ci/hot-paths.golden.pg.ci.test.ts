/**
 * Hot paths — golden regression over the real routes and real PostgreSQL.
 *
 * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2: "a regression test that each
 *        path's results are unchanged (golden comparison against the real route, before vs
 *        after)"; Doc-02B_V4 §14 (resumable sessions, idempotent submit), §16 (option tokens),
 *        §20 (reveal matrix); Doc-05F_V1.0 §15 (GET /api/calendar), §8 item 19 (timezone fall-open);
 *        Coding Standards §4.2, §5.2] | @implemented [2026-10-13]
 *
 * plain English: drives practice session start (new and replayed), answer submit (correct,
 * replayed, and the one that completes a session), review session start, the calendar read
 * (set-up and pre-setup, with a known and an unknown device zone) and the practice-topics
 * catalog through the REAL routers, then normalises each response and the rows it wrote —
 * uuids, timestamps and the random option tokens masked — into one record per path.
 *
 * HOW "UNCHANGED" IS PROVEN. The date-independent records (practice, answer, review, topics,
 * pre-setup calendar) are pinned in `tests/ci/__golden__/hot-paths.*.json`, which were RECORDED ON origin/cleanup
 * before the performance pass and is asserted unchanged after it. The set-up calendar read
 * depends on today's date (a 14-day window from the student's local today), so it cannot be a
 * committed snapshot; it is asserted structurally here, and the before/after comparison of its
 * full record was made by running this file on both trees on the same day with
 * `HOT_PATHS_GOLDEN_OUT` set (PR description, "Golden comparison").
 *
 * ANTI-LEAK: the session-start responses carry no question, and the review/practice pre-submit
 * state is checked through the DB rows only; the post-submit answer reveals the explanation
 * and the served token of the correct option, exactly as before (Doc 02B §20). Answer checking
 * stays server-side: the client sends a served token and the server grades it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import type { Express } from "express";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  NEW_STUDENT,
  STUDENT,
  bootHarness,
  buildApp,
  closeOpenSessions,
  correctTokenFor,
  harness,
  sequentialDepth,
  setupBody,
  shutdownHarness,
} from "../perf/hot-paths.harness";

/** Sequential waits in one warm `GET /api/calendar` (see the calendar test below). */
const CALENDAR_READ_DEPTH = 5;

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
/** Keys whose values are random served option tokens (Doc 02B §16), masked by key. */
const TOKEN_KEYS = new Set(["correctOptionId"]);
/** Keys that only correlate a request; never part of the behaviour being compared. */
const DROP_KEYS = new Set(["requestId"]);

function normalise(value: unknown, key = ""): unknown {
  if (TOKEN_KEYS.has(key) && typeof value === "string") return "<token>";
  if (typeof value === "string") {
    if (UUID.test(value)) return "<uuid>";
    if (ISO_TS.test(value)) return "<ts>";
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => normalise(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      if (DROP_KEYS.has(k)) continue;
      out[k] = normalise((value as Record<string, unknown>)[k], k);
    }
    return out;
  }
  return value;
}

async function rows(sql: string, params: unknown[]): Promise<unknown[]> {
  if (!harness.setup) throw new Error("harness not booted");
  return (await harness.setup.query(sql, params)).rows;
}

/** The practice items a session wrote, in ordinal order, tokens reduced to presence. */
async function practiceItems(sessionId: string): Promise<unknown> {
  const items = await rows(
    `SELECT ordinal, status, question_id, is_correct, outcome,
            option_order IS NOT NULL AS has_order,
            option_token_map IS NOT NULL AS has_tokens,
            cardinality(option_order) AS order_len
       FROM public.practice_session_items WHERE session_id = $1 ORDER BY ordinal`,
    [sessionId],
  );
  return {
    // Selection is ORDER BY random() over the filter, so the SET is the contract, not the order.
    question_ids: (items as Array<{ question_id: string }>)
      .map((i) => i.question_id)
      .sort(),
    by_ordinal: (items as Array<Record<string, unknown>>).map((i) => ({
      ordinal: i.ordinal,
      status: i.status,
      is_correct: i.is_correct,
      outcome: i.outcome,
      has_order: i.has_order,
      has_tokens: i.has_tokens,
      order_len: i.order_len,
    })),
  };
}

/**
 * A post-submit answer body with its explanation checked against the item it answered and then
 * masked. The first item of a session is a random draw from the filter, so the explanation text
 * varies run to run; WHICH item's explanation is revealed is the contract, and is asserted here.
 */
async function revealed(body: Record<string, unknown>): Promise<unknown> {
  const [item] = (await rows(
    `SELECT question_id FROM public.practice_session_items WHERE id = $1`,
    [body.sessionItemId],
  )) as Array<{ question_id: string }>;
  expect(body.explanation).toBe(`Expl ${item!.question_id}`);
  return normalise({
    ...body,
    explanation: "<explanation of the answered item>",
  });
}

async function practiceSession(sessionId: string): Promise<unknown> {
  const [row] = (await rows(
    `SELECT status, mode, target_count, platform, client_instance_id, filters,
            completed_at IS NOT NULL AS completed
       FROM public.practice_sessions WHERE id = $1`,
    [sessionId],
  )) as Array<Record<string, unknown>>;
  return normalise(row);
}

const golden: Record<string, unknown> = {};

/**
 * The pinned record as JSON. A JSON file rather than a vitest `.snap`, because the
 * fixture-canonicality gate parses `.json` (and has no parser for `.snap`): the `section`
 * values a golden record carries are checked against the database CHECKs like any fixture.
 */
function goldenJson(record: unknown): string {
  return JSON.stringify(record, null, 2) + "\n";
}

describe.skipIf(!PG_AVAILABLE)(
  "hot paths: golden regression (real routes, real PG)",
  () => {
    let app: Express;

    beforeAll(async () => {
      await bootHarness("hot_paths_golden_ci");
      app = await buildApp();
    }, 240_000);

    afterAll(async () => {
      const out = process.env.HOT_PATHS_GOLDEN_OUT;
      if (out) fs.writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
      await shutdownHarness();
    });

    it("practice session start: a new session, then its idempotent replay", async () => {
      harness.actingStudent = STUDENT;
      const body = {
        sections: ["M"],
        domains: ["Algebra"],
        target_question_count: 10,
        idempotency_key: "golden-practice-start-1",
        client_instance_id: "golden-client",
      };
      const created = await request(app)
        .post("/api/practice/sessions")
        .send(body);
      expect(created.status).toBe(200);
      // Presence before absence: the payload is a real session.
      expect(created.body.sessionId).toMatch(UUID);
      const replay = await request(app)
        .post("/api/practice/sessions")
        .send(body);
      expect(replay.status).toBe(200);
      expect(replay.body.sessionId).toBe(created.body.sessionId);

      const record = {
        created: normalise(created.body),
        replay: normalise(replay.body),
        session: await practiceSession(created.body.sessionId),
        items: await practiceItems(created.body.sessionId),
      };
      golden.practice_start = record;
      await expect(goldenJson(record)).toMatchFileSnapshot(
        "./__golden__/hot-paths.practice_start.json",
      );
    });

    it("answer submit: correct, replayed, and an answer to an item not yet served", async () => {
      harness.actingStudent = STUDENT;
      // Self-contained: the same start body as the test above, so this is that session — created
      // here when this test runs alone, an idempotent replay (no change to the record) otherwise.
      const start = await request(app)
        .post("/api/practice/sessions")
        .send({
          sections: ["M"],
          domains: ["Algebra"],
          target_question_count: 10,
          idempotency_key: "golden-practice-start-1",
          client_instance_id: "golden-client",
        });
      expect(start.status).toBe(200);
      const session = { id: start.body.sessionId as string };
      const [first, second] = (await rows(
        `SELECT id FROM public.practice_session_items
        WHERE session_id = $1 ORDER BY ordinal LIMIT 2`,
        [session.id],
      )) as Array<{ id: string }>;
      const token = await correctTokenFor(first!.id);

      const answer = {
        sessionId: session.id,
        sessionItemId: first!.id,
        selectedAnswer: token,
        clientAttemptId: "golden-attempt-1",
      };
      const correct = await request(app)
        .post("/api/practice/answer")
        .send(answer);
      expect(correct.status).toBe(200);
      expect(correct.body.isCorrect).toBe(true);
      const replay = await request(app)
        .post("/api/practice/answer")
        .send(answer);
      expect(replay.status).toBe(200);
      expect(replay.body.idempotentRetried).toBe(true);
      const notServed = await request(app).post("/api/practice/answer").send({
        sessionId: session.id,
        sessionItemId: second!.id,
        selectedAnswer: token,
        clientAttemptId: "golden-attempt-2",
      });

      const record = {
        correct: await revealed(correct.body),
        replay: await revealed(replay.body),
        not_served: {
          status: notServed.status,
          body: normalise(notServed.body),
        },
        session: await practiceSession(session.id),
        items: await practiceItems(session.id),
      };
      golden.answer_submit = record;
      await expect(goldenJson(record)).toMatchFileSnapshot(
        "./__golden__/hot-paths.answer_submit.json",
      );
    });

    it("answer submit that completes a one-question session", async () => {
      harness.actingStudent = STUDENT;
      await closeOpenSessions();
      const created = await request(app)
        .post("/api/practice/sessions")
        .send({
          sections: ["RW"],
          domains: ["Craft and Structure"],
          // One candidate only (CRS.S0 at medium difficulty is SATRW1CRS004), so the row is fixed.
          skills: ["CRS.S0"],
          difficulties: ["medium"],
          target_question_count: 1,
          idempotency_key: "golden-practice-start-2",
          client_instance_id: "golden-client",
        });
      expect(created.status).toBe(200);
      const [item] = (await rows(
        `SELECT id FROM public.practice_session_items WHERE session_id = $1`,
        [created.body.sessionId],
      )) as Array<{ id: string }>;
      // A wrong answer this time: any served token that does not map to the key.
      const [mapRow] = (await rows(
        `SELECT option_token_map, question_correct_answer
         FROM public.practice_session_items WHERE id = $1`,
        [item!.id],
      )) as Array<{
        option_token_map: Record<string, string>;
        question_correct_answer: string;
      }>;
      const wrong = Object.entries(mapRow!.option_token_map).find(
        ([, key]) => key !== mapRow!.question_correct_answer,
      )![0];

      const res = await request(app).post("/api/practice/answer").send({
        sessionId: created.body.sessionId,
        sessionItemId: item!.id,
        selectedAnswer: wrong,
        clientAttemptId: "golden-attempt-3",
      });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("completed");

      const record = {
        answer: await revealed(res.body),
        session: await practiceSession(created.body.sessionId),
        items: await practiceItems(created.body.sessionId),
      };
      golden.answer_completes = record;
      await expect(goldenJson(record)).toMatchFileSnapshot(
        "./__golden__/hot-paths.answer_completes.json",
      );
    });

    it("review session start: the open queue, oldest mistake first, then its replay", async () => {
      harness.actingStudent = STUDENT;
      await closeOpenSessions();
      const body = {
        mode: "queue",
        idempotency_key: "golden-review-start-1",
        client_instance_id: "golden-client",
      };
      const created = await request(app)
        .post("/api/review/sessions")
        .send(body);
      expect(created.status).toBe(200);
      expect(created.body.sessionId).toMatch(UUID);
      const replay = await request(app).post("/api/review/sessions").send(body);
      expect(replay.status).toBe(200);

      const items = await rows(
        `SELECT ordinal, status, question_id,
              option_order IS NOT NULL AS has_order,
              option_token_map IS NOT NULL AS has_tokens,
              queue_entry_id IS NOT NULL AS has_queue_entry
         FROM public.review_session_items WHERE session_id = $1 ORDER BY ordinal`,
        [created.body.sessionId],
      );
      const [session] = (await rows(
        `SELECT status, mode, target_count, filters FROM public.review_sessions WHERE id = $1`,
        [created.body.sessionId],
      )) as Array<Record<string, unknown>>;

      const record = {
        created: normalise(created.body),
        replay: normalise(replay.body),
        session: normalise(session),
        items,
      };
      golden.review_start = record;
      await expect(goldenJson(record)).toMatchFileSnapshot(
        "./__golden__/hot-paths.review_start.json",
      );
    });

    it("practice topics: the catalog, read twice, is the same both times", async () => {
      harness.actingStudent = STUDENT;
      const first = await request(app).get("/api/practice/topics");
      const second = await request(app).get("/api/practice/topics");
      expect(first.status).toBe(200);
      expect(normalise(second.body)).toEqual(normalise(first.body));
      golden.practice_topics = normalise(first.body);
      await expect(goldenJson(golden.practice_topics)).toMatchFileSnapshot(
        "./__golden__/hot-paths.practice_topics.json",
      );
    });

    it("calendar read, pre-setup: a known device zone is offered, an unknown one falls open", async () => {
      harness.actingStudent = NEW_STUDENT;
      const known = await request(app).get(
        "/api/calendar?device_timezone=America/New_York",
      );
      const unknown = await request(app).get(
        "/api/calendar?device_timezone=Mars/Olympus",
      );
      const knownAgain = await request(app).get(
        "/api/calendar?device_timezone=America/New_York",
      );
      expect(known.status).toBe(200);
      expect(known.body.status).toBe("setup_required");
      expect(known.body.defaults.timezone).toBe("America/New_York");
      expect(unknown.body.defaults.timezone).toBe("America/Chicago");
      expect(normalise(knownAgain.body)).toEqual(normalise(known.body));

      const record = {
        known: normalise(known.body),
        unknown: normalise(unknown.body),
      };
      golden.calendar_presetup = record;
      await expect(goldenJson(record)).toMatchFileSnapshot(
        "./__golden__/hot-paths.calendar_presetup.json",
      );
    });

    it("calendar read, set up and entitled: a full ready payload, identical on a second read", async () => {
      harness.actingStudent = STUDENT;
      const put = await request(app)
        .put("/api/calendar/profile")
        .send(setupBody());
      expect(put.status).toBe(200);

      const first = await request(app).get("/api/calendar");
      expect(first.status).toBe(200);
      // The second read runs with 10 ms per round trip, to measure its dependency depth (owner
      // ruling 2026-10-15 on #1238). Its body must still equal the first's.
      harness.latencyMs = 10;
      const intervalsFrom = harness.intervals.length;
      const second = await Promise.resolve(
        request(app).get("/api/calendar"),
      ).finally(() => {
        harness.latencyMs = 0;
      });
      expect(second.status).toBe(200);
      expect(normalise(second.body)).toEqual(normalise(first.body));
      // Profile, the feature row and the entitlement predicate together; then the probe, the
      // streak's two reads, the diagnostic and the projection together (config cached); then the
      // plan; then blocks, launch rows and snapshots; then activity. Was 9 before this change.
      expect(sequentialDepth(harness.intervals.slice(intervalsFrom))).toBe(
        CALENDAR_READ_DEPTH,
      );
      // COLD (config cache empty): the two config reads and the cache's lifetime row run together
      // and alongside the probe/streak/diagnostic/projection wave, so a cold read is no deeper.
      const { invalidateCalendarConfigCache } =
        await import("../../server/services/calendar/config");
      invalidateCalendarConfigCache();
      harness.latencyMs = 10;
      const coldFrom = harness.intervals.length;
      const third = await Promise.resolve(
        request(app).get("/api/calendar"),
      ).finally(() => {
        harness.latencyMs = 0;
      });
      expect(third.status).toBe(200);
      expect(normalise(third.body)).toEqual(normalise(first.body));
      expect(sequentialDepth(harness.intervals.slice(coldFrom))).toBe(
        CALENDAR_READ_DEPTH,
      );

      // Presence: a ready plan with a 14-day window that carries blocks.
      expect(first.body.status).toBe("ready");
      expect(first.body.days).toHaveLength(14);
      const blocks = (first.body.days as Array<{ blocks: unknown[] }>).flatMap(
        (d) => d.blocks,
      );
      expect(blocks.length).toBeGreaterThan(0);
      expect(Object.keys(first.body).sort()).toEqual(
        [
          "bounds",
          "days",
          "diagnostic_state",
          "enabled_block_types",
          "estimates",
          "exam_planning",
          "facts",
          "full_length_suppressions",
          "latest_unacknowledged_nonstudent_change",
          "profile",
          "requestId",
          "status",
          "streak",
        ].sort(),
      );
      golden.calendar_ready = normalise(first.body);
    });
  },
);
