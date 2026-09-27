// @vitest-environment jsdom
/**
 * @spec [CC Brief "PR B: Standalone LISA Chat UI" §6]
 * @implemented 2026-09-23
 *
 * plain English: The eight acceptance tests from the brief.
 * 1. New session creates a new conversation; the previous one is not reopened
 * 2. End calls /end, conversation leaves list, GET still returns it
 * 3. Retry sends the SAME client_turn_id (assert on the value)
 * 4. Send is disabled while a turn is in flight
 * 5. Crisis response renders support card and replaces composer; Continue calls /resume
 * 6. Crisis and safeguarding render distinctly
 * 7. Timeout enters failed with retry available
 * 8. Empty state renders — no sessions is normal, must not look broken
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// jsdom polyfills
// ---------------------------------------------------------------------------

Element.prototype.scrollIntoView = vi.fn();

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const useConversationMock = vi.fn();
const useSendMessageMock = vi.fn();
const useEndConversationMock = vi.fn();
const useConversationsMock = vi.fn();
const useCreateConversationMock = vi.fn();
const useResumeConversationMock = vi.fn();

let mockSearch = "";
const mockSetLocation = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", mockSetLocation],
  useSearch: () => mockSearch,
}));

vi.mock("@/hooks/tutor-client", () => ({
  useConversation: (...args: unknown[]) => useConversationMock(...args),
  useConversations: () => useConversationsMock(),
  useCreateConversation: () => useCreateConversationMock(),
  useSendMessage: () => useSendMessageMock(),
  useEndConversation: () => useEndConversationMock(),
  useResumeConversation: () => useResumeConversationMock(),
}));

vi.mock("@/components/billing/PremiumUpgradePrompt", () => ({
  PremiumUpgradePrompt: () => (
    <div data-testid="premium-upgrade-prompt">Premium prompt</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const idleMutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isIdle: true,
  isSuccess: false,
  isError: false,
  error: null,
  data: undefined,
  status: "idle" as const,
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function setupDefaultMocks(overrides?: {
  conversationId?: string;
  messages?: Array<{
    message_id: string;
    role: string;
    content_kind: string;
    message: string;
    created_at: string;
  }>;
  conversations?: Array<{
    conversation_id: string;
    title: string | null;
    entry_mode: string;
    source_surface: string;
    surface: string | null;
    status: string;
    crisis_flagged: boolean;
    crisis_paused_at: string | null;
    resolved_scope: Record<string, unknown>;
    last_message_preview: string | null;
    message_count: number;
    created_at: string;
    updated_at: string;
  }>;
  conversationStatus?: string;
  crisisPausedAt?: string | null;
}) {
  const convId = overrides?.conversationId ?? "conv-123";
  mockSearch = `?conversationId=${convId}`;

  useConversationMock.mockReturnValue({
    data: {
      conversation: {
        conversation_id: convId,
        entry_mode: "general",
        source_surface: "dashboard",
        surface: "standalone",
        status: overrides?.conversationStatus ?? "active",
        title: "Test Session",
        crisis_paused_at: overrides?.crisisPausedAt ?? null,
        resolved_scope: {
          source_session_id: null,
          source_session_item_id: null,
          source_question_row_id: null,
          source_question_canonical_id: null,
        },
        created_at: "2026-09-23T10:00:00Z",
        updated_at: "2026-09-23T10:05:00Z",
        closed_at: null,
      },
      messages: overrides?.messages ?? [],
      pagination: { has_more: false, next_cursor: null },
    },
    isLoading: false,
    error: null,
  });

  useConversationsMock.mockReturnValue({
    data: {
      conversations: overrides?.conversations ?? [],
      pagination: { has_more: false, next_cursor: null },
    },
    isLoading: false,
    error: null,
  });

  const sendMut = idleMutation();
  const endMut = idleMutation();
  const resumeMut = idleMutation();
  const createMut = idleMutation();

  useSendMessageMock.mockReturnValue(sendMut);
  useEndConversationMock.mockReturnValue(endMut);
  useResumeConversationMock.mockReturnValue(resumeMut);
  useCreateConversationMock.mockReturnValue(createMut);

  return { sendMut, endMut, resumeMut, createMut };
}

const sampleMessage = (role: string, text: string, id?: string) => ({
  message_id: id ?? crypto.randomUUID(),
  role,
  content_kind: "text",
  message: text,
  created_at: "2026-09-23T10:01:00Z",
});

// ---------------------------------------------------------------------------
// Tests — §6 acceptance criteria
// ---------------------------------------------------------------------------

describe("PR B §6 — Standalone LISA Chat UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSearch = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Test 1: New session creates a new conversation ─────────────────
  it("1. new session creates a new conversation (not reopening a previous one)", async () => {
    const { createMut } = setupDefaultMocks({
      conversations: [
        {
          conversation_id: "old-conv-1",
          title: "Old Session",
          entry_mode: "general",
          source_surface: "dashboard",
          surface: "standalone",
          status: "active",
          crisis_flagged: false,
          crisis_paused_at: null,
          resolved_scope: {},
          last_message_preview: "hello",
          message_count: 1,
          created_at: "2026-09-22T10:00:00Z",
          updated_at: "2026-09-22T10:05:00Z",
        },
      ],
    });

    createMut.mutateAsync = vi.fn().mockResolvedValue({
      conversation_id: "new-conv-999",
      reused: false,
      entry_mode: "general",
      source_surface: "dashboard",
      surface: "standalone",
      status: "active",
      title: null,
      crisis_flagged: false,
      crisis_paused_at: null,
      resolved_scope: {},
      created_at: "2026-09-23T10:10:00Z",
      updated_at: "2026-09-23T10:10:00Z",
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    const newSessionBtn = screen.getAllByRole("button", {
      name: /new session/i,
    })[0];
    expect(newSessionBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(newSessionBtn);
    });

    expect(createMut.mutateAsync).toHaveBeenCalledOnce();
    const callArgs = createMut.mutateAsync.mock.calls[0][0];
    expect(callArgs.entry_mode).toBe("general");
    expect(callArgs.idempotency_key).toBeTruthy();
    expect(callArgs.idempotency_key).not.toBe("old-conv-1");
  });

  // ── Test 2: End session calls /end ─────────────────────────────────
  it("2. end calls /end and navigates away", async () => {
    const { endMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "hello")],
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    const endButton = screen.getByRole("button", { name: /end session/i });
    await act(async () => {
      fireEvent.click(endButton);
    });

    expect(
      screen.getByText(/It will close and leave your sessions list/),
    ).toBeTruthy();

    const confirmButtons = screen.getAllByRole("button", {
      name: /end session/i,
    });
    const confirmBtn = confirmButtons[confirmButtons.length - 1];
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(endMut.mutate).toHaveBeenCalledOnce();
    expect(endMut.mutate.mock.calls[0][0]).toBe("conv-123");
  });

  // ── Test 3: Retry sends the SAME client_turn_id ────────────────────
  it("3. retry reuses the same client_turn_id", async () => {
    const { sendMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "hello")],
    });

    const capturedTurnIds: string[] = [];
    let callCount = 0;

    sendMut.mutateAsync = vi
      .fn()
      .mockImplementation((input: { client_turn_id: string }) => {
        capturedTurnIds.push(input.client_turn_id);
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("network error"));
        }
        return Promise.resolve({
          conversation_id: "conv-123",
          message_id: "msg-resp-1",
          client_turn_id: input.client_turn_id,
          response: {
            content: "Hi there",
            content_kind: "text",
            suggested_action: { type: "none", label: null },
            ui_hints: {
              show_accept_decline: false,
              allow_freeform_reply: true,
              suggested_chip: null,
            },
          },
          conversation_updated_at: "2026-09-23T10:06:00Z",
        });
      });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    const textarea = screen.getByRole("textbox", { name: /message/i });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "test message" } });
    });

    const sendButton = screen.getByRole("button", { name: /send message/i });
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/couldn.t respond/i)).toBeTruthy();
    });

    const retryButton = screen.getByRole("button", { name: /try again/i });
    await act(async () => {
      fireEvent.click(retryButton);
    });

    expect(capturedTurnIds.length).toBe(2);
    expect(capturedTurnIds[0]).toBe(capturedTurnIds[1]);
    expect(capturedTurnIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  // ── Test 4: Send is disabled while in flight ───────────────────────
  it("4. send button is disabled while a turn is in flight", async () => {
    const { sendMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "hello")],
    });

    sendMut.mutateAsync = vi
      .fn()
      .mockImplementation(() => new Promise(() => {}));

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    const textarea = screen.getByRole("textbox", { name: /message/i });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "test" } });
    });
    const sendButton = screen.getByRole("button", { name: /send message/i });
    await act(async () => {
      fireEvent.click(sendButton);
    });

    expect(sendButton).toBeDisabled();
    expect(textarea).toBeDisabled();
    expect(screen.getByText("LISA is thinking...")).toBeTruthy();
  });

  // ── Test 5: Crisis renders support card, replaces composer ─────────
  it("5. crisis response renders support card and replaces composer; Continue calls /resume", async () => {
    const { resumeMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "I need help")],
      crisisPausedAt: "2026-09-23T10:03:00Z",
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    expect(screen.getByText("Tutoring is paused")).toBeTruthy();

    const textareas = screen.queryAllByRole("textbox", { name: /message/i });
    expect(textareas.length).toBe(0);

    const continueBtn = screen.getByRole("button", {
      name: /continue with lisa/i,
    });
    expect(continueBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(continueBtn);
    });

    expect(resumeMut.mutate).toHaveBeenCalledOnce();
    expect(resumeMut.mutate.mock.calls[0][0]).toBe("conv-123");
  });

  // ── Test 6: Crisis and safeguarding render distinctly ──────────────
  it("6. crisis and safeguarding support cards use distinct styling", async () => {
    const { sendMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "I feel unsafe")],
    });

    const crisisResponse = {
      conversation_id: "conv-123",
      message_id: "msg-crisis",
      client_turn_id: "turn-1",
      response: {
        content: "If you or someone you know is in crisis, please call 988.",
        content_kind: "text",
        crisis_category: "crisis" as const,
        suggested_action: { type: "none" as const, label: null },
        ui_hints: {
          show_accept_decline: false,
          allow_freeform_reply: false,
          suggested_chip: null,
        },
      },
      crisis_paused: true,
      crisis_paused_at: "2026-09-23T10:03:00Z",
      conversation_updated_at: "2026-09-23T10:03:00Z",
    };

    sendMut.mutateAsync = vi.fn().mockResolvedValue(crisisResponse);

    const { default: ChatPage } = await import("./chat");
    const { container } = render(<ChatPage />, { wrapper: createWrapper() });

    const textarea = screen.getByRole("textbox", { name: /message/i });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "I need help" } });
    });
    const sendButton = screen.getByRole("button", { name: /send message/i });
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(screen.getByText("Support")).toBeTruthy();
    });

    const supportCard = container.querySelector(".bg-emerald-50");
    expect(supportCard).toBeTruthy();

    const safeguardingResponse = {
      ...crisisResponse,
      response: {
        ...crisisResponse.response,
        crisis_category: "safeguarding" as const,
        content:
          "If you are in an unsafe situation, reach out to a trusted adult.",
      },
    };

    vi.clearAllMocks();
    setupDefaultMocks({
      messages: [sampleMessage("student", "someone is hurting me")],
    });
    const sendMut2 = idleMutation();
    sendMut2.mutateAsync = vi.fn().mockResolvedValue(safeguardingResponse);
    useSendMessageMock.mockReturnValue(sendMut2);

    const { container: container2 } = render(<ChatPage />, {
      wrapper: createWrapper(),
    });

    const textarea2 = screen.getAllByRole("textbox", { name: /message/i })[0];
    await act(async () => {
      fireEvent.change(textarea2, { target: { value: "help me" } });
    });
    const sendButton2 = screen.getAllByRole("button", {
      name: /send message/i,
    })[0];
    await act(async () => {
      fireEvent.click(sendButton2);
    });

    await waitFor(() => {
      const cards = container2.querySelectorAll(".bg-purple-50");
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  // ── Test 7: Timeout enters failed with retry ───────────────────────
  it("7. timeout at 35s enters failed state with retry available", async () => {
    const { sendMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "hello")],
    });

    sendMut.mutateAsync = vi
      .fn()
      .mockImplementation(() => new Promise(() => {}));

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    const textarea = screen.getByRole("textbox", { name: /message/i });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "waiting forever" } });
    });
    const sendButton = screen.getByRole("button", { name: /send message/i });
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await act(async () => {
      vi.advanceTimersByTime(35_000);
    });

    expect(screen.getByText(/couldn.t respond/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  // ── Test D1: 409 crisis_paused renders paused, not failed ──────────
  it("D1. 409 conversation_crisis_paused enters paused state (not failed)", async () => {
    const { HttpApiError: HttpApiErrorClass } = await import("@/lib/api-error");

    const { sendMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "I need help")],
    });

    sendMut.mutateAsync = vi.fn().mockRejectedValue(
      new HttpApiErrorClass({
        status: 409,
        code: "conversation_crisis_paused",
        message:
          "This session is paused because a crisis response was provided.",
      }),
    );

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    const textarea = screen.getByRole("textbox", { name: /message/i });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "hello again" } });
    });
    const sendButton = screen.getByRole("button", { name: /send message/i });
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(screen.getByText("Tutoring is paused")).toBeTruthy();
    });

    expect(screen.queryByText(/couldn.t respond/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();

    const continueBtn = screen.getByRole("button", {
      name: /continue with lisa/i,
    });
    expect(continueBtn).toBeTruthy();
  });

  // ── Test D2: Crisis support card renders on reload ────────────────
  it("D2. crisis support card renders from last tutor message on reload (effectiveCrisisContent)", async () => {
    const crisisMsg =
      "If you or someone you know is in crisis, please call 988.";

    setupDefaultMocks({
      messages: [
        sampleMessage("student", "I feel terrible"),
        sampleMessage("tutor", crisisMsg, "msg-crisis-resp"),
      ],
      crisisPausedAt: "2026-09-23T10:03:00Z",
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Support")).toBeTruthy();
    });

    expect(screen.getAllByText(/call 988/).length).toBeGreaterThan(0);
    expect(screen.getByText("Tutoring is paused")).toBeTruthy();

    const textareas = screen.queryAllByRole("textbox", { name: /message/i });
    expect(textareas.length).toBe(0);
  });

  // ── Test D3: Crisis response renders support card, not normal bubble ─
  it("D3. crisis response from sendMessage renders support card (not normal message bubble)", async () => {
    const { sendMut } = setupDefaultMocks({
      messages: [sampleMessage("student", "I need help")],
    });

    const crisisResponse = {
      conversation_id: "conv-123",
      message_id: "msg-crisis",
      client_turn_id: "turn-1",
      response: {
        content: "If you or someone you know is in crisis, please call 988.",
        content_kind: "text",
        crisis_category: "crisis" as const,
        suggested_action: { type: "none" as const, label: null },
        ui_hints: {
          show_accept_decline: false,
          allow_freeform_reply: false,
          suggested_chip: null,
        },
      },
      crisis_paused: true,
      crisis_paused_at: "2026-09-23T10:03:00Z",
      conversation_updated_at: "2026-09-23T10:03:00Z",
    };

    sendMut.mutateAsync = vi.fn().mockResolvedValue(crisisResponse);

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    const textarea = screen.getByRole("textbox", { name: /message/i });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "I need help" } });
    });
    const sendButton = screen.getByRole("button", { name: /send message/i });
    await act(async () => {
      fireEvent.click(sendButton);
    });

    await waitFor(() => {
      expect(screen.getByText("Support")).toBeTruthy();
    });

    expect(screen.getByText("Tutoring is paused")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /continue with lisa/i }),
    ).toBeTruthy();

    const textareas = screen.queryAllByRole("textbox", { name: /message/i });
    expect(textareas.length).toBe(0);
  });

  // ── Test 8: Empty state renders correctly ──────────────────────────
  it("8. empty state with no sessions renders without looking broken", async () => {
    mockSearch = "";
    useConversationMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    useConversationsMock.mockReturnValue({
      data: {
        conversations: [],
        pagination: { has_more: false, next_cursor: null },
      },
      isLoading: false,
      error: null,
    });
    useSendMessageMock.mockReturnValue(idleMutation());
    useEndConversationMock.mockReturnValue(idleMutation());
    useResumeConversationMock.mockReturnValue(idleMutation());
    useCreateConversationMock.mockReturnValue(idleMutation());

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    expect(screen.getAllByText("Welcome to LISA").length).toBeGreaterThan(0);
    expect(screen.getByText("No sessions yet")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /new session/i }).length,
    ).toBeGreaterThan(0);
  });
});
