/**
 * E9 — the exam seams, end to end through E6's HTTP handlers on real PostgreSQL.
 *
 * @spec [SCL-154 .. SCL-158; Doc-04B_V4.3 §16.1; Doc-05A §6.2; Doc-05C §5.7, §7.7;
 *        Doc-05D §12.2; Doc-04A_V2.2 §13.3] | @implemented [2026-09-25]
 *
 * plain English: one student sits a whole exam through the real /api/tests
 * routers — start, items (real opaque tokens), answers by token, module submits —
 * answering by pattern (ordinal % 4: correct · wrong · never answered · explicit
 * omit). The final submit's own hand-off scores the session and then, in a second
 * RPC call, consumes its 'test_session_scored' event. The test then reads what
 * landed: the review-queue rows with their outcomes, the mastery audit and skill
 * rows, full_length_section_scores beside 05C §5.7's two reads, the projection
 * outbox row, both outbox events, and the scored report.
 *
 * What would turn it red: the server not consuming the follow-up event (no
 * seams at all); a miss or blank missing from the queue, or a correct item in
 * it; a blank reaching mastery; a second projection row.
 *
 * SCOPE AND LIMITS: as tests/ci/exam-shell-server.handler-pg.ci.test.ts (SUPERUSER
 * pg, mocked auth + entitlement). Runs only where PGHOST is set; named in CI.
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
import fs from "fs";
import path from "path";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "exam_seams_handler_ci";
const FORM = "e9af0000-0000-4000-8000-0000000000c1";
const STUDENT = "00000000-0000-0000-0000-0000000e9c01";
const LAPSED = new Set<string>();

let testPg: Client | null = null;

/**
 * PostgREST turns a JSON body into typed arguments by the function's signature; node-pg
 * cannot see the signature. Objects and arrays go as JSON (jsonb), EXCEPT the one
 * text[] argument on this surface, p_eliminated, which node-pg must send as a
 * Postgres array. (An empty JS array is otherwise indistinguishable.)
 */
const TEXT_ARRAY_ARGS = new Set(["p_eliminated"]);

function jsonArgs(
  args?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!args) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] =
      v !== null && typeof v === "object" && !TEXT_ARRAY_ARGS.has(k)
        ? JSON.stringify(v)
        : v;
  }
  return out;
}

function pgProxy() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        const sb = makePgSupabase(testPg);
        if (prop === "rpc") {
          return (fn: string, args?: Record<string, unknown>) =>
            sb.rpc(fn, jsonArgs(args));
        }
        return (sb as Record<string, unknown>)[prop as string];
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
  const pass = (_q: Request, _s: Response, next: NextFunction) => next();
  return {
    requireSupabaseAuth: pass,
    requireStudentOrAdmin: pass,
    requireProfileComplete: pass,
    requireConsentCompliance: pass,
  };
}
vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: vi.fn(
      async (profileId: string, featureKey: string) =>
        featureKey === "exam_full_length" && !LAPSED.has(profileId),
    ),
  },
}));

type Item = {
  question_id: string;
  ordinal: number;
  question_type: string;
  options: Array<{ id: string; text: string }>;
};

