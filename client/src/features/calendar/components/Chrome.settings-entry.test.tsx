// @vitest-environment jsdom
/**
 * §17.3 — ONE way into the settings sheet.
 *
 * @spec [Doc 05F §17.1, §17.3; Brief 11 Step 4; student-UI register UI-55, §2 (the schedule
 *       summary moves into the right panel)] | @implemented [2026-09-24; UI-55 2026-10-03]
 *
 * The rail's "Your schedule" card used to carry its own "Change schedule" button, a second
 * entry point the design dropped two revisions ago while the build kept shipping it. The
 * summary then moved into the App shell's right panel (UI-55) and has since left it (Karl's
 * ruling on production QA 2026-10-07, item 11(e); `calendar.ui55.test.tsx` asserts the panel
 * without it): "Edit schedule" in the student header is the single entry point.
 *
 * This counts CONTROLS, not markup: it renders the student header and asserts exactly one
 * control in it opens the sheet.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { LeftRail, TopBar } from "./Chrome";
import { StudentCalendarHeader } from "./StudentChrome";

afterEach(cleanup);

function renderStudentChrome(over: { onEditSchedule?: () => void } = {}): void {
  const { hook } = memoryLocation({ path: "/calendar", record: true });
  render(
    <Router hook={hook}>
      <StudentCalendarHeader
        view="week"
        title="9/21 – 9/27"
        onView={vi.fn()}
        onToday={vi.fn()}
        onStep={vi.fn()}
        {...(over.onEditSchedule === undefined
          ? {}
          : { onEditSchedule: over.onEditSchedule })}
      />
    </Router>,
  );
}

function scheduleOffers(): Element[] {
  return Array.from(document.querySelectorAll("button, a")).filter((el) =>
    /schedule/i.test(el.textContent ?? ""),
  );
}

describe("the settings sheet has exactly one entry point", () => {
  it("one control opens it, and it is the header's", () => {
    const onEditSchedule = vi.fn();
    renderStudentChrome({ onEditSchedule });

    const opener = screen.getByTestId("topbar-edit-schedule");
    expect(opener).toBeTruthy();

    // Count every control in the whole chrome whose words offer to change the schedule.
    const offers = scheduleOffers();
    expect(offers).toHaveLength(1);
    expect(offers[0]).toBe(opener);
    opener.click();
    expect(onEditSchedule).toHaveBeenCalledTimes(1);
  });

  it("a guardian gets NO entry point at all — §16", () => {
    const { hook } = memoryLocation({ path: "/guardian", record: true });
    render(
      <Router hook={hook}>
        <LeftRail
          name="Study plan"
          subtitle="Viewing only"
          miniMonth="2026-09-01"
          cursor="2026-09-21"
          today="2026-09-24"
          hasWork={() => false}
          filters={{ math: true, rw: true, review: true, exam: true }}
          onToggleFilter={vi.fn()}
          onPickDate={vi.fn()}
          onMonthStep={vi.fn()}
          footer="Read-only view"
        />
        <TopBar
          viewer="guardian"
          backHref="/guardian"
          rangeLabelText="21 – 27 September"
          view="week"
          onView={vi.fn()}
          onStep={vi.fn()}
          onToday={vi.fn()}
          streak={undefined}
          daysToTest={null}
          targetScore={1400}
          projection={undefined}
        />
      </Router>,
    );
    // Presence first: the guardian chrome drew.
    expect(screen.getByTestId("calendar-target")).toBeTruthy();
    expect(screen.queryByTestId("topbar-edit-schedule")).toBeNull();
    expect(scheduleOffers()).toHaveLength(0);
  });
});
