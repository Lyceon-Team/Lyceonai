// @vitest-environment jsdom
/**
 * The guardian Dashboard draws all eight domains, four per section, whatever rows it is served.
 *
 * @spec [Guardian_Closure_Plan G4-03, R11; owner decision 2026-10-01 on #1003] | @implemented [2026-10-01]
 *
 * plain English: the harness serves the student's mastery with only four domain rows (two per
 * section) through the shared schema. The Dashboard still draws two grids of four cards each,
 * and each of the four missing domains reads "Not enough answers yet".
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADA,
  masteryDomains,
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
  net.handlers.push(serveDashboard(ADA));
});
afterEach(cleanup);

describe("guardian Dashboard — all eight domains", () => {
  it("four served rows still draw eight cards, four per section", async () => {
    // The precondition, asserted rather than assumed: the payload really has four rows.
    const served = (masteryDomains() as { domains: { domain: string }[] })
      .domains;
    expect(served).toHaveLength(4);

    mountApp(Router, `/guardian/${ADA}`);
    const grids = await screen.findAllByTestId("domain-grid");
    expect(grids.map((g) => g.children.length)).toEqual([4, 4]);
    const pills = grids.flatMap((g) =>
      Array.from(g.querySelectorAll("[data-testid='level-pill']")),
    );
    expect(
      pills.filter((p) => p.textContent === "Not enough answers yet").length,
    ).toBe(
      // the four missing domains, plus any served row that is itself unmeasured
      4 +
        (
          masteryDomains() as { domains: { levelKey: string }[] }
        ).domains.filter((d) => d.levelKey === "unmeasured").length,
    );
  });
});
