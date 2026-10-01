/**
 * @spec [Doc_05F_Study_Calendar, §15 API surface, §17.7 interaction rules]
 * @implemented [2026-09-23]
 *
 * plain English: ONE query-key factory for the whole calendar surface. Expected outcome:
 * every calendar read and every invalidation names its key from here, so a mutation cannot
 * invalidate a key that no query uses.
 *
 * WHY A FACTORY AND NOT URL-AS-KEY. Most of this app uses the URL as the query key and lets
 * `queryClient`'s default `queryFn` join it (`queryClient.ts`). That works for a read with
 * no parameters. The calendar read is `?from&to&device_timezone`, and after a mutation we
 * must invalidate EVERY cached range at once — a week the student is looking at, the month
 * behind it, the range the mini-month prefetched. With the URL as the key those are
 * unrelated strings. With a factory they share the `["calendar", "range"]` prefix and one
 * `invalidateQueries` reaches all of them.
 *
 * trade-offs: because the keys are structured rather than URLs, every calendar query MUST
 * pass an explicit `queryFn`. The default one would treat `["calendar","range",…]` as a
 * path and fetch `/calendar/range/...`, which is not a route.
 *
 * edge cases: `streak` is deliberately OUTSIDE the `range` prefix. A day edit changes the
 * plan and not the streak, and INV-08-20 serves the streak without an entitlement check —
 * folding it under the same prefix would make every edit refetch a resource it cannot
 * change, on a route with different auth.
 */
export const calendarKeys = {
  /** Everything calendar. Used only by a full reset (sign-out, student switch). */
  all: ["calendar"] as const,

  /** The prefix every student range read shares — the invalidation target for mutations. */
  ranges: () => ["calendar", "range"] as const,

  /**
   * One student range read. `deviceTimezone` is part of the key because it changes the
   * response: §17.3's `device_timezone_mismatch` is derived from it, so two ranges that
   * differ only by device zone are two different answers.
   */
  range: (from: string, to: string, deviceTimezone: string) =>
    ["calendar", "range", from, to, deviceTimezone] as const,

  /** §15 GET /api/me/streak. Its own key — see the module note above. */
  streak: () => ["calendar", "streak"] as const,

  /** The prefix every guardian range read shares. */
  guardianRanges: () => ["calendar", "guardian"] as const,

  /**
   * One guardian range read, scoped by student. `studentId` is the FIRST segment after the
   * prefix so a guardian switching students never reads another student's cached rows.
   */
  guardianRange: (studentId: string, from: string, to: string) =>
    ["calendar", "guardian", studentId, from, to] as const,
} as const;
