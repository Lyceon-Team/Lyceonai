// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import Chat from "./chat";

const apiRequestMock = vi.fn();

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
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

describe("Chat request payload", () => {
  beforeAll(() => {
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      value: vi.fn(),
      writable: true,
    });
  });

  it("does not send client-controlled userId to /api/tutor/v2", async () => {
    apiRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: "Tutor response",
          ragContext: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<Chat />);

    fireEvent.change(screen.getByTestId("input-chat-message"), {
      target: { value: "How do I solve this?" },
    });
    fireEvent.click(screen.getByTestId("button-send-message"));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(1);
    });

    const [url, options] = apiRequestMock.mock.calls[0] as [string, { body?: string }];
    expect(url).toBe("/api/tutor/v2");

    const body = JSON.parse(options.body ?? "{}");
    expect(body).toEqual({
      message: "How do I solve this?",
      mode: "concept",
      testCode: "SAT",
    });
    expect(body).not.toHaveProperty("userId");
  });
});
