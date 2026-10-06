/**
 * @spec [Doc_05F_Study_Calendar §17.5 (setup: "every control preselected from `defaults` so
 *        pressing straight through writes a real profile"), §8.1; SCL-130; student-UI register
 *        UI-55, OQ-25] | @implemented [2026-10-03]
 *
 * plain English: the schedule a first profile save carries when the student was not asked for
 * one. Two surfaces create a profile: the paid setup popup (which shows these as its opening
 * chips) and the free calendar's inline form (test date and target only, DESIGN.md §4). The
 * profile route refuses a FIRST write without study days and daily minutes
 * (`REQUIRED_ON_CREATE`, server/services/calendar/profile-service.ts), so the inline form sends
 * the same opening positions the popup would have saved had the student pressed straight
 * through. One definition, so the two surfaces cannot create different profiles from the same
 * silence.
 *
 * edge cases: the timezone is the browser's, falling back to the server's suggestion when the
 * browser cannot say (the server applies the Chicago fall-open after that). The practice-test
 * pair stays null on create (R-08-27): silence never books an exam.
 */
import type { CalendarSetupDefaults } from "@lyceon/shared/calendar";

/**
 * Mon–Fri: the opening POSITION of the study-day chips, not a stored value and not a
 * recommendation. `calendar_runtime_config` holds no default day-mask, so this is the
 * prototype's, and it exists so that a student who presses straight through saves a week that
 * makes sense rather than an empty one. Sunday-is-0 (the Postgres DOW convention).
 */
export const OPENING_STUDY_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** The `study_days_mask` bit set for a list of Sunday-is-0 weekdays. */
export function maskOf(days: readonly number[]): number {
  let mask = 0;
  for (const d of days) mask |= 1 << d;
  return mask;
}

/** The fourth served preset (60 minutes in production), else the served minimum. */
export function openingDailyMinutes(defaults: CalendarSetupDefaults): number {
  return defaults.daily_minutes_presets[3] ?? defaults.daily_minutes_min;
}

/** What the browser thinks the student's zone is. Undetectable is an answer, not a crash. */
export function browserTimeZone(fallback: string): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    // A browser without a usable Intl is a browser the server has to guess for; the fallback
    // IS the behaviour here, not a silenced fault.
    return fallback;
  }
}

/** The schedule half of a first save when the student was asked only for date and target. */
export function openingSchedule(defaults: CalendarSetupDefaults): {
  study_days_mask: number;
  daily_minutes: number;
  timezone: string;
  full_length_weekday: null;
  full_length_interval_weeks: null;
} {
  return {
    study_days_mask: maskOf(OPENING_STUDY_DAYS),
    daily_minutes: openingDailyMinutes(defaults),
    timezone: browserTimeZone(defaults.timezone),
    full_length_weekday: null,
    full_length_interval_weeks: null,
  };
}
