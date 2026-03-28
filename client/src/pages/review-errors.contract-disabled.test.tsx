// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewErrors from "./review-errors";
import { getQueryFn } from "@/lib/queryClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asUrl(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "throw" }), retry: 3, retryDelay: 10, staleTime: 0 },
      mutations: { retry: 3 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("ReviewErrors contract-disable behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders terminal-disabled state on contract 503 with no retry loop UI", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url === "/api/review-errors?mode=all_past_mistakes") {
        return jsonResponse(
          {
            code: "REVIEW_RUNTIME_DISABLED_BY_CONTRACT",
            message: "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.",
            requestId: "req-review-1",
          },
          503,
        );
      }
      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    render(<ReviewErrors />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Review Temporarily Disabled")).toBeTruthy();
      expect(screen.getByText("Code: REVIEW_RUNTIME_DISABLED_BY_CONTRACT")).toBeTruthy();
    });

    const reviewCalls = fetchMock.mock.calls
      .map(([input]) => asUrl(input))
      .filter((url) => url === "/api/review-errors?mode=all_past_mistakes");
    expect(reviewCalls).toHaveLength(1);
    expect(screen.queryByText("Loading your review queue...")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
