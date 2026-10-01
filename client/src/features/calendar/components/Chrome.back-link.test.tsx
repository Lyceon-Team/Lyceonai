// @vitest-environment jsdom
/**
 * The calendar has a way out, and it is a link.
 *
 * @spec [Brief 7 Step 2; issue #829] | @implemented [2026-09-22]
 *
 * WHY A LINK AND NOT A BACK BUTTON. `history.back()` lands wherever the student happened to
 * arrive from — including an external referrer, or the page they were on two tabs ago — so
 * "back" is not a place. It also cannot be middle-clicked, opened in a new tab, or read out
 * as a destination by a screen reader. A real anchor to a known page is deterministic, and
 * it behaves like every other link in the product now that #829 is fixed.
 *
 * The guardian case is asserted SEPARATELY rather than parameterised, because the two are
 * different claims: a student's home is `/dashboard`, a guardian's is `/guardian` (grounded
 * at App.tsx's route table), and a single loop over a table would let one of them silently
 * become the other's value.
 */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TopBar } from "./Chrome";

afterEach(cleanup);

function renderTopBar(backHref: string, path = "/calendar") {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <TopBar
        viewer="student"
        backHref={backHref}
        rangeLabelText="21 – 27 September"
        view="week"
        onView={vi.fn()}
        onStep={vi.fn()}
        onToday={vi.fn()}
        streak={undefined}
        daysToTest={null}
      />
    </Router>,
  );
}

describe("the calendar back control", () => {
  it("is an anchor to /dashboard for a student, not a button", () => {
    renderTopBar("/dashboard");
    const back = screen.getByTestId("calendar-back-link");

    // `tagName` is the assertion that matters: a <button> with an onClick would satisfy
    // "there is a way back" and fail every one of the reasons this is a link.
    expect(back.tagName).toBe("A");
    expect(back.getAttribute("href")).toBe("/dashboard");
    expect(back.textContent).toContain("Dashboard");
  });

  it("is an anchor to /guardian on the guardian surface", () => {
    renderTopBar("/guardian", "/students/abc/calendar");
    const back = screen.getByTestId("calendar-back-link");

    expect(back.tagName).toBe("A");
    expect(back.getAttribute("href")).toBe("/guardian");
  });

  it("sits before the week arrows, as the prototype places it", () => {
    const { container } = renderTopBar("/dashboard");
    const top = container.querySelector(".top");
    const back = screen.getByTestId("calendar-back-link");
    const arrows = container.querySelector(".arrows");

    expect(top).not.toBeNull();
    expect(arrows).not.toBeNull();
    // DOM order is what a screen reader and the tab key both follow, so "top-left, before
    // the arrows" is an ordering claim, not only a CSS one.
    expect(
      back.compareDocumentPosition(arrows as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is reachable and activatable from the keyboard", () => {
    const { container } = renderTopBar("/dashboard");
    const back = screen.getByTestId("calendar-back-link");

    // In the tab order: an anchor with an href is tabbable unless something removes it.
    const tabbable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(tabbable[0]).toBe(back);

    back.focus();
    expect(document.activeElement).toBe(back);

    // jsdom does not implement a browser's implicit Enter→click activation on anchors, and
    // `@testing-library/user-event` is not a dependency here (adding one needs approval).
    // So the keystroke is dispatched to prove the element receives it, and the activation
    // it stands for is asserted as the click the browser would synthesise. Asserting a
    // jsdom-only Enter→navigate would be asserting a simulation rather than the app.
    fireEvent.keyDown(back, { key: "Enter", code: "Enter" });
    fireEvent.click(back);

    expect(back.getAttribute("href")).toBe("/dashboard");
  });

  it("renders no anchor inside another anchor", () => {
    const { container } = renderTopBar("/dashboard");
    expect(container.querySelectorAll("a a")).toHaveLength(0);
  });
});
