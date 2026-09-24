// @vitest-environment jsdom
/**
 * §17.7 — the phone's week navigation.
 *
 * @spec [Doc 05F §17.1, §17.7; Brief 11 Step 5] | @implemented [2026-09-24]
 *
 * The strip exists because at 390px the seven-column grid was 924px wide inside a 390px
 * scroller: three days visible, four behind a sideways swipe with nothing to say they were
 * there. So the load-bearing assertion is that ALL SEVEN are rendered at once.
 */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayStrip } from "./DayStrip";

afterEach(cleanup);

const WEEK = [
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
];
const TODAY = "2026-09-24";

function open(over: Partial<React.ComponentProps<typeof DayStrip>> = {}) {
  const onSelect = vi.fn();
  render(
    <DayStrip
      dates={WEEK}
      selected={TODAY}
      today={TODAY}
      hasWork={(date) => date !== "2026-09-27"}
      onSelect={onSelect}
      {...over}
    />,
  );
  return { onSelect };
}

describe("every day is reachable without scrolling", () => {
  it("renders all seven days", () => {
    open();
    const chips = screen
      .getByTestId("calendar-day-strip")
      .querySelectorAll("button");
    expect(chips).toHaveLength(7);
    for (const date of WEEK) {
      expect(screen.getByTestId(`calendar-day-chip-${date}`)).toBeTruthy();
    }
  });

  it("tapping a day reports it, and does not select it by itself", () => {
    const { onSelect } = open();
    fireEvent.click(screen.getByTestId("calendar-day-chip-2026-09-26"));
    expect(onSelect).toHaveBeenCalledWith("2026-09-26");
    // The strip is controlled: the parent owns which day is open.
    expect(
      screen
        .getByTestId("calendar-day-chip-2026-09-26")
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
});

describe("what a chip says", () => {
  it("marks exactly one day selected", () => {
    open();
    const selected = WEEK.filter(
      (date) =>
        screen
          .getByTestId(`calendar-day-chip-${date}`)
          .getAttribute("aria-selected") === "true",
    );
    expect(selected).toEqual([TODAY]);
  });

  it("marks today even when another day is open", () => {
    open({ selected: "2026-09-21" });
    expect(
      screen.getByTestId(`calendar-day-chip-${TODAY}`).className,
    ).toContain("is-today");
    // …and the open day is still the one that was asked for.
    expect(
      screen
        .getByTestId("calendar-day-chip-2026-09-21")
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps the dot in the layout on a day with no work, so the strip does not jump", () => {
    open();
    const quiet = screen.getByTestId("calendar-day-chip-2026-09-27");
    const busy = screen.getByTestId("calendar-day-chip-2026-09-26");
    // Present in both; only the paint differs.
    expect(quiet.querySelector(".dot")).toBeTruthy();
    expect(quiet.querySelector(".dot")?.className).toContain("off");
    expect(busy.querySelector(".dot")?.className).not.toContain("off");
  });
});
