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
import { cleanup, render, screen, within } from "@testing-library/react";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/canonical-domains";
import { UNMEASURED_DISPLAY_NAME } from "@lyceon/shared/mastery-levels";
import { DomainGrid } from "./DomainGrid";
import { levelFill, levelTone } from "./LevelPill";

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
    const { container } = render(
      <DomainGrid viewer="student" domains={FOUR} />,
    );
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
    const { container } = render(<DomainGrid viewer="student" domains={[]} />);
    const drawn = cards(container);
    expect(drawn).toHaveLength(8);
    expect(new Set(drawn.map((c) => c.pill))).toEqual(
      new Set([UNMEASURED_DISPLAY_NAME]),
    );
  });

  it("with `sections`, draws that section's four only", () => {
    const { container } = render(
      <DomainGrid viewer="student" domains={FOUR} sections={["RW"]} />,
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

/**
 * The five-segment mastery meter (owner review 2026-10-01, final round item 3): under each
 * card's pill, `mastery_level` 0–4 fills 1–5 segments and null ("Not enough answers yet")
 * fills 0; filled segments take the level's `--lvN-fill` token (UI-42); the meter is one labelled image
 * and its segments are hidden from screen readers. The six level names are the seed rows'
 * (`20260820000000_mastery_levels.sql`), passed in as the server sends them.
 */
describe("DomainGrid — the five-segment mastery meter", () => {
  const STATES = [
    {
      levelKey: "unmeasured" as const,
      level: null,
      displayName: UNMEASURED_DISPLAY_NAME,
      filled: 0,
    },
    {
      levelKey: "L0" as const,
      level: 0,
      displayName: "Foundations",
      filled: 1,
    },
    { levelKey: "L1" as const, level: 1, displayName: "Building", filled: 2 },
    { levelKey: "L2" as const, level: 2, displayName: "Developing", filled: 3 },
    { levelKey: "L3" as const, level: 3, displayName: "Proficient", filled: 4 },
    { levelKey: "L4" as const, level: 4, displayName: "Strong", filled: 5 },
  ];

  function meterOf(container: HTMLElement, domain: string): HTMLElement {
    const card = container.querySelector<HTMLElement>(
      `[data-domain="${domain}"]`,
    );
    if (card === null) throw new Error(`no card for ${domain}`);
    return within(card).getByTestId("mastery-meter");
  }

  it.each(STATES)(
    "$displayName (level $level) fills $filled of 5 segments, in the level's fill token",
    ({ levelKey, level, displayName, filled }) => {
      const { container } = render(
        <DomainGrid
          viewer="student"
          domains={[
            { section: "M", domain: "Algebra", levelKey, level, displayName },
          ]}
          sections={["M"]}
        />,
      );
      const meter = meterOf(container, "Algebra");
      const segments = Array.from(
        meter.querySelectorAll<HTMLElement>("[data-segment]"),
      );
      // Presence first: five segments, whatever the level.
      expect(segments).toHaveLength(5);
      const on = segments.filter((s) => s.dataset.filled === "true");
      expect(on).toHaveLength(filled);
      // Filled first, left to right.
      expect(segments.map((s) => s.dataset.filled)).toEqual(
        Array.from({ length: 5 }, (_v, i) => (i < filled ? "true" : "false")),
      );
      // UPDATED DELIBERATELY 2026-10-03 (UI-42; UI-00e: the pill colours became the level-ramp
      // tokens; DESIGN.md §1 ramp, §3 Mastery row). The meter is now the one segment renderer
      // `MasteryRow` also draws. A filled segment takes the level's `--lvN-fill` token — the
      // ramp's saturated shade, which is what the 2026-10-01 review asked for in place of the
      // pale background shade (`bg-current` over the pill's ink did that before tokens). An
      // empty one takes `--seg-empty`. The pill keeps the level's bg/ink/border tokens.
      const pill = within(
        meter.closest("[data-domain]") as HTMLElement,
      ).getByTestId("level-pill");
      for (const cls of levelTone(levelKey).split(" "))
        expect(pill.classList.contains(cls), cls).toBe(true);
      for (const seg of on)
        expect(seg.classList.contains(levelFill(levelKey))).toBe(true);
      for (const seg of segments.filter((s) => s.dataset.filled === "false"))
        expect(seg.classList.contains("bg-lyc-seg-empty")).toBe(true);
      // Full width of the card's content area: the meter stretches, each segment shares it.
      expect(meter.classList.contains("w-full")).toBe(true);
      for (const seg of segments)
        expect(seg.classList.contains("flex-1")).toBe(true);
      // Accessible: one labelled image ("level N of 5" for a measured level; the unmeasured
      // state is not a level); the segments themselves are hidden.
      expect(meter.getAttribute("role")).toBe("img");
      expect(meter.getAttribute("aria-label")).toBe(
        levelKey === "unmeasured"
          ? `Mastery: ${displayName}`
          : `Mastery: ${displayName}, level ${filled} of 5`,
      );
      for (const seg of segments)
        expect(seg.closest("[aria-hidden='true']")).not.toBeNull();
    },
  );

  it("the meter draws no text of its own, so it can never fall under the 16px floor", () => {
    const { container } = render(
      <DomainGrid viewer="student" domains={FOUR} />,
    );
    const meters = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid='mastery-meter']"),
    );
    expect(meters).toHaveLength(8);
    for (const meter of meters)
      expect((meter.textContent ?? "").trim()).toBe("");
  });
});

/**
 * `viewer="guardian"` renders nothing skill-related, whatever it is handed (owner ruling
 * 2026-10-01, #1013 review item 2; SCL-194): the student keeps the Skills drill-down.
 */
describe("DomainGrid — the viewer decides whether skills exist", () => {
  it("student: every card carries its Skills drill-down", () => {
    render(
      <DomainGrid viewer="student" domains={FOUR} onOpen={() => undefined} />,
    );
    // Presence: the student's control, one per card.
    expect(screen.getAllByTestId("domain-open")).toHaveLength(8);
    expect(
      screen.getByRole("button", { name: "View skills in Algebra" }),
    ).toBeTruthy();
  });

  it("guardian: no Skills control and no skill text, even when handed a drill-down", () => {
    const { container } = render(
      <DomainGrid viewer="guardian" domains={FOUR} onOpen={() => undefined} />,
    );
    // Presence first: the eight cards and their meters are drawn.
    expect(container.querySelectorAll("[data-domain]")).toHaveLength(8);
    expect(screen.getAllByTestId("mastery-meter")).toHaveLength(8);
    expect(screen.queryAllByTestId("domain-open")).toEqual([]);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.textContent ?? "").not.toMatch(/skill/i);
  });
});
