/**
 * @spec [Doc-03B_V4.1 §7.5, §14.3, §14.4; CC Brief "Close the LISA Vertical" PR 1.1, 1.2]
 * @implemented 2026-09-23
 *
 * plain English: drives the REAL `server/routes/tutor-runtime.ts` router over HTTP
 * (supertest) with the database replaced by an in-memory stand-in that models the
 * schema's one relevant uniqueness rule. Proves two contract points the client
 * depends on:
 *   1.1 GET /conversations/:id returns crisis_paused_at, title and surface, and the
 *       body parses against the shared `conversationDetailSchema`.
 *   1.2 A turn that failed after the student message was persisted can be retried
 *       with the SAME client_turn_id: the retry re-claims the existing student row
 *       (exactly one student row), orchestrates, and returns 200.
 * Edge cases covered (Doc 03B V4.1 §14.3/§14.4): retry of a message containing
 * `<`/`&` (the stored text is HTML-escaped); a retry while the first attempt is
 * still running (409 idempotency_in_progress); a turn stuck 'pending' past the
 * in-progress timeout (re-owned); an unexpected throw (turn released as 'failed');
 * a duplicate caught only by the unique index (409 idempotency_conflict + error log).
 */
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb, UNIQUE_KEYS } from "../helpers/fake-tutor-db";
import { conversationDetailSchema } from "../../packages/shared/src/tutor-lifecycle-schema";

// ── Mocks: transport and collaborators, never the route under test ─────

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

vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(async () => ({
    crisis: false,
    source: null,
    category: null,
    signatureId: null,
    modelConfidence: null,
    forceReview: false,
  })),
  getCrisisResponse: vi.fn(() => "crisis resources"),
  flagConversationForReview: vi.fn(),
  notifyCrisisEvent: vi.fn(),
  evaluateNotificationPolicy: vi.fn(() => ({
    shouldNotify: false,
    suppressionReason: null,
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
import { resolveFullEnvelope } from "../../server/services/tutor-context";
import { logger } from "../../server/logger";

// ── Fixtures ───────────────────────────────────────────────────────────

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

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

function seedConversation(overrides: Record<string, unknown> = {}): string {
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
    updated_at: "2026-09-23T10:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
    ...overrides,
  });
  return row.id as string;
}

function okOrchestration(content: string): unknown {
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
        cache_used: false,
        compaction_recommended: false,
      },
    },
  };
}

function studentRowsFor(clientTurnId: string): Array<Record<string, unknown>> {
  return db.current
    .rows("tutor_messages")
    .filter((r) => r.client_turn_id === clientTurnId && r.role === "student");
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  orchestrateTurn.mockReset();
});

// ── The modelled uniqueness rule must be the schema's rule ─────────────

describe("fake DB models the real idempotency index", () => {
  it("UNIQUE_KEYS matches idx_tutor_messages_client_turn_idempotency", () => {
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../supabase/migrations/20260812010000_tutor_messages_idempotency_role.sql",
      ),
      "utf-8",
    );
    const index = UNIQUE_KEYS.tutor_messages?.[0];
    expect(index).toBeDefined();
    expect(sql).toContain(
      `CREATE UNIQUE INDEX ${index?.name}\n  ON public.tutor_messages (${index?.columns.join(", ")})\n  WHERE client_turn_id IS NOT NULL`,
    );
  });
});

// ── 1.1 Detail contract ───────────────────────────────────────────────

describe("PR 1.1 — GET /conversations/:id returns the lifecycle fields", () => {
  it("returns crisis_paused_at, title and surface for a paused conversation, and parses against conversationDetailSchema", async () => {
    const pausedAt = "2026-09-23T10:03:00.000Z";
    const id = seedConversation({
      crisis_paused_at: pausedAt,
      title: "I feel terrible",
      surface: "standalone",
      crisis_flagged: true,
    });

    const res = await request(makeApp()).get(`/api/tutor/conversations/${id}`);

    expect(res.status).toBe(200);
    const detail = conversationDetailSchema.parse(res.body.data);
    expect(detail.conversation.crisis_paused_at).toBe(pausedAt);
    expect(detail.conversation.title).toBe("I feel terrible");
    expect(detail.conversation.surface).toBe("standalone");
  });

  it("returns crisis_paused_at: null for an unpaused conversation", async () => {
    const id = seedConversation();
    const res = await request(makeApp()).get(`/api/tutor/conversations/${id}`);
    expect(res.status).toBe(200);
    const detail = conversationDetailSchema.parse(res.body.data);
    expect(detail.conversation.crisis_paused_at).toBeNull();
  });
});

