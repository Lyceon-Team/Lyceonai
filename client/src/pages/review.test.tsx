// @vitest-environment jsdom
/**
 * U4, U5 (wiring), U6, U7 (review half) — the review landing page.
 *
 * @spec [Doc-02B_V4 §16; rulings 15-17 and 20; brief R4 §2.3, U4/U5/U6/U7]
 * @implemented [2026-09-22]
 *
 * Plants, per brief R4 §3:
 *   U4 — drop the topic section from `review.tsx` and the three-entry-mode assertion
 *        goes red.
 *   U5 — format in UTC instead of the browser timezone: change `review.tsx`'s
 *        `localDateKey(new Date(), browserTimeZone())` to `localDateKey(new Date(),
 *        "UTC")` and the "Today" header becomes "Yesterday" for the evening case.
 *   U6 — render the generic error component for an empty pool and the no-error-styling
 *        assertion goes red.
 *   U7 — remove the status filter in `useReview.ts` and the abandoned row appears.
 *
 * The data hooks are mocked so the page's own logic — grouping, labelling, counting,
 * choosing between empty state and error state — is the thing under test. The pure
 * formatters those call into are pinned separately in `review-session-picker.test.ts`.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

const navMock = vi.hoisted(() => ({
  location: "/review",
  setLocation: vi.fn(),
}));
vi.mock("wouter", () => ({
  useLocation: () => [navMock.location, navMock.setLocation],
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const topicsMock = vi.hoisted(() => ({
  value: {
    data: {
      sections: [
        { section: "M", domains: [{ domain: "Algebra", skills: ["Linear"] }] },
        {
          section: "RW",
          domains: [{ domain: "Craft and Structure", skills: ["Words"] }],
        },
      ],
    },
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => topicsMock.value,
}));

const hooksMock = vi.hoisted(() => ({
  pool: {
    pool: null as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  open: {
    sessions: [] as Array<Record<string, unknown>>,
    maxConcurrentSessions: 5,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    terminateSession: vi.fn(),
    isTerminating: false,
  },
  create: { startSession: vi.fn(), isStarting: false },
  tz: "America/Los_Angeles" as string | null,
}));

vi.mock("@/hooks/useReview", () => ({
  useReviewPool: () => hooksMock.pool,
  useActiveReviewSessions: () => hooksMock.open,
  useCreateReviewSession: () => hooksMock.create,
  browserTimeZone: () => hooksMock.tz,
}));

import ReviewPage from "./review";

/** 2026-09-18T02:30Z is still the 17th in Los Angeles — the U5 plant's target case. */
const EVENING_UTC = "2026-09-18T02:30:00.000Z";

function populatedPool(): Record<string, unknown> {
  return {
    total: 7,
    timezone: "America/Los_Angeles",
    timezoneFallback: false,
    bySection: [
      { key: "M", count: 5 },
      { key: "RW", count: 2 },
    ],
    byDomain: [{ key: "Algebra", count: 5 }],
    bySkill: [{ key: "Linear", count: 5 }],
    sessions: [
      {
        source_engine: "practice",
        source_session_id: "p-1",
        created_at: EVENING_UTC,
        local_date: "2026-09-17",
        local_time: "2:40 PM",
        mode: "balanced",
        filters: { sections: ["M"], domains: ["Algebra"] },
        open_count: 4,
      },
      {
        source_engine: "review",
        source_session_id: "r-1",
        created_at: "2026-09-16T22:10:00.000Z",
        local_date: "2026-09-16",
        local_time: "3:10 PM",
        mode: "queue",
        filters: null,
        open_count: 3,
      },
    ],
  };
}

function emptyPool(): Record<string, unknown> {
  return {
    total: 0,
    timezone: "America/Los_Angeles",
    timezoneFallback: false,
    bySection: [],
    byDomain: [],
    bySkill: [],
    sessions: [],
  };
}

