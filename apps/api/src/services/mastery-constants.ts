/**
 * MASTERY V1.0 EVENT TAXONOMY
 *
 * Canonical event-type vocabulary + counted-event sets for KPI/calendar.
 *
 * NOTE (MA-06, 2026-06-23): the superseded Doc-02C scoring scalars (ALPHA, BASE_DELTA,
 * M_INIT/M_MIN/M_MAX, HALF_LIFE_WEEKS, DIAGNOSTIC_*, MASTERY_STATUS_THRESHOLDS,
 * DEFAULT_QUESTION_WEIGHT) were removed. The live mastery math is DB-side
 * (`apply_learning_event_to_mastery` + `mastery_constants`), and UI status is derived from
 * the canonical `mastery_level`, never app-code literals. This file keeps only the event
 * vocabulary (the one piece consumed in TS).
 */

// ============================================================================
// A. Event Types (closed set - no free strings allowed)
// ============================================================================

export enum MasteryEventType {
  PRACTICE_PASS = "practice_pass",
  PRACTICE_FAIL = "practice_fail",
  REVIEW_PASS = "review_pass",
  REVIEW_FAIL = "review_fail",
  TUTOR_HELPED = "tutor_helped",
  TUTOR_FAIL = "tutor_fail",
  TEST_PASS = "test_pass",
  TEST_FAIL = "test_fail",
}

// ============================================================================
// B. Event Weights (impact multipliers)
// ============================================================================

/**
 * Event weights control how impactful each attempt type is.
 *
 * Rationale:
 * - Practice events are baseline evidence
 * - Review events are stronger than practice
 * - Tutor effects are auxiliary and only emitted after verified retry
 * - Full-test outcomes are highest trust anchors
 *
 * Fixed constants for v1.0 - do not learn/fit
 */
export const EVENT_WEIGHTS: Record<MasteryEventType, number> = {
  [MasteryEventType.PRACTICE_PASS]: 1.0,
  [MasteryEventType.PRACTICE_FAIL]: 1.0,
  [MasteryEventType.REVIEW_PASS]: 1.2,
  [MasteryEventType.REVIEW_FAIL]: 1.2,
  [MasteryEventType.TUTOR_HELPED]: 0.25,
  [MasteryEventType.TUTOR_FAIL]: 0.25,
  [MasteryEventType.TEST_PASS]: 1.5,
  [MasteryEventType.TEST_FAIL]: 1.5,
};

export const REVIEW_OUTCOME_EVENTS: ReadonlyArray<MasteryEventType> = [
  MasteryEventType.REVIEW_PASS,
  MasteryEventType.REVIEW_FAIL,
];

export const TUTOR_EFFECT_EVENTS: ReadonlyArray<MasteryEventType> = [
  MasteryEventType.TUTOR_HELPED,
  MasteryEventType.TUTOR_FAIL,
];

// Canonical KPI/calendar counted attempts (exclude tutor-only auxiliary effects).
export const KPI_CALENDAR_COUNTED_EVENTS: ReadonlyArray<MasteryEventType> = [
  MasteryEventType.PRACTICE_PASS,
  MasteryEventType.PRACTICE_FAIL,
  MasteryEventType.REVIEW_PASS,
  MasteryEventType.REVIEW_FAIL,
];
