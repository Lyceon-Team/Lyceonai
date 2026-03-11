import { describe, expect, it } from 'vitest';

import { isCanonicalKpiAttemptEventType } from '../server/services/kpi-truth-layer';
import { isCalendarCountedEventType } from '../apps/api/src/routes/calendar';

describe('Canonical Review Outcome Consumption', () => {
  const included = [null, 'PRACTICE_SUBMIT', 'REVIEW_PASS', 'REVIEW_FAIL'];
  const excluded = ['TUTOR_HELPED', 'TUTOR_FAIL', 'TUTOR_VIEW'];

  it('KPI truth layer includes canonical review outcomes and excludes tutor-only events', () => {
    for (const eventType of included) {
      expect(isCanonicalKpiAttemptEventType(eventType)).toBe(true);
    }
    for (const eventType of excluded) {
      expect(isCanonicalKpiAttemptEventType(eventType)).toBe(false);
    }
  });

  it('student calendar includes canonical review outcomes and excludes tutor-only events', () => {
    for (const eventType of included) {
      expect(isCalendarCountedEventType(eventType)).toBe(true);
    }
    for (const eventType of excluded) {
      expect(isCalendarCountedEventType(eventType)).toBe(false);
    }
  });

});
