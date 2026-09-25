/**
 * @spec [Doc_05F_Study_Calendar, §8.2 local dates, R-08-30 Monday-anchored local ISO week]
 * @implemented [2026-09-23]
 *
 * plain English: local-date arithmetic for the week and month grids. Expected outcome: the
 * week the student sees starts on a Monday and the dates never shift by a day.
 *
 * EVERY DATE HERE IS A LOCAL `YYYY-MM-DD` STRING AND NOTHING ELSE. §8.2 says a plan date is
 * the student's LOCAL date, which is not a moment in time — `2026-09-21` in Chicago and
 * `2026-09-21` in Tokyo are the same plan day and different instants. Parsing one into a
 * local `Date` is the classic way to land a day early or late, so these functions parse to
 * UTC midnight, do the arithmetic there, and format back. The `Date` never leaves this
 * module and is never rendered from.
 *
 * trade-offs: no date library. The operations are add-days, start-of-week, month-grid and
 * format; a dependency for that would be a dependency to audit, and the owner's approval
 * this round covers @dnd-kit only.
 *
 * edge cases: `startOfWeek` is Monday-anchored per R-08-30, which is NOT what
 * `Date.getUTCDay()` gives (it puts Sunday at 0) — hence the `(dow + 6) % 7` shift.
 */

/** UTC midnight for a local date string. Never exported: see the module note. */
function parse(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function format(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = parse(date);
  value.setUTCDate(value.getUTCDate() + days);
  return format(value);
}

/** 0 = Sunday, as `getUTCDay` gives it. Used only where the Postgres DOW convention applies. */
export function dayOfWeek(date: string): number {
  return parse(date).getUTCDay();
}

/** R-08-30: the local ISO week starts on MONDAY. */
export function startOfWeek(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

/** The first of the month `date` falls in. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}

export function addMonths(date: string, months: number): string {
  const value = parse(startOfMonth(date));
  value.setUTCMonth(value.getUTCMonth() + months);
  return format(value);
}

export function dayOfMonth(date: string): number {
  return parse(date).getUTCDate();
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

export const WEEK_LENGTH = 7;
/** Six rows of seven — the month grid always has the same shape, so it never reflows. */
export const MONTH_GRID_LENGTH = 42;

/** The seven local dates of the week containing `date`, Monday first. */
export function weekDates(date: string): readonly string[] {
  const first = startOfWeek(date);
  return Array.from({ length: WEEK_LENGTH }, (_, index) =>
    addDays(first, index),
  );
}

/**
 * The 42 dates of the month grid containing `date` — the Monday on or before the 1st, then
 * six full weeks. Fixed length on purpose: a grid that is five rows in one month and six in
 * the next makes the page jump as the student pages through it.
 */
export function monthGridDates(date: string): readonly string[] {
  const first = startOfWeek(startOfMonth(date));
  return Array.from({ length: MONTH_GRID_LENGTH }, (_, index) =>
    addDays(first, index),
  );
}

/**
 * The range one query must cover for a view. The month grid spills into the neighbouring
 * months, so the read has to span the whole grid or the first and last rows render empty and
 * look like rest days.
 */
/**
 * Step a cursor by whole days / whole months.
 *
 * These were private to `CalendarView`, which was fine while it was the only caller. The
 * §17.7 adjacent-range prefetch needs the SAME arithmetic to name the week either side, and
 * a second copy of a date helper is how two surfaces end up disagreeing about which week is
 * next. `shiftMonths` normalises to the first of the month first, so stepping from the 31st
 * cannot skip a short month.
 */
export function shiftDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function shiftMonths(date: string, months: number): string {
  const value = new Date(`${startOfMonth(date)}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

export function rangeForView(
  view: "week" | "month",
  cursor: string,
): { from: string; to: string } {
  if (view === "week") {
    const dates = weekDates(cursor);
    return { from: dates[0] ?? cursor, to: dates[dates.length - 1] ?? cursor };
  }
  const dates = monthGridDates(cursor);
  return { from: dates[0] ?? cursor, to: dates[dates.length - 1] ?? cursor };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Monday-first column headers, matching the grids. */
export const WEEKDAY_HEADERS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export function shortWeekday(date: string): string {
  return WEEKDAYS_SHORT[dayOfWeek(date)] ?? "";
}

export function monthName(date: string): string {
  return MONTHS[parse(date).getUTCMonth()] ?? "";
}

/** "Monday 21 September" — the side sheet's date line. */
export function longDate(date: string): string {
  return `${WEEKDAYS_LONG[dayOfWeek(date)] ?? ""} ${dayOfMonth(date)} ${monthName(date)}`;
}

/** "Mon 21 Sep" — compact, for toasts and the move picker. */
export function shortDate(date: string): string {
  return `${shortWeekday(date)} ${dayOfMonth(date)} ${monthName(date).slice(0, 3)}`;
}

/**
 * The top bar's range label: "21 – 27 September" inside one month, "28 Sep – 4 Oct" across
 * two, and "September 2026" in month view.
 */
export function rangeLabel(view: "week" | "month", cursor: string): string {
  if (view === "month") return `${monthName(cursor)} ${cursor.slice(0, 4)}`;
  const dates = weekDates(cursor);
  const first = dates[0] ?? cursor;
  const last = dates[dates.length - 1] ?? cursor;
  if (isSameMonth(first, last)) {
    return `${dayOfMonth(first)} – ${dayOfMonth(last)} ${monthName(first)}`;
  }
  return `${dayOfMonth(first)} ${monthName(first).slice(0, 3)} – ${dayOfMonth(last)} ${monthName(last).slice(0, 3)}`;
}
