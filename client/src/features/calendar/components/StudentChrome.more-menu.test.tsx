// @vitest-environment jsdom
/**
 * OQ-66 (c): the student calendar header's "⋯" menu.
 *
 * @spec [owner ruling (Karl, 2026-10-07, OQ-66 (c)): "the calendar header is at most two rows
 *        at 1024px. Below ~1200px, move Edit schedule and Regenerate plan into a \"⋯\" menu.";
 *        DESIGN.md §4 Calendar; student-UI register §8 F-70 (a portalled menu follows the page
 *        theme); Doc 05F §17.3 (one entry point into the schedule sheet)]
 *       | @implemented [2026-10-07]
 *
 * plain English: the menu's items are wired to the SAME handlers as the 1200px+ buttons (one
 * function passed in, called by either), Regenerate keeps the button's pending (disabled,
 * aria-busy) and done ("Plan regenerated") states, a header with no actions (the free calendar,
 * or before setup) has no "⋯" at all, and the open menu portals inside a `.lyc` root carrying
 * the shell's theme lock, as the student avatar menu does. Which of the two (buttons or "⋯")
 * is drawn at which width is CSS: jsdom lays nothing out, so the last case pins the classes and
 * the rules, and `tests/e2e/student-calendar.spec.ts` measures them in a real browser at
 * 390–1440 ("QA 2026-10-07 item 11 layout", "OQ-66 (c) the ⋯ menu by keyboard @1024").
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActiveThemeLockProvider,
  usePublishThemeLock,
} from "@/components/layout/theme-lock";
import { StudentCalendarHeader } from "./StudentChrome";

afterEach(cleanup);

type Regenerate = { onClick: () => void; pending: boolean; done: boolean };

function LightShell({ children }: { children: React.ReactNode }): JSX.Element {
  usePublishThemeLock("light");
  return <>{children}</>;
}

function renderHeader(
  over: { onEditSchedule?: () => void; regenerate?: Regenerate } = {},
): void {
  render(
    <ActiveThemeLockProvider>
      <LightShell>
        <StudentCalendarHeader
          view="week"
          title="9/28 – 10/4"
          onView={vi.fn()}
          onToday={vi.fn()}
          onStep={vi.fn()}
          {...(over.onEditSchedule === undefined
            ? {}
            : { onEditSchedule: over.onEditSchedule })}
          {...(over.regenerate === undefined
            ? {}
            : { regenerate: over.regenerate })}
        />
      </LightShell>
    </ActiveThemeLockProvider>,
  );
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "More actions" });
}

/** Radix opens the menu on keyboard activation of the trigger. */
function openMenu(): HTMLElement {
  const more = trigger();
  more.focus();
  fireEvent.keyDown(more, { key: "Enter" });
  return screen.getByRole("menu");
}

