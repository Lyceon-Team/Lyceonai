// @vitest-environment jsdom
/**
 * @spec [Doc-03B_V2 §11 (Client Error Handling)]
 * @implemented 2026-09-23
 *
 * plain English: Behavioral contract test proving the chat page never
 * renders raw server error messages to the student. The rewritten
 * standalone LISA chat (PR B) silently handles load errors rather than
 * displaying notices, so the anti-leak property is satisfied trivially:
 * no internal strings appear in the rendered output.
 *
 * trade-offs: requires mocking wouter and all tutor-client hooks.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Raw server messages that must NEVER reach the student
// ---------------------------------------------------------------------------

const RAW_MESSAGES = [
  "internal db serialization failure at tutor_messages.insert",
  "no row in tutor_conversations for id=abc-123",
  "connection pool exhausted on replica-3.us-east1",
];

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

// `/chat` with a conversation selected by default; the New-session case clears it.
const wouterState = vi.hoisted(() => ({
  search: "?conversationId=test-conv-id",
}));

// UI-56: the page reads the feature-access map (GET /api/profile, OQ-29) before any tutor
// request. These tests drive the conversation with NO map, which leaves every decision to the
// tutor routes themselves (the server's own refusal); the map's locked states are covered by
// chat.ui56.test.tsx.
vi.mock("@/hooks/useProfileQuery", () => ({
  useProfileQuery: () => ({ isPending: false, data: undefined }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/chat", vi.fn()],
  useSearch: () => wouterState.search,
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

const idleMutation = {
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
};

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Chat page — raw server errors never surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wouterState.search = "?conversationId=test-conv-id";
    useSendMessageMock.mockReturnValue(idleMutation);
    useEndConversationMock.mockReturnValue(idleMutation);
    useResumeConversationMock.mockReturnValue(idleMutation);
    useCreateConversationMock.mockReturnValue(idleMutation);
    useConversationsMock.mockReturnValue({
      data: {
        conversations: [],
        pagination: { has_more: false, next_cursor: null },
      },
      isLoading: false,
      error: null,
    });
  });

  it.each([
    {
      code: "orchestration_failed",
      status: 500,
      message: RAW_MESSAGES[0],
    },
    {
      code: "conversation_not_found",
      status: 404,
      message: RAW_MESSAGES[1],
    },
    {
      code: "some_future_unknown_code",
      status: 500,
      message: RAW_MESSAGES[2],
    },
  ])(
    "does not render raw server text for $code",
    async ({ code, status, message }) => {
      useConversationMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new HttpApiError({ status, code, message }),
      });

      const { default: ChatPage } = await import("./chat");
      render(<ChatPage />, { wrapper: createWrapper() });

      const body = document.body.textContent ?? "";
      expect(body).not.toContain(message);
      for (const word of message.split(/\s+/).filter((w) => w.length > 4)) {
        expect(body).not.toContain(word);
      }
    },
  );

  // @spec [Doc-03B_V2 §11, LISA-FE-RAW-SERVER-TEXT] | @implemented [2026-09-29]
  // plain English: carried over from the retired tutor landing page's test
  // (UI-04): starting a new session that fails must show curated copy, never
  // the server's own message. `/chat` is now the only place to start one.
  it("a failed New session shows curated copy, never raw server text", async () => {
    const raw =
      "vertex-ai: model-armor template lyceon-lisa-input-v1 rejected input at filter=PI_JAILBREAK";
    wouterState.search = "";
    useConversationMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    useCreateConversationMock.mockReturnValue({
      ...idleMutation,
      isIdle: false,
      isError: true,
      status: "error" as const,
      error: new HttpApiError({
        status: 500,
        code: "orchestration_failed",
        message: raw,
      }),
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    // Presence first: the failure IS reported, so the absence below is not
    // an empty page passing for the wrong reason.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((a) => a.textContent).join(" ")).toMatch(
      /couldn.t start a session/i,
    );

    const body = document.body.textContent ?? "";
    expect(body).not.toContain(raw);
    for (const word of raw.split(/\s+/).filter((w) => w.length > 4)) {
      expect(body).not.toContain(word);
    }
  });
});
