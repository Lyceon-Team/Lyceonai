// @vitest-environment jsdom
/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 3; DESIGN.md §5 (one
 *        filled primary; empty/loading/error states); Coding Standards §10 (a mastery change is
 *        shown only when the server reports one)] | @implemented [2026-10-13]
 *
 * plain English: the summary screen against summaries parsed with the strict shared schema (the
 * same schema `tests/ci/session-summary.pg.ci.test.ts` proves the real routes satisfy):
 *   - every figure is drawn from the body: score with skips, the streak kept, the queue line, and
 *     the mastery change as the server's level names;
 *   - no mastery line at all when the server reports none (empty) or the plan has none (null);
 *   - one filled primary: "Review misses" with misses, else "Another 5";
 *   - "Review misses" starts a review of THIS session's queued questions; "Another 5" starts a
 *     5-question session with this session's criteria (practice) or pool (review), and each
 *     navigates to the new session;
 *   - loading and error states.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  sessionSummarySchema,
  type SessionSummary as Summary,
} from "@lyceon/shared/session-summary-schema";
import { SessionSummary } from "./SessionSummary";

const SESSION = "11111111-1111-4111-8111-111111111111";
const NEW_SESSION = "22222222-2222-4222-8222-222222222222";

const net = vi.hoisted(() => ({
  summary: null as unknown,
  summaryStatus: 200,
  calls: [] as Array<{ url: string; body: unknown }>,
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: { id: "u1", role: "student" },
    authLoading: false,
  }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async (url: string, options?: { body?: string }) => {
    net.calls.push({
      url,
      body: options?.body ? (JSON.parse(options.body) as unknown) : null,
    });
    if (url.endsWith("/summary")) {
      if (net.summaryStatus !== 200) throw new Error("500: summary failed");
      return jsonResponse(200, { data: net.summary });
    }
    if (url === "/api/practice/sessions")
      return jsonResponse(200, { sessionId: NEW_SESSION });
    throw new Error(`unexpected ${url}`);
  }),
}));
vi.mock("@/lib/csrf", () => ({
  csrfFetch: vi.fn(async (url: string, init?: { body?: string }) => {
    net.calls.push({
      url,
      body: init?.body ? (JSON.parse(init.body) as unknown) : null,
    });
    return jsonResponse(200, { sessionId: NEW_SESSION });
  }),
}));

function practiceSummary(over: Partial<Record<string, unknown>> = {}): Summary {
  return sessionSummarySchema.parse({
    engine: "practice",
    sessionId: SESSION,
    state: "completed",
    answered: 5,
    correct: 4,
    skipped: 1,
    sent_to_review: 2,
    streak: { current: 3, today_done: true, broken: false },
    mastery: {
      access: "granted",
      changes: [
        {
          section: "M",
          domain: "Algebra",
          skill: "Linear equations in one variable",
          before: {
            levelKey: "unmeasured",
            level: null,
            displayName: "Not enough answers yet",
          },
          after: { levelKey: "L1", level: 1, displayName: "Building" },
        },
      ],
    },
    again: {
      criteria: {
        sections: ["M"],
        domains: ["Algebra"],
        skills: [],
        difficulties: [],
      },
    },
    ...over,
  });
}

let location: ReturnType<typeof memoryLocation>;

function renderSummary(engine: "practice" | "review"): void {
  location = memoryLocation({
    path: `/${engine}/session/${SESSION}`,
    record: true,
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async () => ({ sessions: [], maxConcurrentSessions: 5 }),
      },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <div className="lyc">
          <SessionSummary engine={engine} sessionId={SESSION} title="Algebra" />
        </div>
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.summary = practiceSummary();
  net.summaryStatus = 200;
  net.calls = [];
});
afterEach(cleanup);

function primaries(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid="session-summary"] .bg-lyc-primary-bg',
    ),
  );
}

