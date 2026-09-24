// @vitest-environment jsdom
/**
 * @spec [Doc-03B_V4.1 §7.5 + fields beyond it: title, crisis_paused_at, surface come from CC Brief "LISA Session Lifecycle" and CC Brief "Close the LISA Vertical" PR 1.1 — not in §7.5; spec gap reported to owner]
 * @implemented 2026-09-23
 *
 * plain English: loads a crisis-paused conversation COLD — no send in this
 * session, so the only source of the paused state is the server's replay
 * response — and asserts the support card and the paused bar render with the
 * composer gone. Unlike chat.standalone.test.tsx (whose fixture is hand-written),
 * the conversation detail here is the JSON the REAL `GET /api/tutor/conversations/:id`
 * route returns, so a server that omits `crisis_paused_at` fails this test. That
 * omission is exactly what made the paused state undetectable after a reload.
 */
import React from "react";
import express from "express";
import request from "supertest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../../../tests/helpers/fake-tutor-db";

Element.prototype.scrollIntoView = vi.fn();

// ── Server-side mocks (transport + collaborators; the route is real) ───

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

// ── Client-side mocks ──────────────────────────────────────────────────

const useConversationMock = vi.fn();
const idleMutation = (): Record<string, unknown> => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  error: null,
});

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", vi.fn()],
  useSearch: () => mockSearch,
}));
vi.mock("@/hooks/tutor-client", () => ({
  useConversation: (...args: unknown[]) => useConversationMock(...args),
  useConversations: () => ({
    data: {
      conversations: [],
      pagination: { has_more: false, next_cursor: null },
    },
    isLoading: false,
    error: null,
  }),
  useCreateConversation: () => idleMutation(),
  useSendMessage: () => idleMutation(),
  useEndConversation: () => idleMutation(),
  useResumeConversation: () => idleMutation(),
}));
vi.mock("@/components/billing/PremiumUpgradePrompt", () => ({
  PremiumUpgradePrompt: () => null,
}));

let mockSearch = "";

import tutorRuntimeRouter from "../../../server/routes/tutor-runtime";

const STUDENT_ID = "33333333-3333-4333-8333-333333333333";
const CRISIS_TEXT =
  "If you or someone you know is in crisis, please call or text 988.";

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

function wrapper({ children }: { children: React.ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  vi.clearAllMocks();
});

describe("PR 1.1 — paused conversation loaded cold renders as paused", () => {
  it("renders the support card and paused bar, with no composer, from the real detail response", async () => {
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
      updated_at: "2026-09-23T10:03:00.000Z",
      closed_at: null,
      title: "I feel terrible",
      crisis_paused_at: "2026-09-23T10:03:00.000Z",
      ended_at: null,
    });
    const convId = conv.id as string;
    db.current.seed("tutor_messages", {
      conversation_id: convId,
      student_id: STUDENT_ID,
      role: "student",
      content_kind: "message",
      message: "I feel terrible",
      source_session_item_id: null,
    });
    db.current.seed("tutor_messages", {
      conversation_id: convId,
      student_id: STUDENT_ID,
      role: "tutor",
      content_kind: "message",
      message: CRISIS_TEXT,
      source_session_item_id: null,
    });

    const res = await request(makeApp()).get(
      `/api/tutor/conversations/${convId}`,
    );
    expect(res.status).toBe(200);

    mockSearch = `?conversationId=${convId}`;
    useConversationMock.mockReturnValue({
      data: res.body.data,
      isLoading: false,
      error: null,
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Tutoring is paused")).toBeTruthy();
    });
    expect(screen.getByText("Support")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /continue with lisa/i }),
    ).toBeTruthy();
    expect(screen.queryAllByRole("textbox", { name: /message/i })).toHaveLength(
      0,
    );
    // Header comes from the server's title, not the "New session" fallback.
    expect(screen.getAllByText("I feel terrible").length).toBeGreaterThan(0);
  });
});
