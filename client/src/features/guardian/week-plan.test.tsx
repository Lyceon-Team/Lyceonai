// @vitest-environment jsdom
/**
 * G5-02 — the Dashboard's "This week's plan" card (ruling R13).
 *
 * @spec [Guardian_Closure_Plan G5-02, R13 (Karl, 2026-10-02); the canvas boards "Wave 5 — BUILD
 *       TARGET"] | @implemented [2026-10-02]
 *
 * plain English: ESTABLISHED FIRST — planned and completed for the current week are the
 * calendar payload's `facts.blocks_total` and `facts.blocks_completed` for the week the
 * Calendar tab shows (`rangeForView("week", startOfWeek(today))`). `factsOf` derives both from
 * the very blocks the calendar draws, and the Calendar footer's "N blocks complete" is that
 * same `blocks_completed`. So the first case mounts both tabs over the shared scenario's REAL
 * week and holds the Dashboard's count to the footer's. Then: one bar segment per planned
 * session with the completed ones filled; above 20 planned sessions, one continuous bar
 * instead; no sessions planned, no bar.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  calendarWeek,
  json,
  mountApp,
  net,
  roster,
  serveDashboard,
} from "./test-harness";

vi.mock("@/contexts/SupabaseAuthContext", async () => {
  const { GUARDIAN_AUTH: auth } = await import("./test-harness");
  return {
    useSupabaseAuth: () => ({ ...auth, signOut: vi.fn(async () => undefined) }),
  };
});
vi.mock("@/lib/csrf", async () => {
  const { scriptedFetch: fetcher } = await import("./test-harness");
  return {
    getCsrfToken: vi.fn(async () => "t"),
    clearCsrfToken: vi.fn(),
    csrfFetch: vi.fn(fetcher),
  };
});

const { Router } = await import("@/App");

beforeEach(() => {
  net.reset();
  net.roster = roster([{ id: ADA, name: "Ada" }]);
});
afterEach(cleanup);

function serve(calendar?: Record<string, unknown>): void {
  if (calendar !== undefined) {
    net.handlers.push((url) =>
      url.startsWith(`/api/students/${ADA}/calendar?`)
        ? json(calendar)
        : undefined,
    );
  }
  net.handlers.push(serveDashboard(ADA));
}

async function planCard(): Promise<HTMLElement> {
  mountApp(Router, `/guardian/${ADA}`);
  return screen.findByTestId("week-plan");
}

describe("G5-02 this week's plan", () => {
  it("counts the same week the Calendar footer counts", async () => {
    serve();
    const facts = (
      calendarWeek() as {
        facts: { blocks_completed: number; blocks_total: number };
      }
    ).facts;
    // Presence first: the scenario's week has planned sessions to count.
    expect(facts.blocks_total).toBeGreaterThan(0);

    const card = await planCard();
    expect(card).toHaveTextContent(
      `${facts.blocks_completed} of ${facts.blocks_total} sessions done`,
    );
    cleanup();

    mountApp(Router, `/guardian/${ADA}/calendar`);
    const footer = await screen.findByTestId("calendar-facts");
    expect(footer).toHaveTextContent(
      `${facts.blocks_completed} blocks complete`,
    );
  });

  it("one segment per planned session, the completed ones filled", async () => {
    serve(calendarWeek({ completed: 2, total: 15 }));
    const card = await planCard();
    expect(card).toHaveTextContent("This week's plan");
    expect(card).toHaveTextContent("2 of 15 sessions done");
    const segments = within(card).getAllByTestId("week-plan-segment");
    expect(segments).toHaveLength(15);
    expect(segments.map((s) => s.getAttribute("data-done")).join(",")).toBe(
      ["true", "true", ...Array(13).fill("false")].join(","),
    );
    expect(within(card).queryByTestId("week-plan-bar")).toBeNull();
  });

  it("above 20 planned sessions: one continuous bar, no segments", async () => {
    serve(calendarWeek({ completed: 6, total: 24 }));
    const card = await planCard();
    expect(card).toHaveTextContent("6 of 24 sessions done");
    expect(within(card).queryAllByTestId("week-plan-segment")).toHaveLength(0);
    const fill = within(card).getByTestId("week-plan-bar-fill");
    expect(fill.style.width).toBe("25%");
  });

  it("exactly 20 planned sessions still draws segments", async () => {
    serve(calendarWeek({ completed: 20, total: 20 }));
    const card = await planCard();
    expect(within(card).getAllByTestId("week-plan-segment")).toHaveLength(20);
  });

  it("no sessions planned this week: says so, draws no bar", async () => {
    serve(calendarWeek({ completed: 0, total: 0 }));
    const card = await planCard();
    expect(card).toHaveTextContent("No sessions planned this week");
    expect(within(card).queryAllByTestId("week-plan-segment")).toHaveLength(0);
    expect(within(card).queryByTestId("week-plan-bar")).toBeNull();
  });
});
