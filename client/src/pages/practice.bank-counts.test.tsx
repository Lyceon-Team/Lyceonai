// @vitest-environment jsdom
/**
 * UI-07 — the Practice page shows no question-bank counts, and an empty pool at session
 * start reads "No questions match these filters".
 *
 * @spec [Doc-02B_V4 §14; Coding Standards §11.3; owner ruling UI-07 2026-09-29]
 * @implemented [2026-09-29]
 *
 * plain English: renders the real Practice page with the REAL `usePractice` hook, the REAL
 * `apiRequest` and the REAL error parser. Only the network edge (`csrfFetch`) and the
 * read-only queries are replaced. The 422 body is the one `practice-canonical.ts` sends for
 * an empty pool (`error: "empty_pool"`, `code: "PRACTICE_POOL_EMPTY"`, plus `requestId`
 * from the route wrapper), so the page sees exactly what the server emits.
 * expected outcome: (1) no "in bank", "Question Bank", "questions available" or
 * "Found N" text and no request to `/api/questions/stats`; (2) clicking a section after a
 * 422 PRACTICE_POOL_EMPTY shows "No questions match these filters" and no count.
 * edge cases: presence before absence — the page must have rendered its section buttons
 * and the Domain Library's domains before the no-count assertions run.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { practiceTopicsResponseSchema } from "@lyceon/shared/practice-reference-schema";

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/practice", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "ui07-student", role: "student" },
    authLoading: false,
  }),
}));

vi.mock("@/hooks/useActiveSessions", () => ({
  useActiveSessions: () => ({
    sessions: [],
    maxConcurrentSessions: 5,
    terminateSession: vi.fn(),
    isTerminating: false,
  }),
}));

vi.mock("@/features/calendar/api", () => ({
  useStreak: () => ({ data: undefined }),
}));

vi.mock("@/components/diagnostic/DiagnosticCTAGate", () => ({
  DiagnosticCTAGate: () => null,
}));

vi.mock("@/components/billing/PremiumUpgradePrompt", () => ({
  PremiumUpgradePrompt: () => <div>upgrade</div>,
}));

/**
 * The topics body, validated against the strict shared schema so this fixture cannot
 * drift from what `GET /api/practice/topics` is contracted to return.
 */
const TOPICS = practiceTopicsResponseSchema.parse({
  sections: [
    {
      section: "M",
      label: "Math",
      domains: [
        { domain: "Algebra", skills: ["M.ALG.LIN", "M.ALG.SYS"] },
        { domain: "Advanced Math", skills: ["M.ADV.QUAD"] },
      ],
    },
    {
      section: "RW",
      label: "Reading and Writing",
      domains: [{ domain: "Craft and Structure", skills: ["RW.CAS.WIC"] }],
    },
  ],
});

/** A bank-stats body, served if (and only if) the page still asks for it. */
const STATS = {
  total: 327,
  math: 180,
  reading_writing: 147,
  byDifficulty: { easy: 100, medium: 150, hard: 77 },
  recentlyAdded: 0,
};

const queryState = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = String(queryKey[0]);
      queryState.keys.push(key);
      const data =
        key === "/api/practice/topics"
          ? TOPICS
          : key === "/api/questions/stats"
            ? STATS
            : undefined;
      return {
        data,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    },
  };
});

/** The empty-pool body practice-canonical.ts returns, plus the route's requestId. */
const EMPTY_POOL_BODY = {
  error: "empty_pool",
  code: "PRACTICE_POOL_EMPTY",
  message: "No questions match the requested filters.",
  requestId: "req-ui07",
};

const csrfFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/csrf", () => ({ csrfFetch: csrfFetchMock }));

import Practice from "./practice";

const BANK_COUNT_TEXT =
  /in bank|question bank|questions available|questions match|found \d+|\d+\s+questions?\b/i;

describe("Practice page (UI-07)", () => {
  beforeEach(() => {
    queryState.keys.length = 0;
    csrfFetchMock.mockReset();
    csrfFetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify(EMPTY_POOL_BODY), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
    );
  });

  it("renders no question-bank count and never asks for bank stats", () => {
    const { container } = render(<Practice />);

    // Presence before absence: the section buttons and Domain Library rendered.
    expect(screen.getByTestId("button-practice-math")).toBeTruthy();
    expect(screen.getByTestId("button-practice-reading")).toBeTruthy();
    expect(screen.getAllByText(/Algebra/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Craft and Structure/).length).toBeGreaterThan(
      0,
    );

    const text = container.textContent ?? "";
    expect(text).not.toMatch(BANK_COUNT_TEXT);
    // Per-domain skill tallies ("Algebra · 2") are gone too.
    expect(text).not.toMatch(/·\s*\d+/);
    expect(queryState.keys).not.toContain("/api/questions/stats");
  });

  it('shows "No questions match these filters" when session start returns 422 PRACTICE_POOL_EMPTY', async () => {
    const { container } = render(<Practice />);

    fireEvent.click(screen.getByTestId("button-practice-math"));

    await waitFor(() =>
      expect(screen.getByText("No questions match these filters")).toBeTruthy(),
    );
    expect(csrfFetchMock).toHaveBeenCalledWith(
      "/api/practice/sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByText("Something went wrong.")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/\d+\s+questions?\b/i);
  });
});
