// @vitest-environment jsdom
/**
 * QA2-C: the week card's and the month chip's compact labels, as rendered.
 *
 * @spec [production re-test (Karl, 2026-10-08) item C: "Calendar chips at narrow widths: compact
 *        labels that keep the count ('Rev 15', 'Math 5', 'R&W 15') plus color; never a single
 *        letter; no mid-word breaks."; Doc 05F §17.1] | @implemented [2026-10-08]
 *
 * plain English: both wordings are in the DOM and the stylesheet shows one by the column's
 * width (measured in a real browser by `tests/e2e/student-calendar.spec.ts`, "QA2-C chip
 * labels"). jsdom lays nothing out, so this pins what the browser test depends on: the compact
 * label is the canonical one and is hidden from assistive technology, the full title and the
 * canonical domain names are in the accessible name, and the colour class stays on the card.
 */
import React from "react";
import { DndContext } from "@dnd-kit/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewBlock, ViewDay } from "../lib/view-model";
import { BlockCard } from "./BlockCard";
import { MonthGrid } from "./MonthGrid";

afterEach(cleanup);

const DATE = "2026-10-07";

function viewBlock(over: Partial<ViewBlock>): ViewBlock {
  return {
    blockId: "b-1",
    tone: "rw",
    title: "Reading & Writing · 15 questions",
    minutes: "~23 min",
    mix: [
      { domain: "Craft and Structure", count: 10 },
      { domain: "Standard English Conventions", count: 5 },
    ],
    target: 15,
    actual: 0,
    progress: 0,
    status: "scheduled",
    started: false,
    explanations: [],
    launchable: true,
    plan: null,
    ...over,
  };
}

function renderCard(block: ViewBlock): HTMLElement {
  render(
    <DndContext>
      <BlockCard block={block} date={DATE} draggable onOpen={vi.fn()} />
    </DndContext>,
  );
  return screen.getByTestId(`calendar-block-${block.blockId}`);
}

describe("QA2-C — the week card", () => {
  it("draws the full title and the compact one; only the full one is in the accessible name", () => {
    const card = renderCard(viewBlock({}));
    expect(card.querySelector(".ttl-full")?.textContent).toBe(
      "Reading & Writing · 15 questions",
    );
    const short = card.querySelector(".ttl-short");
    expect(short?.textContent).toBe("R&W 15");
    expect(short?.getAttribute("aria-hidden")).toBe("true");
    // The tone class carries the colour whichever label is drawn.
    expect(card.classList.contains("rw")).toBe(true);
    expect(card.getAttribute("aria-label")).toBe(
      "Reading & Writing · 15 questions, ~23 min, Craft and Structure 10, Standard English Conventions 5",
    );
  });

  it.each([
    ["review", "Review · 15 items", 15, "Rev 15"],
    ["math", "Math · 5 questions", 5, "Math 5"],
    ["rw", "Reading & Writing · 15 questions", 15, "R&W 15"],
  ] as const)(
    "a %s card's compact label is %s → %s",
    (tone, title, target, compact) => {
      const card = renderCard(viewBlock({ tone, title, target, mix: [] }));
      expect(card.querySelector(".ttl-short")?.textContent).toBe(compact);
      expect(card.getAttribute("aria-label")?.startsWith(title)).toBe(true);
    },
  );

  it("a full-length test keeps its one wording at every width (OQ-62 (b)): one span, no compact", () => {
    const card = renderCard(
      viewBlock({
        tone: "exam",
        title: "Full-length test",
        target: 1,
        minutes: null,
        mix: [],
      }),
    );
    expect(card.querySelector(".ttl-only")?.textContent).toBe(
      "Full-length test",
    );
    expect(card.querySelector(".ttl-full")).toBeNull();
    expect(card.querySelector(".ttl-short")).toBeNull();
  });

  it("a scope chip keeps its name and its count apart, with the canonical name as its title", () => {
    const card = renderCard(viewBlock({}));
    const chips = Array.from(card.querySelectorAll(".dom > span"));
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => chip.getAttribute("title"))).toEqual([
      "Craft and Structure",
      "Standard English Conventions",
    ]);
    expect(
      chips.map((chip) => chip.querySelector(".dname")?.textContent),
    ).toEqual(["Craft & Structure", "Conventions"]);
    expect(
      chips.map((chip) => chip.querySelector(".dcount")?.textContent),
    ).toEqual(["10", "5"]);
    // The words still read as before ("Conventions 5") for anything that reads the text.
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Craft & Structure 10",
      "Conventions 5",
    ]);
  });
});

describe("QA2-C — the month chip", () => {
  it("draws its full and its compact label; the chip is named by the full title", () => {
    const block = viewBlock({
      blockId: "b-rev",
      tone: "review",
      title: "Review · 15 items",
      target: 15,
      mix: [],
    });
    const day: ViewDay = {
      date: DATE,
      status: "upcoming",
      isStudyDay: true,
      isOverride: false,
      blocks: [block],
      plannedCount: 15,
      actualCount: 0,
      extraCount: 0,
    };
    render(
      <DndContext>
        <MonthGrid
          dates={[DATE]}
          cursor={DATE}
          dayFor={(date) => (date === DATE ? day : null)}
          today={DATE}
          visible={() => true}
          canDrag={() => false}
          onOpen={vi.fn()}
        />
      </DndContext>,
    );
    const chip = screen.getByTestId("calendar-month-chip-b-rev");
    expect(chip.querySelector(".full")?.textContent).toBe("Review 15");
    const short = chip.querySelector(".short");
    expect(short?.textContent).toBe("Rev 15");
    expect(short?.getAttribute("aria-hidden")).toBe("true");
    expect(chip.classList.contains("rev")).toBe(true);
    expect(chip.getAttribute("aria-label")).toBe("Review · 15 items");
  });
});