describe("P0-3: the session summary", () => {
  it("draws the server's figures: score, streak kept, sent to review, the recorded mastery change", async () => {
    renderSummary("practice");
    const score = await screen.findByTestId("session-summary-score");
    expect(score.textContent).toBe("4 of 5 correct · 1 skipped");
    expect(screen.getByTestId("session-summary-streak").textContent).toBe(
      "🔥 3-day streak, kept today",
    );
    expect(screen.getByTestId("session-summary-review").textContent).toBe(
      "2 questions sent to review",
    );
    const row = screen.getByTestId("session-summary-mastery-row");
    expect(row.getAttribute("aria-label")).toBe(
      "Linear equations in one variable: Not enough answers yet to Building",
    );
    const pills = within(row).getAllByTestId("level-pill");
    expect(pills.map((p) => p.getAttribute("data-level-key"))).toEqual([
      "unmeasured",
      "L1",
    ]);
    expect(pills.map((p) => p.textContent)).toEqual([
      "Not enough answers yet",
      "Building",
    ]);
  });

  it("paid with no recorded change: no mastery line at all, and not the locked line", async () => {
    net.summary = practiceSummary({
      mastery: { access: "granted", changes: [] },
    });
    renderSummary("practice");
    await screen.findByTestId("session-summary-score");
    expect(screen.queryByTestId("session-summary-mastery")).toBeNull();
    expect(screen.queryByTestId("session-summary-mastery-locked")).toBeNull();
    expect(screen.queryByText("Mastery")).toBeNull();
  });

  it("paid with a recorded change: the change, and not the locked line (ruling 2026-10-15 item 3)", async () => {
    renderSummary("practice");
    expect(
      await screen.findByTestId("session-summary-mastery-row"),
    ).toBeTruthy();
    expect(screen.queryByTestId("session-summary-mastery-locked")).toBeNull();
    expect(document.body.textContent).not.toContain("included with paid plans");
  });

  it("free (the server says locked): one muted line to the plans page, and no level at all (ruling 2026-10-15 item 3)", async () => {
    net.summary = practiceSummary({ mastery: { access: "locked" } });
    renderSummary("practice");
    const locked = await screen.findByTestId("session-summary-mastery-locked");
    expect(locked.textContent).toBe(
      "Track how this moves your mastery — included with paid plans",
    );
    expect(locked.tagName).toBe("A");
    expect(locked.getAttribute("href")).toBe("/profile?tab=billing");
    expect(locked.className.split(/\s+/)).toContain("text-lyc-muted");
    // A link, not a modal and not a filled button.
    expect(locked.className).not.toContain("bg-lyc-primary-bg");
    expect(screen.queryByTestId("level-pill")).toBeNull();
    expect(screen.queryByTestId("session-summary-mastery")).toBeNull();
    fireEvent.click(locked);
    await waitFor(() =>
      expect(location.history?.at(-1)).toBe("/profile?tab=billing"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no streak line when the streak is unknown", async () => {
    net.summary = practiceSummary({ streak: null });
    renderSummary("practice");
    await screen.findByTestId("session-summary-score");
    expect(screen.queryByTestId("session-summary-streak")).toBeNull();
  });

  it("one filled primary: Review misses with misses; it reviews THIS session and goes there", async () => {
    renderSummary("practice");
    const misses = await screen.findByTestId("session-summary-review-misses");
    expect(primaries()).toEqual([misses]);
    expect(screen.getByTestId("session-summary-another").className).toContain(
      "border-lyc-ink-strong",
    );
    fireEvent.click(misses);
    await waitFor(() =>
      expect(location.history?.at(-1)).toBe(`/review/session/${NEW_SESSION}`),
    );
    const call = net.calls.find((c) => c.url === "/api/review/sessions");
    expect(call?.body).toMatchObject({
      mode: "session",
      filters: { source_engine: "practice", source_session_id: SESSION },
    });
  });

  it("Another 5 (practice): a 5-question session with this session's criteria", async () => {
    renderSummary("practice");
    fireEvent.click(await screen.findByTestId("session-summary-another"));
    await waitFor(() =>
      expect(location.history?.at(-1)).toBe(`/practice/session/${NEW_SESSION}`),
    );
    const call = net.calls.find((c) => c.url === "/api/practice/sessions");
    expect(call?.body).toMatchObject({
      target_question_count: 5,
      sections: ["M"],
      domains: ["Algebra"],
    });
  });

  it("with nothing sent to review, Another 5 is the one primary and there is no Review misses", async () => {
    net.summary = practiceSummary({
      sent_to_review: 0,
      correct: 5,
      skipped: 0,
    });
    renderSummary("practice");
    const another = await screen.findByTestId("session-summary-another");
    expect(screen.queryByTestId("session-summary-review-misses")).toBeNull();
    expect(primaries()).toEqual([another]);
    expect(screen.getByTestId("session-summary-review").textContent).toBe(
      "Nothing sent to review",
    );
  });

  it("review: Another 5 starts the same pool with target_count 5", async () => {
    net.summary = sessionSummarySchema.parse({
      ...practiceSummary(),
      engine: "review",
      sent_to_review: 1,
      again: { mode: "queue" },
    });
    renderSummary("review");
    expect(
      (await screen.findByTestId("session-summary-review")).textContent,
    ).toBe("1 question back in your review queue");
    fireEvent.click(screen.getByTestId("session-summary-another"));
    await waitFor(() =>
      expect(location.history?.at(-1)).toBe(`/review/session/${NEW_SESSION}`),
    );
    const call = net.calls.find((c) => c.url === "/api/review/sessions");
    expect(call?.body).toMatchObject({ mode: "queue", target_count: 5 });
  });

  it("loading, then an error state with Try again", async () => {
    net.summaryStatus = 500;
    renderSummary("practice");
    expect(screen.getByTestId("session-summary-loading")).toBeTruthy();
    expect(await screen.findByTestId("session-summary-error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("the score's words: every question skipped, and no skips", async () => {
    net.summary = practiceSummary({
      answered: 0,
      correct: 0,
      skipped: 5,
      mastery: { access: "granted", changes: [] },
    });
    renderSummary("practice");
    expect(
      (await screen.findByTestId("session-summary-score")).textContent,
    ).toBe("No questions answered · 5 skipped");
    cleanup();
    net.summary = practiceSummary({ answered: 5, correct: 5, skipped: 0 });
    renderSummary("practice");
    expect(
      (await screen.findByTestId("session-summary-score")).textContent,
    ).toBe("5 of 5 correct");
  });
});
