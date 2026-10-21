/**
 * Session criteria on practice and review `/state` and `/sessions/open` → real PG proof.
 *
 * @spec [student-UI register §9 OQ-22, owner ruling (Karl) 2026-10-02: "The chosen criteria
 *        on practice and review `/state` and `/sessions/open`, with no counts."; wiring table
 *        §14 OQ-22; register §2 Content rules (no bank counts)] | @implemented [2026-10-03]
 *
 * plain English: sessions are created through the REAL create routes (practice
 * `POST /api/practice/sessions`, review `POST /api/review/sessions`), so the stored spec
 * these reads project from is what production writes, not a hand-built row. Then the real
 * `/state` and `/sessions/open` handlers are read and their `criteria` checked: exactly the
 * chosen values, empty arrays when nothing was chosen, exactly four keys.
 *
 * Anti-leak shape: each read first asserts that `criteria` IS present and that the stored
 * `filters` row really does carry the keys that must not reach the client (pool size,
 * requested count, idempotency key, the spec itself); only then does it assert that none
 * of those keys, and no `filters` key, appears anywhere in the response.
 *
 * LIMITS: the Supabase client is `makePgSupabase` over node-pg against a throwaway
 * database with the real migrations applied; auth is a stand-in (same harness as
 * review.routes.pg.ci.test.ts). It proves the handlers and the real schema/RPCs, not
 * PostgREST wire behaviour.
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
import { sessionCriteriaSchema } from "../../packages/shared/src/session-criteria";

const DB_NAME = "session_criteria_ci";
const STUDENT = "88888888-8888-8888-8888-888888888888";
const PRIOR_SESSION = "99999999-9999-9999-9999-999999999999";

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
    requireGuardianLinkForUnder13: (
      _q: Request,
      _s: Response,
      next: NextFunction,
    ) => next(),
    getSupabaseAdmin: () => {
      if (!testPg) throw new Error("PG client not initialised");
      return makePgSupabase(testPg);
    },
  };
}

vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

type SeedQuestion = {
  id: string;
  section: "M" | "RW";
  domain: string;
  skill: string;
  difficulty: number;
};

const QUESTIONS: SeedQuestion[] = [
  {
    id: "SATM1KKKKKK",
    section: "M",
    domain: "Algebra",
    skill: "ALG.D01",
    difficulty: 1,
  },
  {
    id: "SATM1LLLLLL",
    section: "M",
    domain: "Algebra",
    skill: "ALG.D01",
    difficulty: 1,
  },
  {
    id: "SATM1NNNNNN",
    section: "M",
    domain: "Advanced Math",
    skill: "ADV.D01",
    difficulty: 2,
  },
  {
    id: "SATRW1PPPPPP",
    section: "RW",
    domain: "Information and Ideas",
    skill: "INI.D01",
    difficulty: 3,
  },
];

const CHOSEN = {
  sections: ["M"],
  domains: ["Algebra"],
  skills: ["ALG.D01"],
  difficulties: ["easy"],
} as const;

const EMPTY = { sections: [], domains: [], skills: [], difficulties: [] };

/**
 * Keys that live in the stored `filters` and must never reach a response. Counts of the
 * pool or the bank are here because of the ruling's "with no counts" (register §2).
 */
const FORBIDDEN_KEYS = [
  "filters",
  "session_spec",
  "source_pool_count",
  "requested_count",
  "session_start_idempotency_key",
] as const;

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

/** Presence first: criteria exists, has exactly the four keys, and parses strictly. */
function expectCriteria(holder: unknown, expected: unknown): void {
  expect(holder).toHaveProperty("criteria");
  const criteria = (holder as { criteria: unknown }).criteria;
  expect(Object.keys(criteria as object).sort()).toEqual([
    "difficulties",
    "domains",
    "sections",
    "skills",
  ]);
  expect(sessionCriteriaSchema.safeParse(criteria).success).toBe(true);
  expect(criteria).toEqual(expected);
}

function expectNoForbiddenKeys(body: unknown): void {
  const keys = collectKeys(body, new Set());
  for (const k of FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false);
  // No count of any kind inside criteria.
  const criteriaKeys = collectKeys(
    (body as { criteria?: unknown }).criteria ?? {},
    new Set(),
  );
  for (const k of criteriaKeys) expect(k).not.toMatch(/count|total|pool/i);
}

async function storedFilters(
  table: "practice_sessions" | "review_sessions",
  id: string,
): Promise<Record<string, unknown>> {
  const r = await testPg!.query(
    `SELECT filters FROM public.${table} WHERE id = $1`,
    [id],
  );
  return r.rows[0].filters as Record<string, unknown>;
}

