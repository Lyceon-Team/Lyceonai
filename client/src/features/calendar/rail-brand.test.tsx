// @vitest-environment jsdom
/**
 * The calendar rail's "Lyceon" wordmark: the student's calendar keeps it; a caller can hide it.
 *
 * @spec [owner decision 2026-10-01 on PR 1003, item 6 ("hide its 'Lyceon' wordmark when
 *       viewer='guardian', via a prop, not a fork. Student snapshots must stay identical");
 *       Guardian_Closure_Plan R11] | @implemented [2026-10-01]
 *
 * plain English: the student calendar — the one with no other chrome above it — draws the
 * wordmark at the top of its rail, exactly as before. The guardian half is driven through the
 * real guardian route in `features/guardian/calendar-tab.test.tsx`.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CalendarReadyResponse } from "@lyceon/shared/calendar";
import { CalendarView } from "./CalendarView";
import { studentViewModel } from "./lib/view-model";
import { studentCalendarWeek } from "./calendar-week.fixture";

afterEach(cleanup);

const TODAY = "2026-10-01";

describe("the calendar rail's wordmark", () => {
  it("the student's calendar keeps it", () => {
    const { requestId: _requestId, ...payload } = studentCalendarWeek(TODAY);
    render(
      <CalendarView
        viewer="student"
        model={studentViewModel(payload as CalendarReadyResponse)}
        today={TODAY}
        viewerName="A Student"
        targetExamDate={null}
        streak={undefined}
        fullLengthSuppressions={[]}
        planUpdate={null}
        onRangeChange={() => {}}
        backHref="/dashboard"
      />,
    );
    expect(
      document.querySelector(".lyceon-calendar .rail .who"),
    ).not.toBeNull();
    expect(
      document
        .querySelector(".lyceon-calendar .rail .brand")
        ?.textContent?.trim(),
    ).toBe("Lyceon");
  });
});
