// @vitest-environment jsdom
/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1
 *        ("time-to-first-visible-text ... No message content in logs")] | @implemented [2026-10-23]
 *
 * plain English: one LISA turn through the real chat page, the real tutor-client hooks, the real
 * request-id middleware, the real tutor router and the real beacon router (harness as in
 * chat.optimistic-send.contract.test.tsx; only the worker call is replaced). The send carries an
 * `X-Request-Id` the server adopts, so the turn's `route_timing` line has that id; once the reply
 * is on screen the client posts one beacon with the same id and two numbers; the server logs one
 * `tutor_turn_visible` line joining the two. Presence first (the line, the id, the reply on
 * screen), then absence: neither the beacon body nor the logged line carries the message or the
 * reply. A failed turn reports nothing.
 */
import React from "react";
import express from "express";
import request from "supertest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
vi.mock("../../../server/logger", () => ({
  logger: {
    info: vi.fn((...args: unknown[]) => {
      logged.info.push(args);
    }),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    apiRequest: vi.fn(),
  },
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
import tutorTurnTimingRouter from "../../../server/routes/tutor-turn-timing";
import { requestIdMiddleware } from "../../../server/middleware/request-id";

function makeApp(): express.Express {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT_ID,
      role: "student",
    };
    next();
  });
  app.use("/api/tutor", tutorRuntimeRouter);
  app.use("/api/perf", tutorTurnTimingRouter);
  return app;
}

// ── Client transport: apiRequest → supertest → the real router ─────────────

type Call = {
  method: string;
  path: string;
  body: unknown;
  status: number;
  headers: Record<string, string>;
};
const calls: Call[] = [];

vi.mock("@/lib/queryClient", async () => {
  const { parseApiErrorFromResponse } = await import("@/lib/api-error");
  return {
    apiRequest: async (
      url: string,
      options?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      },
    ): Promise<Response> => {
      const headers = options?.headers ?? {};
      const method = (options?.method ?? "GET").toUpperCase();
      const agent = request(makeApp());
      const body: unknown = options?.body ? JSON.parse(options.body) : {};
      const res =
        method === "POST"
          ? await agent
              .post(url)
              .set({ ...headers, "Content-Type": "application/json" })
              .send(options?.body ?? "{}")
          : await agent.get(url);
      calls.push({ method, path: url, body, status: res.status, headers });
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
// UI-56: the page reads the feature-access map (GET /api/profile, OQ-29) before any tutor
// request. These tests drive the conversation with NO map, which leaves every decision to the
// tutor routes themselves (the server's own refusal); the map's locked states are covered by
// chat.ui56.test.tsx.
vi.mock("@/hooks/useProfileQuery", () => ({
  useProfileQuery: () => ({ isPending: false, data: undefined }),
}));
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

function workerReply(
  suggestedAction: { type: string; label: string | null } = {
    type: "none",
    label: null,
  },
  content: string = TUTOR_TEXT,
): unknown {
  return {
    ok: true,
    value: {
      response: {
        content,
        content_kind: "message",
        suggested_action: suggestedAction,
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
  await waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.method === "GET" &&
          c.path === `/api/tutor/conversations/${convId}` &&
          c.status === 200,
      ),
    ).toBe(true),
  );
  await screen.findByLabelText("Message");
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: text },
  });
  fireEvent.submit(
    screen.getByRole("form", { name: /send a message to lisa/i }),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function perfLines(
  event: string,
): Array<{ data: Record<string, unknown>; requestId: unknown }> {
  return logged.info
    .filter((args) => args[0] === "PERF" && args[1] === event)
    .map((args) => ({
      data: args[3] as Record<string, unknown>,
      requestId: (args[4] as { requestId?: unknown } | undefined)?.requestId,
    }));
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  calls.length = 0;
  logged.info.length = 0;
  orchestrateTurn.mockReset();
});

describe("H1: time to first visible text", () => {
  it("the send's request id joins route_timing and the beacon; the beacon and its line carry numbers only", async () => {
    orchestrateTurn.mockResolvedValue(workerReply());
    const convId = seedEmptyConversation();
    await renderChat(convId);

    send(STUDENT_TEXT);
    await screen.findByText(TUTOR_TEXT);

    const sendCall = calls.find(
      (c) => c.method === "POST" && c.path === "/api/tutor/messages",
    );
    expect(sendCall).toBeDefined();
    const requestId = sendCall!.headers["X-Request-Id"];
    expect(requestId).toMatch(UUID);
    // The id travels as a header, never in the body.
    expect(sendCall!.body).not.toHaveProperty("request_id");

    // The turn's route_timing line was written under that id.
    const timing = perfLines("route_timing");
    expect(timing).toHaveLength(1);
    expect(timing[0]!.requestId).toBe(requestId);

    await waitFor(() =>
      expect(perfLines("tutor_turn_visible")).toHaveLength(1),
    );
    const beacon = calls.find(
      (c) => c.method === "POST" && c.path === "/api/perf/tutor-turn",
    );
    expect(beacon?.status).toBe(204);
    expect(Object.keys(beacon!.body as object).sort()).toEqual([
      "post_ms",
      "request_id",
      "visible_ms",
    ]);
    const [line] = perfLines("tutor_turn_visible");
    expect(Object.keys(line!.data).sort()).toEqual([
      "post_ms",
      "turn_request_id",
      "visible_ms",
    ]);
    expect(line!.data.turn_request_id).toBe(requestId);
    expect(typeof line!.data.post_ms).toBe("number");
    expect(line!.data.visible_ms as number).toBeGreaterThanOrEqual(
      line!.data.post_ms as number,
    );
    for (const text of [STUDENT_TEXT, TUTOR_TEXT, convId]) {
      expect(JSON.stringify(beacon!.body)).not.toContain(text);
      expect(JSON.stringify(line!.data)).not.toContain(text);
    }
  });

  it("a failed turn reports nothing", async () => {
    orchestrateTurn.mockResolvedValue({
      ok: false,
      errorCode: "orchestration_failed_recoverable",
    });
    const convId = seedEmptyConversation();
    await renderChat(convId);

    send(STUDENT_TEXT);
    await screen.findByRole("button", { name: /try again/i });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.some((c) => c.path === "/api/perf/tutor-turn")).toBe(false);
    expect(perfLines("tutor_turn_visible")).toHaveLength(0);
  });
});
