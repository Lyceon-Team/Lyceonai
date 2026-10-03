/**
 * @spec [Brief 13 Step 0b rulings 2-3, 6 (owner, Karl, 2026-10-02); DESIGN.md §4 "Question
 *        runner"; INV-03-04; Doc 02B §20] | @implemented [2026-10-02]
 *
 * plain English: the REAL tutor router and envelope builder run over the in-memory DB; only the
 * worker call is replaced. A review item's four choices were shown in the order A, C, B, D. LISA
 * must receive them in that order lettered A-D, so canonical C (correct, shown second) is "B";
 * the student's answer (canonical B, shown third) is "C"; and after submit the correct answer on
 * the wire is "B". Before submit, the BFF leak scan must catch "B" and "the second choice",
 * because those are what the student sees.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";

const db = { current: new FakeTutorDb() };

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));
const orchestrateTurn = vi.fn();
vi.mock("../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(async () => ({
    crisis: false,
    forceReview: false,
  })),
  getCrisisResponse: vi.fn(),
  flagConversationForReview: vi.fn(),
  notifyCrisisEvent: vi.fn(),
  evaluateNotificationPolicy: vi.fn(),
}));
vi.mock("../../server/services/tutor-policy-logger", () => ({
  logContextResolution: vi.fn(async () => undefined),
  logTurnMetrics: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/tutor-runtime-writer", () => ({
  persistInstructionAssignment: vi.fn(async () => ({
    ok: true,
    assignmentId: "assignment-1",
  })),
}));
vi.mock("../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));

import tutorRuntimeRouter from "../../server/routes/tutor-runtime";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const QUESTION_ID = "SATM1ABC123";

/**
 * Canonical C ("12") is the correct answer; the student was shown it SECOND, so on screen and to
 * LISA it is "B". Canonical B ("9") was shown third ("C") and is what the student picked.
 */
const CANONICAL_OPTIONS = [
  { key: "A", text: "6" },
  { key: "B", text: "9" },
  { key: "C", text: "12" },
  { key: "D", text: "15" },
];
const OPTION_ORDER = ["A", "C", "B", "D"];
const TOKEN_MAP = {
  opt_a1: "A",
  opt_c3: "C",
  opt_b2: "B",
  opt_d4: "D",
};

function seedReviewItem(): string {
  const session = db.current.seed("review_sessions", {
    student_id: STUDENT_ID,
  });
  const item = db.current.seed("review_session_items", {
    session_id: session.id,
    student_id: STUDENT_ID,
    question_id: QUESTION_ID,
    status: "served",
    ordinal: 1,
    question_stem: "If 2x = 24, what is x?",
    question_passage: null,
    question_options: CANONICAL_OPTIONS,
    question_item_type: "mcq",
    question_explanation: "Divide both sides by 2.",
    question_correct_answer: "C",
    option_order: OPTION_ORDER,
    option_token_map: TOKEN_MAP,
    selected_answer: null,
  });
  return item.id as string;
}

function answer(itemId: string, token: string): void {
  const item = db.current
    .rows("review_session_items")
    .find((r) => r.id === itemId);
  if (!item) throw new Error("seeded item missing");
  item.status = "answered";
  // Review stores the served token today (register §8 F-49).
  item.selected_answer = token;
}

