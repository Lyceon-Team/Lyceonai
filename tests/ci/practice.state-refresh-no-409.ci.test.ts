/**
 * Practice /state Refresh Regression Guard
 *
 * @spec [CodingStandards_v1, §9 Practice Engine Contracts] | @implemented [2026-07-24]
 *
 * Proves that GET /api/practice/sessions/:id/state does NOT return 409
 * when the requesting client_instance_id differs from the bound one.
 * A state READ is non-mutating — it must tolerate instance mismatch
 * so that page refresh, tab duplication, and browser restarts work.
 *
 * Regression guard for: session opened under instance A, refreshed
 * page sends instance B → must still get 200, not 409.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express, Request, Response, NextFunction } from "express";

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const TEST_SESSION_ID = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const BOUND_INSTANCE = "dcafd899-aaaa-bbbb-cccc-111111111111";
const NEW_INSTANCE = "3500105b-dddd-eeee-ffff-222222222222";

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
  filters: {
    client_instance_id: BOUND_INSTANCE,
    session_spec: { sections: ["Math"] },
  },
  target_count: 10,
  platform: "web",
  client_instance_id: BOUND_INSTANCE,
  status: "active",
  created_at: "2026-07-24T00:00:00Z",
  updated_at: "2026-07-24T00:00:00Z",
  last_activity_at: "2026-07-24T00:00:00Z",
  completed_at: null,
  actor_id: TEST_USER_ID,
};

const sessionItemRow = {
  id: "00000000-0000-0000-0000-cccccccccccc",
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  ordinal: 1,
  question_id: "SATM1AAAA01",
  question_stem: "If x = 2, what is 3x?",
  question_passage: null,
  question_options: JSON.stringify([
    { key: "A", text: "4" },
    { key: "B", text: "5" },
    { key: "C", text: "6" },
    { key: "D", text: "7" },
  ]),
  question_correct_answer: "C",
  question_explanation: "3 * 2 = 6",
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
  option_order: null,
  option_token_map: null,
  client_instance_id: BOUND_INSTANCE,
};

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const makeChain = (opts: { single: unknown; array: unknown[] }) => {
    const result = { error: null };
    const terminal = {
      single: async () => ({ data: opts.single, ...result }),
      maybeSingle: async () => ({ data: opts.single, ...result }),
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: opts.array, ...result }),
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
          return makeChain({
            single: sessionItemRow,
            array: [sessionItemRow],
          });
        }
        return makeChain({ single: null, array: [] });
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

describe("Practice /state — refresh regression guard", () => {
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

  it("returns 200 when client_instance_id matches the bound one", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/state?client_instance_id=${BOUND_INSTANCE}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(TEST_SESSION_ID);
    expect(res.body.state).toBeDefined();
  });

  it("returns 200 (NOT 409) when client_instance_id differs — refresh scenario", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/state?client_instance_id=${NEW_INSTANCE}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(TEST_SESSION_ID);
    expect(res.body.state).toBeDefined();
  });

  it("returns 200 when no client_instance_id is provided", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/state`,
    );

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(TEST_SESSION_ID);
  });

  it("includes section in the response", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/state?client_instance_id=${BOUND_INSTANCE}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.section).toBe("math");
  });

  it("includes readOnly flag in the response", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/state?client_instance_id=${BOUND_INSTANCE}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.readOnly).toBe(false);
  });
});
