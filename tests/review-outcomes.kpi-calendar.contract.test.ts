import { describe, expect, it } from 'vitest';

import { KPI_CALENDAR_COUNTED_EVENTS } from '../apps/api/src/services/mastery-constants';
import { isCalendarCountedEventType } from '../apps/api/src/routes/calendar';

const COUNTED_EVENTS = new Set<string>(KPI_CALENDAR_COUNTED_EVENTS);

function isCanonicalKpiAttemptEventType(eventType: string | null | undefined): boolean {
  if (!eventType) return true;
  return COUNTED_EVENTS.has(eventType);
}

describe('Canonical Review Outcome Consumption', () => {
  const included = [null, 'practice_pass', 'practice_fail', 'review_pass', 'review_fail'];
  const excluded = ['tutor_helped', 'tutor_fail', 'test_pass', 'test_fail'];

  it('canonical KPI counted-event set includes review outcomes and excludes tutor-only events', () => {
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