function item(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

describe("OQ-66 (c): the ⋯ menu calls the same handlers as the buttons", () => {
  it("is named More actions, closed until opened, and holds Edit schedule then Regenerate plan", () => {
    renderHeader({
      onEditSchedule: vi.fn(),
      regenerate: { onClick: vi.fn(), pending: false, done: false },
    });
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByRole("menu")).toBeNull();
    const menu = openMenu();
    expect(
      Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
        (el) => el.textContent,
      ),
    ).toEqual(["Edit schedule", "Regenerate plan"]);
  });

  it("Edit schedule: the item and the button call the one handler", () => {
    const onEditSchedule = vi.fn();
    renderHeader({
      onEditSchedule,
      regenerate: { onClick: vi.fn(), pending: false, done: false },
    });
    fireEvent.click(screen.getByTestId("topbar-edit-schedule"));
    expect(onEditSchedule).toHaveBeenCalledTimes(1);
    openMenu();
    fireEvent.click(item("Edit schedule"));
    expect(onEditSchedule).toHaveBeenCalledTimes(2);
    // Choosing an item closes the menu.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Regenerate plan: the item and the button call the one handler", () => {
    const onClick = vi.fn();
    renderHeader({
      onEditSchedule: vi.fn(),
      regenerate: { onClick, pending: false, done: false },
    });
    fireEvent.click(screen.getByTestId("calendar-regenerate"));
    expect(onClick).toHaveBeenCalledTimes(1);
    openMenu();
    const regen = item("Regenerate plan");
    expect(regen.getAttribute("aria-disabled")).toBeNull();
    expect(regen.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(regen);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("Regenerate plan while it runs: the item is disabled and busy, as the button is, and choosing it does nothing", () => {
    const onClick = vi.fn();
    renderHeader({
      onEditSchedule: vi.fn(),
      regenerate: { onClick, pending: true, done: false },
    });
    const button = screen.getByTestId("calendar-regenerate");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    openMenu();
    const regen = item("Regenerate plan");
    expect(regen.getAttribute("aria-disabled")).toBe("true");
    expect(regen.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(regen);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Regenerate plan once returned: the item reads "Plan regenerated", as the button does', () => {
    renderHeader({
      onEditSchedule: vi.fn(),
      regenerate: { onClick: vi.fn(), pending: false, done: true },
    });
    expect(screen.getByTestId("calendar-regenerate").textContent).toBe(
      "Plan regenerated",
    );
    openMenu();
    expect(item("Plan regenerated")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Regenerate plan" })).toBe(
      null,
    );
  });

  it("an action that is absent has no item", () => {
    const onEditSchedule = vi.fn();
    renderHeader({ onEditSchedule });
    const menu = openMenu();
    expect(
      Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
        (el) => el.textContent,
      ),
    ).toEqual(["Edit schedule"]);
  });

  it("the open menu portals inside a .lyc root carrying the shell's theme lock (F-70)", () => {
    renderHeader({
      onEditSchedule: vi.fn(),
      regenerate: { onClick: vi.fn(), pending: false, done: false },
    });
    const menu = openMenu();
    const root = menu.closest(".lyc");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-theme-lock")).toBe("light");
    // Student tokens, as the avatar menu's `tone="student"`.
    expect(menu.className).toContain("bg-lyc-sheet");
    expect(item("Edit schedule").className).toContain("focus:bg-lyc-hover");
  });
});

describe("OQ-66 (c): a header without actions is unaffected", () => {
  it("no ⋯, no actions class: the free calendar's and the pre-setup header", () => {
    renderHeader();
    // Presence first: the header and its controls drew.
    const header = screen.getByTestId("calendar-header");
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByTestId("topbar-edit-schedule")).toBeNull();
    expect(header.classList.contains("lyc-cal-head--actions")).toBe(false);
  });
});

describe("OQ-66 (c): below a 1200px viewport the ⋯, from 1200 the buttons (the CSS)", () => {
  function studentCss(): string {
    return fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../calendar-student.css",
      ),
      "utf8",
    );
  }

  /** The block of the at-rule that opens with exactly `head`, to its matching brace. */
  function atBlock(css: string, head: string): string {
    const at = css.indexOf(`${head} {`);
    expect(at).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = css.indexOf("{", at); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) return css.slice(at, i + 1);
    }
    throw new Error(`unclosed ${head}`);
  }

  it("the buttons and the trigger carry the classes the rules select", () => {
    renderHeader({
      onEditSchedule: vi.fn(),
      regenerate: { onClick: vi.fn(), pending: false, done: false },
    });
    expect(
      screen
        .getByTestId("calendar-header")
        .classList.contains("lyc-cal-head--actions"),
    ).toBe(true);
    for (const id of ["topbar-edit-schedule", "calendar-regenerate"])
      expect(
        screen.getByTestId(id).classList.contains("lyc-cal-head__wide"),
      ).toBe(true);
    expect(trigger().classList.contains("lyc-cal-head__more")).toBe(true);
    // All three sit in the actions group the rules address as its children.
    for (const el of [
      screen.getByTestId("topbar-edit-schedule"),
      screen.getByTestId("calendar-regenerate"),
      trigger(),
    ])
      expect(
        el.parentElement?.classList.contains("lyc-cal-head__actions"),
      ).toBe(true);
  });

  it("the stylesheet hides the buttons below 1200px and the ⋯ from 1200px, and puts ⋯ on the title's row under a 700px column", () => {
    const css = studentCss();
    const below = atBlock(css, "@media (max-width: 1199.98px)");
    expect(below).toMatch(
      /\.lyc-cal-head__actions > \.lyc-cal-head__wide \{\s*display: none;\s*\}/,
    );
    const narrow = atBlock(
      below,
      "@container lyc-cal-body (max-width: 699.98px)",
    );
    expect(narrow).toMatch(
      /\.lyc-cal-head--actions \{\s*display: grid;\s*grid-template-columns: 40px minmax\(0, 1fr\) 40px;\s*\}/,
    );
    expect(narrow).toMatch(
      /\.lyc-cal-head--actions > \.lyc-cal-head__actions \{\s*grid-area: 1 \/ 3;\s*\}/,
    );
    expect(narrow).toMatch(
      /\.lyc-cal-head--actions > \.lyc-cal-head__nav \{\s*grid-area: 2 \/ 1 \/ 3 \/ 4;\s*\}/,
    );
    const from = atBlock(css, "@media (min-width: 1200px)");
    expect(from).toMatch(
      /\.lyc-cal-head__actions > \.lyc-cal-head__more \{\s*display: none;\s*\}/,
    );
  });
});
