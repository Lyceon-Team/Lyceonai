/**
 * The end-of-session summary → real PG proof (practice and review).
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 3 ("score, streak
 *        kept, items sent to review, mastery change if any … Same pattern for review sessions");
 *        Coding Standards §10 (mastery from observed events only), §5 (no reveal: the summary
 *        carries no question content), §8.3 (404 / 409), §14 (denial tests)]
 *        | @implemented [2026-10-13]
 *
 * plain English: a practice session is played through the REAL routes (create, next, answer,
 * skip), so every row the summary reads (the items, the review queue, the mastery engine's audit
 * rows, the streak) is written by the production code paths, not by hand. Then:
 *   - practice summary: 5 answered, 4 correct, 1 skipped, 2 sent to review (the miss and the
 *     skip), today's streak kept, and the mastery change exactly as the mastery engine recorded it
 *     (presence first: the 5th answered event made the skill measured, so the list is non-empty);
 *   - a free plan (no `mastery_detail`): the same summary with `mastery_changes: null`;
 *   - review: a queue review of those two entries, one right and one wrong, summarised the same
 *     way (`again` is the queue);
 *   - denials: another student's session is 404, an open session is 409;
 *   - anti-leak: no question text, answer, explanation, option token or item id anywhere in the
 *     body; the body parses against the strict shared schema.
 *
 * LIMITS: auth is a stand-in and the Supabase client is `makePgSupabase` over node-pg (as
 * practice-runner.pg.ci.test.ts). The entitlement read is spied, not seeded: what is under test is
 * the summary's gate on it, not the entitlement service.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import pg from "pg";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  pgConnConfig,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { sessionSummarySchema } from "../../packages/shared/src/session-summary-schema";

const DB_NAME = "session_summary_ci";
const STUDENT = "88888888-8888-4888-8888-888888888888";
const OTHER = "99999999-9999-4999-8999-999999999999";
const CLIENT = "summary-ci";

let setupPg: pg.Client | null = null;
let pool: pg.Pool | null = null;

function poolProxy() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (!pool) throw new Error("PG pool not initialised");
        return (makePgSupabase(pool) as Record<string, unknown>)[
          prop as string
        ];
      },
    },
  );
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: poolProxy(),
}));
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    if (!pool) throw new Error("PG pool not initialised");
    return makePgSupabase(pool);
  },
}));

function authStub() {
  return {
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: unknown }).user = {
        id: STUDENT,
        actor_id: STUDENT,
        role: "student",
      };
      next();
    },
    requireStudentOrAdmin: (_q: Request, _s: Response, next: NextFunction) =>
      next(),
    requireProfileComplete: (_q: Request, _s: Response, next: NextFunction) =>
      next(),
    requireGuardianLinkForUnder13: (
      _q: Request,
      _s: Response,
      next: NextFunction,
    ) => next(),
    getSupabaseAdmin: () => {
      if (!pool) throw new Error("PG pool not initialised");
      return makePgSupabase(pool);
    },
  };
}
vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

const ALGEBRA = Array.from(
  { length: 8 },
  (_, i) => `SATM1SUM${String(i).padStart(3, "0")}`,
);

async function seedQuestion(id: string): Promise<void> {
  await setupPg!.query(
    `INSERT INTO public.questions
       (id, section, source_type, domain, skill_codes, difficulty, stem, options,
        correct_answer, explanation, option_metadata, status, item_type, published_at)
     VALUES ($1,'M',1,'Algebra',$2,1,$3,
       '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
       'C',$4,
       '{"A":{"role":"distractor"},"B":{"role":"distractor"},"C":{"role":"correct"},"D":{"role":"distractor"}}'::jsonb,
       'published','mcq', now())`,
    [id, ["ALG.D01"], `Summary stem ${id}`, `Summary explanation ${id}`],
  );
}

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

/** The served option token for the canonical key `C` (the correct one), from the item's own map. */
async function tokenFor(
  table: "practice_session_items" | "review_session_items",
  itemId: string,
  key: "A" | "C",
): Promise<string> {
  const row = await setupPg!.query(
    `SELECT option_token_map FROM public.${table} WHERE id = $1`,
    [itemId],
  );
  const map = row.rows[0]?.option_token_map as Record<string, string> | null;
  if (!map) throw new Error(`no option_token_map on ${itemId}`);
  for (const [k, v] of Object.entries(map)) {
    if (v === key) return k;
    if (k === key) return v;
  }
  throw new Error(`no token for ${key} on ${itemId}`);
}

