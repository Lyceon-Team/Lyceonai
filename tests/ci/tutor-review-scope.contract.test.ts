/**
 * @spec [Doc-02B_V4 §21 (Surface-Aware Behavior, Question Awareness),
 *        CR-02B-29; closure plan W4-1 (LISA in review — launch scope,
 *        owner ruling 2026-09-25); W3-8 gate; W3-10 / SCL-144]
 * @implemented 2026-09-25
 *
 * plain English: LISA scoped to a review item receives the question behind
 * it — and before the student answers, nothing that gives it away.
 *
 *   before submit: stem, passage, options.  correct_answer null, explanation null.
 *   after submit:  the same, plus correct_answer and explanation.
 *
 * Review items live in review tables, not practice ones; scope resolution,
 * ownership and question content used to read practice tables only, so a
 * review item id was silently dropped. The REAL tutor router and the REAL
 * envelope builder run here over the in-memory DB; only the worker call is
 * replaced, and the envelope handed to it is exactly what would go on the
 * wire.
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
import {
  resolveQuestionContent,
  resolveScope,
} from "../../server/services/tutor-context";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_STUDENT = "66666666-6666-4666-8666-666666666666";
const QUESTION_ID = "SATM1ABC123";
const OTHER_QUESTION_ID = "SATM1ZZZ999";
const EXPLANATION = "zqx-review-explanation: isolate x first.";

let reviewSessionId = "";

function seedReview(status = "served", owner = STUDENT_ID): string {
  const session = db.current.seed("review_sessions", { student_id: owner });
  reviewSessionId = session.id as string;
  const item = db.current.seed("review_session_items", {
    session_id: session.id,
    student_id: owner,
    question_id: QUESTION_ID,
    status,
    ordinal: 1,
    question_stem: "If 3x - 4 = 11, what is x?",
    question_passage: null,
    question_options: [
      { key: "A", text: "3" },
      { key: "B", text: "5" },
    ],
    question_item_type: "mcq",
    question_explanation: EXPLANATION,
    question_correct_answer: "B",
    selected_answer: status === "answered" ? "A" : null,
  });
  return item.id as string;
}

beforeEach(() => {
  // The in-memory DB's clock starts 2026-09-23; pin "now" beside it so the
  // 7-day conversation-reuse window is not a function of the calendar.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
  db.current = new FakeTutorDb();
  orchestrateTurn.mockReset();
  orchestrateTurn.mockResolvedValue({
    ok: false,
    errorCode: "orchestration_failed_recoverable",
  });
  for (const [id, answer] of [
    [QUESTION_ID, "B"],
    [OTHER_QUESTION_ID, "D"],
  ]) {
    db.current.seed("questions", {
      id,
      correct_answer: answer,
      section: "M",
      domain: "Algebra",
      skill_codes: [],
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Scope resolution and question content ────────────────────────────────

describe("review scope resolves from review tables", () => {
  it("an owned review item resolves its session and question", async () => {
    const itemId = seedReview();
    const scope = await resolveScope(STUDENT_ID, null, itemId, null, "review");
    expect(scope).toEqual({
      source_session_id: reviewSessionId,
      source_session_item_id: itemId,
      source_question_row_id: QUESTION_ID,
      source_question_canonical_id: QUESTION_ID,
    });
  });

  it("another student's review item is dropped", async () => {
    const itemId = seedReview("served", OTHER_STUDENT);
    const scope = await resolveScope(STUDENT_ID, null, itemId, null, "review");
    expect(scope.source_session_item_id).toBeNull();
    expect(scope.source_question_row_id).toBeNull();
  });

  it("the tables do not cross: a review item is not a practice item, and vice versa", async () => {
    const reviewItem = seedReview();
    const asPractice = await resolveScope(
      STUDENT_ID,
      null,
      reviewItem,
      null,
      "practice",
    );
    expect(asPractice.source_session_item_id).toBeNull();

    const practiceItem = db.current.seed("practice_session_items", {
      user_id: STUDENT_ID,
      session_id: "p-session",
      question_id: QUESTION_ID,
      status: "served",
    }).id as string;
    const asReview = await resolveScope(
      STUDENT_ID,
      null,
      practiceItem,
      null,
      "review",
    );
    expect(asReview.source_session_item_id).toBeNull();
  });

  it("question content comes from the review snapshot; explanation only after submit", async () => {
    const itemId = seedReview();
    const scope = await resolveScope(STUDENT_ID, null, itemId, null, "review");
    const pre = await resolveQuestionContent(
      STUDENT_ID,
      scope,
      false,
      "review",
    );
    expect(pre?.stem).toBe("If 3x - 4 = 11, what is x?");
    expect(pre?.options).toHaveLength(2);
    expect(pre?.explanation).toBeNull();
    const post = await resolveQuestionContent(
      STUDENT_ID,
      scope,
      true,
      "review",
    );
    expect(post?.explanation).toBe(EXPLANATION);
  });
});

// ── The route: create, reuse, and the wire ─────────────────────────────────

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

async function createReviewConversation(
  itemId: string,
  extra: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(makeApp())
    .post("/api/tutor/conversations")
    .send({
      entry_mode: "scoped_question",
      source_surface: "review",
      source_session_item_id: itemId,
      idempotency_key: crypto.randomUUID(),
      ...extra,
    });
}

type WireEnvelope = {
  source_surface: string;
  is_post_submit: boolean;
  correct_answer: string | null;
  question_content: {
    stem: string;
    options: unknown[];
    explanation: string | null;
  } | null;
};

async function turnEnvelope(convId: string): Promise<WireEnvelope> {
  orchestrateTurn.mockClear();
  await request(makeApp()).post("/api/tutor/messages").send({
    conversation_id: convId,
    message: "why is this one tricky?",
    client_turn_id: crypto.randomUUID(),
  });
  expect(orchestrateTurn).toHaveBeenCalledTimes(1);
  return orchestrateTurn.mock.calls[0][0] as WireEnvelope;
}

describe("POST /conversations and /messages on a review item", () => {
  it("creates a review conversation scoped to the item; a client-supplied different question id is overridden by the item's own", async () => {
    const itemId = seedReview();
    const res = await createReviewConversation(itemId, {
      source_question_row_id: OTHER_QUESTION_ID,
    });
    expect(res.status).toBeLessThan(300);
    const conv = db.current
      .rows("tutor_conversations")
      .find((r) => r.id === res.body.data.conversation_id);
    expect(conv?.source_surface).toBe("review");
    expect(conv?.source_session_item_id).toBe(itemId);
    expect(conv?.source_session_id).toBe(reviewSessionId);
    // Not OTHER_QUESTION_ID: pairing an answered item with another question
    // would put THAT question's answer on the wire post-submit.
    expect(conv?.source_question_row_id).toBe(QUESTION_ID);
  });

  it("one conversation per review item: a second open for the same item reuses it", async () => {
    const itemId = seedReview();
    const a = await createReviewConversation(itemId);
    const b = await createReviewConversation(itemId);
    expect(b.body.data.conversation_id).toBe(a.body.data.conversation_id);
  });

  it("BEFORE the student answers: the wire carries the question, and neither the answer nor the explanation", async () => {
    const itemId = seedReview("served");
    const created = await createReviewConversation(itemId);
    const env = await turnEnvelope(created.body.data.conversation_id);
    expect(env.source_surface).toBe("review");
    expect(env.is_post_submit).toBe(false);
    expect(env.question_content?.stem).toBe("If 3x - 4 = 11, what is x?");
    expect(env.question_content?.options).toHaveLength(2);
    expect(env.correct_answer).toBeNull();
    expect(env.question_content?.explanation).toBeNull();
    expect(JSON.stringify(env)).not.toContain("zqx-review-explanation");
  });

  it("AFTER the student answers: the answer and explanation are delivered — review discussion is allowed", async () => {
    const itemId = seedReview("served");
    const created = await createReviewConversation(itemId);
    // The student submits the review item.
    const item = db.current
      .rows("review_session_items")
      .find((r) => r.id === itemId);
    if (item) {
      item.status = "answered";
      item.selected_answer = "A";
    }
    const env = await turnEnvelope(created.body.data.conversation_id);
    expect(env.is_post_submit).toBe(true);
    expect(env.correct_answer).toBe("B");
    expect(env.question_content?.explanation).toBe(EXPLANATION);
  });
});
