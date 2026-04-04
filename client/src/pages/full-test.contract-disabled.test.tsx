// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FullTest from "./full-test";

const toastMock = vi.fn();

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "student-1", role: "student" },
    authLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/full-length-exam/ExamRunner", () => ({
  __esModule: true,
  default: () => <div data-testid="exam-runner">Exam Runner</div>,
}));

vi.mock("@/components/full-length-exam/FullLengthResultsView", () => ({
  __esModule: true,
  default: () => <div data-testid="results-view">Results</div>,
}));

vi.mock("@/components/full-length-exam/FullLengthReviewView", () => ({
  __esModule: true,
  default: () => <div data-testid="review-view">Review</div>,
}));

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
      queries: { retry: 3, retryDelay: 10, staleTime: 0 },
      mutations: { retry: 3 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("FullTest contract-disable behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastMock.mockReset();
  });

  it("renders terminal-disabled state on contract 503 with no retries or toast loops", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url === "/api/full-length/sessions?limit=15") {
        return jsonResponse(
          {
            code: "FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT",
            message: "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement.",
            requestId: "req-full-1",
          },
          503,
        );
      }
      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    render(<FullTest />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Full-Length Temporarily Disabled")).toBeTruthy();
      expect(screen.getByText("Code: FULL_LENGTH_RUNTIME_DISABLED_BY_CONTRACT")).toBeTruthy();
    });

    const historyCalls = fetchMock.mock.calls
      .map(([input]) => asUrl(input))
      .filter((url) => url === "/api/full-length/sessions?limit=15");
    expect(historyCalls).toHaveLength(1);
    expect(toastMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Loading full-length sessions...")).toBeNull();
  });
});
