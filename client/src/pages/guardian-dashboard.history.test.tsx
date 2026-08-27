// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GuardianDashboard from "./guardian-dashboard";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    isGuardian: true,
    isAuthenticated: true,
    authLoading: false,
  }),
}));

vi.mock("@/components/guardian/SubscriptionPaywall", () => ({
  SubscriptionPaywall: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ManageSubscriptionButton: () => (
    <button type="button">Manage Subscription</button>
  ),
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    Redirect: ({ to }: { to: string }) => (
      <div data-testid="redirect">{to}</div>
    ),
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
      <a href={href}>{children}</a>
    ),
  };
});

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
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("GuardianDashboard full-length history view UX", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows report action only when runtime view marks reportAvailable", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = asUrl(input);

        if (url === "/api/guardian/students") {
          return jsonResponse({
            students: [
              {
                id: "student-1",
                email: "alex@example.com",
                display_name: "Alex Student",
                created_at: "2026-03-20T12:00:00.000Z",
              },
            ],
          });
        }

        if (url === "/api/billing/status") {
          return jsonResponse({
            isPaid: true,
            effectiveAccess: true,
            hasLinkedStudent: true,
            linkRequiredForPremium: false,
          });
        }

        if (url === "/api/guardian/students/student-1/summary") {
          // The guardian summary IS the student KPI envelope with the metric list
          // narrowed. The previous fixture carried `student` and `progress` — a shape the
          // route no longer returns, i.e. a fixture describing a contract that does not
          // exist, which is how the crashed weakness card got past its own tests.
          return jsonResponse({
            modelVersion: "kpi-v1",
            timezone: "America/Chicago",
            week: { questionsSolved: 80, accuracy: 75, explanations: {} },
            recency: null,
            metrics: [
              { id: "week_questions", label: "Questions (7d)", value: 80 },
              { id: "week_accuracy", label: "Accuracy (7d)", value: 75 },
              { id: "current_streak", label: "Streak", value: 3 },
            ],
            gating: {
              historicalTrends: {
                allowed: false,
                requiredPlan: "paid",
                reason:
                  "Historical trend KPIs require an active paid entitlement.",
              },
            },
            measurementModel: { official: [], weighted: [], diagnostic: [] },
          });
        }

        if (url.startsWith("/api/guardian/weaknesses/student-1")) {
          // Domain grain, not per-skill (AC#19). The old `skills: []` fixture described a
          // shape this route has never returned.
          return jsonResponse({
            ok: true,
            count: 0,
            domains: [],
          });
        }

        if (
          url ===
          "/api/guardian/students/student-1/exams/full-length/sessions?limit=12&include_incomplete=true"
        ) {
          return jsonResponse({
            studentId: "student-1",
            sessions: [
              {
                sessionId: "sess-complete-1",
                status: "completed",
                startedAt: "2026-03-20T09:00:00.000Z",
                completedAt: "2026-03-20T11:00:00.000Z",
                createdAt: "2026-03-20T08:58:00.000Z",
                reportAvailable: true,
              },
              {
                sessionId: "sess-live-2",
                status: "in_progress",
                startedAt: "2026-03-21T09:00:00.000Z",
                completedAt: null,
                createdAt: "2026-03-21T08:58:00.000Z",
                reportAvailable: false,
              },
            ],
          });
        }

        return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
      });

    render(<GuardianDashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Alex Student")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Alex Student/i }));

    await waitFor(() => {
      expect(screen.getByText("Linked student session history")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open Report" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Report Locked" }),
      ).toBeTruthy();
    });

    expect(
      screen.getByRole("button", { name: "Open Report" }),
    ).not.toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Report Locked" }),
    ).toHaveProperty("disabled", true);

    const urls = fetchMock.mock.calls.map(([input]) => asUrl(input));
    expect(urls).toContain(
      "/api/guardian/students/student-1/exams/full-length/sessions?limit=12&include_incomplete=true",
    );
  });
});

describe("GuardianDashboard linked-students contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @spec [owner ruling 2026-08-24 bucket 2 step 5] | @implemented [2026-08-24]
   *
   * A SUCCESSFUL response whose `students` is not an array is a contract violation, not an
   * empty roster. `|| []` rendered it as "No students linked yet" — a claim about the
   * parent's account, made from a value never read. Same class as the `?? 0` that told a
   * parent their child had answered nothing.
   */
  it("a malformed success renders the recoverable error, NOT 'no students linked'", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url === "/api/guardian/students") {
        // 200 OK, but `students` is not an array.
        return jsonResponse({ students: null });
      }
      if (url === "/api/billing/status") {
        return jsonResponse({
          isPaid: true,
          effectiveAccess: true,
          hasLinkedStudent: true,
          linkRequiredForPremium: false,
        });
      }
      return jsonResponse({}, 404);
    });

    render(<GuardianDashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("We couldn't load students.")).toBeTruthy();
    });
    // The empty-roster copy must NOT appear: we did not establish that it is empty.
    expect(screen.queryByText("No students linked yet")).toBeNull();
  });

  it("a genuinely empty roster still reads as empty, not as an error", async () => {
    // The counterpart that makes the case above mean something: [] is a real answer.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = asUrl(input);
      if (url === "/api/guardian/students") {
        return jsonResponse({ students: [] });
      }
      if (url === "/api/billing/status") {
        return jsonResponse({
          isPaid: true,
          effectiveAccess: true,
          hasLinkedStudent: true,
          linkRequiredForPremium: false,
        });
      }
      return jsonResponse({}, 404);
    });

    render(<GuardianDashboard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getAllByText("No students linked yet").length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText("We couldn't load students.")).toBeNull();
  });
});
