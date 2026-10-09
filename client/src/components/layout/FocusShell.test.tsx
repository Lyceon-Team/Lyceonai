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

// QA 2026-10-07 item 7: "a back link's label must match its destination. 'Start today's plan' →
// runner → '< Review' went to Home." The arrow still returns to the previous in-app page
// (register §2); its label now names that page.
describe("QA item 7: the back arrow's label names its destination", () => {
  function arriveFrom(
    from: string,
    section = "Review",
    home = "/review",
  ): void {
    window.history.replaceState(null, "", from);
    // The tracker mounts on the page the student starts from…
    render(<Tracker />);
    // …and the launch is one client-side navigation into the runner.
    navigate("/review/session/r-1");
    render(
      <FocusShell section={section} sectionHome={home}>
        <div />
      </FocusShell>,
    );
  }

  it("launched from Home: the arrow says Home and goes back to Home", () => {
    arriveFrom("/dashboard");
    const link = screen.getByTestId("focus-back");
    expect(link.textContent).toBe("Home");
    expect(link.getAttribute("aria-label")).toBe("Back to Home");
    fireEvent.click(link);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("launched from the calendar: the arrow says Calendar", () => {
    arriveFrom("/calendar");
    expect(screen.getByTestId("focus-back").textContent).toBe("Calendar");
  });

  it("started from Review: the arrow says Review", () => {
    arriveFrom("/review");
    expect(screen.getByTestId("focus-back").textContent).toBe("Review");
  });

  it("two steps in: the arrow names the page directly behind, not the first one", () => {
    window.history.replaceState(null, "", "/dashboard");
    render(<Tracker />);
    navigate("/review");
    navigate("/review/session/r-2");
    render(
      <FocusShell section="Review" sectionHome="/review">
        <div />
      </FocusShell>,
    );
    expect(screen.getByTestId("focus-back").textContent).toBe("Review");
  });

  it("an in-app page with no known name: the arrow says Back, never a wrong section", () => {
    arriveFrom("/some/unknown/page");
    const link = screen.getByTestId("focus-back");
    expect(link.textContent).toBe("Back");
    expect(link.getAttribute("aria-label")).toBe("Back");
  });

  it("a fresh load (nothing in-app behind): the section name, and the section home", () => {
    window.history.replaceState(null, "", "/review/session/r-1");
    render(
      <>
        <Tracker />
        <FocusShell section="Review" sectionHome="/review">
          <div />
        </FocusShell>
      </>,
    );
    const link = screen.getByTestId("focus-back");
    expect(link.textContent).toBe("Review");
    expect(link.getAttribute("href")).toBe("/review");
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

/**
 * F-69 (owner ruling 2026-10-05): `<main>` is the containing block of everything absolutely
 * positioned inside the shell (the `sr-only` choice letters), so nothing escapes its scroll area
 * and makes the document taller than the `100dvh` shell. jsdom has no layout, so this pins the
 * class; the layout itself is measured in the browser by the student harness's
 * `expectFitsViewport` (UI-53, UI-54) and recorded in evidence/wave5/F-69.md.
 */
describe("F-69: the scroll area contains its positioned descendants", () => {
  it("<main> is the 100dvh shell's only scroller and a positioned containing block", () => {
    renderFocus();
    const main = screen.getByTestId("focus-shell-main");
    expect(main.tagName).toBe("MAIN");
    expect(main.id).toBe("main");
    const classes = main.className.split(/\s+/);
    expect(classes).toContain("relative");
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("min-h-0");
    expect(
      document.querySelector('[data-shell="focus"]')?.className.split(/\s+/),
    ).toContain("h-[100dvh]");
  });
});
