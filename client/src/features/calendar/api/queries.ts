/**
 * @spec [Doc_05F_Study_Calendar, §15 API surface, §16 guardian read, §17.7 interaction rules]
 * @implemented [2026-09-23]
 *
 * plain English: the three calendar reads. Expected outcome: one query covers the visible
 * range, so switching between Week and Month never refetches rows already held.
 *
 * REFETCH ON FOCUS IS DELIBERATE AND LOCAL. The app-wide `queryClient` sets
 * `refetchOnWindowFocus: false` and `staleTime: Infinity`, which is right for a question
 * bank and wrong for a plan the student just changed in another tab — or, far more often,
 * for coming back from a practice session in which they completed the very block this page
 * is showing as unstarted. §17.7 says "refetch on route focus", so these three queries
 * opt back in rather than the global default changing under every other feature.
 */
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect } from "react";
import type {
  CalendarResponse,
  GuardianCalendarResponse,
  StreakSummary,
} from "@lyceon/shared/calendar";
import { calendarKeys } from "./keys";
import { fetchCalendar, fetchGuardianCalendar, fetchStreak } from "./client";
import { rangeForView, shiftDays, shiftMonths } from "../lib/dates";

/**
 * The device's IANA zone, for §17.3's mismatch prompt and the pre-setup `defaults.timezone`.
 * `resolvedOptions().timeZone` is absent on very old engines, so the empty string stands for
 * "the device did not say" — the server treats a missing `device_timezone` as exactly that
 * and falls back to `America/Chicago` (formula sheet item 19).
 */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    // A browser without a usable Intl is not an error state for the calendar — it is a
    // browser the server has to guess for. Swallowing this specific failure is the
    // behaviour, not a silenced bug.
    return "";
  }
}

/**
 * §15 GET /api/calendar for one visible range.
 *
 * `enabled` guards the initial render before a range is known. The query is NOT disabled on
 * a 402: an entitlement denial is an answer the page renders (§17.5), so it must reach the
 * error state rather than being suppressed into a permanent loading spinner.
 */
export function useCalendar(
  from: string,
  to: string,
  options?: { enabled?: boolean },
): UseQueryResult<CalendarResponse, Error> {
  const timezone = deviceTimezone();
  return useQuery<CalendarResponse, Error>({
    queryKey: calendarKeys.range(from, to, timezone),
    queryFn: () => fetchCalendar(from, to, timezone),
    enabled: options?.enabled ?? true,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
    /**
     * §17.7. Stepping a week is a NEW query key — a different range is a different
     * resource, which is right — but without this the page had no data for the new key and
     * fell to its loading state for the 800–1,100 ms the read takes. The plan vanished and
     * came back on every arrow press.
     *
     * `keepPreviousData` leaves the previous week on screen until the next resolves. It is
     * not a cache of the wrong answer: `isPlaceholderData` says the rows are the old
     * range's, so a caller that needs to know can ask, and nothing here is written back.
     */
    placeholderData: keepPreviousData,
  });
}

/**
 * §17.7 — warm the ranges either side of the one being read, once the browser is idle.
 *
 * WHY IDLE AND NOT IMMEDIATELY. Two extra reads issued alongside the one the student is
 * waiting for would compete with it; the point is to be ready for the NEXT arrow press, not
 * to make this one slower. `requestIdleCallback` yields until the main thread is free, and
 * falls back to a timeout on engines without it (Safari, at time of writing).
 *
 * `prefetchQuery` is a no-op when the key is already fresh, so stepping back and forth over
 * the same two weeks issues no requests at all after the first pass.
 *
 * Disabled while the current read is in flight or has failed: prefetching around a range
 * that is itself erroring would turn one failure into three.
 */
export function usePrefetchAdjacentRange(
  view: "week" | "month",
  cursor: string,
  options?: { enabled?: boolean },
): void {
  const client = useQueryClient();
  const timezone = deviceTimezone();
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    const neighbours =
      view === "week"
        ? [shiftDays(cursor, -7), shiftDays(cursor, 7)]
        : [shiftMonths(cursor, -1), shiftMonths(cursor, 1)];

    let cancelled = false;
    const run = (): void => {
      if (cancelled) return;
      for (const neighbour of neighbours) {
        const range = rangeForView(view, neighbour);
        void client.prefetchQuery({
          queryKey: calendarKeys.range(range.from, range.to, timezone),
          queryFn: () => fetchCalendar(range.from, range.to, timezone),
          staleTime: 30_000,
        });
      }
    };

    const idle = globalThis.requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(run, { timeout: 2_000 });
      return () => {
        cancelled = true;
        globalThis.cancelIdleCallback?.(handle);
      };
    }
    const handle = setTimeout(run, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [client, view, cursor, timezone, enabled]);
}

/**
 * §15 GET /api/me/streak. INV-08-20: no `calendar_access` check, so this succeeds for a free
 * student whose calendar read is answering 402 — which is why it is a separate query and not
 * a field the page reads off the calendar payload when it renders the upgrade prompt.
 */
export function useStreak(options?: {
  enabled?: boolean;
}): UseQueryResult<StreakSummary, Error> {
  return useQuery<StreakSummary, Error>({
    queryKey: calendarKeys.streak(),
    queryFn: fetchStreak,
    enabled: options?.enabled ?? true,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * §16 GET /api/students/:studentId/calendar — the guardian's narrow projection.
 *
 * A SEPARATE hook against a separate schema, never `useCalendar` with a flag. The guardian
 * payload is its own `.strict()` union in `packages/shared` with no profile, no target score
 * and no explanation copy at either level; sharing a hook would mean sharing a type, and a
 * type wide enough for both is a type that lets a guardian field through.
 */
export function useGuardianCalendar(
  studentId: string,
  from: string,
  to: string,
  options?: { enabled?: boolean },
): UseQueryResult<GuardianCalendarResponse, Error> {
  return useQuery<GuardianCalendarResponse, Error>({
    queryKey: calendarKeys.guardianRange(studentId, from, to),
    queryFn: () => fetchGuardianCalendar(studentId, from, to),
    enabled: (options?.enabled ?? true) && studentId.length > 0,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
  });
}
