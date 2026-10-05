// @vitest-environment jsdom
/**
 * G5-05 — the Dashboard holds the design's four blocks and nothing else (ruling R13).
 *
 * @spec [Guardian_Closure_Plan G5-05, R13 (Karl, 2026-10-02); the canvas boards "Wave 5 — BUILD
 *       TARGET"] | @implemented [2026-10-02]
 *
 * plain English: the real app at `/guardian/:id` over the shared scenario. Presence first: the
 * score strip, this week's plan, the mastery card and the latest-test card all render, in that
 * order. Then absence: the old flat header strip (the calendar's `HeaderFacts` readouts) and
 * the embedded full report — its own title, its total, its score tabs, its domain bars and its
 * "See all results" link — are gone. The full report stays one click away, on the detail page.
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADA, mountApp, net, roster, serveDashboard } from "./test-harness";

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
  net.handlers.push(serveDashboard(ADA));
});
afterEach(cleanup);

async function dashboard(): Promise<HTMLElement> {
  mountApp(Router, `/guardian/${ADA}`);
  await screen.findByTestId("score-strip");
  await screen.findByTestId("mastery-card");
  await screen.findByTestId("latest-test-meta");
  return screen.getByTestId("guardian-dashboard-tab");
}

describe("G5-05 the Dashboard is the design's four blocks", () => {
  it("score strip, week plan, mastery, latest test — in that order", async () => {
    const root = await dashboard();
    const order = [
      "score-strip",
      "week-plan",
      "mastery-card",
      "latest-test-card",
    ].map((id) => {
      const el = root.querySelector(`[data-testid="${id}"]`);
      if (el === null) throw new Error(`missing ${id}`);
      return el;
    });
    for (let i = 1; i < order.length; i += 1) {
      const before = order[i - 1]!;
      expect(
        before.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("no flat header strip and no embedded report", async () => {
    const root = await dashboard();
    expect(root.querySelector('[data-testid="header-facts"]')).toBeNull();
    expect(root.querySelector(".lyceon-calendar")).toBeNull();
    expect(root.querySelector('[data-testid="dashboard-exam"]')).toBeNull();
    expect(root.querySelector('[data-testid="dashboard-exam-all"]')).toBeNull();
    expect(root.querySelector('[data-testid="exam-total-score"]')).toBeNull();
    expect(root.querySelector(".exam-root")).toBeNull();
    expect(root).not.toHaveTextContent("See all results");
    // The full report is still one click away.
    expect(
      screen.getByRole("link", { name: "See full report →" }),
    ).toBeTruthy();
  });
});
