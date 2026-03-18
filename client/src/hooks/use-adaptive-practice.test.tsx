// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdaptivePractice } from "./use-adaptive-practice";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAdaptivePractice canonical wiring", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("boots via canonical session endpoints with client_instance_id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url.endsWith("/api/practice/sessions")) {
        return jsonResponse({ sessionId: "session-1" });
      }
      if (url.includes("/api/practice/sessions/session-1/next?client_instance_id=")) {
        return jsonResponse({
          sessionId: "session-1",
          sessionItemId: "item-1",
          state: "active",
          stats: { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 },
          question: {
            id: "q-1",
            stem: "Question 1",
            section: "rw",
            questionType: "multiple_choice",
            options: [
              { key: "A", text: "One" },
              { key: "B", text: "Two" },
            ],
            explanation: null,
            tags: [],
          },
        });
      }
      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    const { result } = renderHook(
      () => useAdaptivePractice({ section: "rw", mode: "flow" }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.startSession();
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("session-1");
      expect(result.current.currentQuestion?.id).toBe("q-1");
    });

    const calledUrls = fetchMock.mock.calls.map(([input]) => asUrl(input));
    expect(calledUrls.some((url) => url === "/api/practice/sessions")).toBe(true);
    expect(
      calledUrls.some((url) => url.startsWith("/api/practice/sessions/session-1/next?client_instance_id="))
    ).toBe(true);
    expect(calledUrls.some((url) => url.startsWith("/api/practice/next"))).toBe(false);
  });

  it("submits skip to canonical /sessions/:id/skip endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = asUrl(input);
      if (url.endsWith("/api/practice/sessions")) {
        return jsonResponse({ sessionId: "session-1" });
      }
      if (url.includes("/api/practice/sessions/session-1/next?client_instance_id=")) {
        return jsonResponse({
          sessionId: "session-1",
          sessionItemId: "item-1",
          state: "active",
          stats: { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 },
          question: {
            id: "q-1",
            stem: "Question 1",
            section: "rw",
            questionType: "multiple_choice",
            options: [
              { key: "A", text: "One" },
              { key: "B", text: "Two" },
            ],
            explanation: null,
            tags: [],
          },
        });
      }
      if (url.endsWith("/api/practice/sessions/session-1/skip")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body.sessionItemId).toBe("item-1");
        expect(body.questionId).toBe("q-1");
        expect(typeof body.client_instance_id).toBe("string");
        expect(body.client_instance_id.length).toBeGreaterThan(0);
        return jsonResponse({
          skipped: true,
          state: "active",
          stats: { correct: 0, incorrect: 0, skipped: 1, total: 1, streak: 0 },
        });
      }
      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    const { result } = renderHook(
      () => useAdaptivePractice({ section: "rw", mode: "flow" }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.startSession();
    });

    await waitFor(() => {
      expect(result.current.currentQuestion?.id).toBe("q-1");
    });

    await act(async () => {
      await result.current.skipQuestion();
    });

    const calledUrls = fetchMock.mock.calls.map(([input]) => asUrl(input));
    expect(calledUrls).toContain("/api/practice/sessions/session-1/skip");
  });

  it("terminates session through backend endpoint instead of local-only reset", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = asUrl(input);
      if (url.endsWith("/api/practice/sessions")) {
        return jsonResponse({ sessionId: "session-1" });
      }
      if (url.includes("/api/practice/sessions/session-1/next?client_instance_id=")) {
        return jsonResponse({
          sessionId: "session-1",
          sessionItemId: "item-1",
          state: "active",
          stats: { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 },
          question: {
            id: "q-1",
            stem: "Question 1",
            section: "rw",
            questionType: "multiple_choice",
            options: [
              { key: "A", text: "One" },
              { key: "B", text: "Two" },
            ],
            explanation: null,
            tags: [],
          },
        });
      }
      if (url.endsWith("/api/practice/sessions/session-1/terminate")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(typeof body.client_instance_id).toBe("string");
        expect(body.client_instance_id.length).toBeGreaterThan(0);
        return jsonResponse({ sessionId: "session-1", state: "abandoned" });
      }
      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    const { result } = renderHook(
      () => useAdaptivePractice({ section: "rw", mode: "structured" }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.startSession();
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("session-1");
    });

    await act(async () => {
      await result.current.endSession();
    });

    const calledUrls = fetchMock.mock.calls.map(([input]) => asUrl(input));
    expect(calledUrls).toContain("/api/practice/sessions/session-1/terminate");
  });
});
