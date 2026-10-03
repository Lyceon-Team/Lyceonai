// @vitest-environment jsdom
/**
 * UI-42: the mastery row — five segments filled to the level, plus the level pill.
 *
 * @spec [student-UI register §2, UI-42; DESIGN.md §3 (Mastery row); owner review 2026-10-01
 *       final round item 3 (level 0–4 fills 1–5, null fills 0); owner ruling 2026-08-20 RULE 1,
 *       RULE 3] | @implemented [2026-10-03]
 *
 * plain English: every level state, in both variants, draws the right number of filled
 * segments in the level's fill token and the server's level name in the pill; unmeasured draws
 * five empty segments and a dashed "Not enough answers yet" pill. The rendered text holds the
 * name of the domain and of the level and NO digit at all — no percentage, no accuracy, no
 * count. Names are passed in as the server sends them (`mastery_levels`), never looked up.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { UNMEASURED_DISPLAY_NAME } from "@lyceon/shared/mastery-levels";
import { MasteryRow } from "./MasteryRow";

afterEach(cleanup);

/** The production ladder (`20260820000000_mastery_levels.sql`), as the server sends it. */
const STATES = [
  { levelKey: "unmeasured", displayName: UNMEASURED_DISPLAY_NAME, filled: 0 },
  { levelKey: "L0", displayName: "Foundations", filled: 1 },
  { levelKey: "L1", displayName: "Building", filled: 2 },
  { levelKey: "L2", displayName: "Developing", filled: 3 },
  { levelKey: "L3", displayName: "Proficient", filled: 4 },
  { levelKey: "L4", displayName: "Strong", filled: 5 },
] as const;

const VARIANTS = ["wide", "compact"] as const;

const CASES = VARIANTS.flatMap((variant) =>
  STATES.map((s) => ({ ...s, variant })),
);

function segmentsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>("[data-segment]"));
}

describe("MasteryRow — each level, each variant", () => {
  it.each(CASES)(
    "$variant $levelKey: $filled of 5 filled, pill reads $displayName",
    ({ levelKey, displayName, filled, variant }) => {
      render(
        <MasteryRow
          label="Advanced Math"
          levelKey={levelKey}
          displayName={displayName}
          variant={variant}
        />,
      );
      const row = screen.getByTestId("mastery-row");
      expect(row.dataset.variant).toBe(variant);
      expect(row.dataset.levelKey).toBe(levelKey);

      // Presence first: the label, the pill with the server's words, five segments.
      expect(within(row).getByText("Advanced Math")).toBeTruthy();
      const pill = within(row).getByTestId("level-pill");
      expect(pill.textContent).toBe(displayName);
      expect(pill.dataset.levelKey).toBe(levelKey);
      const segments = segmentsOf(row);
      expect(segments).toHaveLength(5);

      // Filled first, left to right; `filled` of them.
      expect(segments.map((s) => s.dataset.filled)).toEqual(
        Array.from({ length: 5 }, (_v, i) => (i < filled ? "true" : "false")),
      );
      const fill =
        levelKey === "unmeasured" ? null : `bg-lyc-lv${levelKey.slice(1)}-fill`;
      for (const [i, seg] of segments.entries()) {
        if (i < filled) {
          expect(seg.classList.contains(fill ?? "")).toBe(true);
        } else {
          expect(seg.classList.contains("bg-lyc-seg-empty")).toBe(true);
        }
      }

      // The pill's tone is the level's tokens; unmeasured is the dashed pill.
      if (levelKey === "unmeasured") {
        for (const cls of [
          "border-dashed",
          "bg-transparent",
          "border-lyc-rule-strong",
        ])
          expect(pill.classList.contains(cls), cls).toBe(true);
      } else {
        const n = levelKey.slice(1);
        for (const cls of [
          `bg-lyc-lv${n}-bg`,
          `text-lyc-lv${n}-ink`,
          `border-lyc-lv${n}-bd`,
        ])
          expect(pill.classList.contains(cls), cls).toBe(true);
        expect(pill.classList.contains("border-dashed")).toBe(false);
      }

      // One accessible statement of the level, without a score; the pill is not read twice.
      const meter = within(row).getByRole("img");
      expect(meter.getAttribute("aria-label")).toBe(
        levelKey === "unmeasured"
          ? `Mastery: ${displayName}`
          : `Mastery: ${displayName}, level ${filled} of 5`,
      );
      expect(pill.closest("[aria-hidden='true']")).not.toBeNull();

      // No digits in the rendered text: no percentage, no accuracy, no count.
      const text = row.textContent ?? "";
      expect(text).toContain(displayName);
      expect(text).not.toMatch(/\d+\s*%/);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/accura|correct|score/i);
    },
  );
});

describe("MasteryRow — wide and compact are different layouts", () => {
  it("wide: name, meter and pill on one grid line, 15px pill, 30px segments", () => {
    render(
      <MasteryRow
        label="Algebra"
        levelKey="L2"
        displayName="Developing"
        variant="wide"
      />,
    );
    const row = screen.getByTestId("mastery-row");
    expect(row.className).toContain("sm:grid-cols-[minmax(0,1fr)_176px_132px]");
    expect(
      within(row).getByTestId("level-pill").classList.contains("text-[15px]"),
    ).toBe(true);
    for (const seg of segmentsOf(row))
      expect(seg.classList.contains("w-[30px]")).toBe(true);
    // The three parts are the row's direct children: one line.
    expect(row.children).toHaveLength(3);
  });

  it("compact: name above a line holding meter and pill, 14px pill, 26px segments", () => {
    render(
      <MasteryRow
        label="Algebra"
        levelKey="L2"
        displayName="Developing"
        variant="compact"
      />,
    );
    const row = screen.getByTestId("mastery-row");
    expect(row.className).not.toContain("grid-cols");
    const pill = within(row).getByTestId("level-pill");
    expect(pill.classList.contains("text-sm")).toBe(true);
    for (const seg of segmentsOf(row))
      expect(seg.classList.contains("w-[26px]")).toBe(true);
    // Name, then one line that holds both the meter and the pill.
    expect(row.children).toHaveLength(2);
    const line = row.children[1] as HTMLElement;
    expect(within(line).getByRole("img")).toBeTruthy();
    expect(within(line).getByTestId("level-pill")).toBe(pill);
  });
});

describe("MasteryRow — href", () => {
  it("with href the whole row is one link to it", () => {
    render(
      <MasteryRow
        label="Algebra"
        levelKey="L3"
        displayName="Proficient"
        variant="compact"
        href="/mastery"
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/mastery");
    expect(link.dataset.testid).toBe("mastery-row");
    expect(within(link).getByText("Algebra")).toBeTruthy();
  });

  it("without href there is no link", () => {
    render(
      <MasteryRow
        label="Algebra"
        levelKey="L3"
        displayName="Proficient"
        variant="wide"
      />,
    );
    expect(screen.getByTestId("mastery-row")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
