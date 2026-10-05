/**
 * OQ-30 — GET /api/tests/sessions?state=scored, HTTP handler against real PostgreSQL.
 *
 * @spec [Doc-04C_V1.0 §16.3 (multi-session listing), §15.1 (disclosure), §16.8 (envelope)]
 *       [Doc-04A_V2.2 §16.1 step 2, §16.2; SCL-185 (UI-01 entitlement denial)]
 *       [Owner ruling (Karl) 2026-10-02, student-ui register §9 OQ-30; OQ-31]
 * @implemented [2026-10-03]
 *
 * plain English: mounts the real /api/tests routers over a throwaway database built from this
 * repo's migrations and sits REAL exams through them — no hand-written score rows. One student
 * finishes two exams on two different forms (the first with every RW answer right and Math
 * left blank, so rw_scaled != math_scaled and a swapped column cannot pass; the second blank),
 * abandons a third after RW (partial_scored) and leaves a fourth in progress. Another student
 * finishes one. The list must hold exactly the first student's two scored sessions, newest
 * first, each row equal to what that session's own /report says (a round trip through the
 * real producer of the same numbers).
 *
 * What would turn it red: another student's session, a partial/in-progress session, a wrong
 * order or tie-break, a key beyond the seven, a swapped score column, a missing disclosure
 * shipping as a score, an unpaid caller getting anything but the UI-01 403, a bad `state`
 * getting anything but 400.
 *
 * SCOPE AND LIMITS: as tests/ci/exam-shell-server.handler-pg.ci.test.ts (SUPERUSER pg, mocked
 * auth + entitlement). Runs only where PGHOST is set; named by file in CI.
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
import { examScoredSessionsPayloadSchema } from "../../packages/shared/src/exam-scored-sessions-schema";
import { examStudentReportPayloadSchema } from "../../packages/shared/src/exam-student-report-schema";
import { readEntitlementDenial } from "../../packages/shared/src/entitlement-denial";

/** Every key name at any depth of a JSON body. */
function keysDeep(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysDeep(v, acc);
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      keysDeep(v, acc);
    }
  }
  return acc;
}

function evidence(label: string, value: unknown): void {
  process.stdout.write(`OQ-30 EVIDENCE ${label} ${JSON.stringify(value)}\n`);
}

const DB_NAME = "exam_scored_sessions_handler_ci";
const FORM_1 = "0c300000-0000-4000-8000-0000000000f1";
const FORM_2 = "0c300000-0000-4000-8000-0000000000f2";
const STUDENT = "00000000-0000-0000-0000-0000000c3001";
const OTHER = "00000000-0000-0000-0000-0000000c3002";
const FREE = "00000000-0000-0000-0000-0000000c3003";
const UNPAID = new Set<string>([FREE]);

const ROW_KEYS = [
  "completed_at",
  "disclosure",
  "math_scaled",
  "rw_scaled",
  "session_id",
  "test_form_name",
  "total_scaled",
];

let testPg: Client | null = null;

function jsonArgs(
  args?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!args) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] =
      v !== null && typeof v === "object" && k !== "p_eliminated"
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
    requireGuardianLinkForUnder13: pass,
  };
}
vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: vi.fn(
      async (profileId: string, featureKey: string) =>
        featureKey === "exam_full_length" && !UNPAID.has(profileId),
    ),
  },
}));

type Item = { question_id: string; ordinal: number };

