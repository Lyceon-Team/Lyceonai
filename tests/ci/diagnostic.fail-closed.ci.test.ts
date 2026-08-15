/**
 * Diagnostic Mastery-Tolerance Gate
 *
 * @spec [Doc-05A §11] | @implemented [2026-08-08] | @rescoped [2026-08-15]
 *
 * Proves at the HTTP level that diagnostic sessions tolerate mastery-emission
 * failure the SAME WAY practice does (warn-and-continue):
 *   - applyMasteryEvent returns { ok: false } for diagnostic → HTTP 200
 *     (answer was recorded; mastery is a downstream consumer, not a gatekeeper)
 *   - The 200 response reports state:"completed" when all items are answered
 *   - A replay of the same client_attempt_id re-attempts mastery, and even if
 *     mastery still fails → HTTP 200 with answer data
 *   - Practice mode (regression) continues with warn-and-continue when mastery
 *     fails — it should still return 200 and state:"completed"
 *   - Optimistic-race replay paths also return 200 regardless of mastery outcome
 *
 * @rescoped [2026-08-15] Mastery is a separate vertical. The diagnostic must
 * write its data correctly (answer rows, occurred_at, diagnostic_attempt tags)
 * and emit to mastery best-effort. If mastery fails, the student still advances.
 * The diagnostic FUNCTIONING must not depend on the mastery vertical being fixed.
 *
 * Mock architecture follows practice.completion-behavioral.ci.test.ts — uses
 * configurable count query returns and a vi.fn()-based mastery mock so tests
 * can reconfigure the return value per scenario.
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
import type { Express, Request, Response, NextFunction } from "express";

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const TEST_SESSION_ID = "00000000-0000-0000-0000-bbbbbbbbbb03";
const TEST_ITEM_ID = "00000000-0000-0000-0000-cccccccccc03";

const RETRY_CLIENT_ATTEMPT_ID = "00000000-0000-0000-0000-eeeeeeeeee01";

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

const mockApplyMasteryEvent = vi.fn();

vi.mock("../../apps/api/src/services/mastery-write", () => ({
  applyMasteryEvent: (...args: unknown[]) => mockApplyMasteryEvent(...args),
}));

const TARGET_COUNT = 1;

const configRows = [
  { key: "max_concurrent_sessions", value: 5 },
  { key: "default_session_count_web", value: 20 },
  { key: "max_session_count_premium", value: 60 },
  { key: "target_seconds_per_question", value: 90 },
  { key: "answer_rate_limit_window_ms", value: 60000 },
  { key: "answer_rate_limit_max", value: 30 },
];

const MCQ_OPTION_TOKEN_MAP = JSON.stringify({
  opt_tok_A: "A",
  opt_tok_B: "B",
  opt_tok_C: "C",
  opt_tok_D: "D",
});

const sessionItemRow = {
  id: TEST_ITEM_ID,
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  ordinal: 1,
  question_id: "SATM1AAAA01",
  question_stem: "If 2x + 3 = 7, what is x?",
  question_passage: null,
  question_options: JSON.stringify([
    { key: "A", text: "1" },
    { key: "B", text: "2" },
    { key: "C", text: "3" },
    { key: "D", text: "4" },
  ]),
  question_correct_answer: "B",
  question_explanation: "Subtract 3: 2x=4, divide by 2: x=2.",
  question_option_metadata: null,
  question_difficulty: 1,
  question_domain: "Algebra",
  question_skill: "ALG.01",
  question_section: "M",
  question_item_type: "mcq",
  question_correct_variants: null,
  status: "served",
  selected_answer: null,
  is_correct: null,
  outcome: null,
  time_spent_ms: null,
  client_attempt_id: null,
  answered_at: null,
  served_at: "2026-07-22T00:00:01Z",
  occurred_at: null,
  actor_id: TEST_USER_ID,
  option_order: JSON.stringify(["A", "B", "C", "D"]),
  option_token_map: MCQ_OPTION_TOKEN_MAP,
  client_instance_id: "ci-test",
};

// Mutable per-test overrides for session item state
let mockItemStatus = "served";
let mockItemOutcome: string | null = null;
let mockItemClientAttemptId: string | null = null;
let mockItemIsCorrect: boolean | null = null;
let mockItemAnsweredAt: string | null = null;
let mockItemSelectedAnswer: string | null = null;
let mockResolvedCount = TARGET_COUNT;
// Controls session mode per test: "diagnostic" or "practice"
let mockSessionMode = "diagnostic";
// When true, the CAS update (.eq("status","served").maybeSingle()) returns null,
// simulating an optimistic-race loss where another request already answered the item.
let mockCasUpdateReturnsNull = false;
// @spec [Codex REVISE Fix 1] Controls question metadata per test to trigger
// specific mastery failure branches (missing metadata, invalid difficulty).
let mockQuestionSection: string | null = "M";
let mockQuestionDomain: string | null = "Algebra";
let mockQuestionSkill: string | null = "ALG.01";
let mockQuestionDifficulty: number | null = 1;
// @spec [Codex REVISE Fix 2] When non-null, findSessionItemByClientAttemptId returns
// this object instead of the default currentItem. Enables testing the clientAttemptId
// replay path (path 2) independently from the initial session-item fetch.
let mockClientAttemptIdLookupItem: Record<string, unknown> | null = null;
// @spec [Codex re-audit Fix D] Records every update patch applied to practice_sessions.
// Tests assert that the handler issued a persisted lifecycle update, not just a response field.
const sessionUpdatePatches: Record<string, unknown>[] = [];
// @spec [Codex REVISE Fix 3] Records every update patch applied to practice_session_items.
// Tests assert that the handler persisted the answer row, not just returned a 200.
const itemUpdatePatches: Record<string, unknown>[] = [];

function makeSessionRow(mode: string): Record<string, unknown> {
  return {
    id: TEST_SESSION_ID,
    user_id: TEST_USER_ID,
    mode,
    filters: { target_question_count: TARGET_COUNT },
    target_count: TARGET_COUNT,
    platform: "web",
    client_instance_id: "ci-test",
    status: "active",
    created_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z",
    last_activity_at: "2026-07-22T00:00:00Z",
    completed_at: null,
    actor_id: TEST_USER_ID,
    metadata: JSON.stringify({
      prebuilt: true,
      active_session_item_id: null,
      last_served_ordinal: 0,
      calculator_state: null,
      target_question_count: TARGET_COUNT,
    }),
  };
}

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const makeChain = (opts: {
    single: unknown;
    array: unknown[];
    onUpdate?: (patch: Record<string, unknown>) => unknown;
  }) => {
    const result = { error: null };
    let pendingUpdate: Record<string, unknown> | null = null;
    let isCountQuery = false;
    let hasClientAttemptIdFilter = false;

    const chain: Record<string, unknown> = {
      select: (...args: unknown[]) => {
        if (
          args.length >= 2 &&
          typeof args[1] === "object" &&
          args[1] !== null &&
          (args[1] as Record<string, unknown>).count === "exact"
        ) {
          isCountQuery = true;
        }
        return chain;
      },
      eq: (col: string) => {
        if (col === "client_attempt_id") {
          hasClientAttemptIdFilter = true;
        }
        return chain;
      },
      neq: () => chain,
      in: () => chain,
      is: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      gt: () => chain,
      gte: () => chain,
      lt: () => chain,
      lte: () => chain,
      like: () => chain,
      ilike: () => chain,
      not: () => chain,
      filter: () => chain,
      match: () => chain,
      contains: () => chain,
      containedBy: () => chain,
      range: () => chain,
      overlaps: () => chain,
      textSearch: () => chain,
      update: (patch: Record<string, unknown>) => {
        pendingUpdate = patch;
        return chain;
      },
      insert: () => chain,
      upsert: () => chain,
      delete: () => chain,
      single: async () => ({ data: opts.single, ...result }),
      maybeSingle: async () => {
        // findSessionItemByClientAttemptId path: return separate lookup data
        // when configured, or null when no client_attempt_id is set.
        if (hasClientAttemptIdFilter) {
          if (mockClientAttemptIdLookupItem) {
            return { data: mockClientAttemptIdLookupItem, ...result };
          }
          if (!mockItemClientAttemptId) {
            return { data: null, ...result };
          }
        }
        if (pendingUpdate && opts.onUpdate) {
          const updated = opts.onUpdate(pendingUpdate);
          pendingUpdate = null;
          return { data: updated, ...result };
        }
        return { data: opts.single, ...result };
      },
      then: (
        resolve: (v: { data: unknown; count?: number; error: null }) => void,
      ) => {
        // Handle awaited .update().eq() chains that don't terminate with
        // .maybeSingle() — e.g. updateSessionLifecycle's fire-and-check pattern.
        if (pendingUpdate && opts.onUpdate) {
          const updated = opts.onUpdate(pendingUpdate);
          pendingUpdate = null;
          resolve({ data: updated, ...result });
          return;
        }
        if (isCountQuery) {
          resolve({ data: null, count: mockResolvedCount, ...result });
        } else {
          resolve({ data: opts.array, ...result });
        }
      },
    };
    return chain;
  };

  return {
    supabaseServer: {
      from: (table: string) => {
        if (table === "practice_runtime_config") {
          return makeChain({ single: configRows[0], array: configRows });
        }
        if (table === "practice_sessions") {
          const currentSession = makeSessionRow(mockSessionMode);
          return makeChain({
            single: currentSession,
            array: [currentSession],
            onUpdate: (patch) => {
              sessionUpdatePatches.push(patch);
              return {
                ...currentSession,
                ...patch,
              };
            },
          });
        }
        if (table === "practice_session_items") {
          const currentItem = {
            ...sessionItemRow,
            status: mockItemStatus,
            outcome: mockItemOutcome,
            client_attempt_id: mockItemClientAttemptId,
            is_correct: mockItemIsCorrect,
            answered_at: mockItemAnsweredAt,
            selected_answer: mockItemSelectedAnswer,
            question_section: mockQuestionSection,
            question_domain: mockQuestionDomain,
            question_skill: mockQuestionSkill,
            question_difficulty: mockQuestionDifficulty,
          };
          return makeChain({
            single: currentItem,
            array: [currentItem],
            onUpdate: (patch) => {
              itemUpdatePatches.push({ ...patch });
              if (mockCasUpdateReturnsNull) {
                // Simulate: the winning request already answered this item.
                // Flip mock state so the next findSessionItemById returns the
                // raced item with an outcome (handler's reload path).
                mockItemStatus = "answered";
                mockItemOutcome = "answered";
                mockItemIsCorrect = true;
                mockItemAnsweredAt = "2026-07-22T00:00:02Z";
                mockItemSelectedAnswer = "B";
                return null;
              }
              return {
                ...currentItem,
                ...patch,
                status: patch.status ?? currentItem.status,
              };
            },
          });
        }
        if (table === "student_skill_mastery") {
          return makeChain({ single: null, array: [] });
        }
        return makeChain({ single: null, array: [] });
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

describe("Diagnostic mastery-tolerance gate", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";

    const authModule = await import("../../server/middleware/supabase-auth");

    vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as Record<string, unknown>).user = {
          id: TEST_USER_ID,
          email: "test@example.com",
          role: "student",
          isAdmin: false,
          isGuardian: false,
          display_name: "Test Student",
        };
        next();
      },
    );

    vi.spyOn(authModule, "requireSupabaseAuth").mockImplementation(
      (req: Request, res: Response, next: NextFunction) => {
        if (!(req as Record<string, unknown>).user) {
          return res.status(401).json({ error: "auth_required" });
        }
        next();
      },
    );

    vi.spyOn(authModule, "requireStudentOrAdmin").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );

    vi.spyOn(authModule, "requireProfileComplete").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );

    vi.spyOn(authModule, "requireConsentCompliance").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );

    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockItemStatus = "served";
    mockItemOutcome = null;
    mockItemClientAttemptId = null;
    mockItemIsCorrect = null;
    mockItemAnsweredAt = null;
    mockItemSelectedAnswer = null;
    mockResolvedCount = TARGET_COUNT;
    mockSessionMode = "diagnostic";
    mockCasUpdateReturnsNull = false;
    mockQuestionSection = "M";
    mockQuestionDomain = "Algebra";
    mockQuestionSkill = "ALG.01";
    mockQuestionDifficulty = 1;
    mockClientAttemptIdLookupItem = null;
    sessionUpdatePatches.length = 0;
    itemUpdatePatches.length = 0;
    mockApplyMasteryEvent.mockReset();
  });

  // ---------------------------------------------------------------------------
  // @rescoped [2026-08-15] Diagnostic now uses warn-and-continue (matches practice)
  // @spec [Codex REVISE] Each fresh-answer failure branch is individually exercised.
  // ---------------------------------------------------------------------------

  it("returns 200 when applyMasteryEvent returns {ok:false} for diagnostic (warn-and-continue)", async () => {
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    // Diagnostic now matches practice: mastery failure → warn-and-continue → 200
    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.state).toBe("completed");
    // Mastery was attempted (best-effort)
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(1);
    // @spec [Codex REVISE Fix 3] Answer row was persisted
    expect(itemUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "answered",
        selected_answer: "B",
        is_correct: true,
        outcome: "correct",
        answered_at: expect.any(String),
        occurred_at: expect.any(String),
      }),
    );
  });

  // @spec [Codex REVISE Fix 1] Forces the missing-metadata branch
  // (canonicalId && difficultyBucket && (!section || !domain || !skill))
  // Uses question_domain = null (not question_section, which would fail
  // toCanonicalQuestionFromSessionItem validation and return 422).
  it("returns 200 when metadata missing (null domain) for diagnostic (warn-and-continue)", async () => {
    mockQuestionDomain = null;
    // Mastery mock should NOT be called — missing metadata skips emission
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.state).toBe("completed");
    // Mastery was NOT called — missing domain skips the emission entirely
    expect(mockApplyMasteryEvent).not.toHaveBeenCalled();
    // @spec [Codex REVISE Fix 3] Answer row was persisted despite skipped mastery
    expect(itemUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "answered",
        selected_answer: "B",
        is_correct: true,
        outcome: "correct",
        answered_at: expect.any(String),
        occurred_at: expect.any(String),
      }),
    );
  });

  // @spec [Codex REVISE Fix 1] Forces the invalid-difficulty branch
  // (canonicalId && !difficultyBucket)
  it("returns 200 when difficulty invalid for diagnostic (warn-and-continue)", async () => {
    mockQuestionDifficulty = 99; // resolveDifficultyBucketStrict returns null for values outside 1-3
    // Mastery mock should NOT be called — invalid difficulty skips emission
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.state).toBe("completed");
    // Mastery was NOT called — invalid difficulty skips the emission entirely
    expect(mockApplyMasteryEvent).not.toHaveBeenCalled();
    // @spec [Codex REVISE Fix 3] Answer row was persisted despite skipped mastery
    expect(itemUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "answered",
        selected_answer: "B",
        is_correct: true,
        outcome: "correct",
        answered_at: expect.any(String),
        occurred_at: expect.any(String),
      }),
    );
  });

  // @spec [Codex REVISE Fix 1] Forces the thrown-exception branch
  // (catch (masteryErr) around applyMasteryEvent)
  it("returns 200 when applyMasteryEvent throws for diagnostic (warn-and-continue)", async () => {
    mockApplyMasteryEvent.mockRejectedValue(new Error("mastery service down"));

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.state).toBe("completed");
    // Mastery was attempted but threw — caught and continued
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(1);
    // @spec [Codex REVISE Fix 3] Answer row was persisted despite thrown mastery
    expect(itemUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "answered",
        selected_answer: "B",
        is_correct: true,
        outcome: "correct",
        answered_at: expect.any(String),
        occurred_at: expect.any(String),
      }),
    );
  });

  it("reports state:'completed' even when mastery fails (warn-and-continue)", async () => {
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    // Diagnostic now completes even when mastery fails — the student answered
    // all questions, the answer is recorded, mastery is a downstream consumer.
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("completed");
    expect(res.body.isCorrect).toBe(true);
    // @spec [Codex REVISE Fix 3] Answer row persisted + lifecycle completed
    expect(itemUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "answered",
        selected_answer: "B",
        is_correct: true,
        outcome: "correct",
      }),
    );
    expect(sessionUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "completed",
        completed_at: expect.any(String),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // @spec [Codex REVISE Fix 2] Replay paths: mastery failure tolerance
  // Each replay entry point must return 200 even when mastery re-emission fails.
  // ---------------------------------------------------------------------------

  it("replay via status-check tolerates mastery failure (warn-and-continue)", async () => {
    // --- First call: answer is recorded (mastery fails but 200 returned) ---
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const firstRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.isCorrect).toBe(true);

    // --- Between calls: simulate DB state after the first call recorded the
    // answer. The session item is now "answered" with the client_attempt_id
    // bound. ---
    mockItemStatus = "answered";
    mockItemOutcome = "answered";
    mockItemIsCorrect = true;
    mockItemClientAttemptId = RETRY_CLIENT_ATTEMPT_ID;
    mockItemAnsweredAt = "2026-07-22T00:00:02Z";
    mockItemSelectedAnswer = "B";

    // @spec [Codex REVISE Fix 2] Mastery STAYS FAILING on replay — NOT flipped
    // to ok:true. The replay must still return 200, proving tolerance.

    // --- Second call: same client_attempt_id, mastery still fails ---
    const retryRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.isCorrect).toBe(true);
    expect(retryRes.body.idempotentRetried).toBe(true);
    // Completion reconciliation still runs on replay
    expect(retryRes.body.state).toBe("completed");
    // Mastery was attempted on both calls (best-effort)
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(2);
  });

  it("replay via status-check tolerates mastery throw (warn-and-continue)", async () => {
    // --- First call: mastery throws, 200 returned ---
    mockApplyMasteryEvent.mockRejectedValue(new Error("mastery service down"));

    const firstRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });
    expect(firstRes.status).toBe(200);

    // --- Between calls: simulate answered state ---
    mockItemStatus = "answered";
    mockItemOutcome = "answered";
    mockItemIsCorrect = true;
    mockItemClientAttemptId = RETRY_CLIENT_ATTEMPT_ID;
    mockItemAnsweredAt = "2026-07-22T00:00:02Z";
    mockItemSelectedAnswer = "B";

    // Mastery STILL throws on replay
    // --- Second call: replay, mastery throws again ---
    const retryRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.isCorrect).toBe(true);
    expect(retryRes.body.idempotentRetried).toBe(true);
    expect(retryRes.body.state).toBe("completed");
    // Mastery was attempted on both calls (threw both times)
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(2);
  });

  it("replay via status-check tolerates missing metadata (warn-and-continue)", async () => {
    // --- First call: mastery skipped due to missing metadata, 200 returned ---
    // Uses question_skill = null (not question_section, which would fail
    // toCanonicalQuestionFromSessionItem validation upstream).
    mockQuestionSkill = null;
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    const firstRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });
    expect(firstRes.status).toBe(200);

    // --- Between calls: simulate answered state (still missing skill) ---
    mockItemStatus = "answered";
    mockItemOutcome = "answered";
    mockItemIsCorrect = true;
    mockItemClientAttemptId = RETRY_CLIENT_ATTEMPT_ID;
    mockItemAnsweredAt = "2026-07-22T00:00:02Z";
    mockItemSelectedAnswer = "B";

    // --- Second call: replay, helper's missing-metadata early return fires ---
    const retryRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.isCorrect).toBe(true);
    expect(retryRes.body.idempotentRetried).toBe(true);
    expect(retryRes.body.state).toBe("completed");
    // Mastery was NOT called on either attempt — missing metadata skips it
    expect(mockApplyMasteryEvent).not.toHaveBeenCalled();
  });

  it("replay via clientAttemptId lookup tolerates mastery failure (warn-and-continue)", async () => {
    // @spec [Codex REVISE Fix 2] Exercises replay path 2: item still "served" in
    // the initial fetch, but findSessionItemByClientAttemptId finds a previously
    // answered item with the same id. The handler enters the clientAttemptId
    // replay branch and calls reEmitDiagnosticMasteryIfNeeded.
    //
    // Mock setup: mockItemStatus stays "served" (initial fetch returns served),
    // but mockClientAttemptIdLookupItem returns a separately constructed
    // "answered" item for the clientAttemptId query.
    mockClientAttemptIdLookupItem = {
      ...sessionItemRow,
      status: "answered",
      outcome: "answered",
      client_attempt_id: RETRY_CLIENT_ATTEMPT_ID,
      is_correct: true,
      answered_at: "2026-07-22T00:00:02Z",
      selected_answer: "B",
      question_section: "M",
      question_domain: "Algebra",
      question_skill: "ALG.01",
      question_difficulty: 1,
    };
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.idempotentRetried).toBe(true);
    // Completion reconciliation still runs
    expect(res.body.state).toBe("completed");
    // Mastery was attempted via the clientAttemptId replay path
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(1);
  });

  it("retries mastery emission on replay and recovers", async () => {
    // Regression: the original recovery scenario still works (mastery fails on
    // first call, recovers on replay).
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const firstRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.isCorrect).toBe(true);

    // --- Between calls: simulate answered state ---
    mockItemStatus = "answered";
    mockItemOutcome = "answered";
    mockItemIsCorrect = true;
    mockItemClientAttemptId = RETRY_CLIENT_ATTEMPT_ID;
    mockItemAnsweredAt = "2026-07-22T00:00:02Z";
    mockItemSelectedAnswer = "B";

    // Mastery now recovers
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    const retryRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.isCorrect).toBe(true);
    expect(retryRes.body.idempotentRetried).toBe(true);
    expect(retryRes.body.state).toBe("completed");
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(2);
  });

  it("practice mode continues with warn on mastery failure (regression)", async () => {
    // Switch to practice mode — mastery failure should NOT block the response
    mockSessionMode = "practice";
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    // Practice mode: warn-and-continue — response is 200, state reflects
    // completion (resolvedCount >= targetCount).
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("completed");
    expect(res.body.isCorrect).toBe(true);
    // @spec [Codex REVISE Fix 3] Answer row was persisted
    expect(itemUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "answered",
        selected_answer: "B",
        is_correct: true,
        outcome: "correct",
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // @spec [Doc-05A §11, Codex re-audit Fix B] Optimistic-race replay path
  // ---------------------------------------------------------------------------

  it("optimistic-race replay re-emits mastery and completes diagnostic", async () => {
    // Simulate the race: CAS update returns null (another request won), but
    // the item is already answered when re-loaded.
    mockCasUpdateReturnsNull = true;
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.idempotentRetried).toBe(true);
    // The race branch must re-emit mastery for diagnostic sessions
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(1);
    // And run completion reconciliation — return state:"completed"
    expect(res.body.state).toBe("completed");
    // @spec [Codex re-audit Fix D] Assert persisted lifecycle update (not just response)
    expect(sessionUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "completed",
        completed_at: expect.any(String),
      }),
    );
  });

  it("optimistic-race replay continues when mastery re-emission fails (warn-and-continue)", async () => {
    mockCasUpdateReturnsNull = true;
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    // Diagnostic now returns 200 on race path even when mastery fails
    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.idempotentRetried).toBe(true);
    // Mastery was attempted (best-effort)
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(1);
    // Completion reconciliation still runs
    expect(res.body.state).toBe("completed");
  });

  // @spec [Codex REVISE Fix 2] Optimistic-race with thrown exception
  it("optimistic-race replay continues when mastery re-emission throws (warn-and-continue)", async () => {
    mockCasUpdateReturnsNull = true;
    mockApplyMasteryEvent.mockRejectedValue(new Error("mastery service down"));

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.idempotentRetried).toBe(true);
    expect(mockApplyMasteryEvent).toHaveBeenCalledTimes(1);
    expect(res.body.state).toBe("completed");
  });

  // @spec [Codex REVISE Fix 2] Optimistic-race with missing metadata
  it("optimistic-race replay continues when metadata missing (warn-and-continue)", async () => {
    mockCasUpdateReturnsNull = true;
    mockQuestionSkill = null; // Missing skill triggers helper's early return
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.idempotentRetried).toBe(true);
    // Mastery not called on the race path — helper sees missing skill and logs
    expect(mockApplyMasteryEvent).not.toHaveBeenCalled();
    expect(res.body.state).toBe("completed");
  });

  it("optimistic-race replay skips mastery for practice mode (regression)", async () => {
    mockSessionMode = "practice";
    mockCasUpdateReturnsNull = true;

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    // Practice mode: no mastery re-emission on race path, returns 200 as before
    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.idempotentRetried).toBe(true);
    // No mastery call — practice mode doesn't re-emit on race path
    expect(mockApplyMasteryEvent).not.toHaveBeenCalled();
    // No state field for non-diagnostic race replay (unchanged behavior)
    expect(res.body.state).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // @spec [Codex REVISE Fix 3] Answer-row persistence proof (with idempotency key)
  // ---------------------------------------------------------------------------

  it("persists client_attempt_id in the answer row when provided", async () => {
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    // Answer row includes client_attempt_id when provided
    expect(itemUpdatePatches).toContainEqual(
      expect.objectContaining({
        status: "answered",
        selected_answer: "B",
        is_correct: true,
        outcome: "correct",
        answered_at: expect.any(String),
        occurred_at: expect.any(String),
        client_attempt_id: RETRY_CLIENT_ATTEMPT_ID,
      }),
    );
  });
});
