// @vitest-environment jsdom
/**
 * @spec [closure plan W2-10; CC Brief "PR B: Standalone LISA Chat UI" §3
 *        (client_turn_id idempotency)] | @implemented 2026-09-25
 *
 * plain English: the student's message is on screen the moment it is sent —
 * before LISA answers — and it stays there, exactly once, through success,
 * failure and retry.
 *
 * WHY THIS TEST EXISTS. The thread renders from the conversation query, and
 * `useSendMessage` refetches it only in onSuccess. So the student's text did
 * not appear until LISA's reply did, and on a FAILED turn it never appeared
 * at all — only the FailedTurn notice, with the text the student typed gone.
 *
 * Nothing is mocked between the hooks and the route: the REAL tutor-client
 * hooks call `apiRequest`, routed through supertest into the REAL tutor router
 * over the in-memory DB. Only the worker call is replaced — by a promise the
 * test holds open, which is what lets it look at the screen while the turn is
 * genuinely in flight.
 */
import React from "react";
import express from "express";
import request from "supertest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../../../tests/helpers/fake-tutor-db";

Element.prototype.scrollIntoView = vi.fn();

// ── Server side: the route is real; its collaborators are stubbed ─────────

const db = { current: new FakeTutorDb() };

vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));

const orchestrateTurn = vi.fn();
vi.mock("../../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
vi.mock("../../../server/services/tutor-context", () => ({
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
vi.mock("../../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));
vi.mock("../../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(async () => ({
    crisis: false,
    forceReview: false,
  })),
  getCrisisResponse: vi.fn(),
  flagConversationForReview: vi.fn(),
  notifyCrisisEvent: vi.fn(),
  evaluateNotificationPolicy: vi.fn(),
}));
vi.mock("../../../server/services/tutor-policy-logger", () => ({
  logContextResolution: vi.fn(async () => undefined),
  logTurnMetrics: vi.fn(async () => undefined),
}));
vi.mock("../../../server/services/tutor-runtime-writer", () => ({
  persistInstructionAssignment: vi.fn(async () => ({
    ok: true,
    assignmentId: "assignment-1",
  })),
}));
vi.mock("../../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));

const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

import tutorRuntimeRouter from "../../../server/routes/tutor-runtime";

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

// ── Client transport: apiRequest → supertest → the real router ─────────────

type Call = { method: string; path: string; body: unknown; status: number };
const calls: Call[] = [];

vi.mock("@/lib/queryClient", async () => {
  const { parseApiErrorFromResponse } = await import("@/lib/api-error");
  return {
    apiRequest: async (
      url: string,
      options?: { method?: string; body?: string },
    ): Promise<Response> => {
      const method = (options?.method ?? "GET").toUpperCase();
      const agent = request(makeApp());
      const body: unknown = options?.body ? JSON.parse(options.body) : {};
      const res =
        method === "POST"
          ? await agent
              .post(url)
              .set("Content-Type", "application/json")
              .send(options?.body ?? "{}")
          : await agent.get(url);
      calls.push({ method, path: url, body, status: res.status });
      const response = new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw await parseApiErrorFromResponse(response, "Request failed");
      }
      return response;
    },
  };
});

let mockSearch = "";
vi.mock("wouter", () => ({
  useLocation: () => ["/chat", vi.fn()],
  useSearch: () => mockSearch,
}));
vi.mock("@/components/billing/PremiumUpgradePrompt", () => ({
  PremiumUpgradePrompt: () => null,
}));

// ── Fixtures ────────────────────────────────────────────────────────────

const STUDENT_TEXT = "how do I factor x^2 + 5x + 6";
const TUTOR_TEXT = "Look for two numbers that multiply to 6 and add to 5.";

function seedEmptyConversation(): string {
  const conv = db.current.seed("tutor_conversations", {
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
    updated_at: "2026-09-25T00:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
  });
  return conv.id as string;
}

