/**
 * Practice serves a question's assets (F-33)
 *
 * @spec [Doc-02A_V6 §16; Doc-02B_V4 §14/§20; register F-33; owner ruling Brief 6] |
 *   @implemented [2026-09-30] |
 * plain English: a session item whose snapshot carries `question_assets` is served with those
 * assets (filtered to the pre-submit roles), not `null`. `SESSION_ITEM_SELECT` used to omit
 * `question_assets` and `question_estimated_time_seconds`, so every serving path that rebuilds the
 * question from the session item sent `assets: null`; production had 0 questions with assets, so
 * nobody saw it, but the first figure added to the bank would have vanished silently.
 *
 * Runs the real app (GET /next). The database is a PostgREST-shaped fake that returns ONLY the
 * columns the query selected — the property this defect lived in; a fake that returned the whole
 * row (as the anti-leak /next test's does) cannot see it. Presence first: the served question is
 * the seeded one. Anti-leak is asserted in the same response: the explanation-role asset stays
 * filtered out and `correct_answer` / `explanation` stay null.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express, Request, Response, NextFunction } from "express";

const TEST_USER_ID = "00000000-0000-0000-0000-f33f33f33f33";
const TEST_SESSION_ID = "00000000-0000-0000-0000-f33000000001";
const TEST_ITEM_ID = "00000000-0000-0000-0000-f33000000002";

const STIMULUS_ASSET = {
  role: "stimulus",
  kind: "svg",
  src: "f33-figure.svg",
  alt: "A line through (0, 1) and (2, 5)",
};
const EXPLANATION_ASSET = {
  role: "explanation",
  kind: "svg",
  src: "f33-worked-solution.svg",
};

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
  client_instance_id: "ci-f33",
  status: "active",
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
  last_activity_at: "2026-09-30T00:00:00Z",
  completed_at: null,
  actor_id: TEST_USER_ID,
  metadata: JSON.stringify({
    prebuilt: true,
    active_session_item_id: null,
    last_served_ordinal: 0,
    calculator_state: null,
  }),
};

/** The full stored row, as the snapshot writer (`buildSessionItemInsertRows`) stores it. */
const sessionItemRow = {
  id: TEST_ITEM_ID,
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  ordinal: 1,
  question_id: "SATMF33AAA01",
  question_stem:
    "The line in the figure passes through two points. What is its slope?",
  question_passage: null,
  question_options: JSON.stringify([
    { key: "A", text: "1" },
    { key: "B", text: "2" },
    { key: "C", text: "3" },
    { key: "D", text: "4" },
  ]),
  question_correct_answer: "B",
  question_explanation: "Rise 4 over run 2 is 2.",
  question_option_metadata: null,
  question_assets: { v: 1, items: [STIMULUS_ASSET, EXPLANATION_ASSET] },
  question_estimated_time_seconds: 75,
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
  option_order: null,
  option_token_map: null,
  client_instance_id: "ci-f33",
};

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  /** Keep only the selected columns, as PostgREST does. `*` (or no select) keeps the row. */
  const project = (row: unknown, cols: string | null): unknown => {
    if (row === null || typeof row !== "object" || cols === null) return row;
    const wanted = cols
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (wanted.includes("*")) return row;
    const source = row as Record<string, unknown>;
    return Object.fromEntries(
      wanted.filter((c) => c in source).map((c) => [c, source[c]]),
    );
  };

  const makeChain = (opts: { single: unknown; array: unknown[] }) => {
    let selected: string | null = null;
    const terminal = {
      select: (cols?: string) => {
        if (typeof cols === "string") selected = cols;
        return chain;
      },
      single: async () => ({
        data: project(opts.single, selected),
        error: null,
      }),
      maybeSingle: async () => ({
        data: project(opts.single, selected),
        error: null,
      }),
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({
          data: opts.array.map((row) => project(row, selected)),
          error: null,
        }),
    };
    const chain: Record<string, unknown> = new Proxy(terminal, {
      get(target, prop) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return (..._args: unknown[]) => chain;
      },
    });
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
          return makeChain({ single: sessionItemRow, array: [sessionItemRow] });
        }
        return makeChain({ single: null, array: [] });
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

describe("practice serves a question's assets (F-33)", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const authModule = await import("../../server/middleware/supabase-auth");
    vi.spyOn(authModule, "supabaseAuthMiddleware").mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as Record<string, unknown>).user = {
          id: TEST_USER_ID,
          email: "f33@example.test",
          role: "student",
          isAdmin: false,
          isGuardian: false,
          display_name: "F33 Student",
        };
        next();
      },
    );
    vi.spyOn(authModule, "requireSupabaseAuth").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    vi.spyOn(authModule, "requireStudentOrAdmin").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    vi.spyOn(authModule, "requireProfileComplete").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    vi.spyOn(authModule, "requireGuardianLinkForUnder13").mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    app = (await import("../../server/index")).default;
  });

  afterAll(() => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it("GET /next returns the stimulus asset, not null; the explanation asset stays filtered out", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-f33`,
    );

    expect(res.status).toBe(200);
    // Presence: the served question is the seeded one.
    expect(res.body.question?.stem).toBe(sessionItemRow.question_stem);
    // The assets arrive, filtered to the pre-submit roles.
    expect(res.body.question.assets).toEqual({ v: 1, items: [STIMULUS_ASSET] });
    // Anti-leak holds in the same response.
    expect(JSON.stringify(res.body)).not.toContain(EXPLANATION_ASSET.src);
    expect(res.body.question.correct_answer).toBeNull();
    expect(res.body.question.explanation).toBeNull();
  });
});
