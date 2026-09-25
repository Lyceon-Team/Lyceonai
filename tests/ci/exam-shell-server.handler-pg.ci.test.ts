/**
 * E7a — exam shell server endpoints, HTTP handlers against real PostgreSQL.
 *
 * @spec [Doc-04A_V2.2 §8.3/§15.1 (SCL-146), §16 (SCL-145 workspace, SCL-147 forms)]
 *       [Doc-04C_V1.0 §5.3, §11.2 (payload by state), §16.1, §16.5-§16.8]
 * @implemented [2026-09-25]
 *
 * plain English: mounts the real /api/tests routers (runtime + 04C report) over a
 * throwaway database built from this repo's migrations and drives them as the shell
 * will: list forms, start a module, fetch items (real opaque tokens), save a
 * workspace with THOSE tokens and read it back, report a position on the heartbeat
 * and see it in the state read, then read the report through every state it can
 * reach — not_completed, scored, partial_scored, scoring_pending,
 * failed_requires_review, unavailable (entitlement lapsed on an owned session) —
 * and the one bare 403 for missing and foreign sessions.
 *
 * What would turn it red: a canonical letter accepted as an elimination; the
 * position leaking across modules; a report that differs for missing vs foreign
 * sessions; a score without the disclosure; any state's payload failing its strict
 * schema; a revoked student getting 403 instead of 200 unavailable.
 *
 * SCOPE AND LIMITS: as tests/ci/exam-runtime.handler-pg.ci.test.ts (SUPERUSER pg,
 * mocked auth + entitlement). Runs only where PGHOST is set; named by file in CI.
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
import { examReportPayloadSchema } from "../../packages/shared/src/exam-report-schema";

const DB_NAME = "exam_shell_server_handler_ci";
const FORM = "e7af0000-0000-4000-8000-0000000000c1";
const DRAFT = "e7af0000-0000-4000-8000-0000000000c2";
const STUDENT = "00000000-0000-0000-0000-0000000e7c01";
const OTHER = "00000000-0000-0000-0000-0000000e7c02";
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

describe.skipIf(!PG_AVAILABLE)("E7a exam shell server → real PG", () => {
  let app: Express;
  const as = (student: string) => (r: request.Test) =>
    r.set("x-test-user", student);

  beforeAll(async () => {
    testPg = await bootstrapPgDatabase(DB_NAME);
    const fixture = fs.readFileSync(
      path.resolve(__dirname, "../../scripts/ci/lib/exam-form-fixture.sql"),
      "utf-8",
    );
    await testPg.query(fixture);
    await testPg.query(
      `SELECT pg_temp.exam_fixture_make_form($1, 'H3', 20, 15)`,
      [FORM],
    );
    await testPg.query(
      `SELECT pg_temp.exam_fixture_make_form($1, 'H4', 20, 15)`,
      [DRAFT],
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
      [FORM],
    );
    await testPg.query(
      `UPDATE public.test_forms SET status = 'published', published_at = now(), name = 'Practice Test 1' WHERE id = $1`,
      [FORM],
    );
    for (const id of [STUDENT, OTHER]) {
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
      (req as unknown as { requestId: string }).requestId = "exam-shell-pg";
      next();
    });
    app.use("/api/tests", runtimeRouter);
    app.use("/api/tests", reportRouter);
  }, 180_000);

  afterAll(async () => {
    await testPg?.end();
  });

  let sid = "";
  let items: Item[] = [];

  it("GET /forms lists the published form only, with no session yet", async () => {
    const res = await as(STUDENT)(request(app).get("/api/tests/forms"));
    expect(res.status).toBe(200);
    expect(res.body.forms).toHaveLength(1);
    expect(res.body.forms[0]).toMatchObject({
      test_form_id: FORM,
      name: "Practice Test 1",
      is_selectable: true,
      question_count: 98,
      latest_session: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /routing_threshold|score_table_version|module2_path/,
    );
  });

  it("workspace: served tokens round-trip; a canonical letter is refused 400", async () => {
    const created = await as(STUDENT)(
      request(app).post("/api/tests/sessions"),
    ).send({
      test_form_id: FORM,
      mode: "strict",
    });
    expect(created.status).toBe(201);
    sid = created.body.session_id;
    const base = `/api/tests/sessions/${sid}/sections/RW/modules/1`;
    expect((await as(STUDENT)(request(app).post(`${base}/start`))).status).toBe(
      200,
    );
    const listed = await as(STUDENT)(request(app).get(`${base}/items`));
    items = listed.body.items as Item[];
    const mcq = items.find((i) => i.question_type === "multiple_choice")!;
    const [t1, t2] = [mcq.options[0]!.id, mcq.options[2]!.id];

    const put = await as(STUDENT)(request(app).put(`${base}/workspace`)).send({
      ordinal: mcq.ordinal,
      marked_for_review: true,
      eliminated_option_ids: [t1, t2],
      highlights: [],
    });
    expect(put.status).toBe(200);
    expect(put.body.item.eliminated_option_ids).toEqual([t1, t2]);

    const got = await as(STUDENT)(request(app).get(`${base}/workspace`));
    expect(got.status).toBe(200);
    expect(got.body.items).toEqual([
      {
        ordinal: mcq.ordinal,
        marked_for_review: true,
        eliminated_option_ids: [t1, t2],
        highlights: [],
      },
    ]);

    const letter = await as(STUDENT)(
      request(app).put(`${base}/workspace`),
    ).send({
      ordinal: mcq.ordinal,
      marked_for_review: false,
      eliminated_option_ids: ["A"],
      highlights: [],
    });
    expect(letter.status).toBe(400);
    expect(letter.body.error.code).toBe("invalid_workspace");

    const notes = await as(STUDENT)(request(app).put(`${base}/workspace`)).send(
      {
        ordinal: mcq.ordinal,
        marked_for_review: false,
        eliminated_option_ids: [],
        highlights: [],
        notes: "free text",
      },
    );
    expect(notes.status).toBe(400); // no notes field exists (05E INV-05E-04)

    const foreign = await as(OTHER)(request(app).get(`${base}/workspace`));
    expect(foreign.status).toBe(403);
  });

  it("heartbeat ordinal is the resume position; state reads it back", async () => {
    const hb = await as(STUDENT)(
      request(app).post(`/api/tests/sessions/${sid}/sections/RW/heartbeat`),
    ).send({ ordinal: 11 });
    expect(hb.status).toBe(200);
    const state = await as(STUDENT)(
      request(app).get(`/api/tests/sessions/${sid}/state`),
    );
    expect(state.body.sections[0].current_ordinal).toBe(11);
    expect(state.body.sections[1].current_ordinal).toBeNull();

    const empty = await as(STUDENT)(
      request(app).post(`/api/tests/sessions/${sid}/sections/RW/heartbeat`),
    );
    expect(empty.status).toBe(200); // the E6 heartbeat, unchanged
    const bad = await as(STUDENT)(
      request(app).post(`/api/tests/sessions/${sid}/sections/RW/heartbeat`),
    ).send({ ordinal: 150 });
    expect(bad.status).toBe(400);
  });

  it("report: not_completed while the exam runs; one 403 for missing and foreign", async () => {
    const mine = await as(STUDENT)(
      request(app).get(`/api/tests/sessions/${sid}/report`),
    );
    expect(mine.status).toBe(200);
    expect(mine.body.data).toMatchObject({
      report_state: "not_completed",
      session_state: "active",
      resumable: true,
    });
    expect(mine.body.meta).toMatchObject({ request_id: "exam-shell-pg" });
    examReportPayloadSchema.parse(mine.body.data);

    const foreign = await as(OTHER)(
      request(app).get(`/api/tests/sessions/${sid}/report`),
    );
    const missing = await as(OTHER)(
      request(app).get(
        `/api/tests/sessions/00000000-0000-4000-8000-00000000dead/report`,
      ),
    );
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(foreign.body.error).toEqual(missing.body.error);
    expect(foreign.body).not.toHaveProperty("data");
  });

  it("report: scored after the whole exam, disclosure from the table", async () => {
    const pg = testPg!;
    const answerAll = async (section: "RW" | "M", module: "1" | "2") => {
      const base = `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;
      if (!(section === "RW" && module === "1")) {
        expect(
          (await as(STUDENT)(request(app).post(`${base}/start`))).status,
        ).toBe(200);
      }
      const listed = (await as(STUDENT)(request(app).get(`${base}/items`))).body
        .items as Item[];
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
            : Object.entries(o.option_token_map as Record<string, string>).find(
                ([, k]) => k === o.correct_answer,
              )![0];
        const r = await as(STUDENT)(
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
      expect(
        (await as(STUDENT)(request(app).post(`${base}/submit`))).status,
      ).toBe(200);
    };
    await answerAll("RW", "1");
    await answerAll("RW", "2");
    await answerAll("M", "1");
    await answerAll("M", "2");

    const report = await as(STUDENT)(
      request(app).get(`/api/tests/sessions/${sid}/report`),
    );
    expect(report.status).toBe(200);
    const data = examReportPayloadSchema.parse(report.body.data);
    expect(data.report_state).toBe("scored");
    if (data.report_state !== "scored") return;
    expect(data.score.total_scaled).toBe(1600);
    expect(data.disclosure.summary).toMatch(
      /^Lyceon-modeled SAT score\. .* ±20-50 points or more\.$/,
    );
    const status = await as(STUDENT)(
      request(app).get(`/api/tests/sessions/${sid}/report/status`),
    );
    expect(status.body.data).toEqual({
      report_state: "scored",
      review_unlocked: true,
    });

    const forms = await as(STUDENT)(request(app).get("/api/tests/forms"));
    expect(forms.body.forms[0].latest_session).toMatchObject({
      session_id: sid,
      report_state: "scored",
    });
  }, 120_000);

  it("report: unavailable (200) when the owner's entitlement has lapsed", async () => {
    LAPSED.add(STUDENT);
    try {
      const res = await as(STUDENT)(
        request(app).get(`/api/tests/sessions/${sid}/report`),
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        report_state: "unavailable",
        unavailable_reason: "entitlement_lapsed",
      });
      expect(JSON.stringify(res.body)).not.toMatch(/scaled|disclosure/);
    } finally {
      LAPSED.delete(STUDENT);
    }
  });

  it("report: scoring_pending, then failed_requires_review on a dead-lettered event", async () => {
    const pg = testPg!;
    await pg.query("BEGIN");
    try {
      await pg.query(
        "ALTER TABLE public.score_runs DISABLE TRIGGER trg_prevent_score_runs_delete",
      );
      await pg.query(
        "DELETE FROM public.score_runs WHERE test_session_id = $1",
        [sid],
      );
      await pg.query(
        "UPDATE public.exam_runtime_outbox SET status = 'pending' WHERE aggregate_id = $1",
        [sid],
      );
      const pending = await as(STUDENT)(
        request(app).get(`/api/tests/sessions/${sid}/report`),
      );
      expect(pending.body.data).toMatchObject({
        report_state: "scoring_pending",
        estimated_ready_at: null,
      });
      examReportPayloadSchema.parse(pending.body.data);

      await pg.query(
        "UPDATE public.exam_runtime_outbox SET status = 'failed', attempts = 5, last_attempt_at = now() WHERE aggregate_id = $1",
        [sid],
      );
      const failed = await as(STUDENT)(
        request(app).get(`/api/tests/sessions/${sid}/report`),
      );
      const data = examReportPayloadSchema.parse(failed.body.data);
      expect(data.report_state).toBe("failed_requires_review");
      expect(JSON.stringify(failed.body)).not.toMatch(
        /sqlstate|failure_code|score_runs|v1\.0/,
      );
    } finally {
      await pg.query("ROLLBACK");
    }
  });

  it("report: partial_scored for an exam abandoned after RW", async () => {
    const pg = testPg!;
    const created = await as(OTHER)(
      request(app).post("/api/tests/sessions"),
    ).send({ test_form_id: FORM, mode: "lenient" });
    const osid: string = created.body.session_id;
    for (const module of ["1", "2"] as const) {
      const base = `/api/tests/sessions/${osid}/sections/RW/modules/${module}`;
      expect((await as(OTHER)(request(app).post(`${base}/start`))).status).toBe(
        200,
      );
      expect(
        (await as(OTHER)(request(app).post(`${base}/submit`))).status,
      ).toBe(200);
    }
    await pg.query(
      "UPDATE public.test_sessions SET grace_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
      [osid],
    );
    await pg.query("SELECT public.exam_abandonment_sweep()");
    const res = await as(OTHER)(
      request(app).get(`/api/tests/sessions/${osid}/report`),
    );
    const data = examReportPayloadSchema.parse(res.body.data);
    expect(data.report_state).toBe("partial_scored");
    if (data.report_state !== "partial_scored") return;
    expect(data.score.total_scaled).toBeNull();
    expect(data.completed_sections).toEqual(["RW"]);
    expect(data.partial_disclosure.summary).toMatch(
      /Math was not completed, so no total score is available\.$/,
    );
  }, 60_000);
});
