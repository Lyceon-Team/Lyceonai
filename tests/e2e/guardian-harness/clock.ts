/**
 * One "today" for the guardian-e2e job: the fixtures and the browser agree on it, and neither
 * reads the real clock.
 *
 * @spec [n/a — e2e test-harness tooling; serves the browser checks of Guardian_Closure_Plan
 *       R12 (16px floor) and owner decision 2026-10-01 item 10 (phone centring)]
 *       | @implemented [2026-10-03]
 *
 * plain English: the calendar fixtures are built around "today" (`calendarWeekRange(today)`),
 * and the app draws "today" from the browser's clock (`browserLocalToday()`). Both used to read
 * the real date, so what the phone calendar showed — and so whether the centring and scope-chip
 * checks found anything to measure — depended on the weekday CI ran on: the same commit passed
 * on Friday 2026-10-02 and failed on Saturday 2026-10-03. Now the fixture generator builds every
 * payload for `E2E_TODAY`, and each spec freezes the page's clock at noon UTC on that date in
 * a UTC time zone, before the first navigation.
 *
 * WHY THIS DATE. A weekday on which the shared week fixture has blocks with scope chips on
 * "today", so the phone checks have real content to measure (they fail closed on an empty
 * match, by design). Change it only together with a green run of the three specs.
 */
import type { Page } from "@playwright/test";

/** The single "today" of the guardian-e2e job (a Friday). */
export const E2E_TODAY = "2026-10-02";

/** Freeze the page's wall clock at noon UTC on `E2E_TODAY`. Call before the first `goto`. */
export async function pinClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(`${E2E_TODAY}T12:00:00.000Z`));
}
