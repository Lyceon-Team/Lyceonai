/**
 * Practice Completion Behavioral Gate (Revision 3)
 *
 * @spec [Doc-02B_V4 §14] | @implemented [2026-07-22]
 *
 * Proves at the HTTP level that the completion logic works correctly:
 *   - Final ANSWER at the configured target count → response reports state:"completed"
 *   - Final SKIP at the configured target count → response reports state:"completed"
 *
 * This is the behavioral proof of the G1 fix (coerceTargetQuestionCount arity).
 * The existing static arity regex test in practice.selection-rpc.ci.test.ts is
 * kept as a regression guard; these behavioral tests are the real runtime proof.
 *
 * Mock architecture follows practice.grid-in-anti-leak.ci.test.ts — uses
 * configurable count query returns to simulate reaching the target.
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
const TEST_SESSION_ID = "00000000-0000-0000-0000-bbbbbbbbbb02";
const TEST_ITEM_ID = "00000000-0000-0000-0000-cccccccccc02";

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../apps/api/src/services/mastery-write", () => ({
  applyMasteryEvent: async () => ({ ok: true, error: null }),
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

const sessionRow = {
  id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  mode: "practice",
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

let mockItemStatus = "served";
let mockResolvedCount = TARGET_COUNT;

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
          return makeChain({
            single: sessionRow,
            array: [sessionRow],
            onUpdate: (patch) => ({
              ...sessionRow,
              ...patch,
            }),
          });
        }
        if (table === "practice_session_items") {
          const currentItem = {
            ...sessionItemRow,
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

describe("Practice completion behavioral gate", () => {
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
    mockResolvedCount = TARGET_COUNT;
  });

  // --- REVISION 3: Behavioral completion proofs ---

  it("POST /answer at target count → state:'completed'", async () => {
    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("completed");
    expect(res.body.isCorrect).toBe(true);
  });

  it("POST /sessions/:id/skip at target count → state:'completed'", async () => {
    const res = await request(app)
      .post(`/api/practice/sessions/${TEST_SESSION_ID}/skip`)
      .send({
        questionId: "SATM1AAAA01",
      });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("completed");
    expect(res.body.skipped).toBe(true);
  });

  it("POST /answer below target count → state:'active'", async () => {
    mockResolvedCount = 0;

    const res = await request(app).post("/api/practice/answer").send({
      sessionId: TEST_SESSION_ID,
      questionId: "SATM1AAAA01",
      selectedAnswer: "opt_tok_B",
    });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("active");
  });

  it("POST /sessions/:id/skip below target count → state:'active'", async () => {
    mockResolvedCount = 0;

    const res = await request(app)
      .post(`/api/practice/sessions/${TEST_SESSION_ID}/skip`)
      .send({
        questionId: "SATM1AAAA01",
      });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("active");
  });
});
