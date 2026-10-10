/**
 * Email quiet hours: when a student- or guardian-facing email may be delivered.
 *
 * @spec [owner ruling, Karl 2026-10-09, schedule audit Step 2 item 2: "no student- or
 *       guardian-facing email between 21:00 and 08:00 America/Chicago; an email due in that
 *       window is deferred to the next 08:00 America/Chicago, never dropped; exempt only
 *       user-triggered emails"; contracts/notifications.contract.md §6.6]
 *       | @implemented [2026-10-09]
 *
 * plain English: one pure function. Given an instant, it answers either "send now" (null) or
 * "not before <the next 08:00 America/Chicago>". The window is half-open, [21:00, 08:00): 20:59
 * sends, 21:00 defers, 07:59 defers, 08:00 sends. The hour and the 08:00 instant are both read
 * from the IANA database through `Intl` (local-day.ts), so they are exact in CDT and in CST and
 * on the two changeover days; 08:00 is never inside a DST gap (the changes happen at 02:00).
 *
 * The audience decides whether it applies at all (`EmailAudience` in packages/shared):
 * `student_or_guardian` is subject to it; `user_triggered` and `ops` are not. A missing audience
 * is treated as `student_or_guardian` — a send that does not say who it is for is held to the
 * stricter rule.
 *
 * Deterministic: the clock is a parameter, never read here.
 */
import {
  EMAIL_QUIET_HOURS_END_HOUR,
  EMAIL_QUIET_HOURS_START_HOUR,
  EMAIL_QUIET_HOURS_TIME_ZONE,
  type EmailAudience,
} from "../../../packages/shared/src/notifications-schema";
import {
  localHourIn,
  localTodayIn,
  localWallTimeUtc,
  nextLocalDate,
} from "../../services/calendar/adapters/local-day";

/** True when quiet hours govern this audience. */
export function quietHoursApply(audience: EmailAudience | undefined): boolean {
  return audience === undefined || audience === "student_or_guardian";
}

/**
 * null when `now` is outside the quiet window; otherwise the instant of the next 08:00
 * America/Chicago, before which a student- or guardian-facing email must not be delivered.
 */
export function quietHoursDeferral(now: Date): Date | null {
  const hour = localHourIn(EMAIL_QUIET_HOURS_TIME_ZONE, now);
  if (
    hour >= EMAIL_QUIET_HOURS_END_HOUR &&
    hour < EMAIL_QUIET_HOURS_START_HOUR
  ) {
    return null;
  }
  const today = localTodayIn(EMAIL_QUIET_HOURS_TIME_ZONE, now);
  // After 21:00 the next 08:00 is tomorrow's; before 08:00 it is today's.
  const day =
    hour >= EMAIL_QUIET_HOURS_START_HOUR ? nextLocalDate(today) : today;
  return localWallTimeUtc(
    day,
    EMAIL_QUIET_HOURS_END_HOUR,
    EMAIL_QUIET_HOURS_TIME_ZONE,
  );
}
