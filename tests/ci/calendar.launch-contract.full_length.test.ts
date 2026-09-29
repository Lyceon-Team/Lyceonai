/**
 * Calendar full-length adapter — launch contract, against the REAL exam engine.
 *
 * @spec [Doc-05F_V1.0 §9.1 adapter contract, §9.4 full-length adapter (G-08-02), §10.1
 *        exams{}, §13 allocator, §15.1 launch (INV-08-18); formula sheet §2 step 4;
 *        SCL-167 .. SCL-170] | @implemented [2026-09-25]
 *
 * THIS FILE USED TO TEST A STUB, and said so: "When the real engine lands, it must pass this
 * file with `create` SUCCEEDING instead of declining." The exam engine landed (E6-E9) and
 * this is that flip, made deliberately (E9b). §9.1 also requires the contract to run against
 * the real engine, "not a stub, not a mock", before `enabled_block_types` may name it — so the
 * database half below drives the student's own API path on real PostgreSQL:
 *
 *   PUT  /api/calendar/days/:date        — what CreateBlockSheet sends to add the block
 *   POST /api/calendar/blocks/:id/launch — what the Start button sends
 *     -> real launch service -> real liveLaunchDeps -> real full-length adapter
 *       -> real createExamSession -> real exam_create_session
 *   POST /api/tests/...                   — the exam itself, sat to the end
 *
 * and then reads what the calendar makes of it: the plan input's exam facts, and the
 * session-scoped review block the generator places after it.
 *
 * WHAT IS SUBSTITUTED: auth (a header names the student), and EntitlementService (a set
 * decides who lacks `exam_full_length`). Everything that decides WHAT happens is real.
 *
 * Runs where PGHOST is set; named in CI behind `vitest-summary-gate`, so a skip is red.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import pg, { type Client } from "pg";
import fs from "fs";
import path from "path";
import { launchResponseSchema, type PlanBlock } from "@lyceon/shared";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  assertSessionIdResolves,
  launchResumingExistingSession,
} from "../helpers/launch-landing";

const DB_NAME = "calendar_full_length_contract";
const FORM_1 = "e9b00000-0000-4000-8000-0000000000f1";
const FORM_2 = "e9b00000-0000-4000-8000-0000000000f2";
const STUDENT = "00000000-0000-0000-0000-00000e9b0001";
const NO_EXAM = "00000000-0000-0000-0000-00000e9b0002";
/** Students denied `exam_full_length` (they keep `calendar_access`). */
const EXAM_DENIED = new Set<string>([NO_EXAM]);

let testPg: Client | null = null;

// PostgREST sends dates and timestamps as STRINGS; node-pg parses them into Date objects.
// The calendar's row schemas are written against the real transport (`setup_completed_at:
// z.string()`), so this file's process reads them the way production does. Scoped to this
// test file's worker; the adapters normalise either form (`toIsoTimestamp`) regardless.
for (const oid of [1082, 1114, 1184])
  pg.types.setTypeParser(oid, (v: string) => v);

/** As tests/ci/exam-seams.handler-pg.ci.test.ts: node-pg cannot see an RPC's signature. */
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
    canAccessFeature: vi.fn(async (profileId: string, featureKey: string) => {
      if (featureKey === "calendar_access") return true;
      if (featureKey === "exam_full_length") return !EXAM_DENIED.has(profileId);
      return false;
    }),
  },
}));

const { fullLengthAdapter } =
  await import("../../server/services/calendar/adapters/full-length");

const PURE_BLOCK: PlanBlock = {
  block_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  scheduled_date: "2026-09-18",
  block_type: "full_length",
  section: null,
  scope: { form_id: null, exam_mode: "strict" },
  target_count: 1,
  source: "auto",
  derived_from_block_id: null,
  explanation_key: null,
  display_ordinal: 1,
  membership_type: "created",
};