describe.skipIf(!PG_AVAILABLE)("session summary → real PG", () => {
  let app: Express;
  let entitlementSpy: ReturnType<typeof vi.spyOn>;
  let masteryGranted = true;
  let practiceSessionId = "";
  const practiceItemIds: string[] = [];

  beforeAll(async () => {
    setupPg = await bootstrapPgDatabase(DB_NAME);
    for (const [id, email] of [
      [STUDENT, "summary@example.test"],
      [OTHER, "other@example.test"],
    ] as const) {
      await setupPg.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
        id,
        email,
      ]);
      await setupPg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1,$2,'student')`,
        [id, email],
      );
    }
    for (const id of ALGEBRA) await seedQuestion(id);
    pool = new pg.Pool({ ...pgConnConfig(DB_NAME), max: 8 });

    const { EntitlementService } =
      await import("../../server/services/entitlement-service");
    entitlementSpy = vi
      .spyOn(EntitlementService, "canAccessFeature")
      .mockImplementation(async (_id: string, key: string) =>
        key === "mastery_detail" ? masteryGranted : false,
      );

    const { default: practiceRouter } =
      await import("../../server/routes/practice-canonical");
    const { default: reviewRouter } =
      await import("../../server/routes/review-canonical");
    const { requireSupabaseAuth, requireStudentOrAdmin } =
      await import("../../server/middleware/supabase-auth.js");
    app = express();
    app.use(express.json());
    app.use(
      "/api/practice",
      requireSupabaseAuth,
      requireStudentOrAdmin,
      practiceRouter,
    );
    app.use(
      "/api/review",
      requireSupabaseAuth,
      requireStudentOrAdmin,
      reviewRouter,
    );
  }, 240_000);

  afterAll(async () => {
    entitlementSpy?.mockRestore();
    await pool?.end();
    pool = null;
    await setupPg?.end();
    setupPg = null;
  });

  async function playPractice(): Promise<void> {
    const created = await request(app)
      .post("/api/practice/sessions")
      .send({
        sections: ["M"],
        domains: ["Algebra"],
        target_question_count: 6,
        client_instance_id: CLIENT,
        idempotency_key: "summary-practice",
      });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    practiceSessionId = created.body.sessionId as string;
    // correct, wrong, skip, correct, correct, correct
    const plan = ["C", "A", "skip", "C", "C", "C"] as const;
    for (let i = 0; i < plan.length; i += 1) {
      const next = await request(app).get(
        `/api/practice/sessions/${practiceSessionId}/next?client_instance_id=${CLIENT}`,
      );
      expect(next.status, JSON.stringify(next.body)).toBe(200);
      const itemId = next.body.sessionItemId as string;
      practiceItemIds.push(itemId);
      const step = plan[i]!;
      if (step === "skip") {
        const skipped = await request(app)
          .post(`/api/practice/sessions/${practiceSessionId}/skip`)
          .send({
            sessionItemId: itemId,
            clientAttemptId: `sum-skip-${i}`,
            client_instance_id: CLIENT,
          });
        expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
        continue;
      }
      const answered = await request(app)
        .post("/api/practice/answer")
        .send({
          sessionId: practiceSessionId,
          sessionItemId: itemId,
          selectedOptionId: await tokenFor(
            "practice_session_items",
            itemId,
            step,
          ),
          clientAttemptId: `sum-${i}`,
          client_instance_id: CLIENT,
        });
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
      expect(answered.body.isCorrect).toBe(step === "C");
    }
    // "Done": the server closes the session on the /next after the last item.
    const closed = await request(app).get(
      `/api/practice/sessions/${practiceSessionId}/next?client_instance_id=${CLIENT}`,
    );
    expect(closed.status).toBe(409);
    const status = await setupPg!.query(
      `SELECT status FROM public.practice_sessions WHERE id = $1`,
      [practiceSessionId],
    );
    expect(status.rows[0]?.status).toBe("completed");
  }

  /** What the mastery engine recorded for these items: first before, last after, per skill. */
  async function recordedChanges(
    itemIds: readonly string[],
  ): Promise<
    Array<{ skill: string; before: number | null; after: number | null }>
  > {
    const rows = await setupPg!.query(
      `SELECT skill,
              (array_agg(mastery_level_before ORDER BY event_count_after ASC))[1] AS before,
              (array_agg(mastery_level_after ORDER BY event_count_after DESC))[1] AS after
         FROM public.mastery_event_audit_log
        WHERE student_id = $1 AND event_id = ANY($2::uuid[])
        GROUP BY section, domain, skill`,
      [STUDENT, itemIds],
    );
    return rows.rows
      .map(
        (r: {
          skill: string;
          before: number | null;
          after: number | null;
        }) => ({
          skill: r.skill,
          before: r.before === null ? null : Number(r.before),
          after: r.after === null ? null : Number(r.after),
        }),
      )
      .filter((r) => r.before !== r.after);
  }

  function expectNoContent(body: unknown): void {
    const text = JSON.stringify(body);
    expect(text).not.toContain("Summary stem");
    expect(text).not.toContain("Summary explanation");
    const keys = collectKeys(body, new Set());
    for (const k of [
      "correct_answer",
      "explanation",
      "stem",
      "options",
      "option_token_map",
      "correctOptionId",
      "sessionItemId",
      "question_id",
      "event_id",
      "mastery_score_before",
      "mastery_score_after",
    ])
      expect(keys.has(k), k).toBe(false);
    for (const id of practiceItemIds) expect(text).not.toContain(id);
  }

  it("practice: score, skips, queue entries, streak and the recorded mastery change", async () => {
    await playPractice();
    masteryGranted = true;
    const res = await request(app).get(
      `/api/practice/sessions/${practiceSessionId}/summary`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const summary = sessionSummarySchema.parse(res.body.data);
    expect(summary.engine).toBe("practice");
    expect(summary.answered).toBe(5);
    expect(summary.correct).toBe(4);
    expect(summary.skipped).toBe(1);
    // The miss and the skip, each queued by the database trigger, sourced to this session.
    const queued = await setupPg!.query(
      `SELECT count(*)::int AS n FROM public.review_schedule
        WHERE student_id = $1 AND source_engine = 'practice' AND source_session_id = $2`,
      [STUDENT, practiceSessionId],
    );
    expect(queued.rows[0]?.n).toBe(2);
    expect(summary.sent_to_review).toBe(2);
    expect(summary.streak).toEqual({
      current: 1,
      today_done: true,
      broken: false,
    });
    // Presence first: the engine recorded a level change (unmeasured → measured at the 5th event).
    const recorded = await recordedChanges(practiceItemIds);
    expect(recorded.length).toBeGreaterThan(0);
    expect(summary.mastery_changes).not.toBeNull();
    expect(
      (summary.mastery_changes ?? []).map((c) => ({
        skill: c.skill,
        before: c.before.level,
        after: c.after.level,
      })),
    ).toEqual(recorded);
    for (const c of summary.mastery_changes ?? []) {
      expect(c.before.levelKey).toBe("unmeasured");
      expect(c.after.displayName.length).toBeGreaterThan(0);
    }
    if (summary.engine === "practice")
      expect(summary.again.criteria.domains).toEqual(["Algebra"]);
    expectNoContent(res.body);
  }, 120_000);

  it("each summary counts only its own session's queue entries", async () => {
    // A second practice session, every item skipped: each skip queues one entry for IT.
    const created = await request(app)
      .post("/api/practice/sessions")
      .send({
        sections: ["M"],
        domains: ["Algebra"],
        target_question_count: 5,
        client_instance_id: CLIENT,
        idempotency_key: "summary-practice-2",
      });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const second = created.body.sessionId as string;
    let skipped = 0;
    for (;;) {
      const next = await request(app).get(
        `/api/practice/sessions/${second}/next?client_instance_id=${CLIENT}`,
      );
      if (next.status === 409) break;
      expect(next.status, JSON.stringify(next.body)).toBe(200);
      const res = await request(app)
        .post(`/api/practice/sessions/${second}/skip`)
        .send({
          sessionItemId: next.body.sessionItemId,
          clientAttemptId: `sum2-skip-${skipped}`,
          client_instance_id: CLIENT,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      skipped += 1;
    }
    // Presence first: the second session really queued entries of its own.
    expect(skipped).toBeGreaterThan(0);
    const mine = await request(app).get(
      `/api/practice/sessions/${second}/summary`,
    );
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(sessionSummarySchema.parse(mine.body.data).sent_to_review).toBe(
      skipped,
    );
    const first = await request(app).get(
      `/api/practice/sessions/${practiceSessionId}/summary`,
    );
    expect(sessionSummarySchema.parse(first.body.data).sent_to_review).toBe(2);
  });

  it("practice on a plan without mastery detail: no mastery line at all (null), the rest unchanged", async () => {
    masteryGranted = false;
    const res = await request(app).get(
      `/api/practice/sessions/${practiceSessionId}/summary`,
    );
    masteryGranted = true;
    expect(res.status).toBe(200);
    const summary = sessionSummarySchema.parse(res.body.data);
    expect(summary.answered).toBe(5);
    expect(summary.mastery_changes).toBeNull();
  });

  it("review: a queue review of the two entries, summarised the same way", async () => {
    const created = await request(app).post("/api/review/sessions").send({
      mode: "queue",
      client_instance_id: CLIENT,
      idempotency_key: "summary-review",
      // The queue serves oldest first: the first session's miss and skip.
      target_count: 2,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const reviewId = created.body.sessionId as string;
    const reviewItemIds: string[] = [];
    for (const key of ["C", "A"] as const) {
      const next = await request(app).get(
        `/api/review/sessions/${reviewId}/next?client_instance_id=${CLIENT}`,
      );
      expect(next.status, JSON.stringify(next.body)).toBe(200);
      const itemId = next.body.sessionItemId as string;
      reviewItemIds.push(itemId);
      const answered = await request(app)
        .post("/api/review/answer")
        .send({
          sessionId: reviewId,
          sessionItemId: itemId,
          selectedOptionId: await tokenFor("review_session_items", itemId, key),
          clientAttemptId: `sum-review-${key}`,
          client_instance_id: CLIENT,
        });
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    }
    const closed = await request(app).get(
      `/api/review/sessions/${reviewId}/next?client_instance_id=${CLIENT}`,
    );
    expect(closed.status).toBe(409);

    const res = await request(app).get(
      `/api/review/sessions/${reviewId}/summary`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const summary = sessionSummarySchema.parse(res.body.data);
    expect(summary.engine).toBe("review");
    expect(summary.answered).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.skipped).toBe(0);
    // The wrong answer is queued again, sourced to this review session.
    expect(summary.sent_to_review).toBe(1);
    expect(summary.again).toEqual({ mode: "queue" });
    const recorded = await recordedChanges(reviewItemIds);
    expect(
      (summary.mastery_changes ?? []).map((c) => ({
        skill: c.skill,
        before: c.before.level,
        after: c.after.level,
      })),
    ).toEqual(recorded);
    expectNoContent(res.body);
    for (const id of reviewItemIds)
      expect(JSON.stringify(res.body)).not.toContain(id);
  }, 120_000);

  it("denials: another student's session is 404; an open session is 409", async () => {
    const theirs = await setupPg!.query(
      `INSERT INTO public.practice_sessions
         (user_id, actor_id, mode, filters, target_count, platform, status, completed_at)
       VALUES ($1,$1,'flow','{}'::jsonb,5,'web','completed', now()) RETURNING id`,
      [OTHER],
    );
    const theirId = theirs.rows[0]?.id as string;
    const notMine = await request(app).get(
      `/api/practice/sessions/${theirId}/summary`,
    );
    expect(notMine.status).toBe(404);
    expect(JSON.stringify(notMine.body)).not.toContain('"answered"');

    const open = await request(app)
      .post("/api/practice/sessions")
      .send({
        sections: ["M"],
        domains: ["Algebra"],
        target_question_count: 5,
        client_instance_id: CLIENT,
        idempotency_key: "summary-open",
      });
    expect(open.status).toBe(200);
    const notDone = await request(app).get(
      `/api/practice/sessions/${open.body.sessionId as string}/summary`,
    );
    expect(notDone.status).toBe(409);
    expect(notDone.body.error.code).toBe("SESSION_NOT_COMPLETED");

    const reviewTheirs = await setupPg!.query(
      `INSERT INTO public.review_sessions
         (student_id, actor_id, mode, filters, target_count, platform, status, completed_at)
       VALUES ($1,$1,'queue','{}'::jsonb,1,'web','completed', now()) RETURNING id`,
      [OTHER],
    );
    const reviewNotMine = await request(app).get(
      `/api/review/sessions/${reviewTheirs.rows[0]?.id as string}/summary`,
    );
    expect(reviewNotMine.status).toBe(404);
  });
});
