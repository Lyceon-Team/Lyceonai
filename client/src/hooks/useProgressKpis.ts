import {
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";

/**
 * @spec [Coding Standards §11.2; student-ui register UI-14; owner ruling 2026-10-01 (Brief 10,
 *        dashboard KPI polling)] | @implemented [2026-10-01] |
 * plain English: the one read of `GET /api/progress/kpis`, and the one way to mark it out of
 * date. `/dashboard` and `/practice` read it until their rebuilds (UI-50, UI-51, 2026-10-03)
 * removed the KPI tiles DESIGN.md §4 does not have; no page reads it today, and the session
 * runners still invalidate it, so a page that shows KPIs again reads them here. It does not poll. It refetches when the
 * window regains focus (if the cached copy is older than `QUERY_FRESHNESS.kpis.staleTime`), and
 * whenever a practice, review or exam session completes in this tab
 * (`invalidateProgressKpis`).
 *
 * Why no timer: KPIs only change after the student answers questions, and those answers happen
 * in this tab (session completion invalidates) or in another one (focus refetches). A 60-second
 * interval cost every open dashboard 60 requests an hour and kept the API function warm for
 * nobody (observed in production 2026-10-01, register UI-18).
 *
 * Edge cases: each page keeps its own view type of the response (`T`), unchanged.
 */
export const PROGRESS_KPIS_QUERY_KEY = ["/api/progress/kpis"] as const;

export function useProgressKpis<T>(enabled: boolean): UseQueryResult<T> {
  return useQuery<T>({
    queryKey: PROGRESS_KPIS_QUERY_KEY,
    enabled,
    ...QUERY_FRESHNESS.kpis,
  });
}

/** Mark the KPIs stale after a session completes; active readers refetch at once. */
export function invalidateProgressKpis(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: PROGRESS_KPIS_QUERY_KEY });
}
