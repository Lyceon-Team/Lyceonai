// @vitest-environment jsdom
/**
 * §17.7 — stepping a week does not blank the plan.
 *
 * @spec [Doc 05F §15, §17.7; Brief 11 Step 6] | @implemented [2026-09-24]
 *
 * Every `GET /api/calendar` returned 200; nothing here was an error. The roughness was that
 * a different range is a different query key, so the arrow press had no data for the new key
 * and the page fell to its loading state for the 800–1,100 ms the read takes. The plan
 * vanished and came back on every press.
 *
 * The assertion is about what the CALLER can see: on a range change with the previous range
 * already resolved, the hook never reports a loading state, and it keeps serving rows
 * throughout. `isLoading` is what `calendar.tsx` branches on to render the skeleton, so it
 * is the exact signal that decides whether the page blanks.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarResponse } from "@lyceon/shared/calendar";
import { useCalendar } from "./queries";

const fetchCalendarMock = vi.fn();
vi.mock("./client", () => ({
  fetchCalendar: (...args: unknown[]) => fetchCalendarMock(...args),
  fetchGuardianCalendar: vi.fn(),
  fetchStreak: vi.fn(),
}));

function readyFor(from: string): CalendarResponse {
  return {
    status: "ready",
    profile: {
      timezone: "America/Chicago",
      target_exam_date: null,
      target_score: null,
      study_days_mask: 62,
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
    estimates: { practice_seconds_per_unit: 90, review_seconds_per_unit: 120 },
    days: [
      {
        local_date: from,
        status: "planned",
        is_study_day: true,
        is_user_override: false,
        planned_count: 1,
        actual_count: 0,
        extra_count: 0,
        blocks: [],
      },
    ],
    facts: { planned_total: 1, done_total: 0, extra_total: 0 },
    streak: { current: 3, longest: 5, history_complete: true },
    latest_unacknowledged_nonstudent_change: null,
    diagnostic_state: "baseline_ready",
    enabled_block_types: ["practice", "review"],
  } as unknown as CalendarResponse;
}

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  fetchCalendarMock.mockReset();
});

describe("a week change keeps the previous week on screen", () => {
  it("never reports a loading state once a range has resolved", async () => {
    // The second week resolves only when we say so, so the window in which the page could
    // blank is held open for the assertion rather than raced past.
    let releaseSecond: (value: CalendarResponse) => void = () => {};
    fetchCalendarMock
      .mockResolvedValueOnce(readyFor("2026-09-21"))
      .mockImplementationOnce(
        () =>
          new Promise<CalendarResponse>((resolve) => {
            releaseSecond = resolve;
          }),
      );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ from, to }: { from: string; to: string }) => useCalendar(from, to),
      {
        wrapper: wrapperWith(client),
        initialProps: { from: "2026-09-21", to: "2026-09-27" },
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const firstWeek = result.current.data;
    expect(firstWeek).toBeDefined();

    // Step to the next week. Its fetch is still in flight.
    rerender({ from: "2026-09-28", to: "2026-10-04" });

    // THE ASSERTION. Without `keepPreviousData` this is `true` and the page renders
    // <CalendarSkeleton /> in place of the plan.
    expect(result.current.isLoading).toBe(false);
    // …and there are still rows to draw, which are the previous week's.
    expect(result.current.data).toEqual(firstWeek);
    expect(result.current.isPlaceholderData).toBe(true);

    releaseSecond(readyFor("2026-09-28"));
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data).not.toEqual(firstWeek);
  });

  it("stepping BACK to a cached week issues no request at all", async () => {
    fetchCalendarMock
      .mockResolvedValueOnce(readyFor("2026-09-21"))
      .mockResolvedValueOnce(readyFor("2026-09-28"));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ from, to }: { from: string; to: string }) => useCalendar(from, to),
      {
        wrapper: wrapperWith(client),
        initialProps: { from: "2026-09-21", to: "2026-09-27" },
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ from: "2026-09-28", to: "2026-10-04" });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(fetchCalendarMock).toHaveBeenCalledTimes(2);

    // Back to the first week, which is inside its 30s staleTime.
    rerender({ from: "2026-09-21", to: "2026-09-27" });
    expect(result.current.isLoading).toBe(false);
    expect(fetchCalendarMock).toHaveBeenCalledTimes(2);
  });

  it("the FIRST ever load still shows a loading state — there is nothing to keep", async () => {
    // The other half: `keepPreviousData` must not paper over a genuine cold start, or the
    // page renders an empty plan as though it were the student's.
    fetchCalendarMock.mockImplementation(
      () => new Promise<CalendarResponse>(() => {}),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () => useCalendar("2026-09-21", "2026-09-27"),
      { wrapper: wrapperWith(client) },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});
