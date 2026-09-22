/**
 * Review API → real PostgreSQL route proof (A1-A14).
 *
 * @spec [Doc-02B_V4 §16; ruled plan §2/§3; brief R3 §4; owner ruling 2026-09-21 (A14)]
 * @implemented [2026-09-21]
 *
 * SCOPE AND LIMITS — read before trusting a green run.
 * The Supabase client is replaced by `makePgSupabase` over a node-pg connection to a
 * throwaway database with the real migrations applied. That proves the handlers'
 * logic, the real schema and the two real triggers. It does NOT prove PostgREST wire
 * behaviour, the service_role identity, or any GRANT — `scripts/ci/review-queue-gates.sql`
 * covers the grants and RLS, and R3 wires it into CI.
 *
 * `requireSupabaseAuth` is replaced by a stand-in that 401s when no student is acting.
 * A6's 401 half therefore proves the review mount SITS BEHIND an auth middleware, not
 * that Supabase JWT parsing works — that is not review's to prove. A6's CSRF half uses
 * the REAL `doubleCsrfProtection` and the real error boundary, so the 403 is genuine.
 * Every other test mounts without CSRF, because A6 owns that proof and carrying a
 * double-submit token through thirteen other tests would be noise.
 *
 * Every assertion here is planted: `scripts/ci/review-routes-gate.mutations.sh` applies
 * one source mutation per assertion and requires THAT assertion to go red.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import request from "supertest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import fs from "node:fs";
import type { Client } from "pg";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { ENGINE_RESPONSE_SCHEMAS } from "../../packages/shared/src/practice-response-schema";

const DB_NAME = "review_routes_ci";

const STUDENT_A = "11111111-1111-1111-1111-111111111111";
const STUDENT_B = "22222222-2222-2222-2222-222222222222";
const PRACTICE_SESSION = "33333333-3333-3333-3333-333333333333";
const OTHER_SESSION = "44444444-4444-4444-4444-444444444444";

const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-02T10:00:00.000Z";
const T3 = "2026-09-03T10:00:00.000Z";

let testPg: Client | null = null;
/** Flipped per test by the auth stand-in so one app can act as either student. */
let actingStudent: string | null = STUDENT_A;

const hoisted = vi.hoisted(() => ({
  masteryCalls: [] as Array<Record<string, unknown>>,
}));

// mastery-write.ts calls getSupabaseAdmin() rather than supabaseServer, so without
// this the RPC would hit the network, fail, and A10 would assert on a mastery call
// that wrote nothing.
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    if (!testPg) throw new Error("PG client not initialised");
    return makePgSupabase(testPg);
  },
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: new Proxy(
    {},
    {
      get(_t, prop) {
        if (!testPg) throw new Error("PG client not initialised");
        return (makePgSupabase(testPg) as Record<string, unknown>)[
          prop as string
        ];
      },
    },
  ),
}));

/**
 * Records every mastery emission and then calls the real one, so A10 asserts on the
 * arguments the route actually passed rather than on a reconstruction of them.
 */
vi.mock("../../apps/api/src/services/mastery-write", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/services/mastery-write")
    >();
  return {
    ...actual,
    applyMasteryEvent: async (
      input: Parameters<typeof actual.applyMasteryEvent>[0],
    ) => {
      hoisted.masteryCalls.push(input as unknown as Record<string, unknown>);
      return actual.applyMasteryEvent(input);
    },
  };
});