function workerReply(): unknown {
  return {
    ok: true,
    value: {
      response: {
        content: TUTOR_TEXT,
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

async function renderChat(convId: string): Promise<void> {
  mockSearch = `?conversationId=${convId}`;
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const { default: ChatPage } = await import("./chat");
  render(
    <QueryClientProvider client={qc}>
      <ChatPage />
    </QueryClientProvider>,
  );
  // The empty conversation has loaded (its GET has returned).
  await screen.findByRole("button", { name: /^math$/i });
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: text },
  });
  fireEvent.submit(
    screen.getByRole("form", { name: /send a message to lisa/i }),
  );
}

function studentBubbles(): HTMLElement[] {
  return screen.queryAllByTestId("student-bubble");
}

function studentRows(convId: string): Array<Record<string, unknown>> {
  return db.current
    .rows("tutor_messages")
    .filter((r) => r.conversation_id === convId && r.role === "student");
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  calls.length = 0;
  orchestrateTurn.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("W2-10 — the student's message renders on send", () => {
  it("appears BEFORE the response arrives, with the thinking indicator below it; on success it reconciles to the persisted row — still one bubble", async () => {
    let finishTurn: (v: unknown) => void = () => undefined;
    orchestrateTurn.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishTurn = resolve;
        }),
    );
    const convId = seedEmptyConversation();
    await renderChat(convId);

    send(STUDENT_TEXT);

    // The request is genuinely in flight: the route has reached the worker
    // call and is blocked on it.
    await waitFor(() => expect(orchestrateTurn).toHaveBeenCalledTimes(1));
    const inFlight = calls.filter(
      (c) => c.method === "POST" && c.path === "/api/tutor/messages",
    );
    expect(inFlight).toHaveLength(0); // no response yet

    // ...and the student's words are already on screen.
    const [bubble] = studentBubbles();
    expect(studentBubbles()).toHaveLength(1);
    expect(within(bubble).getByText(STUDENT_TEXT)).toBeTruthy();
    expect(bubble.getAttribute("data-pending")).toBe("true");

    // The thinking indicator is below the visible student message.
    const thinking = screen.getByRole("status", { name: /lisa is thinking/i });
    expect(
      bubble.compareDocumentPosition(thinking) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    finishTurn(workerReply());

    await screen.findByText(TUTOR_TEXT);
    await waitFor(() => {
      // The persisted row has replaced the optimistic one — not joined it.
      const bubbles = studentBubbles();
      expect(bubbles).toHaveLength(1);
      expect(bubbles[0].getAttribute("data-pending")).toBeNull();
    });
    const rows = studentRows(convId);
    expect(rows).toHaveLength(1);
    expect(studentBubbles()[0].getAttribute("data-client-turn-id")).toBe(
      rows[0].client_turn_id,
    );
    expect(screen.queryByRole("status", { name: /lisa is thinking/i })).toBe(
      null,
    );
  });

  it("a failed turn keeps the message on screen as FailedTurn, and a retry does NOT produce a second bubble", async () => {
    orchestrateTurn
      .mockResolvedValueOnce({
        ok: false,
        errorCode: "orchestration_failed_recoverable",
      })
      .mockResolvedValueOnce(workerReply());
    const convId = seedEmptyConversation();
    await renderChat(convId);

    send(STUDENT_TEXT);

    // Failed: the text is still there, exactly once, with Try again below it.
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(studentBubbles()).toHaveLength(1);
    const failedBubble = studentBubbles()[0];
    expect(within(failedBubble).getByText(STUDENT_TEXT)).toBeTruthy();
    expect(
      failedBubble.compareDocumentPosition(retry) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(retry);

    await screen.findByText(TUTOR_TEXT);
    await waitFor(() => {
      const bubbles = studentBubbles();
      expect(bubbles).toHaveLength(1);
      expect(bubbles[0].getAttribute("data-pending")).toBeNull();
    });

    // Both sends carried the same client_turn_id, and the server holds one
    // student row for it — the retry resumed the failed row, it did not add one.
    const posts = calls.filter(
      (c) => c.method === "POST" && c.path === "/api/tutor/messages",
    );
    expect(posts.map((p) => p.status)).toEqual([expect.any(Number), 200]);
    expect(posts[0].status).toBeGreaterThanOrEqual(500);
    const ids = posts.map(
      (p) => (p.body as { client_turn_id: string }).client_turn_id,
    );
    expect(new Set(ids).size).toBe(1);
    const rows = studentRows(convId);
    expect(rows).toHaveLength(1);
    expect(rows[0].client_turn_id).toBe(ids[0]);
    expect(studentBubbles()[0].getAttribute("data-client-turn-id")).toBe(
      ids[0],
    );
  });
});
