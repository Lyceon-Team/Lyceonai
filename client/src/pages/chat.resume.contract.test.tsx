// @vitest-environment jsdom
/**
 * @spec [CC Brief "LISA Session Lifecycle" §5.4 (POST /resume clears crisis_paused_at); Doc-03B_V4.1 §7.5]
 * @implemented 2026-09-24
 *
 * plain English: a paused conversation, "Continue with LISA" clicked once,
 * must come back to the composer — and must not fire /resume again.
 *
 * WHY THIS TEST EXISTS. Production conversation d3e4dba1 (2026-09-24): the
 * crisis turn paused it, the student pressed Continue, POST /resume returned
 * 200 and cleared `crisis_paused_at` — then the page stayed paused, and four
 * more presses each got 409 `conversation_not_paused`. The server was right
 * every time. The client re-paused itself: the resume handler set the turn
 * state to idle while the cached conversation detail still held the OLD
 * `crisis_paused_at`, and the "sync paused state from the server" effect read
 * that stale value and set the turn state back to paused. When the refetch
 * then arrived with `crisis_paused_at: null`, nothing cleared the turn state.
 *
 * Nothing is mocked between the hooks and the route: the REAL tutor-client
 * hooks call `apiRequest`, which is routed through supertest into the REAL
 * tutor router over the in-memory DB. A hook-level mock could not reproduce
 * this — the defect is the ordering between the mutation, the query cache and
 * the component effect.
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
vi.mock("../../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
    isLiveExamInProgress: vi.fn(async () => false),
  },
}));
vi.mock("../../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: vi.fn(),
}));
vi.mock("../../../server/services/tutor-context", () => ({
  resolveFullEnvelope: vi.fn(),
}));
vi.mock("../../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));
vi.mock("../../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(),
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
  persistInstructionAssignment: vi.fn(),
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

type Call = { method: string; path: string; status: number };
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
      const pending =
        method === "POST"
          ? agent
              .post(url)
              .set("Content-Type", "application/json")
              .send(options?.body ?? "{}")
          : agent.get(url);
      const res = await pending;
      calls.push({ method, path: url, status: res.status });
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

function seedPausedConversation(): string {
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
    crisis_flagged: true,
    deleted_at: null,
    updated_at: "2026-09-24T00:02:18.000Z",
    closed_at: null,
    title: "a hard day",
    crisis_paused_at: "2026-09-24T00:02:18.000Z",
    ended_at: null,
  });
  const convId = conv.id as string;
  db.current.seed("tutor_messages", {
    conversation_id: convId,
    student_id: STUDENT_ID,
    role: "student",
    content_kind: "message",
    message: "a hard day",
    source_session_item_id: null,
  });
  db.current.seed("tutor_messages", {
    conversation_id: convId,
    student_id: STUDENT_ID,
    role: "tutor",
    content_kind: "message",
    message:
      "If you or someone you know is in crisis, please call or text 988.",
    source_session_item_id: null,
  });
  return convId;
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  calls.length = 0;
});

describe("crisis pause → Continue with LISA", () => {
  it("returns to the composer after ONE successful /resume and never re-pauses", async () => {
    const convId = seedPausedConversation();
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

    const cont = await screen.findByRole("button", {
      name: /continue with lisa/i,
    });
    fireEvent.click(cont);

    // The composer is back: the paused bar is gone and the input is present.
    await waitFor(() => {
      expect(screen.queryByText("Tutoring is paused")).toBeNull();
    });
    expect(
      screen.getByRole("form", { name: /send a message to lisa/i }),
    ).toBeTruthy();

    // Exactly one /resume, and it succeeded. The production failure was one
    // 200 followed by 409 conversation_not_paused on every further press.
    const resumes = calls.filter((c) => c.path.endsWith("/resume"));
    expect(resumes).toEqual([
      {
        method: "POST",
        path: `/api/tutor/conversations/${convId}/resume`,
        status: 200,
      },
    ]);

    // Server truth agrees with the screen.
    const row = db.current
      .rows("tutor_conversations")
      .find((r) => r.id === convId);
    expect(row?.crisis_paused_at).toBeNull();
    expect(row?.crisis_flagged).toBe(true);
  });
  it("leaves the paused state when /resume says 409 conversation_not_paused (resumed elsewhere)", async () => {
    const convId = seedPausedConversation();
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

    const cont = await screen.findByRole("button", {
      name: /continue with lisa/i,
    });

    // Another tab resumed it: the server no longer holds a pause, but this
    // page's cache still does.
    const row = db.current
      .rows("tutor_conversations")
      .find((r) => r.id === convId);
    if (row) row.crisis_paused_at = null;

    fireEvent.click(cont);

    await waitFor(() => {
      expect(screen.queryByText("Tutoring is paused")).toBeNull();
    });
    expect(
      screen.getByRole("form", { name: /send a message to lisa/i }),
    ).toBeTruthy();
    const resumes = calls.filter((c) => c.path.endsWith("/resume"));
    expect(resumes.map((c) => c.status)).toEqual([409]);
  });
});
