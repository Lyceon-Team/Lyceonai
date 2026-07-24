/**
 * Practice R&W Passage Anti-Leak Gate
 *
 * @spec [Doc-02B_V4 §14/§20; Preamble V3 §12 INV-02B-01] | @implemented [2026-07-22]
 *
 * Proves at the HTTP level that GET /api/practice/sessions/:id/next and
 * POST /api/practice/sessions/:id/resume return passage content for R&W
 * questions while maintaining anti-leak:
 *   - passage is present and non-null for R&W items
 *   - correct_answer:null, explanation:null (anti-leak preserved)
 *   - response body never contains the real answer or explanation text
 *
 * Complements the real-Postgres integration gate (practice-integration.sh P.9)
 * and the pure-function regression guard (practice.rw-row-mapping.ci.test.ts).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express, Request, Response, NextFunction } from "express";

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const TEST_SESSION_ID = "00000000-0000-0000-0000-bbbbbbbbbb01";
const TEST_ITEM_ID = "00000000-0000-0000-0000-cccccccccc01";

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
  }),
};

const rwItemRow = {
  id: TEST_ITEM_ID,
  session_id: TEST_SESSION_ID,
  user_id: TEST_USER_ID,
  ordinal: 1,
  question_id: "SATRW1CAS001",
  question_stem:
    'Based on the passage, the author most likely uses the word "luminous" to mean',
  question_passage:
    "The scholar's luminous analysis of the text stood in stark contrast to the opaque reasoning that had dominated the field for decades. Where others saw ambiguity, she found precision; where others retreated into jargon, she advanced with plain language that illuminated every corner of the debate.",
  question_options: JSON.stringify([
    { key: "A", text: "brightly lit" },
    { key: "B", text: "intellectually brilliant" },
    { key: "C", text: "clearly visible" },
    { key: "D", text: "warmly glowing" },
  ]),
  question_correct_answer: "B",
  question_explanation:
    'In context, "luminous" describes the quality of the argument, not physical light.',
  question_option_metadata: null,
  question_difficulty: 2,
  question_domain: "Craft and Structure",
  question_skill: "CAS.01",
  question_section: "RW",
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
  client_instance_id: "ci-test",
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
            single: rwItemRow,
            array: [rwItemRow],
          });
        }
        return makeChain({ single: null, array: [] });
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

describe("Practice R&W passage anti-leak gate", () => {
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

  it("GET /next returns passage for R&W item (non-null)", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);

    const q = res.body.question;
    expect(q).toBeDefined();
    expect(q.passage).toBeDefined();
    expect(q.passage).not.toBeNull();
    expect(typeof q.passage).toBe("string");
    expect(q.passage.length).toBeGreaterThan(0);
    expect(q.passage).toContain("luminous");
  });

  it("GET /next returns correct_answer:null and explanation:null for R&W item (anti-leak)", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);

    const q = res.body.question;
    expect(q).toBeDefined();
    expect(q.correct_answer).toBeNull();
    expect(q.explanation).toBeNull();
  });

  it("response body never contains the real answer value or explanation text", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(
      "describes the quality of the argument, not physical light",
    );
  });

  it("GET /next returns section=RW for R&W item", async () => {
    const res = await request(app).get(
      `/api/practice/sessions/${TEST_SESSION_ID}/next?client_instance_id=ci-test`,
    );

    expect(res.status).toBe(200);
    expect(res.body.question.section).toBe("RW");
  });

  it("POST /resume returns passage for R&W item (non-null)", async () => {
    const res = await request(app)
      .post(`/api/practice/sessions/${TEST_SESSION_ID}/resume`)
      .send({ client_instance_id: "ci-test" });

    expect(res.status).toBe(200);

    const q = res.body.question;
    expect(q).toBeDefined();
    expect(q.passage).toBeDefined();
    expect(q.passage).not.toBeNull();
    expect(typeof q.passage).toBe("string");
    expect(q.passage.length).toBeGreaterThan(0);
    expect(q.passage).toContain("luminous");
  });

  it("POST /resume returns correct_answer:null and explanation:null (anti-leak)", async () => {
    const res = await request(app)
      .post(`/api/practice/sessions/${TEST_SESSION_ID}/resume`)
      .send({ client_instance_id: "ci-test" });

    expect(res.status).toBe(200);

    const q = res.body.question;
    expect(q).toBeDefined();
    expect(q.correct_answer).toBeNull();
    expect(q.explanation).toBeNull();

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(
      "describes the quality of the argument, not physical light",
    );
  });
});
