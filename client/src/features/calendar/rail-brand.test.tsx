// @vitest-environment jsdom
/**
 * The calendar's own "Lyceon" wordmark is gone from both surfaces.
 *
 * @spec [owner decision 2026-10-01 on PR 1003, item 6 (the guardian rail drops the wordmark;
 *       its shell carries the logo); student-UI register UI-55, §2 (the App shell's rail carries
 *       the logo; the calendar's left column moves into the right panel), UI-41 finding ("the
 *       calendar's own rail and wordmark" were interim duplication)] | @implemented
 *       [2026-10-01; UI-55 2026-10-03]
 *
 * plain English: until UI-55 the student's calendar drew a dark rail of its own with a
 * "Lyceon" wordmark at its top, under the App shell's rail and logo. The student calendar now
 * renders its Canvas-style header and the shell's right panel instead, and no rail of its
 * own. The guardian half (no wordmark under the guardian shell) is driven through the real
 * guardian route in `features/guardian/calendar-tab.test.tsx`.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CalendarReadyResponse } from "@lyceon/shared/calendar";
import { CalendarView } from "./CalendarView";
import { studentViewModel } from "./lib/view-model";
import { studentCalendarWeek } from "./calendar-week.fixture";

afterEach(cleanup);

const TODAY = "2026-10-01";

describe("the student calendar's chrome", () => {
  it("is the App-shell header, with no rail and no wordmark of its own", () => {
    const { requestId: _requestId, ...payload } = studentCalendarWeek(TODAY);
    render(
      <CalendarView
        viewer="student"
        model={studentViewModel(payload as CalendarReadyResponse)}
        today={TODAY}
        viewerName="A Student"
        targetExamDate={null}
        targetScore={null}
        streak={undefined}
        fullLengthSuppressions={[]}
        planUpdate={null}
        onRangeChange={() => {}}
        backHref="/dashboard"
      />,
    );
    // Presence first: the page drew its header and its week.
    expect(screen.getByTestId("calendar-header")).toBeTruthy();
    expect(screen.getByTestId("calendar-week-grid")).toBeTruthy();
    // Then the absence: no rail, no wordmark, no identity card.
    expect(document.querySelector(".lyceon-calendar .rail")).toBeNull();
    expect(document.querySelector(".brand")).toBeNull();
    expect(document.querySelector(".who")).toBeNull();
  });
});
