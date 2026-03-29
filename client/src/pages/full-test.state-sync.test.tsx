// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FullTest from "./full-test";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "student-1", role: "student" },
    authLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
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
  default: ({ data }: { data: { sessionId: string } }) => (
    <div data-testid="report-session-id">{data.sessionId}</div>
  ),
}));

vi.mock("@/components/full-length-exam/FullLengthReviewView", () => ({
  __esModule: true,
  default: ({ data }: { data: { session: { id: string } } }) => (
    <div data-testid="review-session-id">{data.session.id}</div>
  ),
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
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("FullTest review/report session sync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/full-test");
    window.localStorage.clear();
  });

  it("keeps report and review on the same session when opening review from a different history row", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = asUrl(input);

      if (url === "/api/full-length/sessions?limit=15") {
        return jsonResponse({
          sessions: [
            {
              sessionId: "session-a",
              status: "completed",
              currentSection: "math",
              currentModule: 2,
              testFormId: "form-1",
              startedAt: "2026-03-20T09:00:00.000Z",
              completedAt: "2026-03-20T11:00:00.000Z",
              createdAt: "2026-03-20T08:58:00.000Z",
              updatedAt: "2026-03-20T11:00:00.000Z",
              reportAvailable: true,
              reviewAvailable: true,
            },
            {
              sessionId: "session-b",
              status: "completed",
              currentSection: "math",
              currentModule: 2,
              testFormId: "form-1",
              startedAt: "2026-03-21T09:00:00.000Z",
              completedAt: "2026-03-21T11:00:00.000Z",
              createdAt: "2026-03-21T08:58:00.000Z",
              updatedAt: "2026-03-21T11:00:00.000Z",
              reportAvailable: true,
              reviewAvailable: true,
            },
          ],
          reportAccess: {
            hasPaidAccess: true,
            reason: "active",
          },
        });
      }

      if (url === "/api/full-length/sessions/session-a/report") {
        return jsonResponse({
          sessionId: "session-a",
        });
      }

      if (url === "/api/full-length/sessions/session-b/report") {
        return jsonResponse({
          sessionId: "session-b",
        });
      }

      if (url === "/api/full-length/sessions/session-b/review") {
        return jsonResponse({
          session: {
            id: "session-b",
            status: "completed",
            currentSection: "math",
            currentModule: 2,
            startedAt: "2026-03-21T09:00:00.000Z",
            completedAt: "2026-03-21T11:00:00.000Z",
            createdAt: "2026-03-21T08:58:00.000Z",
          },
          modules: [],
          questions: [],
          responses: [],
        });
      }

      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });

    render(<FullTest />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Open Report" }).length).toBe(2);
      expect(screen.getAllByRole("button", { name: "Open Review" }).length).toBe(2);
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Open Report" })[0]);
    await waitFor(() => {
      expect(screen.getByTestId("report-session-id").textContent).toBe("session-a");
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Open Review" })[1]);

    await waitFor(() => {
      expect(screen.getByTestId("report-session-id").textContent).toBe("session-b");
      expect(screen.getByTestId("review-session-id").textContent).toBe("session-b");
    });

    const urls = fetchMock.mock.calls.map(([input]) => asUrl(input));
    expect(urls).toContain("/api/full-length/sessions/session-a/report");
    expect(urls).toContain("/api/full-length/sessions/session-b/report");
    expect(urls).toContain("/api/full-length/sessions/session-b/review");
  });
});
