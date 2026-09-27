/**
 * @spec [INV-03-06; Doc-02B_V4 §20, §21 Question Awareness, CR-02B-29;
 *        closure plan W3-8 + the W4-1 review gate; owner ruling 2026-09-25]
 * @implemented 2026-09-25
 *
 * plain English: the pre-submit gate decides whether `correct_answer` may go
 * on the wire. It must answer from the item's own row.
 *
 *   review    — was hard-coded post-submit. Review is a graded re-attempt: the
 *               item is served UNANSWERED. Wiring LISA into review behind the
 *               old gate would have sent the answer before the student
 *               answered. Now reads review_session_items.status.
 *   dashboard — was hard-coded post-submit. A general conversation attaching a
 *               question id put `correct_answer` on the wire (W3-8). Now
 *               pre-submit: there is no submission record to say otherwise.
 *   practice  — unchanged behaviour, same helper as review.
 *
 * The route-level tests drive the REAL tutor router and assert what it hands
 * the envelope builder: `isPostSubmit`, which is the only thing between the
 * BFF-local correct answer and the wire (`tutor-context.ts`
 * `correct_answer: params.isPostSubmit ? params.correctAnswer : null`).
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
  },
}));
const orchestrateTurn = vi.fn();
vi.mock("../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
const resolveFullEnvelope = vi.fn();
vi.mock("../../server/services/tutor-context", () => ({
  resolveFullEnvelope: (...args: unknown[]) => resolveFullEnvelope(...args),
}));
vi.mock("../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
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

import { isPreSubmitForSurface } from "../../server/services/tutor-antileak";
import tutorRuntimeRouter from "../../server/routes/tutor-runtime";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const QUESTION_ID = "q-canonical-0001";

beforeEach(() => {
  db.current = new FakeTutorDb();
  orchestrateTurn.mockReset();
  resolveFullEnvelope.mockReset();
  resolveFullEnvelope.mockImplementation(async () => ({
    recent_messages: [],
    memory_summaries: [],
    student_learning_context: { mastery_snapshot: null },
    resolved_scope: {
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    },
  }));
  orchestrateTurn.mockResolvedValue({
    ok: false,
    errorCode: "orchestration_failed_recoverable",
  });
});

function seedItem(
  table: "practice_session_items" | "review_session_items",
  status: string,
): string {
  const row = db.current.seed(table, {
    status,
    question_id: QUESTION_ID,
    ...(table === "review_session_items"
      ? { student_id: STUDENT_ID }
      : { user_id: STUDENT_ID }),
  });
  return row.id as string;
}

// ── Unit: the gate itself ──────────────────────────────────────────────────

describe("isPreSubmitForSurface", () => {
  it.each([
    ["pending", true],
    ["served", true],
    ["answered", false],
    ["skipped", false],
  ] as const)(
    "review item with status %s → preSubmit=%s (reads review_session_items)",
    async (status, expected) => {
      const id = seedItem("review_session_items", status);
      await expect(isPreSubmitForSurface("review", id, null)).resolves.toBe(
        expected,
      );
    },
  );

  it.each([
    ["served", true],
    ["answered", false],
  ] as const)(
    "practice item with status %s → preSubmit=%s (unchanged)",
    async (status, expected) => {
      const id = seedItem("practice_session_items", status);
      await expect(isPreSubmitForSurface("practice", id, null)).resolves.toBe(
        expected,
      );
    },
  );

  it("review is NOT answered from the practice table (a practice row with the same id does not count)", async () => {
    const practiceId = seedItem("practice_session_items", "answered");
    await expect(
      isPreSubmitForSurface("review", practiceId, null),
    ).resolves.toBe(true);
  });

  it.each(["review", "practice"])(
    "%s with no item id, or an id with no row, fails closed",
    async (surface) => {
      await expect(isPreSubmitForSurface(surface, null, null)).resolves.toBe(
        true,
      );
      await expect(
        isPreSubmitForSurface(
          surface,
          "00000000-0000-4000-8000-000000000000",
          null,
        ),
      ).resolves.toBe(true);
    },
  );

  it("review with an unreadable status fails closed", async () => {
    const id = seedItem("review_session_items", "answered");
    db.current.failNext("review_session_items", "select", {
      message: "boom",
      code: "XX000",
    });
    await expect(isPreSubmitForSurface("review", id, null)).resolves.toBe(true);
  });

  it("dashboard is pre-submit (W3-8): no item, so no submission record", async () => {
    await expect(isPreSubmitForSurface("dashboard", null, null)).resolves.toBe(
      true,
    );
  });

  it("test_review stays post-submit; an unknown surface fails closed", async () => {
    await expect(
      isPreSubmitForSurface("test_review", null, null),
    ).resolves.toBe(false);
    await expect(isPreSubmitForSurface("mystery", null, null)).resolves.toBe(
      true,
    );
  });
});

// ── Route: what reaches the envelope builder ──────────────────────────────

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

function seedConversation(
  surface: "dashboard" | "review",
  sessionItemId: string | null,
): string {
  const row = db.current.seed("tutor_conversations", {
    student_id: STUDENT_ID,
    entry_mode: surface === "dashboard" ? "general" : "scoped_question",
    source_surface: surface,
    surface: surface === "dashboard" ? "standalone" : "review",
    source_session_id: null,
    source_session_item_id: sessionItemId,
    source_question_row_id: QUESTION_ID,
    source_question_canonical_id: null,
    status: "active",
    crisis_flagged: false,
    deleted_at: null,
    updated_at: "2026-09-25T00:00:00.000Z",
    closed_at: null,
    title: "already titled",
    crisis_paused_at: null,
    ended_at: null,
  });
  return row.id as string;
}

async function sendTurn(convId: string): Promise<void> {
  await request(makeApp()).post("/api/tutor/messages").send({
    conversation_id: convId,
    message: "is it B?",
    client_turn_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
}

function envelopeArgs(): { isPostSubmit: boolean; correctAnswer: unknown } {
  expect(resolveFullEnvelope).toHaveBeenCalledTimes(1);
  return resolveFullEnvelope.mock.calls[0][0] as {
    isPostSubmit: boolean;
    correctAnswer: unknown;
  };
}

describe("the route hands the envelope builder the gate's verdict", () => {
  beforeEach(() => {
    db.current.seed("questions", {
      id: QUESTION_ID,
      correct_answer: "B",
      section: "M",
      domain: "Algebra",
      skill_codes: [],
    });
  });

  it("W3-8: a general dashboard conversation with a question attached is PRE-submit — the answer cannot reach the wire", async () => {
    await sendTurn(seedConversation("dashboard", null));
    expect(envelopeArgs().isPostSubmit).toBe(false);
  });

  it("review, item served (student has not answered): PRE-submit", async () => {
    const item = seedItem("review_session_items", "served");
    await sendTurn(seedConversation("review", item));
    expect(envelopeArgs().isPostSubmit).toBe(false);
  });

  it("review, item answered: POST-submit — discussion of the answer is allowed", async () => {
    const item = seedItem("review_session_items", "answered");
    await sendTurn(seedConversation("review", item));
    expect(envelopeArgs().isPostSubmit).toBe(true);
  });
});
