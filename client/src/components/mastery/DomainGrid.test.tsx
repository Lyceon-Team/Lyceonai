// @vitest-environment jsdom
/**
 * `DomainGrid` always draws the eight canonical domains, four per section.
 *
 * @spec [Guardian_Closure_Plan G4-03, R11; owner decision 2026-10-01 on #1003 ("DomainGrid
 *       always shows the 8 domains, 4 per section. A domain with no row shows 'Not enough
 *       answers yet'")] | @implemented [2026-10-01]
 *
 * plain English: the grid is driven by the canonical domain list, not by the rows it is
 * handed. A served row keeps its own level and the server's words; a domain with no row is a
 * card reading "Not enough answers yet" — never missing. With `sections`, only that
 * section's four are drawn (the guardian Dashboard draws one grid per section).
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/canonical-domains";
import { UNMEASURED_DISPLAY_NAME } from "@lyceon/shared/mastery-levels";
import { DomainGrid } from "./DomainGrid";

afterEach(cleanup);

/** Four rows — two per section — as a student part-way through their first week has. */
const FOUR = [
  {
    section: "RW" as const,
    domain: "Craft and Structure",
    levelKey: "L3" as const,
    level: 3,
    displayName: "Proficient",
  },
  {
    section: "RW" as const,
    domain: "Expression of Ideas",
    levelKey: "L1" as const,
    level: 1,
    displayName: "Building",
  },
  {
    section: "M" as const,
    domain: "Algebra",
    levelKey: "L4" as const,
    level: 4,
    displayName: "Strong",
  },
  {
    section: "M" as const,
    domain: "Geometry and Trigonometry",
    levelKey: "L0" as const,
    level: 0,
    displayName: "Foundations",
  },
];

function cards(
  container: HTMLElement,
): { domain: string; pill: string; key: string }[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-domain]"),
  ).map((card) => {
    const pill = within(card).getByTestId("level-pill");
    return {
      domain: card.dataset.domain ?? "",
      pill: pill.textContent ?? "",
      key: pill.dataset.levelKey ?? "",
    };
  });
}

describe("DomainGrid — all eight domains", () => {
  it("four rows still draw all eight, four per section, in canonical order", () => {
    const { container } = render(<DomainGrid domains={FOUR} />);
    const drawn = cards(container);
    expect(drawn.map((c) => c.domain)).toEqual([
      ...CANONICAL_DOMAINS_BY_SECTION.M,
      ...CANONICAL_DOMAINS_BY_SECTION.RW,
    ]);
    expect(drawn).toHaveLength(8);
    // A served row keeps its own level and the server's words.
    for (const row of FOUR) {
      const card = drawn.find((c) => c.domain === row.domain);
      expect(card).toEqual({
        domain: row.domain,
        pill: row.displayName,
        key: row.levelKey,
      });
    }
    // A domain with no row reads "Not enough answers yet", as the unmeasured state.
    const missing = drawn.filter(
      (c) => !FOUR.some((r) => r.domain === c.domain),
    );
    expect(missing).toHaveLength(4);
    for (const card of missing) {
      expect(card.pill).toBe("Not enough answers yet");
      expect(card.key).toBe("unmeasured");
    }
  });

  it("no rows at all: eight unmeasured cards, not an empty grid", () => {
    const { container } = render(<DomainGrid domains={[]} />);
    const drawn = cards(container);
    expect(drawn).toHaveLength(8);
    expect(new Set(drawn.map((c) => c.pill))).toEqual(
      new Set([UNMEASURED_DISPLAY_NAME]),
    );
  });

  it("with `sections`, draws that section's four only", () => {
    const { container } = render(
      <DomainGrid domains={FOUR} sections={["RW"]} />,
    );
    expect(cards(container).map((c) => c.domain)).toEqual([
      ...CANONICAL_DOMAINS_BY_SECTION.RW,
    ]);
  });

  it("the unmeasured name is the `mastery_levels` seed row's, word for word", async () => {
    const fs = await import("node:fs");
    const seed = fs.readFileSync(
      "supabase/migrations/20260820000000_mastery_levels.sql",
      "utf8",
    );
    expect(seed).toContain(
      `('unmeasured', NULL, '${UNMEASURED_DISPLAY_NAME}', 0)`,
    );
  });
});
