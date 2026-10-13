/**
 * The practice runner's server reads → real PG proof: F-64 (two `/next` at once) and OQ-35
 * (a session shorter than asked for says so, with no number).
 *
 * @spec [student-UI register §8 F-64 ("two concurrent GET /api/practice/sessions/:id/next on one
 *        session: both 200 with the same item, or one 409, never a 500"); register §9 OQ-35,
 *        owner ruling (Karl) 2026-10-02: "serve the shorter session and say 'Fewer questions
 *        match these filters, so this session is shorter.' No number"; register §2 Content rules
 *        (students never see bank counts); Coding Standards §4.2 (idempotent mutations), §5.2
 *        (no reveal before submit)] | @implemented [2026-10-03]
 *
 * plain English:
 *   - F-64. A session is created and its first item answered through the REAL routes; then two
 *     `/next` calls for the second item are fired at once. The supabase shim runs over a node-pg
 *     POOL here (not one client), so the two handlers hold separate connections, as production
 *     does. Each round asserts: no 500, and either both 200 with the SAME item or one 409.
 *     Both responses are pre-submit payloads, so each must carry `correct_answer: null` and
 *     `explanation: null` and no option token map. Several rounds, because the race needs the
 *     two handlers to read `pending` before either promotes it.
 *   - OQ-35. `/state` carries `shortened: true` when the filters match fewer questions than the
 *     session asked for, and `false` otherwise. Presence first (the stored row really carries
 *     `source_pool_count` and `requested_count`), then absence: neither number, nor any key
 *     naming a pool, reaches the response. The response parses against the shared practice
 *     state schema made `.strict()`, so an extra field fails.
 *
 * LIMITS: auth is a stand-in (same harness as session-criteria.pg.ci.test.ts); the Supabase
 * client is `makePgSupabase` over node-pg. It proves the handlers against the real schema and
 * RPCs, not PostgREST wire behaviour.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import http from "node:http";
import pg from "pg";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  pgConnConfig,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  engineNextItemResponseSchema,
  practiceSessionStateResponseSchema,
  studentSafeQuestionSchema,
} from "../../packages/shared/src/practice-response-schema";

const DB_NAME = "practice_runner_ci";
const STUDENT = "77777777-7777-7777-7777-777777777777";
const CLIENT = "runner-ci";

/** Setup client (DDL, seed, direct reads). */
let setupPg: pg.Client | null = null;
/** What the routes run on: a pool, so concurrent handlers hold separate connections. */
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

/** Eight Algebra questions (enough for the F-64 sessions) and two Geometry ones (OQ-35). */
const ALGEBRA = Array.from(
  { length: 8 },
  (_, i) => `SATM1ALG${String(i).padStart(3, "0")}`,
);
const GEOMETRY = ["SATM1GEO000", "SATM1GEO001"];
/**
 * QMH (question header): one question whose domain, skill and difficulty all differ from every
 * other seeded question's, so a header field read from the wrong place cannot pass.
 */
const QMH_QUESTION = {
  id: "SATM1PSD000",
  domain: "Problem Solving and Data Analysis",
  skill: "PSD.D02",
  difficulty: 2,
} as const;

