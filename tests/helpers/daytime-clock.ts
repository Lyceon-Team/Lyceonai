/**
 * Pin the process clock to Chicago daytime for suites whose sends run on `new Date()`.
 *
 * @spec [owner ruling, Karl 2026-10-09, schedule audit Step 2 item 2 (email quiet hours,
 *       21:00–08:00 America/Chicago); contracts/notifications.contract.md C6.6]
 *       | @implemented [2026-10-09]
 *
 * plain English: since quiet hours, a notification email sent through a route (which reads the
 * process clock) is postponed when the suite happens to run between 21:00 and 08:00 Chicago —
 * 02:00–13:00 UTC in summer. A suite that asserts "the email was sent" would then pass or fail
 * by the hour CI ran it. This pins `Date` (only `Date`; timers stay real and the clock keeps
 * ticking) to 17:00 UTC on the real current UTC date — 12:00 CDT / 11:00 CST — so the same
 * assertions hold at any hour, and the JS clock stays within a day of the database's `now()`.
 * Quiet hours themselves are proved with explicit clocks in tests/ci/notification-quiet-hours.*.
 */
import { vi } from "vitest";

export function chicagoDaytimeToday(real: Date = new Date()): Date {
  return new Date(`${real.toISOString().slice(0, 10)}T17:00:00.000Z`);
}

export function pinDaytimeClock(): void {
  const target = chicagoDaytimeToday();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(target);
}

export function releaseClock(): void {
  vi.useRealTimers();
}
