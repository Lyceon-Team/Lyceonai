/**
 * Practice /next Anti-Leak CI Test (HTTP-level)
 *
 * @spec [Doc-02B_V4 §14/§20; Preamble V3 §12 INV-02B-01; SKILL.md §Proving mechanism]
 * @implemented [2026-06-27]
 *
 * Proves at the HTTP level that GET /api/practice/sessions/{id}/next returns
 * correct_answer:null and explanation:null in the question DTO, even when the
 * underlying session item snapshot contains answer-bearing data (correct_answer,
 * explanation, correct_variants). This is the "submits-then-reads" contract
 * required by SKILL.md §Proving mechanism for the new RPC selection path.
 *
 * The mock provides a fully-populated practice_session_items row (with
 * correct_answer="B" and explanation="Because...") — the test asserts the
 * HTTP response null-strips them.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express, Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = "anti-leak-practice-user";
const TEST_SESSION_ID = "00000000-0000-0000-0000-000000000a01";
const TEST_ITEM_ID = "00000000-0000-0000-0000-000000000b01";
const TEST_QUESTION_ID = "SATM1TEST01";

const FIXTURE_SESSION = {
  id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  section: "M",
  mode: "balanced",
  status: "in_progress",
  completed: false,
  metadata: {
    client_instance_id: "ci-test",
    prebuilt: true,
    target_question_count: 10,
    active_session_item_id: TEST_ITEM_ID,
    last_served_ordinal: 1,
  },
};

const FIXTURE_SESSION_ITEM = {
  id: TEST_ITEM_ID,
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  question_id: TEST_QUESTION_ID,
  question_canonical_id: TEST_QUESTION_ID,
  question_section: "M",
  question_item_type: null,
  question_correct_variants: null,
  question_stem: "What is 2 + 2?",
  question_options: [
    { key: "A", text: "3" },
    { key: "B", text: "4" },
    { key: "C", text: "5" },
    { key: "D", text: "6" },
  ],
  question_difficulty: 1,
  question_domain: "Algebra",
  question_skill: "Addition",
  question_subskill: null,
  question_exam: null,
  question_structure_cluster_id: null,
  // ANSWER-BEARING FIELDS — these exist in the DB snapshot for server-side
  // grading but must NEVER appear in the /next HTTP response.
  question_correct_answer: "B",
  question_explanation: "2 + 2 = 4, so the answer is B.",
  option_order: ["A", "B", "C", "D"],
  option_token_map: { A: "opt_1", B: "opt_2", C: "opt_3", D: "opt_4" },
  ordinal: 1,
  status: "served",
  attempt_id: null,
  client_instance_id: "ci-test",
  selected_answer: null,
  is_correct: null,
  outcome: null,
  answered_at: null,
  time_spent_ms: null,
  client_attempt_id: null,
};

const FIXTURE_CONFIG = [
  { key: "max_concurrent_sessions", value: 5 },
  { key: "default_session_count_web", value: 10 },
  { key: "max_session_count_premium", value: 60 },
  { key: "target_seconds_per_question", value: 90 },
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../apps/api/src/lib/rate-limit-ledger", () => ({
  checkAndReservePracticeQuota: vi.fn().mockResolvedValue({
    allowed: true,
    current: 1,
    limit: 40,
    remaining: 39,
  }),
  RateLimitUnavailableError: class extends Error {},
}));

// Build a fluent chain mock that handles multiple tables.
// listValue is returned by bare await (array queries); singleValue by .single()/.maybeSingle().
function buildChainMock(resolveValue: unknown, listOverride?: unknown) {
  const listValue = listOverride ?? resolveValue;
  const chain: Record<string, unknown> = {};
  const identity = () => chain;
  Object.assign(chain, {
    select: identity,
    eq: identity,
    is: identity,
    in: identity,
    order: identity,
    limit: identity,
    update: () => chain,
    insert: () => chain,
    delete: identity,
    match: identity,
    single: () => Promise.resolve(resolveValue),
    maybeSingle: () => Promise.resolve(resolveValue),
    then: (resolve: (v: unknown) => unknown) => resolve(listValue),
  });
  return chain;
}

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: mockFrom,
    rpc: mockRpc,
  },
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Practice /next anti-leak (HTTP-level)", () => {
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
          display_name: "Test User",
        };
        next();
      },
    );

    vi.spyOn(authModule, "requireSupabaseAuth").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        if (!(req as Record<string, unknown>).user) {
          return _res.status(401).json({ error: "auth_required" });
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

    // Configure table-specific mock returns
    mockFrom.mockImplementation((table: string) => {
      if (table === "practice_runtime_config") {
        return buildChainMock({
          data: FIXTURE_CONFIG,
          error: null,
        });
      }
      if (table === "practice_sessions") {
        return buildChainMock({
          data: FIXTURE_SESSION,
          error: null,
        });
      }
      if (table === "practice_session_items") {
        // .single()/.maybeSingle() get the single-object form;
        // bare await (e.g. getSessionStats) gets the array form.
        return buildChainMock(
          { data: FIXTURE_SESSION_ITEM, error: null, count: 10 },
          { data: [FIXTURE_SESSION_ITEM], error: null, count: 10 },
        );
      }
      // Default: return empty
      return buildChainMock({ data: null, error: null });
    });

    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it("GET /next returns correct_answer:null and explanation:null in question DTO", async () => {
    const res = await request(app)
      .get(`/api/practice/sessions/${TEST_SESSION_ID}/next`)
      .set("Origin", "http://localhost:5000")
      .query({ client_instance_id: "ci-test" });

    expect(res.status).toBe(200);
    expect(res.body.question).toBeDefined();

    const question = res.body.question;

    expect(question.correct_answer).toBeNull();
    expect(question.explanation).toBeNull();
    expect(question).not.toHaveProperty("correct_variants");
    expect(question).not.toHaveProperty("option_metadata");
    expect(question).not.toHaveProperty("question_correct_answer");
    expect(question).not.toHaveProperty("question_explanation");

    expect(typeof question.stem).toBe("string");
    expect(question.stem.length).toBeGreaterThan(0);
    expect(question.sessionItemId).toBeDefined();
  });

  it("response body never contains raw answer-bearing field values from fixture", async () => {
    const res = await request(app)
      .get(`/api/practice/sessions/${TEST_SESSION_ID}/next`)
      .set("Origin", "http://localhost:5000")
      .query({ client_instance_id: "ci-test" });

    const bodyStr = JSON.stringify(res.body);

    // The fixture's correct_answer value "B" is too short to be a reliable signal,
    // but the explanation is unique enough to detect a leak.
    expect(bodyStr).not.toContain("2 + 2 = 4, so the answer is B.");

    // The snapshot field names must not appear in the response
    expect(bodyStr).not.toContain("question_correct_answer");
    expect(bodyStr).not.toContain("question_explanation");
    expect(bodyStr).not.toContain("correct_variants");
    expect(bodyStr).not.toContain("option_metadata");
  });
});
