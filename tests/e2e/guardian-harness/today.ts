/**
 * The one "today" every guardian-e2e spec runs on — fixtures and browser alike.
 *
 * @spec [Guardian_Closure_Plan G4-07 (visual check); owner decisions 2026-10-01 on PR 1003
 *       (item 10, phone centring) and final review item 1 (phone block cards centred)]
 *       | @implemented [2026-10-03]
 *
 * plain English: the calendar week (`calendar-week.fixture.ts`) is built around "today", and
 * at 390px the calendar shows only today's column. The 390 centring checks measure that
 * column's block cards, so they need a day that has study blocks with scope chips. Taking
 * today from the real clock made them depend on the weekday: Saturday holds only a
 * full-length block (no chips) and Sunday is a rest day, so they failed every weekend
 * (guardian-e2e red on PR 1042, Sat 2026-10-03 UTC). Pinning both sides to one fixed
 * weekday makes the run the same on every day it runs.
 *
 * expected outcome: `E2E_TODAY` feeds the fixtures (Node, via `tsx`), and `pinBrowserToday`
 * sets the page's clock to the same date before the app loads, so the payload's week and the
 * browser's "today" agree. Wednesday has two ordinary blocks with chips; the rest of the week
 * (a done/missed past, a scheduled future, Saturday's full-length, Sunday's rest day) is
 * unchanged, so "Calendar, an empty day" still finds Sunday.
 *
 * trade-offs: `setFixedTime` freezes `Date` (timers keep running). `client/src/features/
 * calendar` and `client/src/features/guardian` read the clock only through
 * `browserLocalToday()`, never to measure elapsed time, so a frozen clock changes only which
 * day is "today". Noon UTC keeps the local date on Wednesday in any timezone from UTC-11 to
 * UTC+11.
 */
import type { Page } from "@playwright/test";

/** A Wednesday. The fixture's "today": one block done and one still to do, both with chips. */
export const E2E_TODAY = "2026-09-30";

/** Pins the page's `Date` to `E2E_TODAY` (noon UTC). Call before `page.goto`. */
export async function pinBrowserToday(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(`${E2E_TODAY}T12:00:00Z`));
}
