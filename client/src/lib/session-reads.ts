/**
 * The reads a practice or review session's progress changes, marked stale in one place.
 *
 * @spec [owner QA list (Karl, 2026-10-07) item 6: "refetch 'Pick up where you left off', answered
 *        counts and session lists when a student submits or leaves a session (TanStack query
 *        invalidation of the right keys on answer submit, skip, end/leave session)"; Coding
 *        Standards §11.2 (server state through the query layer)] | @implemented [2026-10-07]
 *
 * plain English: every query in the app is cached with `staleTime: Infinity` (queryClient.ts), so
 * a list read once is shown as it was until something marks it stale. Answering, skipping, ending
 * or leaving a session changes what Home's "Pick up where you left off", Practice's and Review's
 * open-session rows ("N of M answered"), the review pool (queue, recent and past sessions), today's
 * plan (a block's done state) and the mastery rows show, so each of those calls this.
 *
 * WHAT IS REFETCHED. A list on screen (Practice's or Review's rows after "End") is refetched at
 * once; a list on a page that is not mounted (Home, while the runner is open) is only marked stale,
 * and asks the server afresh when that page mounts. The one exception is the session's own state
 * read (`/api/<engine>/sessions/:id/state`, resume-practice.tsx / resume-review.tsx): it is on
 * screen while the student answers, and refetching it on the last answer would swap the runner for
 * the "Session complete" card before the student had read that answer's feedback, so it is only
 * marked stale (`refetchType: "none"`). The next visit to the session, and the launch prefetch
 * (`useLaunchBlock`), then ask the server instead of serving the cached state.
 *
 * WHY PREDICATES FOR THE POOL. The review pool's key is its URL WITH `?tz=…` (useReview.ts,
 * `reviewPoolPath`), so the prefix key `["/api/review/pool"]` matches nothing: TanStack compares key
 * elements whole. The earlier invalidations written that way never fired (found 2026-10-07).
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { calendarKeys } from "@/features/calendar/api/keys";
import {
  REVIEW_OPEN_SESSIONS_QUERY_KEY,
  REVIEW_POOL_QUERY_KEY,
} from "@/hooks/useReview";

/** `GET /api/practice/sessions/open`'s key (useActiveSessions.ts). */
export const PRACTICE_OPEN_SESSIONS_QUERY_KEY = "/api/practice/sessions/open";

function firstKeyStartsWith(key: QueryKey, prefix: string): boolean {
  const head = key[0];
  return typeof head === "string" && head.startsWith(prefix);
}

function firstKeyIncludes(key: QueryKey, part: string): boolean {
  const head = key[0];
  return typeof head === "string" && head.includes(part);
}

/**
 * Marks stale every read a session's progress changes. `session` names the session whose own
 * state read should be marked too (its runner page reads it again on the next visit).
 */
export function invalidateSessionReads(
  client: QueryClient,
  session?: { engine: "practice" | "review"; sessionId: string },
): void {
  void client.invalidateQueries({
    queryKey: [PRACTICE_OPEN_SESSIONS_QUERY_KEY],
  });
  void client.invalidateQueries({ queryKey: [REVIEW_OPEN_SESSIONS_QUERY_KEY] });
  void client.invalidateQueries({
    predicate: (q) => firstKeyStartsWith(q.queryKey, REVIEW_POOL_QUERY_KEY),
  });
  void client.invalidateQueries({ queryKey: calendarKeys.ranges() });
  void client.invalidateQueries({
    predicate: (q) => firstKeyIncludes(q.queryKey, "/mastery/"),
  });
  if (session !== undefined) {
    const prefix = `/api/${session.engine}/sessions/${session.sessionId}/state`;
    void client.invalidateQueries({
      predicate: (q) => firstKeyStartsWith(q.queryKey, prefix),
      refetchType: "none",
    });
  }
}