describe("full-length adapter — the §9.1 contract, engine-independent items", () => {
  it("(1) names its engine, and the name is the block type", () => {
    expect(fullLengthAdapter.engine).toBe("full_length");
    expect(fullLengthAdapter.engine).toBe(PURE_BLOCK.block_type);
  });

  it("(5) nextLaunchSize is 1 — one sitting — not the stub's `remaining` (§9.4)", async () => {
    await expect(fullLengthAdapter.nextLaunchSize(PURE_BLOCK, 7)).resolves.toBe(
      1,
    );
    await expect(fullLengthAdapter.nextLaunchSize(PURE_BLOCK, 1)).resolves.toBe(
      1,
    );
  });

  it("resumeHref is the exam's own session route, never practice's or review's", () => {
    const id = "5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b";
    expect(fullLengthAdapter.resumeHref(id)).toBe(`/tests/${id}`);
  });

  it("refuses a block of the wrong type as DATA, never a throw", async () => {
    const practice = {
      ...PURE_BLOCK,
      block_type: "practice",
      section: "M",
      scope: { level: "section", count: 5, explanation_key: "cold_start" },
      target_count: 5,
    } as PlanBlock;
    const result = await fullLengthAdapter.create(practice, 1, {
      student_id: STUDENT,
      actor_id: STUDENT,
      role: "student",
      client_instance_id: "ci",
      platform: "web",
      idempotency_key: "calendar:block:x:1",
    });
    expect(result.ok).toBe(false);
  });
});

type Item = {
  question_id: string;
  ordinal: number;
  question_type: string;
};