async function seedQuestion(
  id: string,
  domain: string,
  skill = "ALG.D01",
  difficulty = 1,
): Promise<void> {
  await setupPg!.query(
    `INSERT INTO public.questions
       (id, section, source_type, domain, skill_codes, difficulty, stem, options,
        correct_answer, explanation, option_metadata, status, item_type, published_at)
     VALUES ($1,'M',1,$2,$3,$6,$4,
       '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
       'C',$5,
       '{"A":{"role":"distractor"},"B":{"role":"distractor"},"C":{"role":"correct"},"D":{"role":"distractor"}}'::jsonb,
       'published','mcq', now())`,
    [id, domain, [skill], `Stem ${id}`, `Expl ${id}`, difficulty],
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

describe.skipIf(!PG_AVAILABLE)("practice runner reads → real PG", () => {
  let app: Express;
  /**
   * One listening server for every request. `request(app)` opens a fresh server per call, and
   * that start-up staggers two "concurrent" calls by more than a whole /next takes locally, so
   * they would never overlap.
   */
  let server: http.Server;

  beforeAll(async () => {
    setupPg = await bootstrapPgDatabase(DB_NAME);
    await setupPg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,'runner@example.test')`,
      [STUDENT],
    );
    await setupPg.query(
      `INSERT INTO public.profiles (id, email, role)
       VALUES ($1,'runner@example.test','student')`,
      [STUDENT],
    );
    for (const id of ALGEBRA) await seedQuestion(id, "Algebra");
    for (const id of GEOMETRY)
      await seedQuestion(id, "Geometry and Trigonometry");
    await seedQuestion(
      QMH_QUESTION.id,
      QMH_QUESTION.domain,
      QMH_QUESTION.skill,
      QMH_QUESTION.difficulty,
    );

    pool = new pg.Pool({ ...pgConnConfig(DB_NAME), max: 8 });

    const { default: practiceRouter } =
      await import("../../server/routes/practice-canonical");
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
    server = app.listen(0);
  }, 240_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool?.end();
    pool = null;
    await setupPg?.end();
    setupPg = null;
  });

  async function start(
    key: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const created = await request(app)
      .post("/api/practice/sessions")
      .send({ ...body, client_instance_id: CLIENT, idempotency_key: key });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    return created.body.sessionId as string;
  }

  async function terminate(sessionId: string): Promise<void> {
    const res = await request(app)
      .post(`/api/practice/sessions/${sessionId}/terminate`)
      .send({ client_instance_id: CLIENT });
    expect(res.status).toBe(200);
  }

  const next = (sessionId: string) =>
    request(server).get(
      `/api/practice/sessions/${sessionId}/next?client_instance_id=${CLIENT}`,
    );

  it("F-64: concurrent /next calls on one session never 500; every 200 serves the same item, or a clean 409", async () => {
    // Several rounds of CONCURRENT calls for the item that must be promoted next: the race
    // needs two handlers to read it as `pending` before either promotes it, and on a local
    // database a whole /next takes a few milliseconds, so two calls alone rarely overlap.
    // Observed on the old code: one of eight answered 500 `session_item_promote_failed`
    // (evidence/wave5/UI-53/f64-red-on-old-code.log).
    const ROUNDS = 10;
    const CONCURRENT = 8;
    for (let round = 0; round < ROUNDS; round += 1) {
      const sessionId = await start(`f64-${round}`, {
        sections: ["M"],
        domains: ["Algebra"],
        target_question_count: 5,
      });
      // Item 1 is served at creation; answer it so item 2 must be promoted.
      const first = await next(sessionId);
      expect(first.status).toBe(200);
      const answered = await request(server)
        .post("/api/practice/answer")
        .send({
          sessionId,
          sessionItemId: first.body.sessionItemId,
          selectedOptionId: first.body.question.options[0].id,
          clientAttemptId: `f64-${round}-1`,
          client_instance_id: CLIENT,
        });
      expect(answered.status).toBe(200);

      const all = await Promise.all(
        Array.from({ length: CONCURRENT }, () => next(sessionId)),
      );
      for (const r of all) {
        expect(r.status, JSON.stringify(r.body)).not.toBe(500);
        expect([200, 409]).toContain(r.status);
      }
      const ok = all.filter((r) => r.status === 200);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      const served = new Set(ok.map((r) => r.body.sessionItemId as string));
      expect(served.size).toBe(1);
      for (const r of ok) {
        expect(r.body.ordinal).toBe(2);
        // Presence first: a real pre-submit question with four options.
        expect(r.body.question.options).toHaveLength(4);
        expect(r.body.question).toHaveProperty("correct_answer", null);
        expect(r.body.question).toHaveProperty("explanation", null);
        const keys = collectKeys(r.body, new Set());
        for (const k of [
          "option_token_map",
          "option_order",
          "correct_variants",
          "correctOptionId",
          "correctAnswer",
        ])
          expect(keys.has(k), k).toBe(false);
      }

      // Exactly one item was promoted: item 2 served, the rest still pending.
      const rows = await setupPg!.query(
        `SELECT ordinal, status FROM public.practice_session_items
          WHERE session_id = $1 ORDER BY ordinal`,
        [sessionId],
      );
      expect(rows.rows.map((r: { status: string }) => r.status)).toEqual([
        "answered",
        "served",
        "pending",
        "pending",
        "pending",
      ]);
      await terminate(sessionId);
    }
  }, 120_000);

  it("OQ-35: /state says shortened (no number) when the filters match fewer questions than asked for", async () => {
    const sessionId = await start("oq35-short", {
      sections: ["M"],
      domains: ["Geometry and Trigonometry"],
      target_question_count: 10,
    });

    // Presence before absence: the stored row really holds both counts.
    const stored = await setupPg!.query(
      `SELECT filters FROM public.practice_sessions WHERE id = $1`,
      [sessionId],
    );
    const filters = stored.rows[0].filters as Record<string, unknown>;
    expect(filters.source_pool_count).toBe(2);
    expect(filters.requested_count).toBe(10);

    const state = await request(app).get(
      `/api/practice/sessions/${sessionId}/state?client_instance_id=${CLIENT}`,
    );
    expect(state.status).toBe(200);
    const parsed = practiceSessionStateResponseSchema
      .strict()
      .safeParse(state.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
    expect(state.body.shortened).toBe(true);

    const keys = collectKeys(state.body, new Set());
    for (const k of [
      "source_pool_count",
      "requested_count",
      "selection_mode",
      "filters",
    ])
      expect(keys.has(k), k).toBe(false);
    for (const k of keys) expect(k).not.toMatch(/pool/i);
    // The pool size (2) is not a value anywhere in the body except where the client already
    // gets it from: nothing on /state is 2 but the served ordinal bookkeeping, which is 1 here.
    expect(JSON.stringify(state.body)).not.toMatch(/:2[,}]/);
    await terminate(sessionId);
  });

  it("OQ-35: /state says not shortened when the filters match at least what was asked for", async () => {
    const sessionId = await start("oq35-full", {
      sections: ["M"],
      domains: ["Algebra"],
      target_question_count: 5,
    });
    const stored = await setupPg!.query(
      `SELECT filters FROM public.practice_sessions WHERE id = $1`,
      [sessionId],
    );
    const filters = stored.rows[0].filters as Record<string, unknown>;
    expect(filters.source_pool_count).toBe(5);
    expect(filters.requested_count).toBe(5);

    const state = await request(app).get(
      `/api/practice/sessions/${sessionId}/state?client_instance_id=${CLIENT}`,
    );
    expect(state.status).toBe(200);
    expect(
      practiceSessionStateResponseSchema.strict().safeParse(state.body).success,
    ).toBe(true);
    expect(state.body.shortened).toBe(false);
    await terminate(sessionId);
  });
  /**
   * QMH — question header (owner brief, Karl, 2026-10-13 §1) | @implemented [2026-10-13]
   * plain English: practice's /next carries the served item's domain, skill and difficulty for
   * the runner's header, read from the snapshot of the one question whose three fields differ
   * from every other's. Presence first; then the whole body parses STRICT against the shared
   * engine schema (so no field beyond the contract rides along, answer-bearing or not) and
   * carries no answer field anywhere.
   */
  it("QMH: practice /next carries the item's domain, skill and difficulty, and no answer field", async () => {
    const sessionId = await start("qmh-practice", {
      sections: ["M"],
      domains: [QMH_QUESTION.domain],
      target_question_count: 1,
    });
    const res = await next(sessionId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const q = res.body.question as Record<string, unknown>;
    expect(q.stem).toBe(`Stem ${QMH_QUESTION.id}`);
    expect(q.domain).toBe(QMH_QUESTION.domain);
    expect(q.skill).toBe(QMH_QUESTION.skill);
    expect(q.difficulty).toBe(QMH_QUESTION.difficulty);

    const parsed = engineNextItemResponseSchema
      .extend({ question: studentSafeQuestionSchema.strict() })
      .strict()
      .safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
    expect(q.correct_answer).toBeNull();
    expect(q.explanation).toBeNull();
    const keys = collectKeys(res.body, new Set());
    for (const k of [
      "option_metadata",
      "correct_variants",
      "option_token_map",
      "option_order",
      "correctOptionId",
      "correctAnswer",
    ])
      expect(keys.has(k), k).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(`Expl ${QMH_QUESTION.id}`);
    await terminate(sessionId);
  });

  /**
   * QMH — the diagnostic (owner brief, Karl, 2026-10-13 §1) | @implemented [2026-10-13]
   * plain English: the diagnostic has no serve route of its own; a `mode = 'diagnostic'` session
   * is served by this same /next. A diagnostic session with one served item (the snapshot the
   * diagnostic start writes: canonical answer, explanation and option metadata included) is
   * asked for its item, which must carry the header fields and nothing answer-bearing.
   */
  it("QMH: a diagnostic session's /next carries the item's domain, skill and difficulty, and no answer field", async () => {
    const sessionId = "9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d";
    const itemId = "7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f";
    await setupPg!.query(
      `INSERT INTO public.practice_sessions
          (id, user_id, actor_id, mode, filters, target_count, platform, status)
        VALUES ($1, $2, $2, 'diagnostic',
          '{"target_question_count": 1}', 1, 'web', 'active')`,
      [sessionId, STUDENT],
    );
    await setupPg!.query(
      `INSERT INTO public.practice_session_items
          (id, session_id, user_id, actor_id, ordinal,
           question_id, question_stem, question_options,
           question_correct_answer, question_explanation, question_option_metadata,
           question_domain, question_skill, question_difficulty,
           question_section, status, question_item_type,
           option_order, option_token_map)
        VALUES ($1, $2, $3, $3, 1, $4, $5,
          '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
          'C', $6,
          '{"A":{"role":"distractor"},"B":{"role":"distractor"},"C":{"role":"correct"},"D":{"role":"distractor"}}'::jsonb,
          $7, $8, $9, 'M', 'served', 'mcq',
          ARRAY['B','C','A','D']::text[],
          '{"opt_aaaaaaaaaaaaaaaa":"B","opt_bbbbbbbbbbbbbbbb":"C","opt_cccccccccccccccc":"A","opt_dddddddddddddddd":"D"}'::jsonb)`,
      [
        itemId,
        sessionId,
        STUDENT,
        QMH_QUESTION.id,
        `Diagnostic stem ${QMH_QUESTION.id}`,
        `Expl ${QMH_QUESTION.id}`,
        QMH_QUESTION.domain,
        QMH_QUESTION.skill,
        QMH_QUESTION.difficulty,
      ],
    );

    const res = await next(sessionId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const q = res.body.question as Record<string, unknown>;
    // Presence first: the diagnostic's real item, with its header fields.
    expect(q.stem).toBe(`Diagnostic stem ${QMH_QUESTION.id}`);
    expect(q.domain).toBe(QMH_QUESTION.domain);
    expect(q.skill).toBe(QMH_QUESTION.skill);
    expect(q.difficulty).toBe(QMH_QUESTION.difficulty);
    // Then absence: nothing answer-bearing.
    expect(q.correct_answer).toBeNull();
    expect(q.explanation).toBeNull();
    const keys = collectKeys(res.body, new Set());
    for (const k of [
      "option_metadata",
      "correct_variants",
      "option_token_map",
      "option_order",
      "role",
    ])
      expect(keys.has(k), k).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(`Expl ${QMH_QUESTION.id}`);
    // The session stays open: this is the suite's last test and its database is its own.
  });
});
