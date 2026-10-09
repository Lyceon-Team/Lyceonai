/**
 * Official SAT test dates (US weekend administrations), offered in onboarding, Settings and the
 * calendar.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09) Part A2: "Official dates
 *       live in shared/sat-test-dates.ts with each date, the College Board source URL and a
 *       'verified on' date. Only future dates are offered. Karl confirms the list."; SCL-223;
 *       Public Disclosure Doctrine 3 (general facts cite real sources).
 *
 *       Owner ruling on #1166 (Karl, 2026-10-09) item 3: the source is College Board's "SAT dates
 *       and deadlines" page; every published date, confirmed and anticipated, as far out as
 *       College Board publishes; no "expected" label; only future dates offered.]
 *       | @implemented [2026-10-09]
 *
 * plain English: each entry is a date College Board publishes, the page it was read from and the
 * day it was checked. The list runs as far out as the page does (through 2028-06-03 as verified
 * on 2026-10-09: six confirmed 2026-27 dates and eight anticipated 2027-28 dates). `status`
 * records which of the two College Board calls it, for maintenance only: no surface shows it,
 * and a student sees every offered date the same way. `offeredSatTestDates(today)` returns only
 * the dates after today, ascending; a date that has passed is never offered.
 *
 * Maintenance:
 *   - College Board confirms a date or publishes a new year: edit or add the entries and set
 *     `VERIFIED_ON` to the day the page was re-read.
 *   - College Board MOVES a date: change the entry here, then move every student who picked the
 *     old date with the owner-run data fix `scripts/ops/sat-test-date-move.sql` (it prints the
 *     counts before and after and fails closed if the old date survives). A stored choice is a
 *     plain date, so editing this file alone never rewrites anyone's saved dates.
 */
import { z } from "zod";

export const SAT_DATES_SOURCE_URL =
  "https://satsuite.collegeboard.org/sat/dates-deadlines";

export const satTestDateSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["confirmed", "anticipated"]),
    source_url: z.string().url(),
    verified_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type SatTestDate = z.infer<typeof satTestDateSchema>;

const VERIFIED_ON = "2026-10-09";

function entry(date: string, status: SatTestDate["status"]): SatTestDate {
  return satTestDateSchema.parse({
    date,
    status,
    source_url: SAT_DATES_SOURCE_URL,
    verified_on: VERIFIED_ON,
  });
}

export const SAT_TEST_DATES: readonly SatTestDate[] = Object.freeze([
  // 2026-27 (confirmed)
  entry("2026-10-03", "confirmed"),
  entry("2026-11-07", "confirmed"),
  entry("2026-12-05", "confirmed"),
  entry("2027-03-06", "confirmed"),
  entry("2027-05-01", "confirmed"),
  entry("2027-06-05", "confirmed"),
  // 2027-28 (anticipated)
  entry("2027-08-28", "anticipated"),
  entry("2027-09-18", "anticipated"),
  entry("2027-10-09", "anticipated"),
  entry("2027-11-06", "anticipated"),
  entry("2027-12-04", "anticipated"),
  entry("2028-03-04", "anticipated"),
  entry("2028-05-06", "anticipated"),
  entry("2028-06-03", "anticipated"),
]);

/** The official dates strictly after `today` (YYYY-MM-DD, America/Chicago), ascending. */
export function offeredSatTestDates(today: string): SatTestDate[] {
  return SAT_TEST_DATES.filter((d) => d.date > today)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** "Sat, Nov 7, 2026" for a YYYY-MM-DD date, without a time-zone shift. */
export function formatSatTestDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** Today's date (YYYY-MM-DD) in America/Chicago, the day boundary every QOTD surface uses. */
export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * What a picker shows: the official future dates, plus any FUTURE date the student already
 * saved that is not on the list (an older free-form calendar entry), so saving never drops a
 * choice silently. Ascending.
 */
export function satDateOptions(
  today: string,
  saved: readonly string[],
): { date: string; official: boolean }[] {
  const official = offeredSatTestDates(today).map((d) => d.date);
  const extra = saved.filter((d) => d > today && !official.includes(d));
  return [
    ...official.map((date) => ({ date, official: true })),
    ...extra.map((date) => ({ date, official: false })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}
