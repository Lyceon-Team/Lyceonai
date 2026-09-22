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
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  CalendarResponse,
  GuardianCalendarResponse,
  StreakSummary,
} from "@lyceon/shared";
import { calendarKeys } from "./keys";
import { fetchCalendar, fetchGuardianCalendar, fetchStreak } from "./client";

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
  });
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
