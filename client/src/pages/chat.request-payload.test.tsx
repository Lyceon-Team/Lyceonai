// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Chat from "./chat";

const apiRequestRawMock = vi.fn();

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "student-123", email: "student@example.com", role: "student" },
  }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequestRaw: (...args: unknown[]) => apiRequestRawMock(...args),
}));

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const ISO_NOW = "2026-04-17T12:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function startConversationBody() {
  return {
    data: {
      conversation_id: CONVERSATION_ID,
      entry_mode: "general",
      source_surface: "dashboard",
      status: "active",
      resolved_scope: {
        source_session_id: null,
        source_session_item_id: null,
        source_question_row_id: null,
        source_question_canonical_id: null,
      },
    },
  };
}

function fetchConversationBody() {
  return {
    data: {
      conversation: {
        conversation_id: CONVERSATION_ID,
        entry_mode: "general",
        source_surface: "dashboard",
        status: "active",
        resolved_scope: {
          source_session_id: null,
          source_session_item_id: null,
          source_question_row_id: null,
          source_question_canonical_id: null,
        },
        created_at: ISO_NOW,
        updated_at: ISO_NOW,
      },
      messages: [],
    },
  };
}

function appendMessageBody(content: string) {
  return {
    data: {
      conversation_id: CONVERSATION_ID,
      message_id: "22222222-2222-4222-8222-222222222222",
      response: {
        content,
        content_kind: "message",
        suggested_action: {
          type: "offer_stay_focused",
          label: "Stay focused",
        },
        ui_hints: {
          show_accept_decline: true,
          allow_freeform_reply: true,
          suggested_chip: "Try this next",
        },
      },
    },
  };
}

function recoverableRetryErrorBody() {
  return {
    error: {
      code: "TUTOR_RECOVERABLE_RETRY_REQUIRED",
      message: "The tutor turn could not be completed safely. Please retry.",
      retryable: true,
    },
    requestId: "request-1",
  };
}

function createDeferredResponse() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("Chat request payload", () => {
  beforeEach(() => {
    apiRequestRawMock.mockReset();
  });

  beforeAll(() => {
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      value: vi.fn(),
      writable: true,
    });
  });

  it("uses canonical tutor endpoints with contract-only payloads and renders backend ui fields", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(jsonResponse(startConversationBody()))
      .mockResolvedValueOnce(jsonResponse(fetchConversationBody()))
      .mockResolvedValueOnce(jsonResponse(appendMessageBody("Tutor response")));

    render(<Chat />);

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByTestId("input-chat-message"), {
      target: { value: "How do I solve this?" },
    });
    fireEvent.click(screen.getByTestId("button-send-message"));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(3);
    });

    const calls = apiRequestRawMock.mock.calls as Array<[string, { method?: string; body?: string }]>;
    const urls = calls.map(([url]) => url);
    expect(urls).toEqual([
      "/api/tutor/conversations",
      `/api/tutor/conversations/${CONVERSATION_ID}`,
      "/api/tutor/messages",
    ]);

    const startPayload = JSON.parse(calls[0][1].body ?? "{}");
    expect(startPayload).toEqual({
      entry_mode: "general",
      source_surface: "dashboard",
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    });
    expect(startPayload).not.toHaveProperty("student_id");
    expect(startPayload).not.toHaveProperty("userId");
    expect(startPayload).not.toHaveProperty("role");
    expect(startPayload).not.toHaveProperty("entitlement");

    const appendPayload = JSON.parse(calls[2][1].body ?? "{}");
    expect(appendPayload.conversation_id).toBe(CONVERSATION_ID);
    expect(appendPayload.message).toBe("How do I solve this?");
    expect(appendPayload.content_kind).toBe("message");
    expect(typeof appendPayload.client_turn_id).toBe("string");
    expect(appendPayload).not.toHaveProperty("student_id");
    expect(appendPayload).not.toHaveProperty("userId");
    expect(appendPayload).not.toHaveProperty("role");
    expect(appendPayload).not.toHaveProperty("entitlement");
    expect(appendPayload).not.toHaveProperty("ownership");

    await waitFor(() => {
      expect(screen.getByText("Stay focused")).toBeTruthy();
      expect(screen.getByText("Try this next")).toBeTruthy();
      expect(screen.getByText(/UI hints: accept\/decline on/)).toBeTruthy();
    });
  });

  it("reuses pending logical turn on recoverable retry without duplicate user or placeholder", async () => {
    const deferredSuccess = createDeferredResponse();

    apiRequestRawMock
      .mockResolvedValueOnce(jsonResponse(startConversationBody()))
      .mockResolvedValueOnce(jsonResponse(fetchConversationBody()))
      .mockResolvedValueOnce(jsonResponse(recoverableRetryErrorBody(), 409))
      .mockReturnValueOnce(deferredSuccess.promise);

    render(<Chat />);

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByTestId("input-chat-message"), {
      target: { value: "Retry this" },
    });
    fireEvent.click(screen.getByTestId("button-send-message"));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(3);
      expect(screen.getByText("The tutor turn could not be completed safely. Please retry.")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(4);
    });

    const messagesContainer = screen.getByTestId("chat-messages-container");
    expect(messagesContainer.querySelectorAll('[data-testid^="message-"]').length).toBe(2);
    expect(screen.getAllByText("Retry this")).toHaveLength(1);

    deferredSuccess.resolve(jsonResponse(appendMessageBody("Recovered response")));

    await waitFor(() => {
      expect(screen.getByText("Recovered response")).toBeTruthy();
    });

    const calls = apiRequestRawMock.mock.calls as Array<[string, { method?: string; body?: string }]>;
    const firstAppendPayload = JSON.parse(calls[2][1].body ?? "{}");
    const retryAppendPayload = JSON.parse(calls[3][1].body ?? "{}");
    expect(retryAppendPayload.client_turn_id).toBe(firstAppendPayload.client_turn_id);

    expect(messagesContainer.querySelectorAll('[data-testid^="message-"]').length).toBe(2);
    expect(screen.getAllByText("Retry this")).toHaveLength(1);
  });
});
