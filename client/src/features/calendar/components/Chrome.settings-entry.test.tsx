// @vitest-environment jsdom
/**
 * §17.3 — ONE way into the settings sheet.
 *
 * @spec [Doc 05F §17.1, §17.3; Brief 11 Step 4] | @implemented [2026-09-24]
 *
 * The rail's "Your schedule" card used to carry its own "Change schedule" button, a second
 * entry point the design dropped two revisions ago while the build kept shipping it. The
 * prototype's rail (`docs/design/calendar-prototype.html`, the `plancard`) has the summary
 * and no button.
 *
 * This counts CONTROLS, not markup: it renders the rail and the header together — the whole
 * chrome a student sees — and asserts exactly one of them opens the sheet. A test that only
 * checked the rail would pass again the day someone re-added the button somewhere else.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { LeftRail, TopBar } from "./Chrome";

afterEach(cleanup);

function renderChrome(over: { onEditSchedule?: () => void } = {}): void {
  const { hook } = memoryLocation({ path: "/calendar", record: true });
  render(
    <Router hook={hook}>
      <LeftRail
        name="A Student"
        subtitle="SAT 7 Nov"
        miniMonth="2026-09"
        selected="2026-09-24"
        today="2026-09-24"
        hasWork={() => false}
        filters={{ math: true, rw: true, review: true, exam: true }}
        onToggleFilter={vi.fn()}
        onPickDate={vi.fn()}
        onMonthStep={vi.fn()}
        footer="footer"
        schedule={{ summary: "Mon–Fri · 1 hr a day" }}
      />
      <TopBar
        viewer="student"
        backHref="/dashboard"
        rangeLabelText="21 – 27 September"
        view="week"
        onView={vi.fn()}
        onStep={vi.fn()}
        onToday={vi.fn()}
        targetScore={1400}
        {...(over.onEditSchedule === undefined
          ? {}
          : { onEditSchedule: over.onEditSchedule })}
      />
    </Router>,
  );
}

describe("the settings sheet has exactly one entry point", () => {
  it("one control opens it, and it is the header's", () => {
    const onEditSchedule = vi.fn();
    renderChrome({ onEditSchedule });

    const opener = screen.getByTestId("topbar-edit-schedule");
    expect(opener).toBeTruthy();

    // Count every control in the whole chrome whose words offer to change the schedule.
    const offers = Array.from(
      document.querySelectorAll("button, a"),
    ).filter((el) => /schedule/i.test(el.textContent ?? ""));
    expect(offers).toHaveLength(1);
    expect(offers[0]).toBe(opener);
  });

  it("the rail keeps the SUMMARY — only the duplicate control went", () => {
    renderChrome({ onEditSchedule: vi.fn() });
    expect(screen.getByTestId("rail-schedule-summary").textContent).toContain(
      "Mon–Fri",
    );
    // The card is still there; it simply no longer offers a second way in.
    expect(
      screen.getByTestId("rail-schedule-card").querySelectorAll("button"),
    ).toHaveLength(0);
  });

  it("a guardian gets NO entry point at all — §16", () => {
    renderChrome({});
    expect(screen.queryByTestId("topbar-edit-schedule")).toBeNull();
    const offers = Array.from(
      document.querySelectorAll("button, a"),
    ).filter((el) => /schedule/i.test(el.textContent ?? ""));
    expect(offers).toHaveLength(0);
  });
});
