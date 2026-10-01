// @vitest-environment jsdom
/**
 * G4-07 — mastery levels get distinct colours on the guardian Dashboard, from `LevelPill`.
 *
 * @spec [Guardian_Closure_Plan G4-07 ("Mastery levels get distinct colours rather than
 *       monochrome"); binding input: labels from `mastery_levels`, colours from `LevelPill`]
 * | @implemented [2026-09-30]
 *
 * plain English: (1) every one of the six level keys the shared schema allows maps to its own
 * tone — no two levels share one; (2) the guardian Dashboard draws each served domain with
 * the shared `LevelPill` in that tone and the server's own label, not a guardian-local
 * colour or name. Presence first: the served levels are on the page before their tones are
 * compared.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { masteryLevelKeySchema } from "@lyceon/shared/mastery-levels";
import { levelTone } from "@/components/mastery/LevelPill";
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

describe("G4-07 mastery level colours", () => {
  it("gives each of the six levels its own tone", () => {
    const keys = masteryLevelKeySchema.options;
    expect(keys).toHaveLength(6);
    const tones = keys.map((k) => levelTone(k));
    expect(new Set(tones).size).toBe(keys.length);
  });

  it("draws the Dashboard's levels with LevelPill, in its tone and the server's words", async () => {
    mountApp(Router, `/guardian/${ADA}`);
    const grids = await screen.findAllByTestId("domain-grid");
    const pills = grids.flatMap((g) => within(g).getAllByTestId("level-pill"));
    const served = (
      masteryDomains() as {
        domains: { domain: string; levelKey: string; displayName: string }[];
      }
    ).domains;
    // All eight domains are drawn (owner decision 2026-10-01); each SERVED one is read on
    // its own card.
    expect(pills).toHaveLength(8);
    for (const want of served) {
      const card = grids
        .map((g) =>
          g.querySelector<HTMLElement>(`[data-domain="${want.domain}"]`),
        )
        .find((c) => c !== null);
      expect(card).toBeTruthy();
      const pill = within(card!).getByTestId("level-pill");
      expect(pill.dataset.levelKey).toBe(want.levelKey);
      expect(pill.textContent).toBe(want.displayName);
      const key = masteryLevelKeySchema.parse(want.levelKey);
      for (const cls of levelTone(key).split(" ")) {
        expect(pill.classList.contains(cls)).toBe(true);
      }
    }
    // More than one tone on screen: the served levels differ, so the colours must.
    expect(new Set(pills.map((p) => p.dataset.levelKey)).size).toBeGreaterThan(
      1,
    );
  });
});