describe.skipIf(!PG_AVAILABLE)(
  "full-length adapter — against the REAL exam engine, through the calendar's own routes",
  () => {
    let app: Express;
    let today = "";
    let gv = "";
    let blockA = "";
    let sid = "";
    const evidence: Record<string, unknown> = {};
    const as = (student: string) => (r: request.Test) =>
      r.set("x-test-user", student);
    const q = async (sql: string, args: unknown[] = []) =>
      (await testPg!.query(sql, args)).rows;

    beforeAll(async () => {
      testPg = await bootstrapPgDatabase(DB_NAME);
      const fixture = fs.readFileSync(
        path.resolve(__dirname, "../../scripts/ci/lib/exam-form-fixture.sql"),
        "utf-8",
      );
      await testPg.query(fixture);
      for (const [form, tag, name, at] of [
        [FORM_1, "B1", "Practice Test 1", "2026-01-01T00:00:00Z"],
        [FORM_2, "B2", "Practice Test 2", "2026-01-02T00:00:00Z"],
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
          `UPDATE public.test_forms SET status = 'published', published_at = $2, name = $3 WHERE id = $1`,
          [form, at, name],
        );
      }
      for (const [id, email] of [
        [STUDENT, "e9b@example.test"],
        [NO_EXAM, "e9b-denied@example.test"],
      ] as const) {
        await testPg.query(
          `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
          [id, email],
        );
        await testPg.query(
          `INSERT INTO public.profiles (id, email, role) VALUES ($1::uuid, $2, 'student')`,
          [id, email],
        );
        // UTC so "today" is the server's date; every day a study day; the most minutes
        // the settings sheet allows, so the exam review is sized by its missed count and
        // not clamped by the day's budget. No test weekday: the only exams on this
        // student's plan are the ones the test adds, exactly as a student would.
        await testPg.query(
          `INSERT INTO public.student_study_profile
             (student_id, timezone, study_days_mask, daily_minutes, full_length_weekday,
              target_score, setup_completed_at)
           VALUES ($1, 'UTC', 127, 180, NULL, 1400, now())`,
          [id],
        );
      }
      today = (await q(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS d`))[0]
        .d as string;
      gv = (
        await q(
          `SELECT value #>> '{}' AS v FROM public.calendar_runtime_config WHERE key = 'generator_version'`,
        )
      )[0].v as string;
      for (const id of [STUDENT, NO_EXAM]) {
        await q(
          `SELECT public.calendar_persist_version($1, 'setup', 'student', $2, NULL)`,
          [id, gv],
        );
      }

      const { calendarRouter } =
        await import("../../server/routes/calendar-routes");
      const { default: runtimeRouter } =
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
        (req as unknown as { requestId: string }).requestId = "e9b-contract";
        next();
      });
      app.use("/api/calendar", calendarRouter);
      app.use("/api/tests", runtimeRouter);
    }, 240_000);

    afterAll(async () => {
      await testPg?.end();
    });

    /** Today's full-length blocks, in display order — what the sheet would show. */
    async function todaysFullLengths(
      student: string,
    ): Promise<Array<{ block_id: string; scope: Record<string, unknown> }>> {
      return (await q(
        `SELECT b.block_id::text, b.scope FROM public.calendar_current_plan cp
           JOIN public.calendar_blocks b ON b.block_id = cp.block_id
          WHERE cp.student_id = $1 AND cp.scheduled_date = $2 AND b.block_type = 'full_length'
          ORDER BY cp.display_ordinal`,
        [student, today],
      )) as Array<{ block_id: string; scope: Record<string, unknown> }>;
    }

    /** PUT /api/calendar/days/:today — the §12.4 day edit CreateBlockSheet sends. */
    async function editToday(
      student: string,
      members: unknown[],
    ): Promise<void> {
      const res = await as(student)(
        request(app).put(`/api/calendar/days/${today}`),
      ).send({
        members,
        idempotency_key: crypto.randomUUID(),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const fullLength = (scope: Record<string, unknown>) => ({
      kind: "created",
      block: {
        block_type: "full_length",
        section: null,
        scope,
        target_count: 1,
        explanation_key: null,
      },
    });
    const launch = (student: string, blockId: string) =>
      as(student)(
        request(app).post(`/api/calendar/blocks/${blockId}/launch`),
      ).send({
        client_instance_id: "ci-e9b",
        platform: "web",
      });
    /** The client's own unwrap: the routes spread `requestId`, the shared schema is strict. */
    function parseLaunch(body: Record<string, unknown>) {
      const { requestId: _requestId, ...rest } = body;
      return launchResponseSchema.parse(rest);
    }

    it("(2) a block the student adds starts a REAL exam session through the launch route, with a launch row", async () => {
      await editToday(STUDENT, [
        fullLength({ form_id: null, exam_mode: "strict" }),
      ]);
      const blocks = await todaysFullLengths(STUDENT);
      expect(blocks).toHaveLength(1);
      blockA = blocks[0]!.block_id;

      const res = await launch(STUDENT, blockA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = parseLaunch(res.body as Record<string, unknown>);
      expect(body.engine).toBe("full_length");
      expect(body.resumed).toBe(false);
      expect(body.next).toBe(`/tests/${body.session_id}`);
      expect(body.next).toBe(fullLengthAdapter.resumeHref(body.session_id));
      sid = body.session_id;

      // A real engine_session_id: the row exists, on the first never-completed form, with
      // the block's timing, for this student.
      const session = await q(
        `SELECT student_id::text, test_form_id::text, mode, state FROM public.test_sessions WHERE id = $1`,
        [sid],
      );
      expect(session).toEqual([
        {
          student_id: STUDENT,
          test_form_id: FORM_1,
          mode: "strict",
          state: "created",
        },
      ]);
      const links = await q(
        `SELECT block_id::text, launch_sequence, engine, engine_session_id::text
           FROM public.calendar_block_launches WHERE block_id = $1`,
        [blockA],
      );
      expect(links).toEqual([
        {
          block_id: blockA,
          launch_sequence: 1,
          engine: "full_length",
          engine_session_id: sid,
        },
      ]);
      evidence.first_launch = {
        response: body,
        test_session: session[0],
        calendar_block_launches: links,
      };
    });

    it("launching twice returns the SAME session, not two", async () => {
      const res = await launch(STUDENT, blockA);
      expect(res.status).toBe(200);
      const body = parseLaunch(res.body as Record<string, unknown>);
      expect(body.session_id).toBe(sid);
      expect(body.resumed).toBe(true);
      expect(body.next).toBe(`/tests/${sid}`);
      const n = await q(
        `SELECT count(*)::int AS n FROM public.test_sessions WHERE student_id = $1`,
        [STUDENT],
      );
      expect(n[0].n).toBe(1);
      evidence.second_launch = body;
    });

    it("a block naming a DIFFERENT test while one is live is refused like every engine refusal (502), and starts nothing", async () => {
      await editToday(STUDENT, [
        { kind: "carried", block_id: blockA },
        fullLength({ form_id: FORM_2, exam_mode: "lenient" }),
      ]);
      const blocks = await todaysFullLengths(STUDENT);
      const blockB = blocks.find((b) => b.block_id !== blockA)!.block_id;
      const res = await launch(STUDENT, blockB);
      expect(res.status).toBe(502);
      expect(JSON.stringify(res.body)).toContain("CALENDAR_ENGINE_ERROR");
      const n = await q(
        `SELECT count(*)::int AS n FROM public.test_sessions WHERE student_id = $1`,
        [STUDENT],
      );
      expect(n[0].n).toBe(1);
      const links = await q(
        `SELECT count(*)::int AS n FROM public.calendar_block_launches WHERE block_id = $1`,
        [blockB],
      );
      expect(links[0].n).toBe(0);
      evidence.different_form = { status: res.status, body: res.body };
    });

    it("without exam_full_length, calendar_access alone cannot start an exam", async () => {
      await editToday(NO_EXAM, [
        fullLength({ form_id: null, exam_mode: "strict" }),
      ]);
      const [block] = await todaysFullLengths(NO_EXAM);
      const res = await launch(NO_EXAM, block!.block_id);
      expect(res.status).toBe(502);
      const n = await q(
        `SELECT count(*)::int AS n FROM public.test_sessions WHERE student_id = $1`,
        [NO_EXAM],
      );
      expect(n[0].n).toBe(0);
    });

    it("the resume branch lands in the EXAM's route, and the id is a test_sessions row and nothing else", async () => {
      const block: PlanBlock = {
        ...PURE_BLOCK,
        block_id: blockA,
        scheduled_date: today,
      };
      const result = await launchResumingExistingSession({
        adapter: fullLengthAdapter,
        engine: "full_length",
        sessionId: sid,
        block,
        studentId: STUDENT,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.next).toBe(`/tests/${sid}`);
      const counts = await assertSessionIdResolves(
        testPg!,
        sid,
        "test_sessions",
        "practice_sessions",
      );
      expect(counts).toEqual({ own: 1, foreign: 0 });
    });

    /** The canonical letter behind a served token (the test reads it; the client never can). */
    async function tokenFor(
      section: string,
      module: string,
      ordinal: number,
      letter: string,
    ): Promise<string> {
      const r = await q(
        `SELECT option_token_map FROM public.test_session_items
          WHERE test_session_id = $1 AND section = $2 AND ordinal = $3
            AND (module = $4 OR ($4 = '2' AND module IN ('2A','2B')))`,
        [sid, section, ordinal, module],
      );
      const map = r[0]?.option_token_map as Record<string, string>;
      const hit = Object.entries(map).find(([, k]) => k === letter);
      if (!hit) throw new Error(`no token for ${letter}`);
      return hit[0];
    }
    async function sitModule(
      section: "RW" | "M",
      module: "1" | "2",
    ): Promise<void> {
      const base = `/api/tests/sessions/${sid}/sections/${section}/modules/${module}`;
      expect(
        (await as(STUDENT)(request(app).post(`${base}/start`))).status,
      ).toBe(200);
      const items = (await as(STUDENT)(request(app).get(`${base}/items`))).body
        .items as Item[];
      for (const it of items) {
        const k = it.ordinal % 4; // correct · wrong · never answered · explicit omit
        if (k === 2) continue;
        let answer: string | null = null;
        if (k === 0 || k === 1) {
          answer =
            it.question_type === "multiple_choice"
              ? await tokenFor(section, module, it.ordinal, k === 0 ? "A" : "B")
              : k === 0
                ? "1"
                : "2";
        }
        const res = await as(STUDENT)(
          request(app).post("/api/tests/answer"),
        ).send({
          test_session_id: sid,
          section,
          module,
          question_id: it.question_id,
          ordinal: it.ordinal,
          answer,
          idempotency_key: `e9b:${section}:${module}:${it.ordinal}`,
        });
        expect(res.status).toBe(200);
      }
      expect(
        (await as(STUDENT)(request(app).post(`${base}/submit`))).status,
      ).toBe(200);
    }

    it("(3)(4) the exam, sat to the end: progress is completed and it is one activity unit carrying its form", async () => {
      await sitModule("RW", "1");
      await sitModule("RW", "2");
      await sitModule("M", "1");
      await sitModule("M", "2");
      const outbox = await q(
        `SELECT event_type, status, result->>'outcome' AS outcome FROM public.exam_runtime_outbox
          WHERE aggregate_id = $1 ORDER BY created_at`,
        [sid],
      );
      expect(outbox.map((o) => [o.event_type, o.status])).toEqual([
        ["test_session_completed", "published"],
        ["test_session_scored", "published"],
      ]);
      expect(outbox[1].outcome).toBe("applied");

      await expect(fullLengthAdapter.progress(sid)).resolves.toBe("completed");
      const units = await fullLengthAdapter.activityUnits(
        STUDENT,
        today,
        "UTC",
      );
      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({
        engine: "full_length",
        unit_id: sid,
        form_id: FORM_1,
        local_date: today,
      });
      evidence.activity_units = units;
    }, 240_000);

    it("the plan input carries the exam — every fact from its owner — and degraded[] is empty", async () => {
      const input = (
        await q(
          `SELECT public.calendar_build_plan_input($1, ARRAY(SELECT generate_series($2::date, $2::date + 13, '1 day')::date)) AS i`,
          [STUDENT, today],
        )
      )[0].i as { exams: Record<string, unknown>; degraded: unknown[] };

      const missed = (
        await q(
          `SELECT count(*)::int AS n FROM public.review_schedule r
             JOIN public.servable_questions sq ON sq.id = r.question_id
            WHERE r.student_id = $1 AND r.source_engine = 'full_length'
              AND r.source_session_id = $2 AND r.status = 'active'`,
          [STUDENT, sid],
        )
      )[0].n as number;
      // Doc 05B's own table, read here independently: the domains at level <= 1, in the
      // calendar's canonical order. The builder must agree with it, not compute its own set.
      const weak = (
        await q(
          `SELECT coalesce(jsonb_agg(d.domain ORDER BY d.ord), '[]'::jsonb) AS w
             FROM jsonb_array_elements_text((SELECT value FROM public.calendar_runtime_config WHERE key = 'canonical_domain_order'))
                  WITH ORDINALITY AS d(domain, ord)
             JOIN public.student_domain_mastery m ON m.student_id = $1 AND m.domain = d.domain
            WHERE m.mastery_level <= 1`,
          [STUDENT],
        )
      )[0].w as string[];

      expect(missed).toBeGreaterThan(0);
      expect(input.degraded).toEqual([]);
      expect(input.exams).toEqual({
        last_completed_local_date: today,
        days_since_exam: 0,
        missed_count: missed,
        reviewed: false,
        weak_domains: weak,
        source_session_id: sid,
      });
      evidence.plan_input_exams = input.exams;
      evidence.plan_input_degraded = input.degraded;
      evidence.student_domain_mastery = await q(
        `SELECT section, domain, mastery_level, event_count_total FROM public.student_domain_mastery
          WHERE student_id = $1 ORDER BY section DESC, domain`,
        [STUDENT],
      );
    });

    it("the generator places THAT exam's review — a session review, sized by its real missed count", async () => {
      const missed = (
        await q(
          `SELECT (public.calendar_build_plan_input($1, ARRAY[$2::date]) #>> '{exams,missed_count}')::int AS n`,
          [STUDENT, today],
        )
      )[0].n as number;
      const days = (
        await q(
          `SELECT public.calendar_compute_plan(public.calendar_build_plan_input($1,
                    ARRAY(SELECT generate_series($2::date, $2::date + 13, '1 day')::date))) -> 'days' AS d`,
          [STUDENT, today],
        )
      )[0].d as Array<{ date: string; blocks: Array<Record<string, unknown>> }>;
      const reviews = days.flatMap((d) =>
        d.blocks
          .filter((b) => b.explanation_key === "exam_review")
          .map((b) => ({ date: d.date, ...b })),
      );
      // One, on the FIRST study day of the horizon (formula sheet §2 step 4, as the oracle
      // implements it) -- which, generated on the exam's own day, is that day.
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        date: today,
        block_type: "review",
        target_count: missed,
        scope: {
          mode: "session",
          source_engine: "full_length",
          source_session_id: sid,
        },
      });
      evidence.generated_exam_review = reviews[0];
      evidence.missed_count = missed;
    });

    it("a regeneration that does not own that day drops it — the finding reported with this change", async () => {
      // Today carries the student's own edit (the exam block), so student_refresh does not
      // own it and calendar_drop_unowned_dates removes its members -- the exam review with
      // them. weekly and post_exam never own today (R-08-32). Recorded, not worked around:
      // the placement is the oracle's, and changing it is a formula decision.
      await q(
        `SELECT public.calendar_persist_version($1, 'student_refresh', 'student', $2, NULL)`,
        [STUDENT, gv],
      );
      const persisted = await q(
        `SELECT count(*)::int AS n FROM public.calendar_current_plan cp
           JOIN public.calendar_blocks b ON b.block_id = cp.block_id
          WHERE cp.student_id = $1 AND b.explanation_key = 'exam_review'`,
        [STUDENT],
      );
      expect(persisted[0].n).toBe(0);
    });

    it("the student's own Reset on that day persists it, and Start launches a SESSION review of the exam", async () => {
      const reset = await as(STUDENT)(
        request(app).post(`/api/calendar/days/${today}/reset`),
      ).send({
        idempotency_key: crypto.randomUUID(),
      });
      expect(reset.status, JSON.stringify(reset.body)).toBe(200);
      const missed = evidence.missed_count as number;
      const rows = await q(
        `SELECT b.block_id::text, b.scope, b.target_count, b.explanation_key
           FROM public.calendar_current_plan cp JOIN public.calendar_blocks b ON b.block_id = cp.block_id
          WHERE cp.student_id = $1 AND cp.scheduled_date = $2 AND b.block_type = 'review'`,
        [STUDENT, today],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        explanation_key: "exam_review",
        target_count: missed,
        scope: {
          mode: "session",
          source_engine: "full_length",
          source_session_id: sid,
        },
      });
      // The started exam block survives the reset (V-12): it is protected state.
      expect(
        (await todaysFullLengths(STUDENT)).map((b) => b.block_id),
      ).toContain(blockA);

      const res = await launch(STUDENT, rows[0]!.block_id as string);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = parseLaunch(res.body as Record<string, unknown>);
      expect(body.engine).toBe("review");
      expect(body.next).toBe(`/review/session/${body.session_id}`);
      const session = await q(
        `SELECT mode, filters->>'source_engine' AS source_engine,
                filters->>'source_session_id' AS source_session_id, target_count
           FROM public.review_sessions WHERE id = $1`,
        [body.session_id],
      );
      expect(session).toEqual([
        {
          mode: "session",
          source_engine: "full_length",
          source_session_id: sid,
          target_count: missed,
        },
      ]);
      const links = await q(
        `SELECT engine, engine_session_id::text FROM public.calendar_block_launches WHERE block_id = $1`,
        [rows[0]!.block_id],
      );
      expect(links).toEqual([
        { engine: "review", engine_session_id: body.session_id },
      ]);
      evidence.post_exam_review_block = rows[0];
      evidence.exam_review_launch = {
        response: body,
        review_session: session[0],
        calendar_block_launches: links,
      };
    });

    it("the next test is the one never sat, at the block's own timing", async () => {
      await editToday(STUDENT, [
        { kind: "carried", block_id: blockA },
        fullLength({ form_id: null, exam_mode: "lenient" }),
      ]);
      const blocks = await todaysFullLengths(STUDENT);
      const next = blocks.find(
        (b) => b.block_id !== blockA && b.scope.exam_mode === "lenient",
      )!;
      const res = await launch(STUDENT, next.block_id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = parseLaunch(res.body as Record<string, unknown>);
      expect(body.resumed).toBe(false);
      const session = await q(
        `SELECT test_form_id::text, mode FROM public.test_sessions WHERE id = $1`,
        [body.session_id],
      );
      expect(session).toEqual([{ test_form_id: FORM_2, mode: "lenient" }]);

      // eslint-disable-next-line no-console -- evidence for the PR
      console.log(
        "E9b EVIDENCE " +
          JSON.stringify({ ...evidence, next_test: session[0] }, null, 1),
      );
    });
  },
);
