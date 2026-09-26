// @vitest-environment jsdom
/**
 * §17.7 at 390px — one day, not seven columns behind a swipe.
 *
 * @spec [Doc 05F §17.1, §17.7; Brief 11 Step 5] | @implemented [2026-09-24]
 *
 * MEASURED FIRST, THEN CHANGED. Before this, at 390px, the week grid was 7 × 132px = 924px
 * inside a 390px `.scroll` with `overflow: auto` — `scrollWidth` 924 against `clientWidth`
 * 390, verified in Chromium against the real stylesheet. It did not overflow the page and
 * it did not collapse: it scrolled sideways, showing about three days, with Sunday 534px
 * away and nothing on screen to say it existed.
 *
 * jsdom does no layout, so these tests assert the STRUCTURE that makes the layout possible
 * — one day column and a strip of seven — and the Chromium harness in the PR carries the
 * pixels. Between them: what renders, and what it measures.
 */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarReadyResponse } from "@lyceon/shared/calendar";
import { CalendarView } from "./CalendarView";
import { studentViewModel } from "./lib/view-model";

const TODAY = "2026-09-24";

/** `useIsMobile` reads BOTH `matchMedia` and `innerWidth`; a mock of one alone is a lie. */
function setViewport(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: width < 768,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

const ESTIMATES = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 120,
};

const RESPONSE = {
  status: "ready",
  profile: {
    timezone: "America/Chicago",
    target_exam_date: null,
    target_score: 1400,
    study_days_mask: 127,
    daily_minutes: 60,
    full_length_weekday: 6,
    planner_mode: "auto",
    setup_completed_at: "2026-09-01T00:00:00Z",
  },
  bounds: {
    daily_minutes_min: 15,
    daily_minutes_max: 180,
    daily_minutes_presets: [15, 30, 45, 60, 90, 120],
    target_exam_date_max_days: 540,
  },
  estimates: ESTIMATES,
  days: [
    {
      local_date: TODAY,
      timezone: "America/Chicago",
      is_user_override: false,
      is_study_day: true,
      version_no: 1,
      status: "today",
      blocks: [
        {
          block: {
            block_id: "11111111-1111-4111-8111-111111111111",
            scheduled_date: TODAY,
            source: "auto",
            derived_from_block_id: null,
            explanation_key: "weighted",
            display_ordinal: 1,
            membership_type: "created",
            block_type: "practice",
            section: "M",
            scope: {
              level: "domain",
              mix: [{ domain: "Algebra", count: 10, explanation_key: "weak" }],
            },
            target_count: 10,
          },
          actual: 0,
          progress: 0,
          status: "scheduled",
        },
      ],
      extra_work: [],
      planned_count: 10,
      actual_count: 0,
      extra_count: 0,
    },
  ],
  facts: {
    blocks_total: 1,
    blocks_completed: 0,
    blocks_partial: 0,
    blocks_missed: 0,
    blocks_in_progress: 0,
    blocks_scheduled: 1,
    questions_completed: 0,
    full_lengths_completed: 0,
    extra_questions: 0,
  },
  streak: { current: 3, longest: 5, history_complete: true },
  latest_unacknowledged_nonstudent_change: null,
  diagnostic_state: "baseline_ready",
  enabled_block_types: ["practice", "review"],
} as unknown as CalendarReadyResponse;

function renderCalendar(): void {
  render(
    <CalendarView
      viewer="student"
      model={studentViewModel(RESPONSE)}
      today={TODAY}
      viewerName="A Student"
      targetExamDate={null}
      streak={{ current: 3, longest: 5, history_complete: true }}
      planUpdate={null}
      onRangeChange={() => {}}
    />,
  );
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("the phone gets a single-day agenda", () => {
  it("renders the day strip and exactly ONE day column", () => {
    setViewport(390);
    renderCalendar();

    expect(screen.getByTestId("calendar-day-strip")).toBeTruthy();
    const columns = document.querySelectorAll("[data-testid^='calendar-day-']");
    const dayColumns = Array.from(columns).filter((el) =>
      /^calendar-day-\d{4}-\d{2}-\d{2}$/.test(
        el.getAttribute("data-testid") ?? "",
      ),
    );
    // Seven columns is the layout that needed 924px. One is the fix.
    expect(dayColumns).toHaveLength(1);
  });

  it("all seven days remain reachable — from the strip, not a sideways swipe", () => {
    setViewport(390);
    renderCalendar();
    const chips = screen
      .getByTestId("calendar-day-strip")
      .querySelectorAll("button");
    expect(chips).toHaveLength(7);
  });

  it("tapping a day in the strip swaps the agenda to that day", () => {
    setViewport(390);
    renderCalendar();

    expect(screen.getByTestId(`calendar-day-${TODAY}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId("calendar-day-chip-2026-09-26"));

    expect(screen.getByTestId("calendar-day-2026-09-26")).toBeTruthy();
    expect(screen.queryByTestId(`calendar-day-${TODAY}`)).toBeNull();
  });

  it("opens on TODAY when today is in the week", () => {
    setViewport(390);
    renderCalendar();
    expect(screen.getByTestId(`calendar-day-${TODAY}`)).toBeTruthy();
  });
});

describe("the desktop layout is untouched", () => {
  it("renders seven columns and NO strip above the breakpoint", () => {
    setViewport(1280);
    renderCalendar();

    expect(screen.queryByTestId("calendar-day-strip")).toBeNull();
    const dayColumns = Array.from(
      document.querySelectorAll("[data-testid^='calendar-day-']"),
    ).filter((el) =>
      /^calendar-day-\d{4}-\d{2}-\d{2}$/.test(
        el.getAttribute("data-testid") ?? "",
      ),
    );
    expect(dayColumns).toHaveLength(7);
  });
});

describe("Month stays a grid at every width", () => {
  it("shows no day strip in month view on a phone", () => {
    setViewport(390);
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    // A month IS a grid; collapsing it would leave nothing to navigate.
    expect(screen.queryByTestId("calendar-day-strip")).toBeNull();
  });
});