function workerReply(content: string): unknown {
  return {
    ok: true,
    value: {
      response: {
        content,
        content_kind: "message",
        suggested_action: { type: "none", label: null },
        ui_hints: {
          show_accept_decline: false,
          allow_freeform_reply: true,
          suggested_chip: null,
        },
      },
      question_links: [],
      instruction_exposures: [],
      orchestration_meta: {
        model_name: "test-model",
        prompt_version: "v1",
        cache_used: false,
        compaction_recommended: false,
      },
      learner_observation: null,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
  db.current = new FakeTutorDb();
  orchestrateTurn.mockReset();
  orchestrateTurn.mockResolvedValue({
    ok: false,
    errorCode: "orchestration_failed_recoverable",
  });
  db.current.seed("questions", {
    id: QUESTION_ID,
    correct_answer: "C",
    section: "M",
    domain: "Algebra",
    skill_codes: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT_ID,
      role: "student",
    };
    next();
  });
  app.use("/api/tutor", tutorRuntimeRouter);
  return app;
}

async function openConversation(itemId: string): Promise<string> {
  const res = await request(makeApp()).post("/api/tutor/conversations").send({
    entry_mode: "scoped_question",
    source_surface: "review",
    source_session_item_id: itemId,
    idempotency_key: crypto.randomUUID(),
  });
  expect(res.status).toBeLessThan(300);
  return res.body.data.conversation_id as string;
}

type WireEnvelope = {
  is_post_submit: boolean;
  correct_answer: string | null;
  question_content: {
    options: Array<{ key: string; text: string }>;
    student_answer: string | null;
  } | null;
};

async function send(
  convId: string,
  message = "can you help me start?",
): Promise<{ env: WireEnvelope; res: request.Response }> {
  orchestrateTurn.mockClear();
  const res = await request(makeApp()).post("/api/tutor/messages").send({
    conversation_id: convId,
    message,
    client_turn_id: crypto.randomUUID(),
  });
  expect(orchestrateTurn).toHaveBeenCalledTimes(1);
  return { env: orchestrateTurn.mock.calls[0][0] as WireEnvelope, res };
}

describe("LISA sees display letters (Brief 13 Step 0b, owner ruling 2026-10-02)", () => {
  it("before submit: the choices arrive in on-screen order, lettered A-D, and canonical C (shown second) is B", async () => {
    const convId = await openConversation(seedReviewItem());
    const { env } = await send(convId);
    expect(env.is_post_submit).toBe(false);
    expect(env.question_content?.options).toEqual([
      { key: "A", text: "6" },
      { key: "B", text: "12" },
      { key: "C", text: "9" },
      { key: "D", text: "15" },
    ]);
    expect(env.correct_answer).toBeNull();
    expect(env.question_content?.student_answer).toBeNull();
  });

  it("after submit: the student's answer and the correct answer are display letters", async () => {
    const itemId = seedReviewItem();
    const convId = await openConversation(itemId);
    answer(itemId, "opt_b2"); // canonical B, shown third
    const { env } = await send(convId);
    expect(env.is_post_submit).toBe(true);
    expect(env.question_content?.student_answer).toBe("C");
    expect(env.correct_answer).toBe("B");
    // No canonical key or served token reaches the wire.
    expect(JSON.stringify(env)).not.toContain("opt_");
  });

  it("before submit: a reply naming the display letter is caught by the leak scan", async () => {
    const convId = await openConversation(seedReviewItem());
    orchestrateTurn.mockResolvedValueOnce(workerReply("The answer is B."));
    const { res } = await send(convId);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("The answer is B.");
  });

  it("before submit: a reply naming the position is caught by the leak scan", async () => {
    const convId = await openConversation(seedReviewItem());
    orchestrateTurn.mockResolvedValueOnce(
      workerReply("Honestly, it's the second choice."),
    );
    const { res } = await send(convId);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("the second choice");
  });

  it("before submit: naming a wrong option passes through (presence: the scan is answer-aware)", async () => {
    const convId = await openConversation(seedReviewItem());
    orchestrateTurn.mockResolvedValueOnce(
      workerReply("Let's check whether it's the first choice."),
    );
    const { res } = await send(convId);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("the first choice");
  });
  it("before submit: a malformed stored order fails closed: no lettered choices on the wire, and the reply is blocked", async () => {
    const itemId = seedReviewItem();
    const item = db.current
      .rows("review_session_items")
      .find((r) => r.id === itemId);
    if (!item) throw new Error("seeded item missing");
    item.option_order = ["A", "C", "B"]; // not a permutation of the four keys
    const convId = await openConversation(itemId);
    orchestrateTurn.mockResolvedValueOnce(
      workerReply("Let's think about what x has to be."),
    );
    const { env, res } = await send(convId);
    expect(res.status).toBe(200);
    // Presence first: the reply would have been harmless, so its absence is the gate's doing.
    expect(env.is_post_submit).toBe(false);
    expect(env.question_content).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(
      "Let's think about what x has to be.",
    );
  });
});
