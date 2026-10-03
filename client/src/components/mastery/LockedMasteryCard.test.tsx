// @vitest-environment jsdom
/**
 * UI-42: the free plan's locked mastery card — empty outlines only, never fake data.
 *
 * @spec [student-UI register §2 ("empty bar outlines only, never fake data"), UI-42;
 *       DESIGN.md §3 (Locked mastery card)] | @implemented [2026-10-03]
 *
 * plain English: the card shows the headline and the button, and its ghost rows are shapes
 * only: every segment empty, no level pill, no level name, no meter announcing a level, no
 * digit. The button calls `onSeeWhatsIncluded` (the lead wires the UI-44 modal) and the card
 * opens nothing of its own.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UNMEASURED_DISPLAY_NAME } from "@lyceon/shared/mastery-levels";
import { LockedMasteryCard } from "./LockedMasteryCard";

afterEach(cleanup);

const LEVEL_NAMES = [
  UNMEASURED_DISPLAY_NAME,
  "Foundations",
  "Building",
  "Developing",
  "Proficient",
  "Strong",
];

describe("LockedMasteryCard", () => {
  it("draws the headline and empty segment outlines only", () => {
    render(<LockedMasteryCard onSeeWhatsIncluded={() => undefined} />);
    const card = screen.getByTestId("locked-mastery-card");

    // Presence first: the headline names the card, and there ARE segments to inspect.
    const heading = screen.getByRole("heading", {
      name: "Track mastery by domain and skills",
    });
    expect(heading.tagName).toBe("H2");
    expect(card.getAttribute("aria-labelledby")).toBe(heading.id);
    const segments = Array.from(
      card.querySelectorAll<HTMLElement>("[data-segment]"),
    );
    expect(segments.length).toBe(15);

    // Every segment is empty, in the empty token; none is filled.
    for (const seg of segments) {
      expect(seg.dataset.filled).toBe("false");
      expect(seg.classList.contains("bg-lyc-seg-empty")).toBe(true);
      expect(seg.className).not.toMatch(/lv\d-fill/);
    }

    // No level anywhere: no pill, no labelled meter, no level name, no digit.
    expect(screen.queryAllByTestId("level-pill")).toEqual([]);
    expect(screen.queryAllByTestId("mastery-meter")).toEqual([]);
    expect(screen.queryAllByRole("img")).toEqual([]);
    const text = card.textContent ?? "";
    expect(text).toContain("Track mastery by domain and skills");
    for (const name of LEVEL_NAMES) expect(text).not.toContain(name);
    expect(text).not.toMatch(/\d/);

    // The ghost rows are decoration: hidden from assistive technology.
    expect(
      screen.getByTestId("locked-mastery-ghosts").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("'See what's included' calls onSeeWhatsIncluded, once per click", () => {
    const onSeeWhatsIncluded = vi.fn();
    render(<LockedMasteryCard onSeeWhatsIncluded={onSeeWhatsIncluded} />);
    const button = screen.getByRole("button", { name: "See what's included" });
    expect(onSeeWhatsIncluded).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onSeeWhatsIncluded).toHaveBeenCalledTimes(1);
    // It opens nothing itself: no dialog appears.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("headingLevel 3 renders an h3 for a panel that already has its own heading", () => {
    render(
      <LockedMasteryCard
        onSeeWhatsIncluded={() => undefined}
        headingLevel={3}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Track mastery by domain and skills",
      }).tagName,
    ).toBe("H3");
  });
});
