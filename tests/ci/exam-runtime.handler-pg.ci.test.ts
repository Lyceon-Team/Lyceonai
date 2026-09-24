/**
 * Full-length exam runtime — HTTP handlers against real PostgreSQL.
 *
 * @spec [Doc-04A_V2.2, §7.3, §8.5, §9.1, §10.1-§10.2, §11.2, §12, §13, §15.1, §16.1;
 *        Coding Standards §5.2; E6 rulings SCL-132 (module '2'), SCL-133 (shuffle),
 *        SCL-136 (inline scoring)]
 * @implemented [2026-09-24]
 *
 * plain English: mounts the real /api/tests router over a throwaway database built
 * from this repo's migrations, and walks whole exams through HTTP exactly as a
 * client would: create -> start RW M1 -> fetch items -> answer by SERVED TOKEN ->
 * submit -> (routed) M2 -> ... -> Math M2 submit. Four students cover both routing
 * paths in both modes. The answers are chosen by a test oracle that reads the
 * persisted token map and the real answer key from the database — the client never
 * sees either.
 *
 * What it proves (and what would turn it red):
 *   - a shuffled selection is stored as the CANONICAL letter and grades correctly
 *     (store the raw token instead and routing collapses to path A, scores fall);
 *   - no pre-submit payload carries correct_answer / explanation (other than null),
 *     domain, difficulty, skill_code(s) or correct_variants, and no response names
 *     the routed path;
 *   - the session is scored inline after the completing request (no manual scoring
 *     call and no sweep anywhere in this file);
 *   - replaying an answer's idempotency key writes nothing and does not error;
 *   - handler order: 401 before anything, 403 on entitlement, 400 on Zod.
 *
 * SCOPE AND LIMITS: both Supabase clients are replaced by tests/helpers/pg-supabase
 * over a SUPERUSER connection, so PostgREST, GRANTs and supabase-js are not exercised
 * here (scripts/ci/exam-runtime-api-gates.sh covers RLS and grants as
 * `authenticated`). Runs only where PGHOST is set; named by file in CI.
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

const DB_NAME = "exam_runtime_handler_ci";
const FORM = "e6f00000-0000-4000-8000-0000000000a1";
const DENIED = "00000000-0000-0000-0000-0000000e6999";

// Four students: (answers right?, mode). All-right routes B/B, all-wrong A/A.
const WALKS = [
  {
    student: "00000000-0000-0000-0000-0000000e6101",
    correct: true,
    mode: "lenient",
  },
  {
    student: "00000000-0000-0000-0000-0000000e6102",
    correct: true,
    mode: "strict",
  },
  {
    student: "00000000-0000-0000-0000-0000000e6103",
    correct: false,
    mode: "lenient",
  },
  {
    student: "00000000-0000-0000-0000-0000000e6104",
    correct: false,
    mode: "strict",
  },
] as const;

let testPg: Client | null = null;

/**
 * PostgREST sends rpc arguments as JSON; node-pg would send a JS array as a Postgres
 * array literal. Encode arrays and objects as JSON so jsonb parameters see what
 * production sends.
 */
function jsonArgs(
  args?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!args) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
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
        featureKey === "exam_full_length" && profileId !== DENIED,
    ),
  },
}));

const FORBIDDEN_ITEM_KEYS = [
  "domain",
  "difficulty",
  "skill_code",
  "skill_codes",
  "correct_variants",
  "option_metadata",
  "option_token_map",
  "option_order",
];
const PAYLOAD_KEYS = [
  "question_id",
  "ordinal",
  "question_type",
  "stem",
  "passage",
  "options",
  "assets",
  "current_answer",
  "correct_answer",
  "explanation",
].sort();

