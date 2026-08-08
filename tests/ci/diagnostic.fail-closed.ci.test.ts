/**
 * Diagnostic Fail-Closed Mastery Gate
 *
 * @spec [Doc-05A §11, Codex audit Fix 1] | @implemented [2026-08-08]
 *
 * Proves at the HTTP level that diagnostic sessions fail-closed when mastery
 * emission fails:
 *   - applyMasteryEvent returns { ok: false } for diagnostic → HTTP 500
 *   - The 500 response does NOT report state:"completed"
 *   - A retry of the same client_attempt_id re-attempts mastery, succeeds on
 *     recovery → HTTP 200 with answer data
 *   - Practice mode (regression) continues with warn-and-continue when mastery
 *     fails — it should still return 200 and state:"completed"
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
        // findSessionItemByClientAttemptId path: return null when no
        // client_attempt_id is set on the mock item (simulates no prior
        // recorded attempt in the DB).
        if (hasClientAttemptIdFilter && !mockItemClientAttemptId) {
          return { data: null, ...result };
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
            onUpdate: (patch) => ({
              ...currentSession,
              ...patch,
            }),
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
          };
          return makeChain({
            single: currentItem,
            array: [currentItem],
            onUpdate: (patch) => {
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

describe("Diagnostic fail-closed mastery gate", () => {
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
    mockApplyMasteryEvent.mockReset();
  });

  it("returns 500 when applyMasteryEvent returns {ok:false} for diagnostic", async () => {
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("diagnostic_mastery_emission_failed");
  });

  it("does NOT report state:'completed' on mastery failure", async () => {
    mockApplyMasteryEvent.mockResolvedValue({
      ok: false,
      error: "simulated_failure",
    });

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(500);
    // The 500 response must never include state:"completed" — the diagnostic
    // is not complete without its mastery audit trail.
    expect(res.body.state).toBeUndefined();
    expect(res.body.error).toBe("diagnostic_mastery_emission_failed");
  });

  it("retries mastery emission on replay with same client_attempt_id", async () => {
    // --- First call: mastery fails, answer is recorded but 500 returned ---
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

    expect(firstRes.status).toBe(500);
    expect(firstRes.body.error).toBe("diagnostic_mastery_emission_failed");

    // --- Between calls: simulate DB state after the first call recorded the
    // answer but returned 500 due to mastery failure. The session item is now
    // "answered" with the client_attempt_id bound. ---
    mockItemStatus = "answered";
    mockItemOutcome = "answered";
    mockItemIsCorrect = true;
    mockItemClientAttemptId = RETRY_CLIENT_ATTEMPT_ID;
    mockItemAnsweredAt = "2026-07-22T00:00:02Z";
    mockItemSelectedAnswer = "B";

    // Mastery now recovers
    mockApplyMasteryEvent.mockResolvedValue({ ok: true, error: null });

    // --- Second call: same client_attempt_id, mastery succeeds ---
    const retryRes = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
      clientAttemptId: RETRY_CLIENT_ATTEMPT_ID,
    });

    expect(retryRes.status).toBe(200);
    // The replay path must have re-attempted mastery emission (Fix B) and
    // succeeded, so it returns the answer data with idempotentRetried flag.
    expect(retryRes.body.isCorrect).toBe(true);
    expect(retryRes.body.idempotentRetried).toBe(true);
    // @spec [Codex re-audit Fix A] After successful mastery re-emission, the
    // replay path must run completion reconciliation and return state:"completed"
    // when resolvedCount >= target. Without this assertion the test certified
    // the bug: mastery re-emits but diagnostic stays ACTIVE forever.
    expect(retryRes.body.state).toBe("completed");
    // Verify mastery was actually re-attempted on the replay
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
  });

  it("optimistic-race replay fails closed when mastery re-emission fails", async () => {
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

    // Diagnostic fail-closed: mastery failure on race path → 500
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("diagnostic_mastery_emission_failed");
    expect(res.body.state).toBeUndefined();
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
});
