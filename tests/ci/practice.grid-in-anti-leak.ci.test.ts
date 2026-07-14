/**
 * Practice Grid-In Anti-Leak + Grading Gate + MCQ Non-Regression
 *
 * @spec [Doc-02B_V4 §14; Doc-02-Preamble_V3 §12 INV-02B-01; TIGHTENING-1] | @implemented [2026-07-09]
 *
 * Proves at the HTTP level that grid-in items served via GET /next:
 *   - return correct_answer:null, explanation:null (anti-leak)
 *   - never expose correct_variants in the response body
 *   - serve inputMode:"numeric_entry", options:[], itemType:"grid_in"
 *
 * Proves grid-in grading via POST /answer:
 *   - correct when submitted answer is in correct_variants
 *   - incorrect when submitted answer is NOT in correct_variants
 *   - response never contains correct_variants
 *
 * MCQ non-regression: proves the unified grader left MCQ serve+grade identical.
 *
 * Mirrors practice.next-http-anti-leak.ci.test.ts (MCQ gate) with a grid-in fixture.
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
const TEST_SESSION_ID = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const TEST_ITEM_ID = "00000000-0000-0000-0000-cccccccccccc";
const TEST_MCQ_ITEM_ID = "00000000-0000-0000-0000-dddddddddddd";

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../apps/api/src/services/mastery-write", () => ({
  applyMasteryEvent: async () => ({ ok: true, error: null }),
}));

const configRows = [
  { key: "max_concurrent_sessions", value: 5 },
  { key: "default_session_count_web", value: 20 },
  { key: "max_session_count_premium", value: 60 },
  { key: "target_seconds_per_question", value: 90 },
  { key: "answer_rate_limit_window_ms", value: 60000 },
  { key: "answer_rate_limit_max", value: 30 },
];

const sessionRow = {
  id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  mode: "practice",
  filters: {},
  target_count: 5,
  platform: "web",
  client_instance_id: "ci-test",
  status: "active",
  created_at: "2026-07-09T00:00:00Z",
  updated_at: "2026-07-09T00:00:00Z",
  last_activity_at: "2026-07-09T00:00:00Z",
  completed_at: null,
  actor_id: TEST_USER_ID,
  metadata: JSON.stringify({
    prebuilt: true,
    active_session_item_id: null,
    last_served_ordinal: 0,
    calculator_state: null,
  }),
};

const MCQ_OPTION_TOKEN_MAP = JSON.stringify({
  opt_tok_A: "A",
  opt_tok_B: "B",
  opt_tok_C: "C",
  opt_tok_D: "D",
});

const gridInItemRow = {
  id: TEST_ITEM_ID,
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  ordinal: 1,
  question_id: "SATM1GRID01",
  question_stem: "What is the value of x if 5x = 1?",
  question_passage: null,
  question_options: JSON.stringify([]),
  question_correct_answer: "0.2",
  question_explanation: "Divide both sides by 5: x = 1/5 = 0.2.",
  question_option_metadata: null,
  question_difficulty: 2,
  question_domain: "Algebra",
  question_skill: "Linear Equations in One Variable",
  question_section: "M",
  question_item_type: "grid_in",
  question_correct_variants: ["0.2", "1/5", ".2", "0.20"],
  status: "pending",
  selected_answer: null,
  is_correct: null,
  outcome: null,
  time_spent_ms: null,
  client_attempt_id: null,
  answered_at: null,
  served_at: null,
  occurred_at: null,
  actor_id: TEST_USER_ID,
  option_order: null,
  option_token_map: null,
  client_instance_id: "ci-test",
};

const mcqItemRow = {
  id: TEST_MCQ_ITEM_ID,
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  ordinal: 2,
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
  status: "pending",
  selected_answer: null,
  is_correct: null,
  outcome: null,
  time_spent_ms: null,
  client_attempt_id: null,
  answered_at: null,
  served_at: null,
  occurred_at: null,
  actor_id: TEST_USER_ID,
  option_order: JSON.stringify(["A", "B", "C", "D"]),
  option_token_map: MCQ_OPTION_TOKEN_MAP,
  client_instance_id: "ci-test",
};

let mockActiveFixture: "grid_in" | "mcq" = "grid_in";
let mockItemStatus = "pending";

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const makeChain = (opts: {
    single: unknown;
    array: unknown[];
    onUpdate?: (patch: Record<string, unknown>) => unknown;
  }) => {
    const result = { error: null };
    let pendingUpdate: Record<string, unknown> | null = null;
    let isCountQuery = false;

    const chain = {
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
      eq: () => chain,
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
        if (pendingUpdate && opts.onUpdate) {
          const updated = opts.onUpdate(pendingUpdate);
          pendingUpdate = null;
          return { data: updated, ...result };
        }
        return { data: opts.single, ...result };
      },
      then: (
        resolve: (v: { data: unknown; count?: number; error: null }) => void,
        _reject?: (e: unknown) => void,
      ) => {
        if (isCountQuery) {
          resolve({ data: null, count: 1, ...result });
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
          return makeChain({ single: sessionRow, array: [sessionRow] });
        }
        if (table === "practice_session_items") {
          const fixture =
            mockActiveFixture === "mcq" ? mcqItemRow : gridInItemRow;
          const currentItem = {
            ...fixture,
            status: mockItemStatus,
          };
          return makeChain({
            single: currentItem,
            array: [currentItem],
            onUpdate: (patch) => ({
              ...currentItem,
              ...patch,
              status: patch.status ?? currentItem.status,
            }),
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

describe("Practice grid-in anti-leak + grading gate", () => {
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
    mockActiveFixture = "grid_in";
    mockItemStatus = "pending";
  });

  // --- GRID-IN: SERVE PATH (anti-leak) ---

  it("GET /next returns correct_answer:null and explanation:null for grid-in (anti-leak)", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);

    const body = res.body;
    expect(body.question).toBeDefined();
    expect(body.question.correct_answer).toBeNull();
    expect(body.question.explanation).toBeNull();
    expect(body.question.stem).toBe("What is the value of x if 5x = 1?");
  });

  it("GET /next serves grid-in surface markers (inputMode, options, itemType)", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);
    const q = res.body.question;
    expect(q.itemType).toBe("grid_in");
    expect(q.inputMode).toBe("numeric_entry");
    expect(q.options).toEqual([]);
  });

  it("response body never contains correct_variants or any accepted-form value", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("correct_variants");
    expect(bodyStr).not.toContain("1/5");
    expect(bodyStr).not.toContain(".20");
    expect(bodyStr).not.toContain("Divide both sides by 5: x = 1/5 = 0.2.");
  });

  // --- GRID-IN: GRADE PATH ---

  it("POST /answer grades grid-in correct (exact match from correct_variants)", async () => {
    mockItemStatus = "served";

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1GRID01",
      selectedAnswer: "0.2",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.mode).toBe("grid_in");
  });

  it("POST /answer grades grid-in correct (fraction variant from correct_variants)", async () => {
    mockItemStatus = "served";

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1GRID01",
      selectedAnswer: "1/5",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
  });

  it("POST /answer grades grid-in incorrect when answer not in correct_variants", async () => {
    mockItemStatus = "served";

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1GRID01",
      selectedAnswer: "0.3",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(false);
    expect(res.body.mode).toBe("grid_in");
  });

  it("POST /answer response includes correctAnswer but never correct_variants", async () => {
    mockItemStatus = "served";

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1GRID01",
      selectedAnswer: "0.2",
    });

    expect(res.status).toBe(200);
    expect(res.body.correctAnswer).toBe("0.2");
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("correct_variants");
  });

  // --- MCQ NON-REGRESSION: SERVE PATH ---

  it("GET /next returns correct_answer:null and explanation:null for MCQ (anti-leak non-regression)", async () => {
    mockActiveFixture = "mcq";
    mockItemStatus = "pending";

    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.question).toBeDefined();
    expect(body.question.correct_answer).toBeNull();
    expect(body.question.explanation).toBeNull();
    expect(body.question.stem).toBe("If 2x + 3 = 7, what is x?");
    expect(body.question.itemType).toBe("mcq");
    expect(Array.isArray(body.question.options)).toBe(true);
    expect(body.question.options.length).toBe(4);
  });

  // --- MCQ NON-REGRESSION: GRADE PATH ---

  it("POST /answer grades MCQ correct via option token (non-regression)", async () => {
    mockActiveFixture = "mcq";
    mockItemStatus = "served";

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.mode).toBe("multiple_choice");
    expect(res.body.correctOptionId).toBeDefined();
    expect(typeof res.body.correctOptionId).toBe("string");
  });

  it("POST /answer grades MCQ incorrect via option token (non-regression)", async () => {
    mockActiveFixture = "mcq";
    mockItemStatus = "served";

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_C",
    });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(false);
    expect(res.body.mode).toBe("multiple_choice");
    expect(res.body.correctOptionId).toBeDefined();
  });
});