function assertPreSubmitPayload(item: Record<string, unknown>): void {
  expect(Object.keys(item).sort()).toEqual(PAYLOAD_KEYS);
  expect(item.correct_answer).toBeNull();
  expect(item.explanation).toBeNull();
  for (const key of FORBIDDEN_ITEM_KEYS) expect(item).not.toHaveProperty(key);
  for (const opt of item.options as Array<Record<string, unknown>>) {
    expect(Object.keys(opt).sort()).toEqual(["id", "text"]);
    expect(String(opt.id)).toMatch(/^opt_[0-9a-f]{16}$/);
  }
}

function assertNoRoutingPath(body: unknown): void {
  expect(JSON.stringify(body)).not.toMatch(/module2_path"|"path"/);
}

describe.skipIf(!PG_AVAILABLE)("Exam runtime handlers → real PG", () => {
  let app: Express;

  beforeAll(async () => {
    testPg = await bootstrapPgDatabase(DB_NAME);

    // The shared exam form fixture (plain SQL: one pg_temp helper), then a published
    // form. Real-shaped options, and answer keys spread over A-D so a token that is
    // NOT resolved to its canonical letter cannot score by luck.
    const fixture = fs.readFileSync(
      path.resolve(__dirname, "../../scripts/ci/lib/exam-form-fixture.sql"),
      "utf-8",
    );
    await testPg.query(fixture);
    await testPg.query(
      `SELECT pg_temp.exam_fixture_make_form($1, 'H1', 20, 15)`,
      [FORM],
    );
    await testPg.query(
      `
      UPDATE public.questions q
         SET options = jsonb_build_array(
               jsonb_build_object('key','A','text','Choice A of ' || q.id),
               jsonb_build_object('key','B','text','Choice B of ' || q.id),
               jsonb_build_object('key','C','text','Choice C of ' || q.id),
               jsonb_build_object('key','D','text','Choice D of ' || q.id)),
             correct_answer = (ARRAY['A','B','C','D'])[1 + (abs(hashtext(q.id)) % 4)]
        FROM public.test_form_items fi
       WHERE fi.question_id = q.id AND fi.test_form_id = $1 AND q.item_type = 'mcq'`,
      [FORM],
    );
    await testPg.query(
      `UPDATE public.test_forms SET status = 'published', published_at = now() WHERE id = $1`,
      [FORM],
    );
    for (const id of [...WALKS.map((w) => w.student), DENIED]) {
      await testPg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
        [id, `${id}@example.test`],
      );
      await testPg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1::uuid, $2, 'student')`,
        [id, `${id}@example.test`],
      );
    }

    const { default: examRuntimeRouter } =
      await import("../../server/routes/exam-runtime-routes");
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const user = req.header("x-test-user");
      if (user) {
        (req as unknown as { user: unknown }).user = {
          id: user,
          actor_id: user,
          role: "student",
        };
      }
      (req as unknown as { requestId: string }).requestId = "exam-handler-pg";
      next();
    });
    app.use("/api/tests", examRuntimeRouter);
  }, 180_000);

  afterAll(async () => {
    await testPg?.end();
  });

  // ── Handler order ──────────────────────────────────────────────────────────
  it("401 without a user, 403 without the entitlement, 400 on a bad body — in that order", async () => {
    const bad = { test_form_id: "not-a-uuid" };
    const r401 = await request(app).post("/api/tests/sessions").send(bad);
    expect(r401.status).toBe(401);
    expect(r401.body.error.code).toBe("unauthenticated");

    const r403 = await request(app)
      .post("/api/tests/sessions")
      .set("x-test-user", DENIED)
      .send(bad);
    expect(r403.status).toBe(403);
    expect(r403.body.error.code).toBe("forbidden");

    const r400 = await request(app)
      .post("/api/tests/sessions")
      .set("x-test-user", WALKS[0].student)
      .send(bad);
    expect(r400.status).toBe(400);
    expect(r400.body.error.code).toBe("invalid_request");

    // SCL-132: the physical module ids are not part of the client contract
    const r400m = await request(app)
      .get(`/api/tests/sessions/${FORM}/sections/RW/modules/2B/items`)
      .set("x-test-user", WALKS[0].student);
    expect(r400m.status).toBe(400);
  });

  // ── Whole exams ────────────────────────────────────────────────────────────
  for (const walk of WALKS) {
    it(`walks a full ${walk.mode} exam answering ${walk.correct ? "everything right" : "everything wrong"}`, async () => {
      const pg = testPg!;
      const as = (r: request.Test) => r.set("x-test-user", walk.student);
      const evidence: string[] = [];

      const created = await as(request(app).post("/api/tests/sessions")).send({
        test_form_id: FORM,
        mode: walk.mode,
      });
      expect(created.status).toBe(201);
      const sid: string = created.body.session_id;
      assertNoRoutingPath(created.body);

      for (const section of ["RW", "M"] as const) {
        for (const module of ["1", "2"] as const) {
          const started = await as(
            request(app).post(
              `/api/tests/sessions/${sid}/sections/${section}/modules/${module}/start`,
            ),
          );
          expect(started.status).toBe(200);
          expect(started.body.section_state.state).toBe(
            module === "1" ? "module1_active" : "module2_active",
          );
          assertPreSubmitPayload(started.body.first_item);

          const items = await as(
            request(app).get(
              `/api/tests/sessions/${sid}/sections/${section}/modules/${module}/items`,
            ),
          );
          expect(items.status).toBe(200);
          assertNoRoutingPath(items.body);
          const served: Array<Record<string, unknown>> = items.body.items;
          expect(served.length).toBe(section === "RW" ? 27 : 22);
          served.forEach(assertPreSubmitPayload);

          // The oracle: the persisted token map + the real key, read from the DB.
          const oracle = await pg.query(
            `SELECT si.ordinal, q.item_type, q.correct_answer, si.option_token_map
               FROM public.test_session_items si JOIN public.questions q ON q.id = si.question_id
              WHERE si.test_session_id = $1 AND si.section = $2 AND left(si.module, 1) = $3`,
            [sid, section, module],
          );
          const byOrdinal = new Map(
            oracle.rows.map((r) => [r.ordinal as number, r]),
          );

          for (const item of served) {
            const o = byOrdinal.get(item.ordinal as number);
            expect(o).toBeDefined();
            let answer: string;
            if (o!.item_type === "grid_in") {
              answer = walk.correct ? " 1 " : "2"; // whitespace: stored trimmed
            } else {
              const map = o!.option_token_map as Record<string, string>;
              const pick = Object.entries(map).find(([, key]) =>
                walk.correct
                  ? key === o!.correct_answer
                  : key !== o!.correct_answer,
              );
              answer = pick![0];
              // the token is one the client was actually shown
              expect(
                (item.options as Array<{ id: string }>).map((x) => x.id),
              ).toContain(answer);
            }
            const res = await as(request(app).post("/api/tests/answer")).send({
              test_session_id: sid,
              section,
              module,
              question_id: item.question_id,
              ordinal: item.ordinal,
              answer,
              client_latency_ms: 1200,
              idempotency_key: `${sid}:${section}:${module}:${item.ordinal}`,
            });
            expect(res.status).toBe(200);
            expect(res.body.idempotent_replay).toBe(false);
            expect(res.body.stored.answer).toBe(answer);
            assertNoRoutingPath(res.body);
          }

          // THE shuffle property: what is stored is the canonical letter, and it grades.
          const stored = await pg.query(
            `SELECT a.answer, q.item_type, q.correct_answer, public.is_answer_correct(a.answer, a.question_id) AS ok
               FROM public.test_session_answers a JOIN public.questions q ON q.id = a.question_id
              WHERE a.test_session_id = $1 AND a.section = $2 AND left(a.module, 1) = $3`,
            [sid, section, module],
          );
          expect(stored.rows.length).toBe(served.length);
          for (const row of stored.rows) {
            if (row.item_type === "mcq")
              expect(["A", "B", "C", "D"]).toContain(row.answer);
            expect(row.ok).toBe(walk.correct);
          }

          const submitted = await as(
            request(app).post(
              `/api/tests/sessions/${sid}/sections/${section}/modules/${module}/submit`,
            ),
          );
          expect(submitted.status).toBe(200);
          assertNoRoutingPath(submitted.body);

          if (module === "1") {
            const path = await pg.query(
              `SELECT module2_path FROM public.test_session_sections WHERE test_session_id = $1 AND section = $2`,
              [sid, section],
            );
            const expected = walk.correct ? "B" : "A";
            expect(path.rows[0].module2_path).toBe(expected);
            evidence.push(
              `${section} M1 ${walk.correct ? served.length : 0}/${served.length} correct -> routing ${path.rows[0].module2_path}`,
            );
          }
        }
      }

      // Scored inline: no scoring call and no sweep in this file.
      const outbox = await pg.query(
        `SELECT id, event_type, status, payload ? 'student_id' AS has_student FROM public.exam_runtime_outbox WHERE aggregate_id = $1`,
        [sid],
      );
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0].event_type).toBe("test_session_completed");
      expect(outbox.rows[0].status).toBe("published");
      expect(outbox.rows[0].has_student).toBe(false);
      const score = await pg.query(
        `SELECT rw_module2_path, rw_scaled, math_module2_path, math_scaled, total_scaled
           FROM public.score_runs WHERE test_session_id = $1`,
        [sid],
      );
      expect(score.rows).toHaveLength(1);
      const s = score.rows[0];
      expect(s.total_scaled).toBe(s.rw_scaled + s.math_scaled);
      if (walk.correct) {
        expect(s.rw_scaled).toBe(800);
        expect(s.math_scaled).toBe(800);
      } else {
        expect(s.rw_scaled).toBe(200);
        expect(s.math_scaled).toBe(200);
      }

      const state = await as(
        request(app).get(`/api/tests/sessions/${sid}/state`),
      );
      expect(state.status).toBe(200);
      expect(state.body.state).toBe("completed");
      assertNoRoutingPath(state.body);

      evidence.push(
        `outbox ${outbox.rows[0].event_type} (${outbox.rows[0].status}) -> score run RW ${s.rw_scaled} (path ${s.rw_module2_path}), Math ${s.math_scaled} (path ${s.math_module2_path}), total ${s.total_scaled}`,
      );
      // Evidence for the job log: printed on purpose (the repo's pattern for PG proofs).
      process.stdout.write(
        `[exam walk ${walk.mode} ${walk.correct ? "all-correct" : "all-wrong"}] ${evidence.join(" | ")}\n`,
      );
    }, 120_000);
  }

  // ── Idempotent replay over HTTP ────────────────────────────────────────────
  it("replaying an answer's idempotency key writes nothing and returns the original response", async () => {
    const pg = testPg!;
    const student = WALKS[0].student;
    const as = (r: request.Test) => r.set("x-test-user", student);
    const created = await as(request(app).post("/api/tests/sessions")).send({
      test_form_id: FORM,
    });
    expect(created.status).toBe(201);
    const sid: string = created.body.session_id;
    const started = await as(
      request(app).post(
        `/api/tests/sessions/${sid}/sections/RW/modules/1/start`,
      ),
    );
    const item = started.body.first_item as {
      question_id: string;
      ordinal: number;
      options: Array<{ id: string }>;
    };
    const body = {
      test_session_id: sid,
      section: "RW",
      module: "1",
      question_id: item.question_id,
      ordinal: item.ordinal,
      answer: item.options[0]!.id,
      idempotency_key: "replay-key",
    };
    const first = await as(request(app).post("/api/tests/answer")).send(body);
    const again = await as(request(app).post("/api/tests/answer")).send({
      ...body,
      answer: item.options[1]!.id,
    });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.idempotent_replay).toBe(true);
    expect(again.body.stored).toEqual(first.body.stored);
    const rows = await pg.query(
      `SELECT count(*)::int AS n FROM public.test_answer_submissions WHERE test_session_id = $1`,
      [sid],
    );
    expect(rows.rows[0].n).toBe(1);
  });
});
