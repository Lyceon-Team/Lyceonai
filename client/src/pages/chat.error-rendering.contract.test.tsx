// @vitest-environment jsdom
/**
 * @spec [Doc-03B_V2 §11 (Client Error Handling)]
 * @implemented 2026-08-28
 *
 * plain English: Behavioral contract test proving the chat page renders
 * errors through a structured notice — never the raw server message.
 * Replaces the static toContain("classifyTutorError") assertion with a
 * render test that catches regressions a source-text scan cannot.
 *
 * expected outcome: when useConversation returns an error with an internal
 * server message, the rendered output contains the curated notice copy and
 * does NOT contain the raw server text.
 *
 * trade-offs: requires mocking wouter and tutor-client hooks. The test
 * survives refactors that rename components or functions — it asserts the
 * property (structured notice, never raw) not the mechanism.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Raw server message that must NEVER reach the student
// ---------------------------------------------------------------------------

const RAW_SERVER_MESSAGE =
  "internal db serialization failure at tutor_messages.insert";

// ---------------------------------------------------------------------------
// jsdom polyfills — scrollIntoView is not implemented in jsdom
// ---------------------------------------------------------------------------

Element.prototype.scrollIntoView = vi.fn();

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const useConversationMock = vi.fn();
const useSendMessageMock = vi.fn();
const useCloseConversationMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", vi.fn()],
  useSearch: () => "?conversationId=test-conv-id",
}));

vi.mock("@/hooks/tutor-client", () => ({
  useConversation: (...args: unknown[]) => useConversationMock(...args),
  useSendMessage: () => useSendMessageMock(),
  useCloseConversation: () => useCloseConversationMock(),
}));

vi.mock("@/components/billing/PremiumUpgradePrompt", () => ({
  PremiumUpgradePrompt: () => (
    <div data-testid="premium-upgrade-prompt">Premium prompt</div>
  ),
}));

// Idle mutation shape — mimics the TanStack Query mutation result when no
// mutation has been triggered.
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
// Test
// ---------------------------------------------------------------------------

describe("Chat page — errors render through structured notice, never raw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSendMessageMock.mockReturnValue(idleMutation);
    useCloseConversationMock.mockReturnValue(idleMutation);
  });

  it("renders the classified notice, not the raw server message, for orchestration_failed", async () => {
    // Simulate useConversation returning an error whose .message carries
    // an internal server string the student must never see.
    useConversationMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new HttpApiError({
        status: 500,
        code: "orchestration_failed",
        message: RAW_SERVER_MESSAGE,
      }),
    });

    // Dynamically import to pick up mocks
    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    // The structured notice copy MUST appear
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(
      screen.getByText("LISA ran into a problem. Try again in a moment."),
    ).toBeTruthy();

    // The raw server message must NEVER appear anywhere in the rendered output
    const body = document.body.textContent ?? "";
    expect(body).not.toContain(RAW_SERVER_MESSAGE);
    expect(body).not.toContain("serialization");
    expect(body).not.toContain("tutor_messages");
  });

  it("renders the classified notice for conversation_not_found", async () => {
    useConversationMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new HttpApiError({
        status: 404,
        code: "conversation_not_found",
        message: "no row in tutor_conversations for id=abc-123",
      }),
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    expect(screen.getByText("Conversation not found")).toBeTruthy();
    expect(
      screen.getByText("This conversation doesn't exist. Start a new one."),
    ).toBeTruthy();

    const body = document.body.textContent ?? "";
    expect(body).not.toContain("tutor_conversations");
    expect(body).not.toContain("abc-123");
  });

  it("renders the generic fallback for an unrecognized error code — still not raw", async () => {
    useConversationMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new HttpApiError({
        status: 500,
        code: "some_future_unknown_code",
        message: "connection pool exhausted on replica-3.us-east1",
      }),
    });

    const { default: ChatPage } = await import("./chat");
    render(<ChatPage />, { wrapper: createWrapper() });

    // The generic fallback notice MUST appear
    expect(screen.getByText("Couldn't load this right now")).toBeTruthy();

    // The raw server message must not surface
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("connection pool");
    expect(body).not.toContain("replica-3");
  });
});
