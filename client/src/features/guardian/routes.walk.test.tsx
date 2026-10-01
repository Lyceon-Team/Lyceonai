// @vitest-environment jsdom
/**
 * G4-01 — every guardian route renders inside ONE `GuardianShell`, and every retired
 * guardian route redirects to its new home.
 *
 * @spec [Guardian_Closure_Plan G4-01 named proof: "a route-walk test that every guardian route
 *       renders inside GuardianShell and every old route redirects"] | @implemented [2026-09-30]
 *
 * plain English: renders the app's REAL route switch (`Router` from `App.tsx`) at each path,
 * signed in as a guardian, and asserts the shell is on the page. For the three retired
 * `/students/:id/*` paths it asserts the location moved to the new route, keeping the student
 * and the exam session, and that the new page is inside the shell. Only the network is
 * scripted; every read answers an empty or refused shape, which is all a layout walk needs.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, describe, expect, it, vi } from "vitest";

const STUDENT = "33333333-3333-4333-8333-333333333333";
const SESSION = "5e551011-0000-4000-8000-000000000001";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "guardian-1", email: "g@example.test", role: "guardian" },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isGuardian: true,
    isAdmin: false,
    accountUnavailable: false,
    signOut: vi.fn(async () => undefined),
  }),
}));
vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(async () => "t"),
  clearCsrfToken: vi.fn(),
  csrfFetch: vi.fn(async (url: string) => {
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url === "/api/profile") {
      return json({
        user: {
          role: "guardian",
          profileCompletedAt: "2026-09-01T00:00:00.000Z",
          requiredProfileComplete: true,
          guardianConsentRequired: false,
        },
      });
    }
    if (url === "/api/guardian/students") return json({ students: [] });
    // Every per-student read: refused, as for a student not (or no longer) linked.
    return json({ error: "Not found" }, 404);
  }),
}));

const { Router } = await import("@/App");

afterEach(cleanup);

function renderAt(path: string): { history: string[] } {
  const location = memoryLocation({ path, record: true });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WouterRouter hook={location.hook}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>,
  );
  return { history: location.history };
}

describe("G4-01 every guardian route renders inside GuardianShell", () => {
  it.each([
    ["/guardian"],
    [`/guardian/${STUDENT}`],
    [`/guardian/${STUDENT}/calendar`],
    [`/guardian/${STUDENT}/exams`],
    [`/guardian/${STUDENT}/exams/${SESSION}`],
  ])("%s", async (path) => {
    renderAt(path);
    expect(await screen.findByTestId("guardian-shell")).toBeTruthy();
    expect(screen.getByTestId("guardian-shell-header")).toBeTruthy();
    // ONE shell: no page brings a second header of its own.
    expect(screen.getAllByTestId("guardian-shell")).toHaveLength(1);
  });

  it("a student's pages carry the Dashboard / Calendar tabs, marking the open one", async () => {
    renderAt(`/guardian/${STUDENT}/calendar`);
    const calendarTab = await screen.findByTestId("guardian-tab-calendar");
    expect(calendarTab.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByTestId("guardian-tab-dashboard").getAttribute("href"),
    ).toBe(`/guardian/${STUDENT}`);
  });
});

describe("G4-01 every retired guardian route redirects to its new home", () => {
  it.each([
    [`/students/${STUDENT}/calendar`, `/guardian/${STUDENT}/calendar`],
    [`/students/${STUDENT}/tests`, `/guardian/${STUDENT}/exams`],
    [
      `/students/${STUDENT}/tests/${SESSION}`,
      `/guardian/${STUDENT}/exams/${SESSION}`,
    ],
  ])("%s → %s", async (from, to) => {
    const { history } = renderAt(from);
    expect(await screen.findByTestId("guardian-shell")).toBeTruthy();
    expect(history[history.length - 1]).toBe(to);
  });
});