describe.skipIf(!PG_AVAILABLE)("OQ-22 session criteria → real PG", () => {
  let app: Express;

  beforeAll(async () => {
    testPg = await bootstrapPgDatabase(DB_NAME);
    await testPg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,'crit@example.test')`,
      [STUDENT],
    );
    await testPg.query(
      `INSERT INTO public.profiles (id, email, role)
       VALUES ($1,'crit@example.test','student')`,
      [STUDENT],
    );
    for (const q of QUESTIONS) {
      await testPg.query(
        `INSERT INTO public.questions
           (id, section, source_type, domain, skill_codes, difficulty, stem, options,
            correct_answer, explanation, option_metadata, status, item_type, published_at)
         VALUES ($1,$2,1,$3,$4,$5,$6,
           '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
           'B',$7,
           '{"A":{"role":"distractor"},"B":{"role":"correct"},"C":{"role":"distractor"},"D":{"role":"distractor"}}'::jsonb,
           'published','mcq', now())`,
        [
          q.id,
          q.section,
          q.domain,
          [q.skill],
          q.difficulty,
          `Stem ${q.id}`,
          `Expl ${q.id}`,
        ],
      );
      // Every question is an open miss, so review has a pool to filter.
      await testPg.query(
        `INSERT INTO public.review_schedule
           (student_id, question_id, queued_at, status, source_engine,
            source_session_id, source_item_id, source_outcome)
         VALUES ($1,$2, now(), 'active', 'practice', $3, gen_random_uuid(), 'incorrect')`,
        [STUDENT, q.id, PRIOR_SESSION],
      );
    }

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

  async function readBoth(
    engine: "practice" | "review",
    sessionId: string,
  ): Promise<{
    state: request.Response;
    row: unknown;
    open: request.Response;
  }> {
    const state = await request(app).get(
      `/api/${engine}/sessions/${sessionId}/state`,
    );
    expect(state.status).toBe(200);
    const open = await request(app).get(`/api/${engine}/sessions/open`);
    expect(open.status).toBe(200);
    const row = (open.body.sessions as Array<{ id: string }>).find(
      (s) => s.id === sessionId,
    );
    expect(row, "session missing from /sessions/open").toBeDefined();
    return { state, row, open };
  }

  it("practice: chosen section, domain, skill and difficulty appear exactly, on /state and /sessions/open", async () => {
    const created = await request(app)
      .post("/api/practice/sessions")
      .send({
        ...CHOSEN,
        client_instance_id: "crit-p1",
        idempotency_key: "crit-p1",
      });
    expect(created.status).toBe(200);
    const sessionId = created.body.sessionId as string;

    // The stored row really carries what must not leak (presence before absence).
    const filters = await storedFilters("practice_sessions", sessionId);
    expect(filters).toHaveProperty("session_spec");
    expect(filters).toHaveProperty("source_pool_count");
    expect(filters).toHaveProperty("session_start_idempotency_key");

    const { state, row, open } = await readBoth("practice", sessionId);
    expectCriteria(state.body, CHOSEN);
    expectCriteria(row, CHOSEN);
    expectNoForbiddenKeys(state.body);
    expectNoForbiddenKeys(open.body);
    expectNoForbiddenKeys(row);
  });

  it("practice: a session started with no filters shows four empty arrays", async () => {
    const created = await request(app)
      .post("/api/practice/sessions")
      .send({ client_instance_id: "crit-p2", idempotency_key: "crit-p2" });
    expect(created.status).toBe(200);
    const sessionId = created.body.sessionId as string;
    expect(await storedFilters("practice_sessions", sessionId)).toHaveProperty(
      "session_spec",
    );

    const { state, row, open } = await readBoth("practice", sessionId);
    expectCriteria(state.body, EMPTY);
    expectCriteria(row, EMPTY);
    expectNoForbiddenKeys(state.body);
    expectNoForbiddenKeys(open.body);
  });

  it("review: filter mode shows the chosen criteria exactly, on /state and /sessions/open", async () => {
    const created = await request(app).post("/api/review/sessions").send({
      mode: "filter",
      filters: CHOSEN,
      client_instance_id: "crit-r1",
      idempotency_key: "crit-r1",
    });
    expect(created.status).toBe(200);
    const sessionId = created.body.sessionId as string;

    const filters = await storedFilters("review_sessions", sessionId);
    expect(filters).toHaveProperty("sections");
    expect(filters).toHaveProperty("session_start_idempotency_key");

    const { state, row, open } = await readBoth("review", sessionId);
    expectCriteria(state.body, CHOSEN);
    expectCriteria(row, CHOSEN);
    expectNoForbiddenKeys(state.body);
    expectNoForbiddenKeys(open.body);
  });

  it("review: queue mode (nothing chosen) shows four empty arrays", async () => {
    const created = await request(app).post("/api/review/sessions").send({
      mode: "queue",
      client_instance_id: "crit-r2",
      idempotency_key: "crit-r2",
    });
    expect(created.status).toBe(200);
    const sessionId = created.body.sessionId as string;
    expect(await storedFilters("review_sessions", sessionId)).toHaveProperty(
      "session_start_idempotency_key",
    );

    const { state, row, open } = await readBoth("review", sessionId);
    expectCriteria(state.body, EMPTY);
    expectCriteria(row, EMPTY);
    expectNoForbiddenKeys(state.body);
    expectNoForbiddenKeys(open.body);
  });

  // F-52 (student-UI register §8): `GET /api/review/pool` used to copy each source
  // session's raw `filters` into `sessions[].filters`, so a practice row carried
  // `session_spec` (the choice nested inside it), `source_pool_count`, `requested_count`,
  // `client_instance_id` and the idempotency key. The fix sends the four criteria arrays
  // only, built with `toSessionCriteria`. The source sessions are created through the REAL
  // create routes (so their stored `filters` are what production writes), a miss is queued
  // against each, and the pool is read through the REAL route.
  it("F-52: /api/review/pool sessions[].filters is exactly the four criteria, for practice and review sources", async () => {
    const practice = await request(app)
      .post("/api/practice/sessions")
      .send({
        ...CHOSEN,
        client_instance_id: "crit-f52-p",
        idempotency_key: "crit-f52-p",
      });
    expect(practice.status).toBe(200);
    const practiceId = practice.body.sessionId as string;

    const reviewChosen = {
      sections: ["M"],
      domains: ["Advanced Math"],
      skills: [],
      difficulties: [],
    };
    const review = await request(app)
      .post("/api/review/sessions")
      .send({
        mode: "filter",
        filters: { sections: ["M"], domains: ["Advanced Math"] },
        client_instance_id: "crit-f52-r",
        idempotency_key: "crit-f52-r",
      });
    expect(review.status).toBe(200);
    const reviewId = review.body.sessionId as string;

    // Presence before absence: the stored rows really carry what must not leak.
    const pFilters = await storedFilters("practice_sessions", practiceId);
    expect(pFilters).toHaveProperty("session_spec");
    expect(pFilters).toHaveProperty("source_pool_count");
    expect(pFilters).toHaveProperty("client_instance_id");
    expect(pFilters).toHaveProperty("session_start_idempotency_key");
    const rFilters = await storedFilters("review_sessions", reviewId);
    expect(rFilters).toHaveProperty("client_instance_id");
    expect(rFilters).toHaveProperty("session_start_idempotency_key");

    // One open miss queued against each source session.
    const queued: Array<[string, string, string]> = [
      ["practice", practiceId, "SATM1KKKKKK"],
      ["review", reviewId, "SATM1NNNNNN"],
    ];
    for (const [engine, sid, qid] of queued) {
      await testPg!.query(
        `UPDATE public.review_schedule
            SET source_engine = $1, source_session_id = $2
          WHERE student_id = $3 AND question_id = $4`,
        [engine, sid, STUDENT, qid],
      );
    }

    const pool = await request(app).get("/api/review/pool?tz=UTC");
    expect(pool.status).toBe(200);
    const rows = pool.body.sessions as Array<{
      source_session_id: string;
      filters: unknown;
    }>;
    const pRow = rows.find((r) => r.source_session_id === practiceId);
    const rRow = rows.find((r) => r.source_session_id === reviewId);
    expect(pRow, "practice source missing from the pool").toBeDefined();
    expect(rRow, "review source missing from the pool").toBeDefined();

    // Presence: each row names what the student chose (for practice this is also what
    // stops the past-session picker labelling every practice row "Mixed").
    expectCriteria({ criteria: pRow!.filters }, CHOSEN);
    expectCriteria({ criteria: rRow!.filters }, reviewChosen);

    // Absence: no stored key rides along anywhere in the response.
    const keys = collectKeys(pool.body, new Set());
    for (const k of [
      "session_spec",
      "source_pool_count",
      "requested_count",
      "selection_mode",
      "client_instance_id",
      "session_start_idempotency_key",
      "target_question_count",
    ]) {
      expect(keys.has(k), k).toBe(false);
    }
  });
});
