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

export const SAT_SCORE_RELEASE_SOURCE_URL =
  "https://satsuite.collegeboard.org/scores/score-release-dates";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * The dates around one test that College Board publishes once it confirms the test date:
 * the registration deadline, the deadline for changes, regular cancellation and late
 * registration, and the student score release date.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A.1 ("official SAT test dates, registration deadlines and
 *       score release dates from College Board, kept as configuration in the repo and refreshed
 *       each testing year"); owner answer on Doc 10B Phase 1 Step 0, item 6 (Karl, 2026-10-11):
 *       "Extend shared/sat-test-dates.ts, published College Board dates only."]
 *       | @implemented [2026-10-11]
 *
 * plain English: present only on dates College Board has published these for (the confirmed
 * 2026-27 dates as of 2026-10-11); an anticipated date carries none, never an estimate. Read
 * by the content plan (days to test, registration reminders, score-release posts); no student
 * surface shows them.
 */
export const satTestDeadlinesSchema = z
  .object({
    registration: isoDateSchema,
    late_registration: isoDateSchema,
    scores_released: isoDateSchema,
    source_url: z.string().url(),
    scores_source_url: z.string().url(),
    verified_on: isoDateSchema,
  })
  .strict();
export type SatTestDeadlines = z.infer<typeof satTestDeadlinesSchema>;

export const satTestDateSchema = z
  .object({
    date: isoDateSchema,
    status: z.enum(["confirmed", "anticipated"]),
    source_url: z.string().url(),
    verified_on: isoDateSchema,
    deadlines: satTestDeadlinesSchema.optional(),
  })
  .strict();
export type SatTestDate = z.infer<typeof satTestDateSchema>;

const VERIFIED_ON = "2026-10-09";
/** The day the deadlines and score release dates were read from College Board's two pages. */
const DEADLINES_VERIFIED_ON = "2026-10-11";

function entry(
  date: string,
  status: SatTestDate["status"],
  deadlines?: [registration: string, late: string, scores: string],
): SatTestDate {
  return satTestDateSchema.parse({
    date,
    status,
    source_url: SAT_DATES_SOURCE_URL,
    verified_on: VERIFIED_ON,
    ...(deadlines
      ? {
          deadlines: {
            registration: deadlines[0],
            late_registration: deadlines[1],
            scores_released: deadlines[2],
            source_url: SAT_DATES_SOURCE_URL,
            scores_source_url: SAT_SCORE_RELEASE_SOURCE_URL,
            verified_on: DEADLINES_VERIFIED_ON,
          },
        }
      : {}),
  });
}

export const SAT_TEST_DATES: readonly SatTestDate[] = Object.freeze([
  // 2026-27 (confirmed): [registration deadline, changes / late registration deadline, student
  // score release], read 2026-10-11 from the dates-deadlines and score-release-dates pages.
  entry("2026-10-03", "confirmed", ["2026-09-18", "2026-09-22", "2026-10-16"]),
  entry("2026-11-07", "confirmed", ["2026-10-23", "2026-10-27", "2026-11-20"]),
  entry("2026-12-05", "confirmed", ["2026-11-20", "2026-11-24", "2026-12-18"]),
  entry("2027-03-06", "confirmed", ["2027-02-19", "2027-02-23", "2027-03-19"]),
  entry("2027-05-01", "confirmed", ["2027-04-16", "2027-04-20", "2027-05-14"]),
  entry("2027-06-05", "confirmed", ["2027-05-21", "2027-05-25", "2027-06-21"]),
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

export type SatCalendarEventKind =
  | "registration_deadline"
  | "late_registration_deadline"
  | "test_day"
  | "scores_released";

export type SatCalendarEvent = {
  date: string;
  kind: SatCalendarEventKind;
  test_date: string;
  source_url: string;
};

/**
 * Every published SAT calendar event from `from` to `to` inclusive (YYYY-MM-DD), ascending by
 * date, then in the order a student meets them (Doc 10B §3A.1-2). Anticipated test dates appear
 * as test days only: College Board has published no deadlines for them.
 */
export function satCalendarEvents(
  from: string,
  to: string,
): SatCalendarEvent[] {
  const order: readonly SatCalendarEventKind[] = [
    "registration_deadline",
    "late_registration_deadline",
    "test_day",
    "scores_released",
  ];
  const events: SatCalendarEvent[] = [];
  for (const t of SAT_TEST_DATES) {
    events.push({
      date: t.date,
      kind: "test_day",
      test_date: t.date,
      source_url: t.source_url,
    });
    if (t.deadlines) {
      const d = t.deadlines;
      events.push(
        {
          date: d.registration,
          kind: "registration_deadline",
          test_date: t.date,
          source_url: d.source_url,
        },
        {
          date: d.late_registration,
          kind: "late_registration_deadline",
          test_date: t.date,
          source_url: d.source_url,
        },
        {
          date: d.scores_released,
          kind: "scores_released",
          test_date: t.date,
          source_url: d.scores_source_url,
        },
      );
    }
  }
  return events
    .filter((e) => e.date >= from && e.date <= to)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        order.indexOf(a.kind) - order.indexOf(b.kind),
    );
}

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative once `date` has passed. */
export function daysUntil(today: string, date: string): number {
  const ms = (d: string): number => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1);
  };
  return Math.round((ms(date) - ms(today)) / 86_400_000);
}
