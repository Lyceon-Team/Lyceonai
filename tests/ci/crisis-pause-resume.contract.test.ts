/**
 * @spec [CC Brief "LISA Session Lifecycle" §5.4; Doc-03_V3 §21.2; CR-03C-V3-01 §3.4]
 * @implemented 2026-09-24
 *
 * plain English: drives the REAL tutor router (supertest over
 * tests/helpers/fake-tutor-db.ts) through a crisis turn and a resume, and
 * pins the lifecycle of the two conversation fields involved:
 *
 *   crisis turn       → crisis_flagged = true, crisis_paused_at = set,
 *                       response says crisis_paused: true with the SAME time
 *   GET detail        → crisis_paused_at is the stored value
 *   POST /resume      → 200, crisis_paused_at = null, crisis_flagged stays true
 *   POST /resume again→ 409 conversation_not_paused
 *   degraded Layer 2  → flagged for review, NOT paused, normal reply
 *
 * The last case is why the pause is not written inside
 * `flag_conversation_for_crisis_review`: that RPC also serves the degraded
 * path, where the student keeps tutoring. "Flagged" and "paused" are
 * different facts, and a resumed crisis conversation is flagged-not-paused by
 * design.
 *
 * `flagConversationForReview` is stubbed to do what the RPC does to
 * tutor_conversations (set crisis_flagged) — the RPC itself is covered by
 * tests/ci/crisis-flag-atomic.pg.ci.test.ts against real Postgres.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    isLiveExamInProgress: vi.fn(async () => false),
  },
}));

const orchestrateTurn = vi.fn();
vi.mock("../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
vi.mock("../../server/services/tutor-context", () => ({
  resolveFullEnvelope: vi.fn(async () => ({
    recent_messages: [],
    memory_summaries: [],
    student_learning_context: { mastery_snapshot: null },
    resolved_scope: {
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    },
  })),
}));
vi.mock("../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));

const runCrisisClassifier = vi.fn();
const flagConversationForReview = vi.fn();
vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: (...args: unknown[]) => runCrisisClassifier(...args),
  getCrisisResponse: vi.fn(() => "crisis resources"),
  flagConversationForReview: (...args: unknown[]) =>
    flagConversationForReview(...args),
  notifyCrisisEvent: vi.fn(async () => undefined),
  evaluateNotificationPolicy: vi.fn(() => ({
    shouldNotify: false,
    suppressionReason: "test",
  })),
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
const CASE_ID = "66666666-6666-4666-8666-666666666666";

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

function seedConversation(): string {
  const row = db.current.seed("tutor_conversations", {
    student_id: STUDENT_ID,
    entry_mode: "general",
    source_surface: "dashboard",
    surface: "standalone",
    source_session_id: null,
    source_session_item_id: null,
    source_question_row_id: null,
    source_question_canonical_id: null,
    status: "active",
    crisis_flagged: false,
    deleted_at: null,
    updated_at: "2026-09-24T00:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
  });
  return row.id as string;
}

function conversationRow(id: string): Record<string, unknown> | undefined {
  return db.current.rows("tutor_conversations").find((r) => r.id === id);
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  orchestrateTurn.mockReset();
  runCrisisClassifier.mockReset();
  flagConversationForReview.mockReset();
  // What the RPC does to tutor_conversations: set crisis_flagged. Nothing else.
  flagConversationForReview.mockImplementation(
    async (conversationId: string) => {
      const row = conversationRow(conversationId);
      if (row) row.crisis_flagged = true;
      return {
        caseId: CASE_ID,
        isNewCase: true,
        caseStatus: "open",
        slaDeadline: "2026-09-26T00:00:00.000Z",
      };
    },
  );
});

describe("crisis turn pauses; /resume unpauses", () => {
  it("a crisis turn leaves crisis_paused_at set, and /resume returns 200 and clears it", async () => {
    const app = makeApp();
    const convId = seedConversation();
    runCrisisClassifier.mockResolvedValue({
      crisis: true,
      source: "layer1_signature",
      category: "crisis",
      signatureId: null,
      modelConfidence: null,
      forceReview: true,
    });

    const send = await request(app).post("/api/tutor/messages").send({
      conversation_id: convId,
      message: "a hard day",
      client_turn_id: "77777777-7777-4777-8777-777777777777",
    });
    expect(send.status).toBe(200);
    expect(send.body.data.crisis_paused).toBe(true);
    expect(orchestrateTurn).not.toHaveBeenCalled();

    const afterTurn = conversationRow(convId);
    expect(afterTurn?.crisis_flagged).toBe(true);
    expect(afterTurn?.crisis_paused_at).toEqual(expect.any(String));
    // The response's pause time is the one the row holds — not a second clock.
    expect(send.body.data.crisis_paused_at).toBe(afterTurn?.crisis_paused_at);

    const detail = await request(app).get(`/api/tutor/conversations/${convId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.conversation.crisis_paused_at).toBe(
      afterTurn?.crisis_paused_at,
    );

    const resume = await request(app)
      .post(`/api/tutor/conversations/${convId}/resume`)
      .send({});
    expect(resume.status).toBe(200);
    expect(resume.body.data.crisis_paused_at).toBeNull();

    const afterResume = conversationRow(convId);
    expect(afterResume?.crisis_paused_at).toBeNull();
    // Resuming does not un-flag: the review case stands.
    expect(afterResume?.crisis_flagged).toBe(true);

    const again = await request(app)
      .post(`/api/tutor/conversations/${convId}/resume`)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("conversation_not_paused");
  });

  it("the degraded-classifier path flags for review but does NOT pause", async () => {
    const app = makeApp();
    const convId = seedConversation();
    runCrisisClassifier.mockResolvedValue({ crisis: false, forceReview: true });
    orchestrateTurn.mockResolvedValue({
      ok: true,
      value: {
        response: {
          content: "Let's look at it.",
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
          cache_used: false,
          compaction_recommended: false,
        },
      },
    });

    const send = await request(app).post("/api/tutor/messages").send({
      conversation_id: convId,
      message: "how do I factor this",
      client_turn_id: "88888888-8888-4888-8888-888888888888",
    });
    expect(send.status).toBe(200);
    expect(send.body.data.crisis_paused).toBeFalsy();
    expect(flagConversationForReview).toHaveBeenCalledWith(
      convId,
      STUDENT_ID,
      "classifier_degraded",
      null,
      null,
    );

    const row = conversationRow(convId);
    expect(row?.crisis_flagged).toBe(true);
    expect(row?.crisis_paused_at).toBeNull();
  });
});