describe.skipIf(!PG_AVAILABLE)(
  "OQ-30 GET /api/tests/sessions?state=scored → real PG",
  () => {
    let app: Express;
    const as = (student: string) => (r: request.Test) =>
      r.set("x-test-user", student);
    const list = (student: string, query = "?state=scored") =>
      as(student)(request(app).get(`/api/tests/sessions${query}`));

    /** Sits one module: start (unless already started), answer if asked, submit. */
    async function sitModule(
      student: string,
      sid: string,
      section: "RW" | "M",
      module: "1" | "2",
      answerCorrectly: boolean,
    ): Promise<void> {
      const pg = testPg!;
      const base = `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;
      expect(
        (await as(student)(request(app).post(`${base}/start`))).status,
      ).toBe(200);
      if (answerCorrectly) {
        const listed = (await as(student)(request(app).get(`${base}/items`)))
          .body.items as Item[];
        const oracle = await pg.query(
          `SELECT si.ordinal, q.item_type, q.correct_answer, si.option_token_map
             FROM public.test_session_items si JOIN public.questions q ON q.id = si.question_id
            WHERE si.test_session_id = $1 AND si.section = $2 AND left(si.module, 1) = $3`,
          [sid, section, module],
        );
        const byOrdinal = new Map(
          oracle.rows.map((r) => [r.ordinal as number, r]),
        );
        for (const item of listed) {
          const o = byOrdinal.get(item.ordinal)!;
          const answer =
            o.item_type === "grid_in"
              ? "1"
              : Object.entries(
                  o.option_token_map as Record<string, string>,
                ).find(([, k]) => k === o.correct_answer)![0];
          const r = await as(student)(
            request(app).post("/api/tests/answer"),
          ).send({
            test_session_id: sid,
            section,
            module,
            question_id: item.question_id,
            ordinal: item.ordinal,
            answer,
            idempotency_key: `${sid}:${section}:${module}:${item.ordinal}`,
          });
          expect(r.status).toBe(200);
        }
      }
      expect(
        (await as(student)(request(app).post(`${base}/submit`))).status,
      ).toBe(200);
    }

    async function createSession(
      student: string,
      form: string,
    ): Promise<string> {
      const created = await as(student)(
        request(app).post("/api/tests/sessions"),
      ).send({ test_form_id: form, mode: "strict" });
      expect(created.status).toBe(201);
      return created.body.session_id as string;
    }

    async function sitWholeExam(
      student: string,
      form: string,
      rwCorrect: boolean,
    ): Promise<string> {
      const sid = await createSession(student, form);
      await sitModule(student, sid, "RW", "1", rwCorrect);
      await sitModule(student, sid, "RW", "2", rwCorrect);
      await sitModule(student, sid, "M", "1", false);
      await sitModule(student, sid, "M", "2", false);
      return sid;
    }

    let scoredA = ""; // STUDENT, form 1, RW right / Math blank — finished first
    let scoredB = ""; // STUDENT, form 2, blank — finished second (newest)
    let partialC = ""; // STUDENT, abandoned after RW
    let inProgressD = ""; // STUDENT, still running
    let otherScored = ""; // OTHER, finished

    beforeAll(async () => {
      testPg = await bootstrapPgDatabase(DB_NAME);
      const fixture = fs.readFileSync(
        path.resolve(__dirname, "../../scripts/ci/lib/exam-form-fixture.sql"),
        "utf-8",
      );
      await testPg.query(fixture);
      for (const [form, tag, name] of [
        [FORM_1, "Q1", "Practice Test 1"],
        [FORM_2, "Q2", "Practice Test 2"],
      ] as const) {
        await testPg.query(
          `SELECT pg_temp.exam_fixture_make_form($1, $2, 20, 15)`,
          [form, tag],
        );
        await testPg.query(
          `UPDATE public.questions q
              SET options = jsonb_build_array(
                    jsonb_build_object('key','A','text','Choice A of ' || q.id),
                    jsonb_build_object('key','B','text','Choice B of ' || q.id),
                    jsonb_build_object('key','C','text','Choice C of ' || q.id),
                    jsonb_build_object('key','D','text','Choice D of ' || q.id))
             FROM public.test_form_items fi
            WHERE fi.question_id = q.id AND fi.test_form_id = $1 AND q.item_type = 'mcq'`,
          [form],
        );
        await testPg.query(
          `UPDATE public.test_forms SET status = 'published', published_at = now(), name = $2 WHERE id = $1`,
          [form, name],
        );
      }
      for (const id of [STUDENT, OTHER, FREE]) {
        await testPg.query(
          `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
          [id, `${id}@example.test`],
        );
        await testPg.query(
          `INSERT INTO public.profiles (id, email, role) VALUES ($1::uuid, $2, 'student')`,
          [id, `${id}@example.test`],
        );
      }
      const { default: runtimeRouter } =
        await import("../../server/routes/exam-runtime-routes");
      const { default: reportRouter } =
        await import("../../server/routes/exam-report-routes");
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
        (req as unknown as { requestId: string }).requestId = "oq30-pg";
        next();
      });
      app.use("/api/tests", runtimeRouter);
      app.use("/api/tests", reportRouter);

      scoredA = await sitWholeExam(STUDENT, FORM_1, true);
      scoredB = await sitWholeExam(STUDENT, FORM_2, false);
      otherScored = await sitWholeExam(OTHER, FORM_1, false);

      partialC = await createSession(STUDENT, FORM_1);
      await sitModule(STUDENT, partialC, "RW", "1", false);
      await sitModule(STUDENT, partialC, "RW", "2", false);
      await testPg.query(
        "UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
        [partialC],
      );
      await testPg.query("SELECT public.exam_abandonment_sweep()");

      inProgressD = await createSession(STUDENT, FORM_2);
      await sitModule(STUDENT, inProgressD, "RW", "1", false);
    }, 600_000);

    afterAll(async () => {
      await testPg?.end();
    });

    it("the fixture really holds four states for STUDENT and one scored for OTHER", async () => {
      const states = await testPg!.query(
        `SELECT s.id, s.state, r.total_scaled, r.rw_scaled, r.math_scaled
           FROM public.test_sessions s LEFT JOIN public.score_runs r ON r.test_session_id = s.id
          WHERE s.id = ANY($1::uuid[])`,
        [[scoredA, scoredB, partialC, inProgressD, otherScored]],
      );
      const byId = new Map(states.rows.map((r) => [r.id as string, r]));
      expect(byId.get(scoredA)).toMatchObject({ state: "completed" });
      expect(byId.get(scoredB)).toMatchObject({ state: "completed" });
      expect(byId.get(otherScored)).toMatchObject({ state: "completed" });
      expect(byId.get(partialC)).toMatchObject({
        state: "partial_scored_abandoned",
        total_scaled: null,
      });
      expect(byId.get(inProgressD)!.state).not.toMatch(/completed|abandoned/);
      // The fixture can separate the two section columns.
      expect(byId.get(scoredA)!.rw_scaled).not.toBe(
        byId.get(scoredA)!.math_scaled,
      );
    });

    it("paid student: exactly the two scored sessions, newest first, each equal to its own /report", async () => {
      const res = await list(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ request_id: "oq30-pg" });
      const data = examScoredSessionsPayloadSchema.parse(res.body.data);
      evidence("student list", res.body.data);
      expect(data.sessions.map((s) => s.session_id)).toEqual([
        scoredB,
        scoredA,
      ]);
      for (const row of res.body.data.sessions as object[]) {
        expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
      }
      // Round trip: each row equals the real per-session report's numbers.
      for (const row of data.sessions) {
        const report = await as(STUDENT)(
          request(app).get(`/api/tests/sessions/${row.session_id}/report`),
        );
        const r = examStudentReportPayloadSchema.parse(report.body.data);
        if (r.report_state !== "scored") throw new Error("expected scored");
        expect(row).toEqual({
          session_id: r.session_id,
          test_form_name: r.test_form_name,
          completed_at: r.completed_at,
          total_scaled: r.score.total_scaled,
          rw_scaled: r.score.rw_scaled,
          math_scaled: r.score.math_scaled,
          disclosure: r.disclosure,
        });
      }
      const [b, a] = data.sessions;
      expect(a!.test_form_name).toBe("Practice Test 1");
      expect(b!.test_form_name).toBe("Practice Test 2");
      expect(a!.rw_scaled).toBeGreaterThan(a!.math_scaled);
      expect(a!.total_scaled).toBe(a!.rw_scaled + a!.math_scaled);
      expect(Date.parse(b!.completed_at)).toBeGreaterThan(
        Date.parse(a!.completed_at),
      );
    });

    it("anti-leak: rows present first, then no answer/explanation/count/decomposition key anywhere", async () => {
      const res = await list(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body.data.sessions).toHaveLength(2);
      const keys = keysDeep(res.body);
      expect(keys.has("total_scaled")).toBe(true);
      expect(keys.has("summary")).toBe(true);
      expect(
        [
          "correct_answer",
          "explanation",
          "correct",
          "total",
          "correct_variants",
          "option_metadata",
          "question_id",
          "answer",
          "domain_breakdown",
          "domain_segments",
          "module2_path",
          "rw_module2_path",
          "rw_module1_correct",
          "math_module1_correct",
          "routing_threshold_rw",
          "score_table_version",
          "score_run_id",
          "items",
        ].filter((k) => keys.has(k)),
      ).toEqual([]);
    });

    it("ties on completed_at are broken by session id, descending", async () => {
      const pg = testPg!;
      await pg.query("BEGIN");
      try {
        await pg.query(
          `UPDATE public.test_sessions SET completed_at = (SELECT completed_at FROM public.test_sessions WHERE id = $1)
            WHERE id = $2`,
          [scoredA, scoredB],
        );
        const res = await list(STUDENT);
        expect(res.status).toBe(200);
        const ids = (
          res.body.data.sessions as Array<{ session_id: string }>
        ).map((s) => s.session_id);
        expect(ids).toEqual([scoredA, scoredB].sort().reverse());
      } finally {
        await pg.query("ROLLBACK");
      }
    });

    it("another student's sessions never appear, in either direction", async () => {
      const mine = await list(STUDENT);
      expect(
        (mine.body.data.sessions as Array<{ session_id: string }>).map(
          (s) => s.session_id,
        ),
      ).not.toContain(otherScored);
      const theirs = await list(OTHER);
      expect(theirs.status).toBe(200);
      expect(
        (theirs.body.data.sessions as Array<{ session_id: string }>).map(
          (s) => s.session_id,
        ),
      ).toEqual([otherScored]);
    });

    it("free student: 403 with the UI-01 exam denial body", async () => {
      const res = await list(FREE);
      expect(res.status).toBe(403);
      expect(res.body.error).toEqual({
        code: "entitlement_required",
        message: "Full-length exams need an active subscription.",
        details: { feature: "exam_full_length" },
      });
      expect(res.body).not.toHaveProperty("data");
      expect(readEntitlementDenial(res.body)).toEqual({
        feature: "exam_full_length",
        message: "Full-length exams need an active subscription.",
      });
    });

    it("bad or missing state: 400 invalid_request", async () => {
      for (const q of [
        "?state=completed",
        "?state=partial_scored",
        "",
        "?state=scored&state=scored",
        "?state=scored&limit=500",
      ]) {
        const res = await list(STUDENT, q);
        expect(res.status, q).toBe(400);
        expect(res.body.error.code, q).toBe("invalid_request");
        expect(res.body).not.toHaveProperty("data");
      }
    });

    it("unauthenticated: 401", async () => {
      const res = await request(app).get("/api/tests/sessions?state=scored");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
    });

    it("a score without its disclosure is a 500, never shipped", async () => {
      const pg = testPg!;
      await pg.query("BEGIN");
      try {
        await pg.query("DELETE FROM public.score_disclosure_versions");
        const res = await list(STUDENT);
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe("report_data_integrity_violation");
        expect(JSON.stringify(res.body)).not.toMatch(/scaled/);
      } finally {
        await pg.query("ROLLBACK");
      }
    });
  },
);
