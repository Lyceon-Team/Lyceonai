/**
 * The QOTD day: which question is "today", and which days are past.
 *
 * @spec [owner ruling "QOTD: day boundary at 04:00 UTC, social run at 04:05 UTC" (Karl,
 *        2026-10-27) items 1 and 3: the QOTD day runs 04:00 UTC to 04:00 UTC, fixed, everywhere
 *        the QOTD day is computed; "no student loses a streak because of the switch"; SCL recorded
 *        with this change] | @implemented [2026-10-27]
 *
 * plain English: the database's `public.qotd_day(at)` (migration 20261117100000) in TypeScript.
 * Before the cutover the QOTD day is the America/Chicago date; from the cutover on it is
 * `(at - 4 hours)` read in UTC, so day D runs from 04:00 UTC on D to 04:00 UTC on D+1. The
 * cutover is the Chicago midnight that followed the migration's apply, stored in
 * `qotd_day_boundary`; `null` here means it is not known (no migration yet, or the read failed),
 * which is the Chicago day, exactly what the database does without the migration.
 * trade-offs: the server reads the cutover from the database (cached), so it and the database can
 * never disagree about the switch. A build and the social generator have no database: they use
 * the rules below that do not need the cutover, each chosen to fail safe (see each).
 * edge cases: the cutover is a Chicago midnight, where both rules give the same date, so no label
 * is skipped or repeated across it; the first new day starts at that midnight and ends at 04:00
 * UTC.
 */
import {
  localDayWindowUtc,
  localTodayIn,
} from "../calendar/adapters/local-day";

/** The QOTD day before the cutover. */
export const QOTD_LEGACY_TIME_ZONE = "America/Chicago";
/** From the cutover on, a QOTD day starts at this UTC hour. */
export const QOTD_DAY_START_UTC_HOUR = 4;

const HOUR_MS = 60 * 60 * 1000;

/** When the 04:00 UTC day took over; null = not (known to be) switched. */
export type QotdCutover = Date | null;

/** The QOTD day of `at`. */
export function qotdDayOf(at: Date, cutoverAt: QotdCutover): string {
  if (cutoverAt === null || at.getTime() < cutoverAt.getTime()) {
    return localTodayIn(QOTD_LEGACY_TIME_ZONE, at);
  }
  return new Date(at.getTime() - QOTD_DAY_START_UTC_HOUR * HOUR_MS)
    .toISOString()
    .slice(0, 10);
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The first instant whose QOTD day is `date`. */
function qotdDayStart(date: string, cutoverAt: QotdCutover): Date {
  const legacy = new Date(
    localDayWindowUtc(date, QOTD_LEGACY_TIME_ZONE).startUtc,
  );
  if (cutoverAt === null || legacy.getTime() < cutoverAt.getTime())
    return legacy;
  const fixed = new Date(
    `${date}T${String(QOTD_DAY_START_UTC_HOUR).padStart(2, "0")}:00:00.000Z`,
  );
  // The first day after the switch starts at the cutover itself (a Chicago midnight).
  return fixed.getTime() > cutoverAt.getTime() ? fixed : cutoverAt;
}

/** The QOTD day `date` as `[start, end)` UTC instants (the public stats bucket's window). */
export function qotdDayWindowOf(
  date: string,
  cutoverAt: QotdCutover,
): { start: Date; end: Date } {
  return {
    start: qotdDayStart(date, cutoverAt),
    end: qotdDayStart(nextDate(date), cutoverAt),
  };
}

/**
 * For code with no database (a build): the latest day that is past under BOTH rules is the one
 * before this. The 04:00 UTC day only ever starts earlier than the Chicago one, so the Chicago
 * date is never ahead of it: taking it as "today" never treats as past a day either rule still
 * calls today, and a page that publishes a past day's answer can never publish today's.
 */
export function qotdTodayWithoutCutover(now: Date): string {
  return qotdDayOf(now, null);
}

/**
 * For the social generator (no database), which runs only after the switch: the 04:00 UTC rule.
 * Its run checks the public `/today` payload against this, so a database that has not switched
 * (the payload still on the Chicago day) is refused rather than posted.
 */
export function qotdTodaySwitched(now: Date): string {
  return qotdDayOf(now, new Date(0));
}
