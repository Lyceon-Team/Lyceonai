import { describe, expect, it } from 'vitest';

import { isCanonicalKpiAttemptEventType } from '../server/services/kpi-truth-layer';
import { isCalendarCountedEventType } from '../apps/api/src/routes/calendar';

describe('Canonical Review Outcome Consumption', () => {
  const included = [null, 'practice_pass', 'practice_fail', 'review_pass', 'review_fail'];
  const excluded = ['tutor_helped', 'tutor_fail', 'test_pass', 'test_fail'];

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