// ── 1.2 Retry after orchestration failure ─────────────────────────────

describe("PR 1.2 — retry with the same client_turn_id resumes the persisted turn", () => {
  const CLIENT_TURN_ID = "22222222-2222-4222-8222-222222222222";

  it("fails orchestration, retries with the same client_turn_id, and succeeds with exactly one student row", async () => {
    const id = seedConversation();
    const app = makeApp();
    const body = {
      conversation_id: id,
      message: "Can you explain slope?",
      client_turn_id: CLIENT_TURN_ID,
    };

    orchestrateTurn.mockResolvedValueOnce({
      ok: false,
      errorCode: "orchestration_failed_recoverable",
    });
    const first = await request(app).post("/api/tutor/messages").send(body);
    expect(first.status).toBe(503);
    expect(studentRowsFor(CLIENT_TURN_ID)).toHaveLength(1);
    expect(studentRowsFor(CLIENT_TURN_ID)[0]?.status).toBe("failed");

    orchestrateTurn.mockResolvedValueOnce(
      okOrchestration("Slope is rise over run."),
    );
    const second = await request(app).post("/api/tutor/messages").send(body);

    expect(second.status).toBe(200);
    expect(second.body.data.response.content).toBe("Slope is rise over run.");
    expect(studentRowsFor(CLIENT_TURN_ID)).toHaveLength(1);
    expect(studentRowsFor(CLIENT_TURN_ID)[0]?.status).toBe("completed");
    const tutorRows = db.current
      .rows("tutor_messages")
      .filter((r) => r.client_turn_id === CLIENT_TURN_ID && r.role === "tutor");
    expect(tutorRows).toHaveLength(1);
    expect(orchestrateTurn).toHaveBeenCalledTimes(2);
  });

  it("retry of a message containing < and & is not a false idempotency_conflict", async () => {
    const id = seedConversation();
    const app = makeApp();
    const body = {
      conversation_id: id,
      message: "If x < 5 & y > 2, what is x + y?",
      client_turn_id: CLIENT_TURN_ID,
    };

    orchestrateTurn.mockResolvedValueOnce({
      ok: false,
      errorCode: "orchestration_failed_recoverable",
    });
    expect(
      (await request(app).post("/api/tutor/messages").send(body)).status,
    ).toBe(503);

    orchestrateTurn.mockResolvedValueOnce(
      okOrchestration("Let's reason about it."),
    );
    const second = await request(app).post("/api/tutor/messages").send(body);
    expect(second.status).toBe(200);
    expect(studentRowsFor(CLIENT_TURN_ID)).toHaveLength(1);
  });

  it("a different message under the same client_turn_id is still a 409 idempotency_conflict", async () => {
    const id = seedConversation();
    const app = makeApp();
    orchestrateTurn.mockResolvedValueOnce({
      ok: false,
      errorCode: "orchestration_failed_recoverable",
    });
    await request(app).post("/api/tutor/messages").send({
      conversation_id: id,
      message: "first text",
      client_turn_id: CLIENT_TURN_ID,
    });

    const conflict = await request(app).post("/api/tutor/messages").send({
      conversation_id: id,
      message: "different text",
      client_turn_id: CLIENT_TURN_ID,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_conflict");
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
  });

  it("a completed turn replays the cached reply without orchestrating again", async () => {
    const id = seedConversation();
    const app = makeApp();
    const body = {
      conversation_id: id,
      message: "hello",
      client_turn_id: CLIENT_TURN_ID,
    };
    orchestrateTurn.mockResolvedValueOnce(okOrchestration("Hi there."));
    const first = await request(app).post("/api/tutor/messages").send(body);
    expect(first.status).toBe(200);

    const replay = await request(app).post("/api/tutor/messages").send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.data.message_id).toBe(first.body.data.message_id);
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
  });

  it("a retry while the first attempt is still running gets 409 idempotency_in_progress and does not orchestrate", async () => {
    const id = seedConversation();
    db.current.seed("tutor_messages", {
      conversation_id: id,
      student_id: STUDENT_ID,
      role: "student",
      content_kind: "message",
      message: "still thinking",
      client_turn_id: CLIENT_TURN_ID,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    const res = await request(makeApp()).post("/api/tutor/messages").send({
      conversation_id: id,
      message: "still thinking",
      client_turn_id: CLIENT_TURN_ID,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("idempotency_in_progress");
    expect(res.body.error.details).toEqual({ retry_after_ms: 2000 });
    expect(orchestrateTurn).not.toHaveBeenCalled();
  });

  it("a turn stuck 'pending' past the in-progress timeout is re-owned and resumed", async () => {
    const id = seedConversation();
    db.current.seed("tutor_messages", {
      conversation_id: id,
      student_id: STUDENT_ID,
      role: "student",
      content_kind: "message",
      message: "crashed turn",
      client_turn_id: CLIENT_TURN_ID,
      status: "pending",
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    orchestrateTurn.mockResolvedValueOnce(okOrchestration("Recovered."));

    const res = await request(makeApp()).post("/api/tutor/messages").send({
      conversation_id: id,
      message: "crashed turn",
      client_turn_id: CLIENT_TURN_ID,
    });

    expect(res.status).toBe(200);
    expect(studentRowsFor(CLIENT_TURN_ID)).toHaveLength(1);
    expect(studentRowsFor(CLIENT_TURN_ID)[0]?.status).toBe("completed");
  });

  it("an unexpected throw after step 11 releases the turn ('failed'), so the next retry resumes", async () => {
    const id = seedConversation();
    const app = makeApp();
    const body = {
      conversation_id: id,
      message: "envelope blows up",
      client_turn_id: CLIENT_TURN_ID,
    };
    vi.mocked(resolveFullEnvelope).mockRejectedValueOnce(
      new Error("envelope validation failed"),
    );

    const first = await request(app).post("/api/tutor/messages").send(body);
    expect(first.status).toBe(500);
    expect(studentRowsFor(CLIENT_TURN_ID)[0]?.status).toBe("failed");

    orchestrateTurn.mockResolvedValueOnce(
      okOrchestration("Second time lucky."),
    );
    const second = await request(app).post("/api/tutor/messages").send(body);
    expect(second.status).toBe(200);
    expect(studentRowsFor(CLIENT_TURN_ID)).toHaveLength(1);
  });

  it("a concurrent duplicate caught by the unique index is 409 idempotency_conflict with a high-severity log (§14.4), never a silent replay", async () => {
    const id = seedConversation();
    const app = makeApp();
    const body = {
      conversation_id: id,
      message: "race me",
      client_turn_id: CLIENT_TURN_ID,
    };

    // While this request is orchestrating, a concurrent one persists the reply.
    orchestrateTurn.mockImplementationOnce(async () => {
      db.current.seed("tutor_messages", {
        conversation_id: id,
        student_id: STUDENT_ID,
        role: "tutor",
        content_kind: "message",
        message: "Winner's reply.",
        client_turn_id: CLIENT_TURN_ID,
      });
      return okOrchestration("Loser's reply.");
    });
    const res = await request(app).post("/api/tutor/messages").send(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("idempotency_conflict");
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "TUTOR_RUNTIME",
      "idempotency_unique_constraint_violation",
      expect.any(String),
      undefined,
      expect.objectContaining({ conversationId: id, role: "tutor" }),
    );
    const tutorRows = db.current
      .rows("tutor_messages")
      .filter((r) => r.client_turn_id === CLIENT_TURN_ID && r.role === "tutor");
    expect(tutorRows).toHaveLength(1);
  });
});