function authStub() {
  return {
    requireSupabaseAuth: (req: Request, res: Response, next: NextFunction) => {
      if (!actingStudent) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      (req as unknown as { user: unknown }).user = {
        id: actingStudent,
        actor_id: actingStudent,
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

// Both specifiers: review-canonical.ts imports with the .js suffix, other modules
// without it, and vi.mock keys on the literal specifier.
vi.mock("../../server/middleware/supabase-auth.js", () => authStub());
vi.mock("../../server/middleware/supabase-auth", () => authStub());

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const Q_ALG = "SATM1AAAAAA";
const Q_ADV = "SATM1BBBBBB";
const Q_RW = "SATRW1CCCCCC";
const Q_RETIRED = "SATM1DDDDDD";

type SeedQuestion = {
  id: string;
  section: "M" | "RW";
  domain: string;
  skill: string;
  difficulty: number;
  retired?: boolean;
};

const QUESTIONS: SeedQuestion[] = [
  {
    id: Q_ALG,
    section: "M",
    domain: "Algebra",
    skill: "ALG.D01",
    difficulty: 1,
  },
  {
    id: Q_ADV,
    section: "M",
    domain: "Advanced Math",
    skill: "ADV.D01",
    difficulty: 2,
  },
  {
    id: Q_RW,
    section: "RW",
    domain: "Information and Ideas",
    skill: "INI.D01",
    difficulty: 3,
  },
  // Retired: keeps its queue entry, never poolable (ruling 18).
  {
    id: Q_RETIRED,
    section: "M",
    domain: "Algebra",
    skill: "ALG.D01",
    difficulty: 2,
    retired: true,
  },
];

async function seed(pg: Client): Promise<void> {
  for (const studentId of [STUDENT_A, STUDENT_B]) {
    await pg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [studentId, `${studentId}@example.test`],
    );
    await pg.query(
      `INSERT INTO public.profiles (id, email, role)
       VALUES ($1, $2, 'student') ON CONFLICT DO NOTHING`,
      [studentId, `${studentId}@example.test`],
    );
  }

  for (const q of QUESTIONS) {
    await pg.query(
      `INSERT INTO public.questions
         (id, section, source_type, domain, skill_codes, difficulty, stem, options,
          correct_answer, explanation, option_metadata, status, item_type, published_at)
       VALUES ($1,$2,1,$3,$4,$5,$6,$7::jsonb,'B',$8,$9::jsonb,$10,'mcq', now())
       ON CONFLICT (id) DO NOTHING`,
      [
        q.id,
        q.section,
        q.domain,
        [q.skill],
        q.difficulty,
        `Stem for ${q.id}`,
        JSON.stringify([
          { key: "A", text: "alpha" },
          { key: "B", text: "bravo" },
          { key: "C", text: "charlie" },
          { key: "D", text: "delta" },
        ]),
        `Explanation for ${q.id}`,
        JSON.stringify({
          A: { role: "distractor" },
          B: { role: "correct" },
          C: { role: "distractor" },
          D: { role: "distractor" },
        }),
        q.retired ? "retired" : "published",
      ],
    );
  }
}

/**
 * Queue entries are inserted directly here. This suite tests the API OVER a queue;
 * `review.queue-e2e.pg.ci.test.ts` drives the triggers that write it for real.
 */
async function enqueue(
  pg: Client,
  args: {
    studentId?: string;
    questionId: string;
    queuedAt: string;
    sourceSessionId?: string;
    status?: string;
    sourceEngine?: string;
  },
): Promise<string> {
  const status = args.status ?? "active";
  const res = await pg.query(
    `INSERT INTO public.review_schedule
       (student_id, question_id, queued_at, status, source_engine,
        source_session_id, source_item_id, source_outcome, closed_at)
     VALUES ($1,$2,$3,$4,$5,$6, gen_random_uuid(), 'incorrect', $7)
     RETURNING id`,
    [
      args.studentId ?? STUDENT_A,
      args.questionId,
      args.queuedAt,
      status,
      args.sourceEngine ?? "practice",
      args.sourceSessionId ?? PRACTICE_SESSION,
      status === "active" ? null : args.queuedAt,
    ],
  );
  return String(res.rows[0].id);
}

async function reset(pg: Client): Promise<void> {
  await pg.query(`DELETE FROM public.review_error_attempts`);
  await pg.query(`DELETE FROM public.review_session_items`);
  await pg.query(`DELETE FROM public.review_sessions`);
  await pg.query(`DELETE FROM public.review_schedule`);
  hoisted.masteryCalls.length = 0;
  actingStudent = STUDENT_A;
}

// ---------------------------------------------------------------------------

describe.skipIf(!PG_AVAILABLE)("Review API → real PG proof (A1-A14)", () => {
  /** No CSRF: A6 owns that proof. */
  let app: Express;
  /** The production mount, CSRF included. A6 only. */
  let guardedApp: Express;

  beforeAll(async () => {
    testPg = await bootstrapPgDatabase(DB_NAME);
    await seed(testPg);

    const { default: reviewRouter } =
      await import("../../server/routes/review-canonical");
    const { requireSupabaseAuth, requireStudentOrAdmin } =
      await import("../../server/middleware/supabase-auth.js");
    const { doubleCsrfProtection } =
      await import("../../server/middleware/csrf-double-submit");

    app = express();
    app.use(express.json());
    app.use(
      "/api/review",
      requireSupabaseAuth,
      requireStudentOrAdmin,
      reviewRouter,
    );

    // NO cookie-parser here, deliberately. A6 asserts that a write with no CSRF
    // token is refused, and an absent cookie jar is "no token" just as an empty one
    // is — the 403 still comes from csrf-csrf's token check, which the A6b plant in
    // scripts/ci/review-routes-gate.mutations.sh proves by disabling that check and
    // requiring this test to go red.
    //
    // Mounting cookie-parser here tripped CodeQL's js/missing-token-validation
    // ("Missing CSRF middleware"), high severity, on PR #803. It is the same false
    // positive already documented at server/index.ts:104-111: CodeQL's default model
    // recognises only app-level `csurf`, not this repo's `doubleCsrfProtection`
    // (csrf-csrf + Origin allowlist). That one was dismissed in the Security UI
    // because, as that note records, default-setup CodeQL does not honour inline
    // suppressions — so a `// codeql[...]` comment here would NOT clear the check.
    // Dropping a middleware the test never needed is the fix that does, and it costs
    // the assertion nothing.
    guardedApp = express();
    guardedApp.use(express.json());
    guardedApp.use(
      "/api/review",
      requireSupabaseAuth,
      requireStudentOrAdmin,
      doubleCsrfProtection,
      reviewRouter,
    );
    // server/index.ts:791-808's boundary, narrowed to the CSRF branch A6 needs.
    guardedApp.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "";
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (
          code === "EBADCSRFTOKEN" ||
          message.toLowerCase().includes("csrf")
        ) {
          res.status(403).json({ error: { code: "csrf_blocked" } });
          return;
        }
        res.status(500).json({ error: { code: "unhandled", message } });
      },
    );
  }, 240_000);

  afterAll(async () => {
    await testPg?.end();
    testPg = null;
  });

  beforeEach(async () => {
    if (testPg) await reset(testPg);
  });

  /**
   * Creates with `client_instance_id: "ci-1"` unless overridden. Practice binds a
   * session to the instance that created it and returns that id; a create that omits
   * it gets a server-generated one, and a later /next under a different id is a
   * deliberate 409. The tests below use one instance throughout, as a browser tab does.
   */
  async function createSession(
    body: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(app)
      .post("/api/review/sessions")
      .send({ mode: "queue", client_instance_id: "ci-1", ...body });
  }

  async function nextItem(
    sessionId: string,
    clientInstanceId = "ci-1",
  ): Promise<request.Response> {
    return request(app)
      .get(`/api/review/sessions/${sessionId}/next`)
      .query({ client_instance_id: clientInstanceId });
  }

  /** The option token whose canonical key is `key`, read from the stored map. */
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

  // -------------------------------------------------------------------------
  // A1 — anti-leak
  // -------------------------------------------------------------------------
  it("A1: create, state and next carry no answer, explanation, option metadata or token map", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    const created = await createSession();
    expect(created.status).toBe(200);
    const sessionId = created.body.sessionId as string;

    const state = await request(app).get(
      `/api/review/sessions/${sessionId}/state`,
    );
    const next = await nextItem(sessionId);
    expect(next.status).toBe(200);

    for (const [label, body] of [
      ["create", created.body],
      ["state", state.body],
      ["next", next.body],
    ] as const) {
      const serialized = JSON.stringify(body);
      expect(
        serialized,
        `${label} leaked a non-null correct_answer`,
      ).not.toMatch(/"correct_answer"\s*:\s*"[^"]/);
      expect(serialized, `${label} leaked an explanation`).not.toContain(
        "Explanation for",
      );
      expect(serialized, `${label} leaked the token map`).not.toContain(
        "option_token_map",
      );
      expect(serialized, `${label} leaked option metadata`).not.toContain(
        "option_metadata",
      );
      expect(
        serialized,
        `${label} leaked a canonical option key`,
      ).not.toContain('"key"');
    }

    expect(next.body.question.correct_answer).toBeNull();
    expect(next.body.question.explanation).toBeNull();
    for (const opt of next.body.question.options as Array<{ id: string }>) {
      expect(opt.id).toMatch(/^opt_[0-9a-f]{16}$/);
    }
  });

  // -------------------------------------------------------------------------
  // A2 — post-submit reveal
  // -------------------------------------------------------------------------
  it("A2: the answer response reveals the correct answer and the explanation", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    const created = await createSession();
    const sessionId = created.body.sessionId as string;
    const next = await nextItem(sessionId);
    const itemId = next.body.sessionItemId as string;
    const wrongToken = await tokenFor(itemId, "A");

    const answered = await request(app)
      .post("/api/review/answer")
      .send({ sessionId, sessionItemId: itemId, selectedAnswer: wrongToken });

    expect(answered.status).toBe(200);
    expect(answered.body.isCorrect).toBe(false);
    expect(answered.body.explanation).toBe(`Explanation for ${Q_ALG}`);
    expect(answered.body.correctOptionId).toBe(await tokenFor(itemId, "B"));
  });

  // -------------------------------------------------------------------------
  // A3 — answer idempotency
  // -------------------------------------------------------------------------
  it("A3: a repeated clientAttemptId returns the same result and writes one attempt row", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    const created = await createSession();
    const sessionId = created.body.sessionId as string;
    const next = await nextItem(sessionId);
    const itemId = next.body.sessionItemId as string;
    const token = await tokenFor(itemId, "B");

    const body = {
      sessionId,
      sessionItemId: itemId,
      selectedAnswer: token,
      clientAttemptId: "attempt-key-1",
    };
    const first = await request(app).post("/api/review/answer").send(body);
    const second = await request(app).post("/api/review/answer").send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.isCorrect).toBe(first.body.isCorrect);
    expect(second.body.sessionItemId).toBe(first.body.sessionItemId);
    expect(second.body.idempotentRetried).toBe(true);

    const attempts = await testPg!.query(
      `SELECT count(*)::int AS c FROM public.review_error_attempts WHERE session_item_id = $1`,
      [itemId],
    );
    expect(attempts.rows[0].c).toBe(1);
  });

  // -------------------------------------------------------------------------
  // A4 — create idempotency
  // -------------------------------------------------------------------------
  it("A4: a repeated create idempotency_key returns the same session", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    const body = { mode: "queue", idempotency_key: "create-key-1" };
    const first = await createSession(body);
    const second = await createSession(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(second.body.replayed).toBe(true);

    const sessions = await testPg!.query(
      `SELECT count(*)::int AS c FROM public.review_sessions WHERE student_id = $1`,
      [STUDENT_A],
    );
    expect(sessions.rows[0].c).toBe(1);
  });

  // -------------------------------------------------------------------------
  // A5 — ownership
  // -------------------------------------------------------------------------
  it("A5: student B cannot read or answer student A's session", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    const created = await createSession();
    const sessionId = created.body.sessionId as string;
    const next = await nextItem(sessionId);
    const itemId = next.body.sessionItemId as string;
    const token = await tokenFor(itemId, "B");

    actingStudent = STUDENT_B;
    const state = await request(app).get(
      `/api/review/sessions/${sessionId}/state`,
    );
    const served = await nextItem(sessionId);
    const answered = await request(app)
      .post("/api/review/answer")
      .send({ sessionId, sessionItemId: itemId, selectedAnswer: token });

    // 404 and not 403: a 403 would confirm the id exists (Coding Standards §6.1).
    expect(state.status).toBe(404);
    expect(served.status).toBe(404);
    expect(answered.status).toBe(404);

    const still = await testPg!.query(
      `SELECT status FROM public.review_session_items WHERE id = $1`,
      [itemId],
    );
    expect(still.rows[0].status).toBe("served");
  });

  // -------------------------------------------------------------------------
  // A6 — auth and CSRF, on the production mount
  // -------------------------------------------------------------------------
  it("A6: unauthenticated is 401, and a write with no CSRF token is 403", async () => {
    actingStudent = null;
    const unauth = await request(guardedApp).get("/api/review/pool");
    expect(unauth.status).toBe(401);

    actingStudent = STUDENT_A;
    const noCsrf = await request(guardedApp)
      .post("/api/review/sessions")
      .send({ mode: "queue" });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body?.error?.code).toBe("csrf_blocked");

    // The app above mirrors the production mount; this pins that it IS the production
    // mount. Without it, removing a middleware from server/index.ts would leave the
    // test green while the real surface was unguarded.
    const indexSrc = fs.readFileSync("server/index.ts", "utf8");
    const mount = indexSrc.slice(indexSrc.indexOf('app.use(\n  "/api/review"'));
    const mountBlock = mount.slice(0, mount.indexOf(");") + 2);
    expect(mountBlock).toContain("requireSupabaseAuth");
    expect(mountBlock).toContain("requireStudentOrAdmin");
    expect(mountBlock).toContain("doubleCsrfProtection");
    expect(mountBlock).toContain("reviewCanonicalRouter");
  });

  // -------------------------------------------------------------------------
  // A7 — the servable join
  // -------------------------------------------------------------------------
  it("A7: the pool excludes non-servable questions but leaves their queue entries alone", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    await enqueue(testPg!, { questionId: Q_RETIRED, queuedAt: T2 });

    const created = await createSession();
    expect(created.status).toBe(200);

    const items = await testPg!.query(
      `SELECT question_id FROM public.review_session_items WHERE session_id = $1`,
      [created.body.sessionId],
    );
    const ids = items.rows.map((r) => r.question_id);
    expect(ids).toContain(Q_ALG);
    expect(ids).not.toContain(Q_RETIRED);

    // Ruling 18: the retired question's entry is left alone, not closed.
    const entry = await testPg!.query(
      `SELECT status FROM public.review_schedule WHERE question_id = $1`,
      [Q_RETIRED],
    );
    expect(entry.rows[0].status).toBe("active");
  });

  // -------------------------------------------------------------------------
  // A8 — ordering
  // -------------------------------------------------------------------------
  it("A8: pool order is queued_at, then question_id", async () => {
    // Q_RW and Q_ADV share a timestamp, so only the question_id tiebreak can order
    // them; Q_ALG is later and must come last despite sorting first alphabetically.
    await enqueue(testPg!, { questionId: Q_RW, queuedAt: T1 });
    await enqueue(testPg!, { questionId: Q_ADV, queuedAt: T1 });
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T2 });

    const created = await createSession();
    const items = await testPg!.query(
      `SELECT question_id FROM public.review_session_items
        WHERE session_id = $1 ORDER BY ordinal ASC`,
      [created.body.sessionId],
    );
    expect(items.rows.map((r) => r.question_id)).toEqual([Q_ADV, Q_RW, Q_ALG]);
  });

  // -------------------------------------------------------------------------
  // A9 — session mode
  // -------------------------------------------------------------------------
  it("A9: session mode includes a question missed in that session and again later", async () => {
    // Missed in PRACTICE_SESSION, superseded, then missed again in OTHER_SESSION. The
    // open entry carries the later session; the closed one carries the provenance.
    await enqueue(testPg!, {
      questionId: Q_ALG,
      queuedAt: T1,
      sourceSessionId: PRACTICE_SESSION,
      status: "superseded",
    });
    await enqueue(testPg!, {
      questionId: Q_ALG,
      queuedAt: T3,
      sourceSessionId: OTHER_SESSION,
      status: "active",
    });
    // A question from another session entirely must NOT appear.
    await enqueue(testPg!, {
      questionId: Q_RW,
      queuedAt: T2,
      sourceSessionId: OTHER_SESSION,
    });

    const created = await createSession({
      mode: "session",
      filters: {
        source_engine: "practice",
        source_session_id: PRACTICE_SESSION,
      },
    });
    expect(created.status).toBe(200);

    const items = await testPg!.query(
      `SELECT question_id FROM public.review_session_items WHERE session_id = $1`,
      [created.body.sessionId],
    );
    const ids = items.rows.map((r) => r.question_id);
    expect(ids).toContain(Q_ALG);
    expect(ids).not.toContain(Q_RW);
  });

  // -------------------------------------------------------------------------
  // A10 — mastery
  // -------------------------------------------------------------------------
  it("A10: skip emits no mastery; answer emits it with event id = the item id", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    await enqueue(testPg!, { questionId: Q_RW, queuedAt: T2 });
    const created = await createSession();
    const sessionId = created.body.sessionId as string;

    const first = await nextItem(sessionId);
    const skipItemId = first.body.sessionItemId as string;
    const skipped = await request(app)
      .post(`/api/review/sessions/${sessionId}/skip`)
      .send({ sessionItemId: skipItemId });
    expect(skipped.status).toBe(200);

    expect(hoisted.masteryCalls).toHaveLength(0);
    const skipAttempts = await testPg!.query(
      `SELECT count(*)::int AS c FROM public.review_error_attempts WHERE session_item_id = $1`,
      [skipItemId],
    );
    expect(skipAttempts.rows[0].c).toBe(0);

    const second = await nextItem(sessionId);
    const answerItemId = second.body.sessionItemId as string;
    await request(app)
      .post("/api/review/answer")
      .send({
        sessionId,
        sessionItemId: answerItemId,
        selectedAnswer: await tokenFor(answerItemId, "B"),
        clientAttemptId: "a10-client-attempt",
      });

    expect(hoisted.masteryCalls).toHaveLength(1);
    const call = hoisted.masteryCalls[0]!;
    expect(call.eventId).toBe(answerItemId);
    expect(call.sourceFamily).toBe("review");
    expect(call.eventSourceKind).toBe("review_error_attempt");

    // The trigger wrote the attempt row under the SAME id, which is what makes the
    // event id above correct rather than merely self-consistent.
    const attempt = await testPg!.query(
      `SELECT id FROM public.review_error_attempts WHERE session_item_id = $1`,
      [answerItemId],
    );
    expect(attempt.rows[0].id).toBe(answerItemId);
  });

  // -------------------------------------------------------------------------
  // A11 — open sessions
  // -------------------------------------------------------------------------
  it("A11: open sessions never include abandoned or completed", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    const open = await createSession({
      mode: "queue",
      idempotency_key: "k-open",
    });
    const openId = open.body.sessionId as string;

    const abandoned = await testPg!.query(
      `INSERT INTO public.review_sessions
         (student_id, actor_id, mode, filters, target_count, platform, status,
          abandoned_at, last_activity_at)
       VALUES ($1,$1,'queue','{}'::jsonb,1,'web','abandoned', now(), now())
       RETURNING id`,
      [STUDENT_A],
    );
    const completed = await testPg!.query(
      `INSERT INTO public.review_sessions
         (student_id, actor_id, mode, filters, target_count, platform, status,
          completed_at, last_activity_at)
       VALUES ($1,$1,'queue','{}'::jsonb,1,'web','completed', now(), now())
       RETURNING id`,
      [STUDENT_A],
    );

    const list = await request(app).get("/api/review/sessions/open");
    expect(list.status).toBe(200);
    const ids = (list.body.sessions as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain(openId);
    expect(ids).not.toContain(String(abandoned.rows[0].id));
    expect(ids).not.toContain(String(completed.rows[0].id));
  });

  // -------------------------------------------------------------------------
  // A12 — the sweep
  // -------------------------------------------------------------------------
  it("A12: the review sweep abandons only stale created and active sessions", async () => {
    const { sweepStaleReviewSessions } =
      await import("../../server/lib/review-stale-session-sweep");

    const mk = async (
      status: string,
      lastActivity: string,
    ): Promise<string> => {
      const extraCol =
        status === "abandoned"
          ? ", abandoned_at"
          : status === "completed"
            ? ", completed_at"
            : "";
      const extraVal = extraCol ? ", now()" : "";
      const r = await testPg!.query(
        `INSERT INTO public.review_sessions
           (student_id, actor_id, mode, filters, target_count, platform, status,
            last_activity_at${extraCol})
         VALUES ($1,$1,'queue','{}'::jsonb,1,'web',$2,$3${extraVal})
         RETURNING id`,
        [STUDENT_A, status, lastActivity],
      );
      return String(r.rows[0].id);
    };

    const staleCreated = await mk("created", "2026-01-01T00:00:00Z");
    const staleActive = await mk("active", "2026-01-01T00:00:00Z");
    const freshActive = await mk("active", new Date().toISOString());
    const staleCompleted = await mk("completed", "2026-01-01T00:00:00Z");

    const queueEntryId = await enqueue(testPg!, {
      questionId: Q_ALG,
      queuedAt: T1,
    });

    const result = await sweepStaleReviewSessions(
      makePgSupabase(testPg!) as never,
      { now: new Date() },
    );
    expect(result.sweptCount).toBe(2);

    const statuses = await testPg!.query(
      `SELECT id, status FROM public.review_sessions WHERE id = ANY($1::uuid[])`,
      [[staleCreated, staleActive, freshActive, staleCompleted]],
    );
    const byId = new Map(statuses.rows.map((r) => [String(r.id), r.status]));
    expect(byId.get(staleCreated)).toBe("abandoned");
    expect(byId.get(staleActive)).toBe("abandoned");
    expect(byId.get(freshActive)).toBe("active");
    expect(byId.get(staleCompleted)).toBe("completed");

    // Abandonment leaves the queue alone (brief R3 §2.5).
    const entry = await testPg!.query(
      `SELECT status FROM public.review_schedule WHERE id = $1`,
      [queueEntryId],
    );
    expect(entry.rows[0].status).toBe("active");
  });

  // -------------------------------------------------------------------------
  // A13 — the shared shuffle
  // -------------------------------------------------------------------------
  it("A13: practice and review use the one shared shuffle, with the same distribution", async () => {
    const contract = await import("../../shared/question-bank-contract");
    const practiceSrc = fs.readFileSync(
      "server/routes/practice-canonical.ts",
      "utf8",
    );

    // One implementation: practice no longer declares its own.
    expect(practiceSrc).not.toMatch(/^function fisherYates/m);
    expect(practiceSrc).not.toMatch(/^function buildServedOptions/m);
    expect(typeof contract.buildServedOptions).toBe("function");
    expect(typeof contract.fisherYates).toBe("function");
    // Imported, not re-declared.
    expect(practiceSrc).toContain("buildServedOptions,");

    // Distribution: every canonical key reaches every position over enough draws,
    // and option_order is always a permutation of A-D.
    const options = [
      { key: "A" as const, text: "alpha" },
      { key: "B" as const, text: "bravo" },
      { key: "C" as const, text: "charlie" },
      { key: "D" as const, text: "delta" },
    ];
    const positions = new Map<string, Set<number>>();
    for (let i = 0; i < 400; i += 1) {
      const served = contract.buildServedOptions(options);
      expect([...served.optionOrder].sort()).toEqual(["A", "B", "C", "D"]);
      expect(Object.keys(served.optionTokenMap)).toHaveLength(4);
      expect(new Set(Object.values(served.optionTokenMap)).size).toBe(4);
      served.optionOrder.forEach((key, index) => {
        if (!positions.has(key)) positions.set(key, new Set());
        positions.get(key)!.add(index);
      });
    }
    for (const key of ["A", "B", "C", "D"]) {
      expect(
        positions.get(key)?.size,
        `${key} never reached all 4 positions`,
      ).toBe(4);
    }
  });

  // -------------------------------------------------------------------------
  // A14 — response shape parity with practice (owner ruling 2026-09-21)
  // -------------------------------------------------------------------------
  it("A14: review's five loop responses satisfy practice's response types", async () => {
    await enqueue(testPg!, { questionId: Q_ALG, queuedAt: T1 });
    await enqueue(testPg!, { questionId: Q_RW, queuedAt: T2 });

    const created = await createSession();
    const sessionId = created.body.sessionId as string;
    const state = await request(app).get(
      `/api/review/sessions/${sessionId}/state`,
    );
    const next = await nextItem(sessionId);
    const answerItemId = next.body.sessionItemId as string;
    const answered = await request(app)
      .post("/api/review/answer")
      .send({
        sessionId,
        sessionItemId: answerItemId,
        selectedAnswer: await tokenFor(answerItemId, "B"),
      });
    const second = await nextItem(sessionId);
    const skipped = await request(app)
      .post(`/api/review/sessions/${sessionId}/skip`)
      .send({ sessionItemId: second.body.sessionItemId });

    const responses = {
      create: created,
      state,
      next,
      answer: answered,
      skip: skipped,
    } as const;

    for (const [route, schema] of Object.entries(ENGINE_RESPONSE_SCHEMAS)) {
      const res = responses[route as keyof typeof responses];
      expect(res.status, `${route} did not return 200`).toBe(200);
      // NOT .strict(): review may ADD fields. It may not rename or drop one, which is
      // what a required-key miss here catches.
      const parsed = schema.safeParse(res.body);
      expect(
        parsed.success,
        `${route} response does not satisfy practice's shape: ${
          parsed.success ? "" : JSON.stringify(parsed.error.issues)
        }`,
      ).toBe(true);
    }
  });
});