describe.skipIf(!PG_AVAILABLE)("E9 exam seams → real PG, through the handlers", () => {
  let app: Express;
  const as = (student: string) => (r: request.Test) =>
    r.set("x-test-user", student);
  let sid = "";

  beforeAll(async () => {
    testPg = await bootstrapPgDatabase(DB_NAME);
    const fixture = fs.readFileSync(
      path.resolve(__dirname, "../../scripts/ci/lib/exam-form-fixture.sql"),
      "utf-8",
    );
    await testPg.query(fixture);
    await testPg.query(`SELECT pg_temp.exam_fixture_make_form($1, 'H9', 20, 15)`, [FORM]);
    await testPg.query(
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
    await testPg.query(
      `UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'Practice Test 1' WHERE id = $1`,
      [FORM],
    );
    await testPg.query(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, [STUDENT, "e9@example.test"]);
    await testPg.query(
      `INSERT INTO public.profiles (id, email, role) VALUES ($1::uuid, $2, 'student')`,
      [STUDENT, "e9@example.test"],
    );
    const { default: runtimeRouter } = await import("../../server/routes/exam-runtime-routes");
    const { default: reportRouter } = await import("../../server/routes/exam-report-routes");
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const user = req.header("x-test-user");
      if (user) {
        (req as unknown as { user: unknown }).user = { id: user, actor_id: user, role: "student" };
      }
      (req as unknown as { requestId: string }).requestId = "exam-seams-pg";
      next();
    });
    app.use("/api/tests", runtimeRouter);
    app.use("/api/tests", reportRouter);
  }, 180_000);

  afterAll(async () => {
    await testPg?.end();
  });

  /** The canonical letter behind each served token (the test reads it; the client never can). */
  async function tokenFor(section: string, module: string, ordinal: number, letter: string): Promise<string> {
    const r = await testPg!.query(
      `SELECT option_token_map FROM public.test_session_items
        WHERE test_session_id = $1 AND section = $2 AND ordinal = $3
          AND (module = $4 OR ($4 = '2' AND module IN ('2A','2B')))`,
      [sid, section, ordinal, module],
    );
    const map = r.rows[0]?.option_token_map as Record<string, string>;
    const hit = Object.entries(map).find(([, k]) => k === letter);
    if (!hit) throw new Error(`no token for ${letter}`);
    return hit[0];
  }

  async function sitModule(section: "RW" | "M", module: "1" | "2"): Promise<void> {
    const base = `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;
    expect((await as(STUDENT)(request(app).post(`${base}/start`))).status).toBe(200);
    const items = (await as(STUDENT)(request(app).get(`${base}/items`))).body.items as Item[];
    for (const it of items) {
      const k = it.ordinal % 4;
      if (k === 2) continue; // never answered
      let answer: string | null = null; // k === 3: explicit omit
      if (k === 0 || k === 1) {
        answer = it.question_type === "multiple_choice"
          ? await tokenFor(section, module, it.ordinal, k === 0 ? "A" : "B")
          : k === 0 ? "1" : "2";
      }
      const res = await as(STUDENT)(request(app).post("/api/tests/answer")).send({
        test_session_id: sid, section, module, question_id: it.question_id,
        ordinal: it.ordinal, answer, idempotency_key: `e9:${section}:${module}:${it.ordinal}`,
      });
      expect(res.status).toBe(200);
    }
    expect((await as(STUDENT)(request(app).post(`${base}/submit`))).status).toBe(200);
  }

  it("a whole exam through the handlers: scored, then every seam landed once", async () => {
    const created = await as(STUDENT)(request(app).post("/api/tests/sessions")).send({
      test_form_id: FORM, mode: "strict",
    });
    expect(created.status).toBe(201);
    sid = created.body.session_id;
    await sitModule("RW", "1");
    await sitModule("RW", "2");
    // the break: start Math Module 1 early (SCL-134)
    await sitModule("M", "1");
    await sitModule("M", "2"); // this submit completes the session; its hand-off scores + seams

    const q = async (sql: string, args: unknown[] = []) => (await testPg!.query(sql, args)).rows;
    const outbox = await q(
      `SELECT event_type, status, attempts, result FROM public.exam_runtime_outbox
        WHERE aggregate_id = $1 ORDER BY created_at`, [sid]);
    expect(outbox.map((o) => [o.event_type, o.status])).toEqual([
      ["test_session_completed", "published"],
      ["test_session_scored", "published"],
    ]);
    expect(outbox[1].result.outcome).toBe("applied");

    // review queue: exactly the served misses + blanks of submitted modules
    const expected = await q(
      `SELECT count(*)::int AS n FROM public.test_session_items
        WHERE test_session_id = $1 AND ordinal % 4 <> 0`, [sid]);
    const review = await q(
      `SELECT r.source_outcome AS outcome, i.section, i.module, count(*)::int AS n
         FROM public.review_schedule r
         JOIN public.test_session_items i
           ON i.test_session_id = r.source_session_id
          AND md5('full_length:' || i.test_session_id || ':' || i.section || ':' || i.module || ':' || i.ordinal)::uuid = r.source_item_id
        WHERE r.source_session_id = $1 AND r.source_engine = 'full_length' AND r.status = 'active'
        GROUP BY 1, 2, 3 ORDER BY 2 DESC, 3, 1`, [sid]);
    const reviewTotal = review.reduce((a, r) => a + (r.n as number), 0);
    expect(reviewTotal).toBe(expected[0].n);
    const sample = await q(
      `SELECT i.section, i.module, i.ordinal, r.question_id, r.source_outcome, a.answer IS NULL AS blank
         FROM public.review_schedule r
         JOIN public.test_session_items i
           ON i.test_session_id = r.source_session_id
          AND md5('full_length:' || i.test_session_id || ':' || i.section || ':' || i.module || ':' || i.ordinal)::uuid = r.source_item_id
         LEFT JOIN public.test_session_answers a USING (test_session_id, section, module, ordinal)
        WHERE r.source_session_id = $1 ORDER BY i.section DESC, i.module, i.ordinal LIMIT 4`, [sid]);

    // mastery: one audit row per answered (non-blank) item; skill rows carry acc_test
    const answered = await q(
      `SELECT count(*)::int AS n FROM public.test_session_answers WHERE test_session_id = $1 AND answer IS NOT NULL`, [sid]);
    const audit = await q(
      `SELECT l.section, l.domain, count(*)::int AS events, sum(l.correct::int)::int AS correct,
              max(l.event_count_after)::int AS event_count_after
         FROM public.mastery_event_audit_log l
         JOIN public.test_session_answers a ON a.last_submission_id = l.event_id
        WHERE a.test_session_id = $1 AND l.event_source_kind = 'full_length_answer' AND l.source_family = 'test'
        GROUP BY 1, 2 ORDER BY 1 DESC, 2`, [sid]);
    expect(audit.reduce((a, r) => a + (r.events as number), 0)).toBe(answered[0].n);
    const skills = await q(
      `SELECT section, domain, skill, round(mastery_score, 4) AS mastery_score, round(acc_test, 4) AS acc_test,
              event_count_total AS events
         FROM public.student_skill_mastery WHERE student_id = $1 ORDER BY 1 DESC, 2`, [STUDENT]);
    // Every answered item reached a skill; a skill with fewer events than the
    // model's minimum carries no score yet (05A), one above it carries acc_test.
    expect(skills.reduce((a, s) => a + (s.events as number), 0)).toBe(answered[0].n);
    expect(skills.some((s) => s.acc_test !== null)).toBe(true);

    // projection surface: the view, and 05C §5.7's two reads against it
    const view = await q(
      `SELECT student_id, section, section_scaled_score, is_complete, completed_at, id
         FROM public.full_length_section_scores WHERE student_id = $1 ORDER BY section DESC`, [STUDENT]);
    expect(view).toHaveLength(2);
    const run = await q(`SELECT id, rw_scaled, math_scaled, total_scaled FROM public.score_runs WHERE test_session_id = $1`, [sid]);
    const readLatest = await q(
      `SELECT fl.section_scaled_score FROM public.full_length_section_scores fl
        WHERE student_id = $1 AND section = 'RW' AND is_complete = true
        ORDER BY completed_at DESC, id DESC LIMIT 1`, [STUDENT]);
    const readSecond = await q(
      `SELECT fl.section_scaled_score FROM public.full_length_section_scores fl
        WHERE student_id = $1 AND section = 'RW' AND is_complete = true
        ORDER BY completed_at DESC, id DESC OFFSET 1 LIMIT 1`, [STUDENT]);
    expect(readLatest[0].section_scaled_score).toBe(run[0].rw_scaled);
    expect(readSecond).toHaveLength(0);
    expect(view[0].id).toBe(
      (await q(`SELECT md5($1::text || ':RW')::uuid AS id`, [run[0].id]))[0].id,
    );

    // projection outbox: one row for the completion
    const proj = await q(
      `SELECT student_id, reason, test_session_id, processed_at FROM public.projection_refresh_outbox WHERE student_id = $1`, [STUDENT]);
    expect(proj).toHaveLength(1);
    expect(proj[0]).toMatchObject({ reason: "full_length_completed", test_session_id: sid, processed_at: null });

    // the report reads the same score
    const report = await as(STUDENT)(request(app).get(`/api/tests/sessions/${sid}/report`));
    expect(report.status).toBe(200);
    expect(report.body.data.report_state).toBe("scored");
    expect(report.body.data.score.total_scaled).toBe(run[0].total_scaled);

    // eslint-disable-next-line no-console -- evidence for the PR
    console.log("E9 EVIDENCE " + JSON.stringify({
      outbox, score_run: run[0], review_by_outcome: review, review_total: reviewTotal,
      review_expected: expected[0].n, review_sample: sample, answered: answered[0].n,
      mastery_audit_by_domain: audit, skill_mastery: skills, full_length_section_scores: view,
      compute_section_projection_reads: { latest_rw: readLatest[0]?.section_scaled_score ?? null, second_rw: readSecond[0]?.section_scaled_score ?? null },
      projection_refresh_outbox: proj, report_state: report.body.data.report_state,
    }, null, 1));
  }, 180_000);
});
