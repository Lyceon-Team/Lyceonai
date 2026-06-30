/**
 * MASTERY V1.0 — DB-SIDE OWNERSHIP
 *
 * The mastery formula, event weights, difficulty weights, source weights,
 * and all scoring constants live in the DB (canonical mastery RPC +
 * `mastery_constants` table). TS has no mastery-formula logic.
 *
 * This file keeps only the KPI/calendar event-type vocabulary consumed by
 * calendar-month-view.ts to classify counted attempts.
 */

// Canonical KPI/calendar counted attempts (exclude tutor-only auxiliary effects).
export const KPI_CALENDAR_COUNTED_EVENTS: ReadonlyArray<string> = [
  "practice_pass",
  "practice_fail",
  "review_pass",
  "review_fail",
];
