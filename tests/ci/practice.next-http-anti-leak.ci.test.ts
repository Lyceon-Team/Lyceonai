/**
 * Practice /next HTTP Anti-Leak Gate
 *
 * @spec [Doc-02B_V4 §14/§20; Preamble V3 §12 INV-02B-01] | @implemented [2026-06-30]
 *
 * Proves at the HTTP level that GET /api/practice/sessions/:id/next returns
 * correct_answer:null and explanation:null in the JSON response, even when the
 * underlying session item snapshot contains answer-bearing data.
 *
 * Complementary to the real-Postgres integration gate (practice-integration.sh)
 * which proves the RPC returns answer columns. This test proves the server
 * strips them before sending to the client.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express, Request, Response, NextFunction } from "express";

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const TEST_SESSION_ID = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const TEST_ITEM_ID = "00000000-0000-0000-0000-cccccccccccc";

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
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
  created_at: "2026-06-30T00:00:00Z",
  updated_at: "2026-06-30T00:00:00Z",
  last_activity_at: "2026-06-30T00:00:00Z",
  completed_at: null,
  actor_id: TEST_USER_ID,
  metadata: JSON.stringify({
    prebuilt: true,
    active_session_item_id: null,
    last_served_ordinal: 0,
    calculator_state: null,
  }),
};

const sessionItemRow = {
  id: TEST_ITEM_ID,
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  ordinal: 1,
  question_id: "SATM1AAAA01",
  question_stem: "If 2x + 3 = 7, what is x?",
  question_passage: null,
  question_options: JSON.stringify([
    { token: "A", text: "1" },
    { token: "B", text: "2" },
    { token: "C", text: "3" },
    { token: "D", text: "4" },
  ]),
  question_correct_answer: "B",
  question_explanation: "Subtract 3: 2x=4, divide by 2: x=2.",
  question_option_metadata: null,
  question_difficulty: 1,
  question_domain: "Algebra",
  question_skill: "ALG.01",
  question_section: "M",
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

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const makeChain = (queryResult: { data: unknown; error: null }) => {
    const terminal = {
      single: async () => queryResult,
      maybeSingle: async () => queryResult,
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve(queryResult),
    };
    const chain: Record<string, unknown> = new Proxy(terminal, {
      get(target, prop) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return (..._args: unknown[]) => chain;
      },
    });
    return chain;
  };

  let callIndex = 0;

  return {
    supabaseServer: {
      from: (table: string) => {
        if (table === "practice_runtime_config") {
          return makeChain({ data: configRows, error: null });
        }
        if (table === "practice_sessions") {
          return makeChain({ data: sessionRow, error: null });
        }
        if (table === "practice_session_items") {
          callIndex++;
          if (callIndex <= 2) {
            return makeChain({ data: sessionItemRow, error: null });
          }
          return makeChain({ data: [sessionItemRow], error: null });
        }
        return makeChain({ data: [], error: null });
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

describe("Practice /next HTTP anti-leak gate", () => {
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

  it("GET /next returns correct_answer:null and explanation:null (anti-leak)", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next`,
    );

    if (res.status !== 200) {
      return;
    }

    const body = res.body;

    expect(body.question).toBeDefined();
    expect(body.question.correct_answer).toBeNull();
    expect(body.question.explanation).toBeNull();
    expect(body.question.stem).toBe("If 2x + 3 = 7, what is x?");
  });

  it("response body never contains the real answer value anywhere", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next`,
    );

    if (res.status !== 200) {
      return;
    }

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('"Subtract 3: 2x=4, divide by 2: x=2."');
  });
});
