/**
 * Full-length exam → review: by session and in the complete queue, exactly as practice.
 *
 * @spec [Doc-02B_V4 §16 ("When a student gets a practice or exam question wrong, that
 *        specific question enters their review queue" … "with option to filter by
 *        original practice session or exam"), as amended by ruled-plan ruling 2 (misses
 *        AND skips enter the queue)]
 *       [SCL-154 (post-scoring hand-off), SCL-158 (served items of submitted modules,
 *        wrong → 'incorrect', blank → 'skipped')] | @implemented [2026-10-03]
 *
 * plain English: a real exam is walked through the E6 runtime functions and scored, and
 * its scoring hand-off is consumed exactly as the API does. Then the REAL /api/review
 * routes are driven as the student would:
 *   E1  the exam's wrong and blank items are in the queue as `full_length` entries, one
 *       per served miss, and nothing for a correct answer;
 *   E2  the past-session picker lists the exam like a practice session: dated by when
 *       the test ended, carrying the form's name and nothing else, with its open count;
 *   E3  "review this test" (mode session) serves exactly that exam's open misses;
 *   E4  the complete queue (mode queue) carries the exam's misses AND a practice miss,
 *       side by side, through the same path;
 *   E5  answering an exam miss in review resolves it exactly like a practice miss:
 *       correct graduates it, wrong requeues it at the back — and the requeued question
 *       is still "from that test" in session mode (provenance, as practice's A9);
 *   E6  partial: an abandoned exam enqueues only sections that were submitted —
 *       a section stopped after Module 1 enqueues nothing (SCL-205);
 *   E7  live: an exam that was never scored enqueues nothing and is not in the picker.
 *
 * LIMITS: superuser pg through makePgSupabase, mocked auth. Grants and RLS on the queue
 * are scripts/ci/review-queue-gates.sql's; the seam's own gates are exam-seams-gates.sql.
 * Runs only where PGHOST is set; named by file in CI (.github/workflows/ci.yml).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Client } from "pg";
import fs from "fs";
import path from "path";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "exam_review_handler_ci";
const FORM = "7e100000-0000-4000-8000-0000000000a1";
const STUDENT = "00000000-0000-4000-8000-00000007e101";
const PART_STUDENT = "00000000-0000-4000-8000-00000007e102";
const LIVE_STUDENT = "00000000-0000-4000-8000-00000007e103";
const PRACTICE_SESSION = "7e100000-0000-4000-8000-0000000000b1";
const PRACTICE_ITEM = "7e100000-0000-4000-8000-0000000000b2";
const PRACTICE_QUESTION = "SATM1RVWEXA";

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

/** The caller is the `x-test-user` header; every guard passes. */
function authStub() {
  const pass = (_q: Request, _s: Response, next: NextFunction) => next();
  return {
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      const id = req.header("x-test-user") ?? STUDENT;
      (req as unknown as { user: unknown }).user = {
        id,
        actor_id: id,
        role: "student",
      };
      next();
    },
    requireStudentOrAdmin: pass,
    requireProfileComplete: pass,
    requireConsentCompliance: pass,
    requireGuardianLinkForUnder13: pass,
    getSupabaseAdmin: () => {
      if (!testPg) throw new Error("PG client not initialised");
      return makePgSupabase(testPg);
    },
  };
}
vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

type QueueRow = {
  id: string;
  question_id: string;
  status: string;
  source_engine: string;
  source_session_id: string;
  source_outcome: string;
};

