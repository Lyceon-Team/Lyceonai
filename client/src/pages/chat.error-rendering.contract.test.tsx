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
import { render } from "@testing-library/react";
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

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", vi.fn()],
  useSearch: () => "?conversationId=test-conv-id",
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
});
