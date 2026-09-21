/**
 * Review queue end-to-end → real PostgreSQL.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §1/§3; brief R3 §4 "at least one integration test"]
 * @implemented [2026-09-21]
 *
 * The five steps brief R3 §4 names, in one run, against a database with the real
 * migrations applied:
 *   1. a practice miss enqueues (via the REAL trg_practice_item_enqueue_review);
 *   2. review create prefills that question;
 *   3. a wrong answer requeues it at the back of the line;
 *   4. a correct answer graduates it;
 *   5. canonical_mastery_events returns the review event.
 *
 * WHY THIS AND NOT MORE UNIT TESTS. Mocks cannot catch a column mismatch, and a column
 * mismatch is exactly what killed the previous review vertical: TypeScript written
 * against a schema that was never applied. Every write here goes through the real
 * schema, the real CHECK constraints and the real triggers. The practice miss in step 1
 * is submitted through practice's own `/api/practice/answer` handler, so the seam
 * between the two engines is exercised rather than simulated.
 *
 * LIMITS: the transport is `makePgSupabase`, not PostgREST, and the connection is the
 * superuser, so this proves neither wire behaviour nor any GRANT.
 * `scripts/ci/review-queue-gates.sql` covers grants, RLS and the column-level
 * reveal matrix.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { Client } from "pg";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "review_queue_e2e_ci";

const STUDENT = "55555555-5555-5555-5555-555555555555";
const PRACTICE_SESSION = "66666666-6666-6666-6666-666666666666";
const PRACTICE_ITEM = "77777777-7777-7777-7777-777777777777";
const QUESTION = "SATM1EEEEEE";

let testPg: Client | null = null;

function pgProxy() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        return (makePgSupabase(testPg) as Record<string, unknown>)[
          prop as string
        ];
      },
    },
  );
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: pgProxy(),
}));

vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    if (!testPg) throw new Error("PG client not initialised");
    return makePgSupabase(testPg);
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
    requireConsentCompliance: (_q: Request, _s: Response, next: NextFunction) =>
      next(),
    getSupabaseAdmin: () => {
      if (!testPg) throw new Error("PG client not initialised");
      return makePgSupabase(testPg);
    },
  };
}

vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

describe.skipIf(!PG_AVAILABLE)("Review queue end-to-end → real PG", () => {
  let app: Express;

  beforeAll(async () => {
    testPg = await bootstrapPgDatabase(DB_NAME);

    await testPg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,'e2e@example.test')`,
      [STUDENT],
    );
    await testPg.query(
      `INSERT INTO public.profiles (id, email, role)
       VALUES ($1,'e2e@example.test','student')`,
      [STUDENT],
    );
    await testPg.query(
      `INSERT INTO public.questions
         (id, section, source_type, domain, skill_codes, difficulty, stem, options,
          correct_answer, explanation, option_metadata, status, item_type, published_at)
       VALUES ($1,'M',1,'Algebra',ARRAY['ALG.D01'],2,'E2E stem',
         '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
         'B','E2E explanation',
         '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
         'published','mcq', now())`,
      [QUESTION],
    );

    // A practice session with one SERVED item, the state practice's answer handler
    // expects. `prebuilt` matters: the handler refuses to serve an unmaterialized
    // session, and the answer path reads the same metadata.
    await testPg.query(
      `INSERT INTO public.practice_sessions
         (id, user_id, actor_id, mode, filters, target_count, platform, status)
       VALUES ($1,$2,$2,'flow',
         '{"target_question_count":1,"prebuilt":true,"client_instance_id":"e2e-1"}'::jsonb,
         1,'web','active')`,
      [PRACTICE_SESSION, STUDENT],
    );
    await testPg.query(
      `INSERT INTO public.practice_session_items
         (id, session_id, user_id, actor_id, ordinal, question_id, question_stem,
          question_options, question_correct_answer, question_explanation,
          question_option_metadata, question_domain, question_skill,
          question_difficulty, question_section, status, question_item_type,
          option_order, option_token_map, served_at, client_instance_id)
       VALUES ($1,$2,$3,$3,1,$4,'E2E stem',
         '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
         'B','E2E explanation',
         '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
         'Algebra','ALG.D01',2,'M','served','mcq',
         ARRAY['A','B','C','D']::text[],
         '{"tok_a":"A","tok_b":"B","tok_c":"C","tok_d":"D"}'::jsonb,
         now(),'e2e-1')`,
      [PRACTICE_ITEM, PRACTICE_SESSION, STUDENT, QUESTION],
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
    await testPg?.end();
    testPg = null;
  });

  async function reviewTokenFor(itemId: string, key: string): Promise<string> {
    const r = await testPg!.query(
      `SELECT option_token_map FROM public.review_session_items WHERE id = $1`,
      [itemId],
    );
    const map = r.rows[0].option_token_map as Record<string, string>;
    const hit = Object.entries(map).find(([, v]) => v === key);
    if (!hit) throw new Error(`no token for ${key}`);
    return hit[0];
  }

  it("a practice miss reaches the queue, is reviewed, requeues, then graduates", async () => {
    // ---- 1. A practice miss enqueues -------------------------------------
    // Submitted through practice's own handler, so the trigger fires on the same
    // UPDATE production issues rather than on a hand-written imitation.
    const practiceAnswer = await request(app)
      .post("/api/practice/answer")
      .send({
        sessionId: PRACTICE_SESSION,
        sessionItemId: PRACTICE_ITEM,
        selectedAnswer: "tok_a", // canonical key A — wrong, the key is B
        client_instance_id: "e2e-1",
      });
    expect(practiceAnswer.status).toBe(200);
    expect(practiceAnswer.body.isCorrect).toBe(false);

    const enqueued = await testPg!.query(
      `SELECT id, status, source_engine, source_outcome, source_item_id, queued_at
         FROM public.review_schedule WHERE student_id = $1`,
      [STUDENT],
    );
    expect(enqueued.rowCount).toBe(1);
    expect(enqueued.rows[0].status).toBe("active");
    expect(enqueued.rows[0].source_engine).toBe("practice");
    expect(enqueued.rows[0].source_outcome).toBe("incorrect");
    expect(enqueued.rows[0].source_item_id).toBe(PRACTICE_ITEM);
    const firstQueuedAt = new Date(enqueued.rows[0].queued_at).getTime();

    // ---- 2. Review create prefills that question -------------------------
    const created = await request(app)
      .post("/api/review/sessions")
      .send({ mode: "queue", client_instance_id: "e2e-r1" });
    expect(created.status).toBe(200);
    const reviewSessionId = created.body.sessionId as string;

    const prefilled = await testPg!.query(
      `SELECT id, question_id, queue_entry_id, status
         FROM public.review_session_items WHERE session_id = $1`,
      [reviewSessionId],
    );
    expect(prefilled.rowCount).toBe(1);
    expect(prefilled.rows[0].question_id).toBe(QUESTION);
    // The item points back at the entry it is working off — the link the deletion
    // cascade and the G15 rehearsal both reason about.
    expect(String(prefilled.rows[0].queue_entry_id)).toBe(
      String(enqueued.rows[0].id),
    );

    // ---- 3. A wrong answer requeues it at the back -----------------------
    const firstServe = await request(app)
      .get(`/api/review/sessions/${reviewSessionId}/next`)
      .query({ client_instance_id: "e2e-r1" });
    expect(firstServe.status).toBe(200);
    const wrongItemId = firstServe.body.sessionItemId as string;

    const wrong = await request(app)
      .post("/api/review/answer")
      .send({
        sessionId: reviewSessionId,
        sessionItemId: wrongItemId,
        selectedAnswer: await reviewTokenFor(wrongItemId, "C"),
      });
    expect(wrong.status).toBe(200);
    expect(wrong.body.isCorrect).toBe(false);

    const afterWrong = await testPg!.query(
      `SELECT status, source_engine, source_outcome, queued_at, closed_at
         FROM public.review_schedule WHERE student_id = $1
         ORDER BY created_at ASC`,
      [STUDENT],
    );
    expect(afterWrong.rowCount).toBe(2);
    const superseded = afterWrong.rows.find((r) => r.status === "superseded");
    const reopened = afterWrong.rows.find((r) => r.status === "active");
    expect(superseded).toBeDefined();
    expect(superseded!.closed_at).not.toBeNull();
    expect(reopened).toBeDefined();
    expect(reopened!.source_engine).toBe("review");
    expect(reopened!.source_outcome).toBe("incorrect");
    // "Back of the line" is an ordering claim (ruling 7): an entry requeued at its
    // original timestamp would be served FIRST.
    expect(new Date(reopened!.queued_at).getTime()).toBeGreaterThan(
      firstQueuedAt,
    );

    // ---- 4. A correct answer graduates it --------------------------------
    const secondSession = await request(app)
      .post("/api/review/sessions")
      .send({ mode: "queue", client_instance_id: "e2e-r2" });
    expect(secondSession.status).toBe(200);
    const secondId = secondSession.body.sessionId as string;

    const secondServe = await request(app)
      .get(`/api/review/sessions/${secondId}/next`)
      .query({ client_instance_id: "e2e-r2" });
    expect(secondServe.status).toBe(200);
    const rightItemId = secondServe.body.sessionItemId as string;

    const right = await request(app)
      .post("/api/review/answer")
      .send({
        sessionId: secondId,
        sessionItemId: rightItemId,
        selectedAnswer: await reviewTokenFor(rightItemId, "B"),
      });
    expect(right.status).toBe(200);
    expect(right.body.isCorrect).toBe(true);

    const open = await testPg!.query(
      `SELECT count(*)::int AS c FROM public.review_schedule
        WHERE student_id = $1 AND status = 'active'`,
      [STUDENT],
    );
    expect(open.rows[0].c).toBe(0);

    const graduated = await testPg!.query(
      `SELECT closed_by_item_id FROM public.review_schedule
        WHERE student_id = $1 AND status = 'graduated'`,
      [STUDENT],
    );
    expect(graduated.rowCount).toBe(1);
    expect(String(graduated.rows[0].closed_by_item_id)).toBe(rightItemId);

    // ---- 5. canonical_mastery_events returns the review event ------------
    const events = await testPg!.query(
      `SELECT event_id, event_source_kind, source_family, correct
         FROM public.canonical_mastery_events($1,'skill','M','Algebra','ALG.D01')`,
      [STUDENT],
    );
    const reviewEvents = events.rows.filter(
      (r) => r.source_family === "review",
    );
    expect(reviewEvents).toHaveLength(2);
    for (const e of reviewEvents) {
      expect(e.event_source_kind).toBe("review_error_attempt");
    }
    // The event id is the review ITEM id (ruling 11), which is what makes the mastery
    // seam idempotent: the trigger wrote review_error_attempts.id = the item id.
    const eventIds = reviewEvents.map((e) => String(e.event_id)).sort();
    expect(eventIds).toEqual([wrongItemId, rightItemId].sort());
    expect(
      reviewEvents.find((e) => String(e.event_id) === rightItemId)!.correct,
    ).toBe(true);
    expect(
      reviewEvents.find((e) => String(e.event_id) === wrongItemId)!.correct,
    ).toBe(false);

    // The practice miss is still its own event, from the other seam.
    const practiceEvents = events.rows.filter(
      (r) => r.source_family === "practice",
    );
    expect(practiceEvents).toHaveLength(1);
    expect(String(practiceEvents[0].event_id)).toBe(PRACTICE_ITEM);
  }, 120_000);
});
