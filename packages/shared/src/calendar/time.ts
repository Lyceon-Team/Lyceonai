/**
 * Calendar time primitives — local dates and instants, as strings, with no `Date`.
 *
 * @spec [Doc_05F §8.2 (local dates), §13 (unit sort order), §22.4 (midnight, LA);
 *        lyceon-coding-standards §3.4]
 * | @implemented [2026-09-17]
 *
 * plain English: the calendar's two time shapes. A LOCAL DATE is `YYYY-MM-DD` in the
 * timezone the plan date itself carries (§8.2 — never today's profile value). An INSTANT is
 * the engine's UTC timestamp for one activity unit, and §13 sorts units by it.
 *
 * WHY NO `Date`. Every module under `calendar/` is pure and clock-free, and `new Date(s)`
 * would be both a host-dependent parse (two engines, two answers on a malformed string) and
 * the one construct a reader cannot distinguish from reading the clock. The arithmetic here
 * is integer-only and total, which is the same discipline the PL/pgSQL generators run under.
 *
 * expected outcome: `instantSortKey` orders any two legal timestamps the way the database
 * would, whatever offset form they arrived in — `…T13:00:00Z`, `…T13:00:00+00:00` and
 * `…T09:00:00-04:00` are one instant and sort as one.
 *
 * trade-offs: a hand-written parser is more code than `Date.parse`. It is also the only way
 * to keep the promise above, and it is ~30 lines of arithmetic with no branches that depend
 * on anything but the input.
 *
 * edge cases: local dates compare correctly as plain strings because `YYYY-MM-DD` is
 * lexicographically ordered — instants do NOT, which is exactly why `instantSortKey` exists.
 */
import { z } from "zod";

// ── Local dates ─────────────────────────────────────────────────────────────

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in each month, 1-indexed; February is resolved by `isLeapYear`. */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH[month] ?? 0;
}

/** `2026-02-31` matches the pattern and is not a date. This is the difference. */
export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export const localDateSchema = z
  .string()
  .refine(isValidLocalDate, { message: "expected a calendar date as YYYY-MM-DD" });
export type LocalDate = z.infer<typeof localDateSchema>;

/**
 * Days since 1970-01-01 for a proleptic Gregorian civil date (Hinnant's `days_from_civil`).
 * Total for any integer inputs; callers hand it values `isValidLocalDate` has already
 * accepted.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * Whole days from `from` to `to`, negative when `to` is earlier. Used for "this day is in
 * the past" and for range widths; never for anything that needs a wall clock.
 */
export function daysBetweenLocalDates(from: LocalDate, to: LocalDate): number {
  const a = LOCAL_DATE_PATTERN.exec(from);
  const b = LOCAL_DATE_PATTERN.exec(to);
  if (a === null || b === null) return 0;
  return (
    daysFromCivil(Number(b[1]), Number(b[2]), Number(b[3])) -
    daysFromCivil(Number(a[1]), Number(a[2]), Number(a[3]))
  );
}

// ── Instants ────────────────────────────────────────────────────────────────

/**
 * `YYYY-MM-DD` then `T` or a space, `HH:MM`, optional `:SS`, optional fractional seconds,
 * then a zone: `Z`, `±HH:MM`, `±HHMM` or `±HH`. That is the set PostgREST and the Supabase
 * client actually produce for a `timestamptz`, plus the plain `Z` form a test fixture writes.
 * A timestamp with NO zone is refused: it has no instant, only a wish.
 */
const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?(?:([Zz])|([+-])(\d{2}):?(\d{2})?)$/;

type InstantParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number;
};

function parseInstantParts(value: string): InstantParts | null {
  const match = INSTANT_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const fraction = match[7] ?? "";
  const millisecond = fraction === "" ? 0 : Number(fraction.slice(0, 3).padEnd(3, "0"));
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  // 24:00 is a legal ISO-8601 end-of-day and Postgres never emits it; refusing it keeps the
  // hour field meaning one thing. A leap second (:60) is likewise not something a
  // timestamptz produces.
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (match[8] === undefined) {
    const sign = match[9] === "-" ? -1 : 1;
    const offsetHours = Number(match[10]);
    const offsetRemainder = match[11] === undefined ? 0 : Number(match[11]);
    if (offsetHours > 23 || offsetRemainder > 59) return null;
    offsetMinutes = sign * (offsetHours * 60 + offsetRemainder);
  }
  return { year, month, day, hour, minute, second, millisecond, offsetMinutes };
}

export function isValidInstant(value: string): boolean {
  return parseInstantParts(value) !== null;
}

export const instantSchema = z.string().refine(isValidInstant, {
  message: "expected an ISO-8601 timestamp carrying a UTC offset",
});
export type Instant = z.infer<typeof instantSchema>;

/**
 * Milliseconds since the Unix epoch. The ONE ordering authority for activity units (§13
 * sorts by `occurred_at` first), so two forms of the same instant compare equal and a
 * cross-midnight session splits by real time rather than by string shape.
 *
 * Returns 0 for a string that is not an instant. Callers reach this only through
 * `instantSchema`, which has already refused those; the fallback exists so the function is
 * total and never throws (Definition of Done: no throw).
 */
export function instantSortKey(value: Instant): number {
  const parts = parseInstantParts(value);
  if (parts === null) return 0;
  const days = daysFromCivil(parts.year, parts.month, parts.day);
  const secondsOfDay = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const utcSeconds = days * 86400 + secondsOfDay - parts.offsetMinutes * 60;
  return utcSeconds * 1000 + parts.millisecond;
}

/**
 * Postgres `EXTRACT(DOW …)` for a local date: Sunday = 0 … Saturday = 6. The same
 * convention `student_study_profile.study_days_mask` and `full_length_weekday` use, and the
 * one the generators use — never ISODOW. 1970-01-01 was a Thursday, which is the `+ 4`.
 */
export function postgresDowOfLocalDate(value: LocalDate): number {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) return 0;
  const days = daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3]));
  return (((days + 4) % 7) + 7) % 7;
}

/** `days_from_civil` inverted (Hinnant's `civil_from_days`). Total for any integer. */
function civilFromDays(days: number): { year: number; month: number; day: number } {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: month <= 2 ? year + 1 : year, month, day };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Calendar-day arithmetic on a local date. Days, never hours: a local date has no time, so
 * adding to it can never cross a DST boundary or need a zone.
 */
export function addDaysToLocalDate(value: LocalDate, days: number): LocalDate {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) return value;
  const civil = civilFromDays(
    daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3])) + days,
  );
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
}
