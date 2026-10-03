// @vitest-environment jsdom
/**
 * UI-41: the Focus shell's back arrow, with and without in-app history, and hidden for the
 * timed module.
 *
 * @spec [student-UI register §2 ("the previous in-app page if the student came from inside
 *        Lyceon, otherwise the section's home. No full-page reloads."); DESIGN.md §2 Focus shell
 *        (the timed exam module has no back arrow)] | @implemented [2026-10-03]
 *
 * plain English: rendered on wouter's real browser location (jsdom's History API), with the same
 * tracker App's Router mounts. "No reload" is asserted as: the back target is reached through the
 * History API (`history.back()` or a `pushState`), and `location.assign`/`reload` are never used.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigate } from "wouter/use-browser-location";
import { useInAppHistoryTracking } from "@/lib/in-app-history";
import { FocusBarContext, FocusShell } from "./FocusShell";

function Tracker(): null {
  useInAppHistoryTracking();
  return null;
}

function renderFocus(
  props: Partial<React.ComponentProps<typeof FocusShell>> = {},
): void {
  render(
    <>
      <Tracker />
      <FocusShell section="Practice" sectionHome="/practice" {...props}>
        <div data-testid="runner-body">runner</div>
      </FocusShell>
    </>,
  );
}

let back: ReturnType<typeof vi.spyOn>;
let push: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState(null, "", "/practice/session/s-1");
  back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
  push = vi.spyOn(window.history, "pushState");
});

afterEach(() => {
  back.mockRestore();
  push.mockRestore();
  cleanup();
});

describe("the back arrow", () => {
  it("is a real link to the section home, named for it", () => {
    renderFocus();
    const link = screen.getByTestId("focus-back");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/practice");
    expect(link.getAttribute("aria-label")).toBe("Back to Practice");
    expect(link.textContent).toBe("Practice");
  });

  it("with in-app history: goes back one entry and pushes nothing", () => {
    renderFocus();
    // The student arrived here from inside the app: one client-side navigation.
    navigate("/practice/session/s-2");
    push.mockClear();

    fireEvent.click(screen.getByTestId("focus-back"));

    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("without in-app history (a fresh load): goes to the section home client-side, never history.back()", () => {
    renderFocus();

    fireEvent.click(screen.getByTestId("focus-back"));

    expect(back).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/practice");
  });

  it("after the student has stepped back out of the in-app entry, it goes to the section home", () => {
    renderFocus();
    navigate("/practice/session/s-2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    push.mockClear();

    fireEvent.click(screen.getByTestId("focus-back"));

    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/practice");
  });

  it("a redirect (replaceState) is not in-app history", () => {
    renderFocus();
    window.history.replaceState(null, "", "/practice/session/s-3");

    fireEvent.click(screen.getByTestId("focus-back"));

    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/practice");
  });

  it("has the 3px focus ring and is reachable by Tab", () => {
    renderFocus();
    const link = screen.getByTestId("focus-back");
    for (const cls of [
      "focus-visible:outline-[3px]",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-lyc-focus",
    ]) {
      expect(link.className.split(/\s+/)).toContain(cls);
    }
    link.focus();
    expect(document.activeElement).toBe(link);
  });
});

describe("the timed exam module", () => {
  it("has no back arrow, shows the section name, and pins the light theme", () => {
    const { container } = render(
      <FocusShell
        section="Full-Length"
        sectionHome="/tests"
        back={false}
        themeLock="light"
      >
        <div />
      </FocusShell>,
    );
    expect(screen.queryByTestId("focus-back")).toBeNull();
    expect(container.querySelector('a[href="/tests"]')).toBeNull();
    expect(screen.getByTestId("focus-section").textContent).toBe("Full-Length");
    expect(
      container
        .querySelector('[data-shell="focus"]')
        ?.getAttribute("data-theme-lock"),
    ).toBe("light");
  });
});

describe("the context slot", () => {
  it("portals a page's context into the bar, and the page body stays in <main>", () => {
    render(
      <FocusShell section="Review" sectionHome="/review">
        <div data-testid="runner-body">
          <FocusBarContext>
            <span data-testid="question-count">Question 3 of 10</span>
          </FocusBarContext>
        </div>
      </FocusShell>,
    );
    const bar = screen.getByTestId("focus-shell-header");
    expect(bar.contains(screen.getByTestId("question-count"))).toBe(true);
    expect(
      screen
        .getByTestId("runner-body")
        .contains(screen.getByTestId("question-count")),
    ).toBe(false);
    expect(screen.getByTestId("runner-body").closest("main")).not.toBeNull();
    // No rail and no right panel (DESIGN.md §2).
    expect(document.querySelector("nav")).toBeNull();
    expect(document.querySelector("aside")).toBeNull();
  });
});
