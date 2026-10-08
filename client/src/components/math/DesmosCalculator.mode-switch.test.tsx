// @vitest-environment jsdom
/**
 * @spec [production QA 2026-10-07 item 12 (Karl: the Desmos "Scientific" tab contrast in dark
 *       mode); DESIGN.md §1 (student tokens only, nothing below 14px)] | @implemented [2026-10-07]
 *
 * plain English: our own mode switch above Desmos draws with the student tokens, so it follows
 * the page's theme: the selected tab is the sheet with the strong ink, the other tab the normal
 * ink on the margin (never the muted ink that disappeared in dark mode), both at the 14px meta
 * size, and none of the app-wide light tokens remain. Desmos itself is not loaded (no key in a
 * test), which is also the harness's state: the switch renders either way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DesmosCalculator from "./DesmosCalculator";

beforeEach(() => {
  global.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function classes(testId: string): string[] {
  return screen.getByTestId(testId).className.split(/\s+/);
}

const APP_WIDE = [
  "bg-background",
  "text-foreground",
  "text-muted-foreground",
  "bg-secondary/60",
  "text-xs",
];

describe("QA 12: the calculator's mode switch is on the student tokens", () => {
  it("Scientific selected: the selected tab is sheet + strong ink, Graphing is ink (not muted), both 14px", () => {
    render(<DesmosCalculator expanded />);
    // Presence first: the switch and both tabs rendered.
    expect(
      screen.getByRole("radiogroup", { name: "Calculator mode" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("desmos-mode-scientific"));
    expect(
      screen.getByTestId("desmos-mode-scientific").getAttribute("aria-checked"),
    ).toBe("true");

    const on = classes("desmos-mode-scientific");
    const off = classes("desmos-mode-graphing");
    expect(on).toEqual(
      expect.arrayContaining([
        "bg-lyc-sheet",
        "text-lyc-ink-strong",
        "text-lyc-meta",
      ]),
    );
    expect(off).toEqual(
      expect.arrayContaining(["text-lyc-ink", "text-lyc-meta"]),
    );
    expect(off).not.toContain("text-lyc-muted");
    for (const c of APP_WIDE) {
      expect(on).not.toContain(c);
      expect(off).not.toContain(c);
    }
    const group = screen
      .getByRole("radiogroup", { name: "Calculator mode" })
      .className.split(/\s+/);
    expect(group).toEqual(
      expect.arrayContaining(["bg-lyc-margin", "border-lyc-rule"]),
    );
    expect(group).not.toContain("bg-secondary/60");
  });
});