describe.skipIf(!PG_AVAILABLE)(
  "exam → review (by session, complete queue) → real PG",
  () => {
    let app: Express;
    let examSid = "";
    let partSid = "";
    let liveSid = "";

    async function queue(student: string): Promise<QueueRow[]> {
      const r = await testPg!.query(
        `SELECT id::text, question_id, status, source_engine,
              source_session_id::text, source_outcome
         FROM public.review_schedule WHERE student_id = $1
        ORDER BY created_at, id`,
        [student],
      );
      return r.rows as QueueRow[];
    }

    /** What the seam must have queued: served items of submitted modules, wrong or blank. */
    async function expectedMisses(
      sid: string,
    ): Promise<Array<{ question_id: string; outcome: string }>> {
      const r = await testPg!.query(
        `SELECT i.question_id,
              CASE WHEN a.answer IS NULL OR btrim(a.answer) = '' THEN 'skipped'
                   ELSE 'incorrect' END AS outcome
         FROM public.test_session_items i
         JOIN public.test_session_sections sec
           ON sec.test_session_id = i.test_session_id AND sec.section = i.section
         LEFT JOIN public.test_session_answers a
           ON a.test_session_id = i.test_session_id AND a.section = i.section
          AND a.module = i.module AND a.ordinal = i.ordinal
        WHERE i.test_session_id = $1
          AND sec.state = 'submitted'
          AND NOT public.is_answer_correct(a.answer, i.question_id)
        ORDER BY i.question_id`,
        [sid],
      );
      return r.rows as Array<{ question_id: string; outcome: string }>;
    }

    async function itemsOf(
      reviewSessionId: string,
    ): Promise<
      Array<{ id: string; question_id: string; queue_entry_id: string }>
    > {
      const r = await testPg!.query(
        `SELECT id::text, question_id, queue_entry_id::text
         FROM public.review_session_items WHERE session_id = $1 ORDER BY ordinal`,
        [reviewSessionId],
      );
      return r.rows as Array<{
        id: string;
        question_id: string;
        queue_entry_id: string;
      }>;
    }

    async function tokenFor(itemId: string, key: string): Promise<string> {
      const r = await testPg!.query(
        `SELECT option_token_map FROM public.review_session_items WHERE id = $1`,
        [itemId],
      );
      const map = r.rows[0].option_token_map as Record<string, string>;
      const hit = Object.entries(map).find(([, v]) => v === key);
      if (!hit) throw new Error(`no token for ${key}`);
      return hit[0];
    }

    beforeAll(async () => {
      testPg = await bootstrapPgDatabase(DB_NAME);
      const pg = testPg;
      for (const f of [
        "exam-form-fixture.sql",
        "exam-walk-fixture.sql",
        "exam-seams-walk.sql",
      ]) {
        await pg.query(
          fs.readFileSync(
            path.resolve(__dirname, "../../scripts/ci/lib", f),
            "utf-8",
          ),
        );
      }
      await pg.query(
        `SELECT pg_temp.exam_fixture_make_form($1, 'R7', 20, 15)`,
        [FORM],
      );
      // The CI form fixture stores MCQ options as bare letters; the bank (and every
      // production form — 384/384 MCQs, read-only 2026-10-03) stores {key, text}, the
      // shape review's serving validators require. Rewritten here as
      // exam-shell-server.handler-pg does, so the test reviews production-shaped items.
      await pg.query(
        `UPDATE public.questions q
            SET options = jsonb_build_array(
                  jsonb_build_object('key','A','text','Choice A of ' || q.id),
                  jsonb_build_object('key','B','text','Choice B of ' || q.id),
                  jsonb_build_object('key','C','text','Choice C of ' || q.id),
                  jsonb_build_object('key','D','text','Choice D of ' || q.id))
           FROM public.test_form_items fi
          WHERE fi.question_id = q.id AND fi.test_form_id = $1 AND q.item_type = 'mcq'`,
        [FORM],
      );
      await pg.query(
        `UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'Practice Test 3' WHERE id = $1`,
        [FORM],
      );
      for (const id of [STUDENT, PART_STUDENT, LIVE_STUDENT]) {
        await pg.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
          id,
          `${id}@example.test`,
        ]);
        await pg.query(
          `INSERT INTO public.profiles (id, email, role) VALUES ($1, $2, 'student')
         ON CONFLICT (id) DO NOTHING`,
          [id, `${id}@example.test`],
        );
      }

      // STUDENT: one whole exam, mixed answers (correct / wrong / never answered /
      // explicit blank by ordinal % 4), scored and its hand-off consumed.
      examSid = String(
        (
          await pg.query(
            `SELECT pg_temp.walk($1, $2, 'strict', '{RW,M}'::text[]) AS sid`,
            [STUDENT, FORM],
          )
        ).rows[0].sid,
      );
      // PART_STUDENT: RW walked; Math Module 1 answered, never submitted; grace expires,
      // the sweep finalises the session (times out M1) and it is partially scored.
      partSid = String(
        (
          await pg.query(
            `SELECT pg_temp.walk($1, $2, 'strict', '{RW}'::text[]) AS sid`,
            [PART_STUDENT, FORM],
          )
        ).rows[0].sid,
      );
      await pg.query(
        `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, 'M', '1'), 200)`,
        [PART_STUDENT, partSid],
      );
      await pg.query(`SELECT pg_temp.answer_mixed($1, $2, 'M', '1')`, [
        PART_STUDENT,
        partSid,
      ]);
      // LIVE_STUDENT: Module 1 answered, nothing submitted — never scored.
      const live = await pg.query(
        `SELECT public.exam_create_session($1, $2, 'strict') AS r`,
        [LIVE_STUDENT, FORM],
      );
      liveSid = String(live.rows[0].r.body.session_id);
      await pg.query(
        `SELECT pg_temp.expect_status('fx', public.exam_start_module($1, $2, 'RW', '1'), 200)`,
        [LIVE_STUDENT, liveSid],
      );
      await pg.query(`SELECT pg_temp.answer_mixed($1, $2, 'RW', '1')`, [
        LIVE_STUDENT,
        liveSid,
      ]);

      expect(
        Number((await pg.query(`SELECT pg_temp.drain() AS n`)).rows[0].n),
      ).toBeGreaterThan(0);
      await pg.query(
        `UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
        [partSid],
      );
      await pg.query(`SELECT public.exam_abandonment_sweep()`);
      expect(
        Number((await pg.query(`SELECT pg_temp.drain() AS n`)).rows[0].n),
      ).toBeGreaterThanOrEqual(0);

      // STUDENT also misses one practice question, through practice's own answer route,
      // so the complete queue holds both engines (E4).
      await pg.query(
        `INSERT INTO public.questions
         (id, section, source_type, domain, skill_codes, difficulty, stem, options,
          correct_answer, explanation, option_metadata, status, item_type, published_at)
       VALUES ($1,'M',1,'Algebra',ARRAY['ALG.D01'],2,'Practice stem',
         '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
         'B','Practice explanation',
         '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
         'published','mcq', now())`,
        [PRACTICE_QUESTION],
      );
      await pg.query(
        `INSERT INTO public.practice_sessions
         (id, user_id, actor_id, mode, filters, target_count, platform, status)
       VALUES ($1,$2,$2,'flow',
         '{"target_question_count":1,"prebuilt":true,"client_instance_id":"exr-1"}'::jsonb,
         1,'web','active')`,
        [PRACTICE_SESSION, STUDENT],
      );
      await pg.query(
        `INSERT INTO public.practice_session_items
         (id, session_id, user_id, actor_id, ordinal, question_id, question_stem,
          question_options, question_correct_answer, question_explanation,
          question_option_metadata, question_domain, question_skill,
          question_difficulty, question_section, status, question_item_type,
          option_order, option_token_map, served_at, client_instance_id)
       VALUES ($1,$2,$3,$3,1,$4,'Practice stem',
         '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
         'B','Practice explanation',
         '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
         'Algebra','ALG.D01',2,'M','served','mcq',
         ARRAY['A','B','C','D']::text[],
         '{"tok_a":"A","tok_b":"B","tok_c":"C","tok_d":"D"}'::jsonb,
         now(),'exr-1')`,
        [PRACTICE_ITEM, PRACTICE_SESSION, STUDENT, PRACTICE_QUESTION],
      );

      const { default: practiceRouter } =
        await import("../../server/routes/practice-canonical");
      const { default: reviewRouter } =
        await import("../../server/routes/review-canonical");
      const { requireSupabaseAuth, requireStudentOrAdmin } =
        await import("../../server/middleware/supabase-auth.js");
      app = express();
      app.use(express.json());
      app.use((req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { requestId: string }).requestId = "exam-review-pg";
        next();
      });
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

      const practiceMiss = await request(app)
        .post("/api/practice/answer")
        .set("x-test-user", STUDENT)
        .send({
          sessionId: PRACTICE_SESSION,
          sessionItemId: PRACTICE_ITEM,
          selectedAnswer: "tok_a", // A — wrong, the key is B
          client_instance_id: "exr-1",
        });
      expect(practiceMiss.status).toBe(200);
      expect(practiceMiss.body.isCorrect).toBe(false);
    }, 300_000);

    afterAll(async () => {
      await testPg?.end();
      testPg = null;
    });

    it("E1: the exam's wrong and blank items are queued as full_length entries, nothing for a correct answer", async () => {
      const want = await expectedMisses(examSid);
      expect(want.length).toBeGreaterThan(0);
      expect(want.some((w) => w.outcome === "incorrect")).toBe(true);
      expect(want.some((w) => w.outcome === "skipped")).toBe(true);
      const got = (await queue(STUDENT))
        .filter((r) => r.source_engine === "full_length")
        .map((r) => ({ question_id: r.question_id, outcome: r.source_outcome }))
        .sort((a, b) => a.question_id.localeCompare(b.question_id));
      expect(got).toEqual(want);
      for (const r of (await queue(STUDENT)).filter(
        (q) => q.source_engine === "full_length",
      )) {
        expect(r.source_session_id).toBe(examSid);
        expect(r.status).toBe("active");
      }
    });

    it("E2: the picker lists the exam like a practice session — dated, named, counted, nothing more", async () => {
      const res = await request(app)
        .get("/api/review/pool")
        .query({ tz: "UTC" })
        .set("x-test-user", STUDENT);
      expect(res.status).toBe(200);
      const sessions = res.body.sessions as Array<Record<string, unknown>>;
      const exam = sessions.find((s) => s.source_engine === "full_length");
      const practice = sessions.find((s) => s.source_engine === "practice");
      expect(practice).toBeDefined();
      expect(exam).toBeDefined();
      const ended = (
        await testPg!.query(
          `SELECT completed_at FROM public.test_sessions WHERE id = $1`,
          [examSid],
        )
      ).rows[0].completed_at as Date;
      const open = (await queue(STUDENT)).filter(
        (r) => r.source_engine === "full_length" && r.status === "active",
      ).length;
      expect(exam).toMatchObject({
        source_session_id: examSid,
        mode: null,
        filters: { test_form_name: "Practice Test 3" },
        open_count: open,
      });
      // Dated by when the test ENDED, so it groups under that day, not "Earlier".
      expect(new Date(String(exam!.created_at)).getTime()).toBe(
        ended.getTime(),
      );
      expect(exam!.local_date).toBe(ended.toISOString().slice(0, 10));
      expect(exam!.local_time).not.toBeNull();
      // F-52: the exam row carries the form's name and nothing else from the session.
      expect(Object.keys(exam!.filters as object)).toEqual(["test_form_name"]);
    });

    it("E3: 'review this test' (mode session) serves exactly that exam's open misses", async () => {
      const created = await request(app)
        .post("/api/review/sessions")
        .set("x-test-user", STUDENT)
        .send({
          mode: "session",
          filters: { source_engine: "full_length", source_session_id: examSid },
          client_instance_id: "exr-s1",
        });
      expect(created.status).toBe(200);
      const items = await itemsOf(String(created.body.sessionId));
      const examEntries = (await queue(STUDENT)).filter(
        (r) => r.source_engine === "full_length" && r.status === "active",
      );
      expect(items.map((i) => i.queue_entry_id).sort()).toEqual(
        examEntries.map((e) => e.id).sort(),
      );
      expect(items.some((i) => i.question_id === PRACTICE_QUESTION)).toBe(
        false,
      );
      // Close it so the next session is not refused as a second open one.
      const terminated = await request(app)
        .post(
          `/api/review/sessions/${String(created.body.sessionId)}/terminate`,
        )
        .set("x-test-user", STUDENT)
        .send({ client_instance_id: "exr-s1" });
      expect(terminated.status).toBe(200);
    });

    it("E4: the complete queue carries the exam's misses and the practice miss through the same path", async () => {
      const created = await request(app)
        .post("/api/review/sessions")
        .set("x-test-user", STUDENT)
        .send({ mode: "queue", client_instance_id: "exr-q1" });
      expect(created.status).toBe(200);
      const items = await itemsOf(String(created.body.sessionId));
      const active = (await queue(STUDENT)).filter(
        (r) => r.status === "active",
      );
      expect(items.map((i) => i.queue_entry_id).sort()).toEqual(
        active.map((e) => e.id).sort(),
      );
      const engines = new Set(
        active
          .filter((e) => items.some((i) => i.queue_entry_id === e.id))
          .map((e) => e.source_engine),
      );
      expect([...engines].sort()).toEqual(["full_length", "practice"]);
      const terminated = await request(app)
        .post(
          `/api/review/sessions/${String(created.body.sessionId)}/terminate`,
        )
        .set("x-test-user", STUDENT)
        .send({ client_instance_id: "exr-q1" });
      expect(terminated.status).toBe(200);
    });

    it("E5: an exam miss answered in review graduates or requeues exactly like a practice miss", async () => {
      const created = await request(app)
        .post("/api/review/sessions")
        .set("x-test-user", STUDENT)
        .send({
          mode: "session",
          filters: { source_engine: "full_length", source_session_id: examSid },
          client_instance_id: "exr-s2",
        });
      expect(created.status).toBe(200);
      const sid = String(created.body.sessionId);
      const before = (await queue(STUDENT)).filter(
        (r) => r.source_engine === "full_length" && r.status === "active",
      ).length;

      // First served item: answered WRONG -> superseded, requeued as a review miss.
      const first = await request(app)
        .get(`/api/review/sessions/${sid}/next`)
        .query({ client_instance_id: "exr-s2" })
        .set("x-test-user", STUDENT);
      expect(first.status).toBe(200);
      const firstItem = String(first.body.sessionItemId);
      const firstQ = (
        await testPg!.query(
          `SELECT question_id, question_correct_answer, question_item_type
           FROM public.review_session_items WHERE id = $1`,
          [firstItem],
        )
      ).rows[0] as {
        question_id: string;
        question_correct_answer: string;
        question_item_type: string;
      };
      const wrongAnswer =
        firstQ.question_item_type === "mcq"
          ? await tokenFor(
              firstItem,
              ["A", "B", "C", "D"].find(
                (k) => k !== firstQ.question_correct_answer,
              )!,
            )
          : "999";
      const wrong = await request(app)
        .post("/api/review/answer")
        .set("x-test-user", STUDENT)
        .send({
          sessionId: sid,
          sessionItemId: firstItem,
          selectedAnswer: wrongAnswer,
        });
      expect(wrong.status).toBe(200);
      expect(wrong.body.isCorrect).toBe(false);

      // Second served item: answered RIGHT -> graduated.
      const second = await request(app)
        .get(`/api/review/sessions/${sid}/next`)
        .query({ client_instance_id: "exr-s2" })
        .set("x-test-user", STUDENT);
      expect(second.status).toBe(200);
      const secondItem = String(second.body.sessionItemId);
      const secondQ = (
        await testPg!.query(
          `SELECT question_id, question_correct_answer, question_item_type
           FROM public.review_session_items WHERE id = $1`,
          [secondItem],
        )
      ).rows[0] as {
        question_id: string;
        question_correct_answer: string;
        question_item_type: string;
      };
      const rightAnswer =
        secondQ.question_item_type === "mcq"
          ? await tokenFor(secondItem, secondQ.question_correct_answer)
          : String(
              (
                await testPg!.query(
                  `SELECT correct_variants[1] AS v FROM public.questions WHERE id = $1`,
                  [secondQ.question_id],
                )
              ).rows[0].v,
            );
      const right = await request(app)
        .post("/api/review/answer")
        .set("x-test-user", STUDENT)
        .send({
          sessionId: sid,
          sessionItemId: secondItem,
          selectedAnswer: rightAnswer,
        });
      expect(right.status).toBe(200);
      expect(right.body.isCorrect).toBe(true);

      const rows = await queue(STUDENT);
      const forFirst = rows.filter((r) => r.question_id === firstQ.question_id);
      expect(
        forFirst.find((r) => r.source_engine === "full_length")?.status,
      ).toBe("superseded");
      expect(forFirst.find((r) => r.status === "active")?.source_engine).toBe(
        "review",
      );
      const forSecond = rows.filter(
        (r) => r.question_id === secondQ.question_id,
      );
      expect(forSecond.map((r) => [r.source_engine, r.status])).toEqual([
        ["full_length", "graduated"],
      ]);
      expect(
        rows.filter(
          (r) => r.source_engine === "full_length" && r.status === "active",
        ).length,
      ).toBe(before - 2);

      await request(app)
        .post(`/api/review/sessions/${sid}/terminate`)
        .set("x-test-user", STUDENT)
        .send({ client_instance_id: "exr-s2" });

      // Provenance, as practice's A9: the requeued question is still "from that test".
      const again = await request(app)
        .post("/api/review/sessions")
        .set("x-test-user", STUDENT)
        .send({
          mode: "session",
          filters: { source_engine: "full_length", source_session_id: examSid },
          client_instance_id: "exr-s3",
        });
      expect(again.status).toBe(200);
      const againItems = await itemsOf(String(again.body.sessionId));
      expect(againItems.some((i) => i.question_id === firstQ.question_id)).toBe(
        true,
      );
      expect(
        againItems.some((i) => i.question_id === secondQ.question_id),
      ).toBe(false);
      expect(againItems).toHaveLength(before - 1);
      await request(app)
        .post(`/api/review/sessions/${String(again.body.sessionId)}/terminate`)
        .set("x-test-user", STUDENT)
        .send({ client_instance_id: "exr-s3" });
    });

    it("E6: a partially scored exam queues only what was submitted, and is reviewable by session", async () => {
      const state = (
        await testPg!.query(
          `SELECT state FROM public.test_sessions WHERE id = $1`,
          [partSid],
        )
      ).rows[0].state;
      expect(state).toBe("partial_scored_abandoned");
      const want = await expectedMisses(partSid);
      const got = (await queue(PART_STUDENT))
        .filter((r) => r.source_engine === "full_length")
        .map((r) => ({ question_id: r.question_id, outcome: r.source_outcome }))
        .sort((a, b) => a.question_id.localeCompare(b.question_id));
      expect(got).toEqual(want);
      // SCL-205: Math stopped after Module 1, so Math queues nothing — though its
      // Module 1 was served and holds misses. Only the submitted RW section counts.
      const math = await testPg!.query(
        `SELECT sec.state,
                (SELECT count(*)::int FROM public.test_session_items i
                  WHERE i.test_session_id = $1 AND i.section = 'M' AND i.module = '1') AS m1_served,
                (SELECT count(*)::int FROM public.test_session_items i
                  WHERE i.test_session_id = $1 AND i.section = 'M' AND i.module <> '1') AS m2_served
           FROM public.test_session_sections sec
          WHERE sec.test_session_id = $1 AND sec.section = 'M'`,
        [partSid],
      );
      expect(math.rows[0]).toMatchObject({ state: "module1_submitted", m2_served: 0 });
      expect(math.rows[0].m1_served).toBeGreaterThan(0);
      const mathQuestions = new Set(
        (
          await testPg!.query(
            `SELECT question_id FROM public.test_session_items WHERE test_session_id = $1 AND section = 'M'`,
            [partSid],
          )
        ).rows.map((r: { question_id: string }) => r.question_id),
      );
      expect(got.filter((r) => mathQuestions.has(r.question_id))).toEqual([]);
      expect(want.length).toBeGreaterThan(0);

      const res = await request(app)
        .get("/api/review/pool")
        .query({ tz: "UTC" })
        .set("x-test-user", PART_STUDENT);
      const row = (res.body.sessions as Array<Record<string, unknown>>).find(
        (s) => s.source_session_id === partSid,
      );
      expect(row).toMatchObject({
        source_engine: "full_length",
        filters: { test_form_name: "Practice Test 3" },
        open_count: want.length,
      });
      expect(row!.local_date).not.toBeNull(); // dated by abandoned_at
    });

    it("E7: an exam that was never scored queues nothing and is not in the picker", async () => {
      expect(await queue(LIVE_STUDENT)).toEqual([]);
      const res = await request(app)
        .get("/api/review/pool")
        .query({ tz: "UTC" })
        .set("x-test-user", LIVE_STUDENT);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.sessions).toEqual([]);
    });
  },
);