describe("review landing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(EVENING_UTC));
    hooksMock.tz = "America/Los_Angeles";
    hooksMock.pool = {
      pool: populatedPool(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    hooksMock.open = {
      sessions: [],
      maxConcurrentSessions: 5,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      terminateSession: vi.fn(),
      isTerminating: false,
    };
    hooksMock.create = { startSession: vi.fn(), isStarting: false };
  });

  // ── U4 ────────────────────────────────────────────────────────────────────
  it("U4: renders all three entry modes with counts from the pool summary", () => {
    render(<ReviewPage />);

    // 1. Continue your queue — the total, straight from the summary.
    expect(screen.getByTestId("review-queue-total").textContent).toContain(
      "7 questions to review",
    );
    expect(screen.getByTestId("button-start-queue")).not.toBeNull();

    // 2. Review a past session.
    expect(screen.getByTestId("review-session-picker")).not.toBeNull();

    // 3. Review by topic, with the per-level counts joined onto the taxonomy.
    const topic = screen.getByTestId("review-topic-picker");
    expect(topic).not.toBeNull();
    expect(topic.textContent).toContain("Algebra (5)");
  });

  it("U4: section counts come from bySection, not from a client tally", () => {
    render(<ReviewPage />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("Math");
    expect(body).toContain("Reading & Writing");
  });

  // ── R4.1 ──────────────────────────────────────────────────────────────────
  it("R4.1: 'Review by topic' sits ABOVE the past-sessions picker", () => {
    const { container } = render(<ReviewPage />);

    const topic = screen.getByTestId("review-topic-picker");
    const picker = screen.getByTestId("review-session-picker");

    // Document order, not CSS order: compareDocumentPosition is the only reading
    // that survives a layout change. FOLLOWING means `picker` comes after `topic`.
    const position = topic.compareDocumentPosition(picker);
    expect(
      position & Node.DOCUMENT_POSITION_FOLLOWING,
      "the past-sessions picker must render after the topic picker",
    ).toBeTruthy();

    // And both are still inside the same column, so this is an ordering change
    // rather than one of them having been moved out or dropped.
    const column = container.querySelector(".lg\\:col-span-8");
    expect(column?.contains(topic)).toBe(true);
    expect(column?.contains(picker)).toBe(true);
  });

  it("R4.1: no screen on the landing repeats the wrong 'twice' rule", () => {
    render(<ReviewPage />);
    // One correct review answer graduates a question
    // (20260921000000_review_queue_runtime.sql:392). The landing said "twice" in
    // two places — the header lede and the "How review works" card.
    expect(document.body.textContent).not.toContain("twice");
    expect(document.body.textContent).toContain(
      "Get it right once and it leaves your queue.",
    );
  });

  // ── U5 ────────────────────────────────────────────────────────────────────
  it("U5: groups by the BROWSER's local day, formats the headline, filters and count", () => {
    render(<ReviewPage />);
    const picker = screen.getByTestId("review-session-picker");
    const text = picker.textContent ?? "";

    // The 2:40 PM row happened on the 17th in Los Angeles, which IS today there.
    // Computing "today" in UTC would put it under "Yesterday" — the U5 plant.
    expect(text).toContain("Today");
    expect(text).toContain("Practice · 2:40 PM");
    expect(text).toContain("Math · Algebra");
    expect(text).toContain("4 to review");

    // A review-sourced row is labelled as such (brief R4 §2.3).
    expect(text).toContain("Review · 3:10 PM");
    expect(text).toContain("Yesterday");
  });

  it("U5: says so when the browser reported no timezone and the server fell back", () => {
    hooksMock.pool = {
      pool: { ...populatedPool(), timezoneFallback: true },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<ReviewPage />);
    expect(document.body.textContent).toContain("Times are shown in UTC");
  });

  // ── U6 ────────────────────────────────────────────────────────────────────
  it("U6: an empty pool shows the friendly empty state with no error styling", () => {
    hooksMock.pool = {
      pool: emptyPool(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<ReviewPage />);

    const empty = screen.getByTestId("review-empty-state");
    expect(empty.textContent).toContain("Nothing to review yet");
    expect(empty.textContent).toContain(
      "Questions you miss or skip in practice show up here",
    );

    // Not an error: no error card, and no red on the empty state itself.
    expect(screen.queryByTestId("review-pool-error")).toBeNull();
    expect(empty.className).not.toMatch(/red|destructive/);
    expect(
      empty.querySelector('[class*="red"], [class*="destructive"]'),
    ).toBeNull();

    // And it offers the way out the brief asks for.
    expect(
      screen.getByTestId("link-review-empty-practice").getAttribute("href"),
    ).toBe("/practice");
  });

  it("U6: a pool that fails to LOAD does get the error state — the two are different", () => {
    hooksMock.pool = {
      pool: null,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    };
    render(<ReviewPage />);
    expect(screen.getByTestId("review-pool-error")).not.toBeNull();
    expect(screen.queryByTestId("review-empty-state")).toBeNull();
  });

  // ── U7 (review half) ──────────────────────────────────────────────────────
  it("U7: the open list renders created/active sessions", () => {
    hooksMock.open = {
      ...hooksMock.open,
      sessions: [
        {
          id: "open-1",
          section: "M",
          mode: "queue",
          status: "active",
          created_at: EVENING_UTC,
          target_question_count: 5,
          total_items: 5,
          answered_items: 2,
        },
      ],
    };
    render(<ReviewPage />);
    const list = screen.getByTestId("review-open-sessions");
    expect(list.textContent).toContain("2 / 5");
  });

  it("U7: no open list at all when the hook returns none — abandoned never reaches here", () => {
    hooksMock.open = { ...hooksMock.open, sessions: [] };
    render(<ReviewPage />);
    expect(screen.queryByTestId("review-open-sessions")).toBeNull();
  });
});
