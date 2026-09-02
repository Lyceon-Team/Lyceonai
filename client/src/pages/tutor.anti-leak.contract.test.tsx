// @vitest-environment jsdom
/**
 * @spec [Doc-03B_V2 §11 (Client Error Handling), LISA-FE-RAW-SERVER-TEXT]
 * @implemented 2026-09-01
 *
 * plain English: Contract test proving the tutor landing page never surfaces
 * raw server error text to the student. The handleNewConversation catch block
 * routes errors through classifyTutorError (code-specific) and
 * toUserFacingMessage (premium/session/generic fallback). Raw err.message is
 * never passed to the toast.
 *
 * expected outcome: when createConversation.mutateAsync rejects with an
 * HttpApiError carrying an internal server message, the toast receives
 * curated copy — never the raw message.
 *
 * edge cases: plain Error (not ApiError), unknown error codes, and
 * recognised codes all get curated copy. The raw server string never
 * appears in any toast call argument.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Raw server messages that must NEVER reach the student
// ---------------------------------------------------------------------------

const RAW_ORCHESTRATION_MSG =
  "vertex-ai: model-armor template lyceon-lisa-input-v1 rejected input at filter=PI_JAILBREAK";

const RAW_UNKNOWN_MSG =
  "connection pool exhausted on replica-3.us-central1; 47 waiters in queue";

const RAW_PLAIN_ERROR_MSG =
  "TypeError: Cannot read properties of undefined (reading 'conversation_id')";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const toastMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/tutor", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const useConversationsMock = vi.fn();
const mutateAsyncMock = vi.fn();

vi.mock("@/hooks/tutor-client", () => ({
  useConversations: (...args: unknown[]) => useConversationsMock(...args),
  useCreateConversation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

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
// Helpers
// ---------------------------------------------------------------------------

/** Click "New Conversation" and return everything the toast was called with */
async function clickNewConversation(): Promise<{
  titles: string[];
  descriptions: string[];
}> {
  const { default: TutorPage } = await import("./tutor");
  render(<TutorPage />, { wrapper: createWrapper() });

  const button = screen.getByRole("button", { name: /new conversation/i });
  fireEvent.click(button);

  // Wait for the async catch handler to resolve and invoke the toast
  await waitFor(() => {
    expect(toastMock).toHaveBeenCalled();
  });

  const titles: string[] = [];
  const descriptions: string[] = [];
  for (const call of toastMock.mock.calls) {
    const arg = call[0] as { title?: string; description?: string };
    if (arg.title) titles.push(arg.title);
    if (arg.description) descriptions.push(arg.description);
  }
  return { titles, descriptions };
}

// ---------------------------------------------------------------------------
// Contract: LISA-FE-RAW-SERVER-TEXT
// ---------------------------------------------------------------------------

describe("LISA-FE-RAW-SERVER-TEXT: tutor.tsx never surfaces raw server text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationsMock.mockReturnValue({
      data: { conversations: [] },
      isLoading: false,
      error: null,
    });
  });

  // Case 1: known code → classified notice, never raw
  it("orchestration_failed → curated notice, raw server text absent", async () => {
    mutateAsyncMock.mockRejectedValue(
      new HttpApiError({
        status: 500,
        code: "orchestration_failed",
        message: RAW_ORCHESTRATION_MSG,
      }),
    );

    const { titles, descriptions } = await clickNewConversation();

    // Classifier returns curated copy for orchestration_failed
    expect(titles).toContain("Something went wrong");
    expect(descriptions).toContain(
      "LISA ran into a problem. Try again in a moment.",
    );

    // Raw server text must NEVER appear
    const allToastText = [...titles, ...descriptions].join(" ");
    expect(allToastText).not.toContain("vertex-ai");
    expect(allToastText).not.toContain("model-armor");
    expect(allToastText).not.toContain("PI_JAILBREAK");
    expect(allToastText).not.toContain(RAW_ORCHESTRATION_MSG);
  });

  // Case 2: unknown code → generic fallback, never raw
  it("unknown code → generic fallback, raw server text absent", async () => {
    mutateAsyncMock.mockRejectedValue(
      new HttpApiError({
        status: 500,
        code: "some_future_unrecognized_code",
        message: RAW_UNKNOWN_MSG,
      }),
    );

    const { titles, descriptions } = await clickNewConversation();

    // classifyTutorError returns null → toUserFacingMessage generic fallback
    expect(titles).toContain("Unable to load right now");
    expect(descriptions).toContain(
      "Please try again. If this keeps happening, refresh the page.",
    );

    // Raw server text must NEVER appear
    const allToastText = [...titles, ...descriptions].join(" ");
    expect(allToastText).not.toContain("connection pool");
    expect(allToastText).not.toContain("replica-3");
    expect(allToastText).not.toContain(RAW_UNKNOWN_MSG);
  });

  // Case 3: plain Error (not ApiError) → generic fallback, never raw
  it("plain Error → generic fallback, raw error message absent", async () => {
    mutateAsyncMock.mockRejectedValue(new Error(RAW_PLAIN_ERROR_MSG));

    const { titles, descriptions } = await clickNewConversation();

    // Both classifyTutorError (null) and toUserFacingMessage hit generic
    expect(titles).toContain("Unable to load right now");

    // Raw error text must NEVER appear
    const allToastText = [...titles, ...descriptions].join(" ");
    expect(allToastText).not.toContain("TypeError");
    expect(allToastText).not.toContain("Cannot read properties");
    expect(allToastText).not.toContain("conversation_id");
    expect(allToastText).not.toContain(RAW_PLAIN_ERROR_MSG);
  });

  // Case 4: premium denial → premium notice, never raw
  it("entitlement_required → premium notice, never raw", async () => {
    mutateAsyncMock.mockRejectedValue(
      new HttpApiError({
        status: 403,
        code: "entitlement_required",
        message: "student user-abc has no active entitlement row",
      }),
    );

    const { titles, descriptions } = await clickNewConversation();

    // Classifier: code-specific premium notice
    expect(titles).toContain("Premium required");

    // Raw server text must NEVER appear
    const allToastText = [...titles, ...descriptions].join(" ");
    expect(allToastText).not.toContain("user-abc");
    expect(allToastText).not.toContain("entitlement row");
  });

  // Case 5: non-Error thrown value → generic fallback, never raw
  it("non-Error thrown value → generic fallback", async () => {
    mutateAsyncMock.mockRejectedValue("raw string error from somewhere");

    const { titles, descriptions } = await clickNewConversation();

    expect(titles).toContain("Unable to load right now");

    const allToastText = [...titles, ...descriptions].join(" ");
    expect(allToastText).not.toContain("raw string error");
  });
});
