/**
 * The one date formatter for the student UI.
 *
 * @spec [production QA 2026-10-07 item 15 (Karl: "one shared date formatter app-wide" for the
 *        student UI); the signed-off prototypes' date forms (Main.dc.html "Monday, 28 September";
 *        FullLength.dc.html "26 September"; Report.dc.html "26 September 2026"; times "12:49 PM");
 *        Doc_05F §8.2 (a plan date is the student's LOCAL date, not an instant)]
 *        | @implemented [2026-10-07]
 *
 * plain English: every student surface that shows a date or a time asks this module, by style,
 * so the same moment never reads three ways on three pages (before: "October 7, 2026",
 * "7 Oct 2026", "10/7/2026" and "Thu, Oct 7" side by side). The house style is the prototypes':
 * day before month ("7 October 2026"), month names in full unless the style says short, and a
 * 12-hour clock ("2:05 PM").
 *
 * TWO KINDS OF INPUT, one rule each:
 *   - a bare `YYYY-MM-DD` is a LOCAL CALENDAR DAY (a plan date, a test date, a legal effective
 *     date). It is formatted as that day and never shifted by a time zone: parsed at UTC midnight
 *     and formatted in UTC, as features/calendar/lib/dates.ts does for the calendar.
 *   - anything else is an INSTANT (an ISO timestamp, or a `Date`), formatted in the viewer's own
 *     zone, which is when it happened for them.
 * An unparseable value returns null, so each caller chooses its own fallback ("soon", the raw
 * value, nothing) rather than showing "Invalid Date".
 *
 * trade-offs: the words come from `Intl.DateTimeFormat` in English (en-US: its short month is
 * always "Sep", where en-GB's became "Sept" in newer ICU data), but the ORDER and the punctuation
 * are assembled here from `formatToParts`, because locales and ICU versions disagree on them, and
 * a date line must not change with the browser. Not for the calendar's own grids (features/calendar/lib/dates.ts
 * keeps its column headers and day numbers) and not for the guardian or admin surfaces, which are
 * other verticals' pages.
 */

export type DateStyle =
  /** "26 September" */
  | "day-month"
  /** "26 September 2026" */
  | "day-month-year"
  /** "26 Sep 2026" */
  | "day-short-month-year"
  /** "Monday, 28 September" */
  | "weekday-day-month"
  /** "Thu 17 Sep" (Main.dc.html / Practice.dc.html: "Fri 25 Sep, 12:49 PM") */
  | "short-weekday-day-month"
  /** "2:05 PM" */
  | "time"
  /** "26 September 2026, 2:05 PM" */
  | "date-time";

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

type Parsed = { date: Date; timeZone: string | undefined };

function parse(value: string | Date): Parsed | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : { date: value, timeZone: undefined };
  }
  if (LOCAL_DAY.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : { date, timeZone: "UTC" };
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : { date, timeZone: undefined };
}

type Part = "weekday" | "day" | "month" | "year";

function dayParts(
  p: Parsed,
  options: Intl.DateTimeFormatOptions,
): Partial<Record<Part, string>> {
  const out: Partial<Record<Part, string>> = {};
  const parts = new Intl.DateTimeFormat("en-US", {
    ...options,
    ...(p.timeZone === undefined ? {} : { timeZone: p.timeZone }),
  }).formatToParts(p.date);
  for (const part of parts) {
    if (
      part.type === "weekday" ||
      part.type === "day" ||
      part.type === "month" ||
      part.type === "year"
    )
      out[part.type] = part.value;
  }
  return out;
}

function clock(p: Parsed): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(p.timeZone === undefined ? {} : { timeZone: p.timeZone }),
  }).format(p.date);
}

/** A date or time in the house style (see the module note), or null for an unparseable value. */
export function formatDate(
  value: string | Date,
  style: DateStyle,
): string | null {
  const p = parse(value);
  if (p === null) return null;
  switch (style) {
    case "day-month": {
      const d = dayParts(p, { day: "numeric", month: "long" });
      return `${d.day ?? ""} ${d.month ?? ""}`;
    }
    case "day-month-year": {
      const d = dayParts(p, { day: "numeric", month: "long", year: "numeric" });
      return `${d.day ?? ""} ${d.month ?? ""} ${d.year ?? ""}`;
    }
    case "day-short-month-year": {
      const d = dayParts(p, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      return `${d.day ?? ""} ${d.month ?? ""} ${d.year ?? ""}`;
    }
    case "weekday-day-month": {
      const d = dayParts(p, { weekday: "long", day: "numeric", month: "long" });
      return `${d.weekday ?? ""}, ${d.day ?? ""} ${d.month ?? ""}`;
    }
    case "short-weekday-day-month": {
      const d = dayParts(p, {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      return `${d.weekday ?? ""} ${d.day ?? ""} ${d.month ?? ""}`;
    }
    case "time":
      return clock(p);
    case "date-time": {
      const d = dayParts(p, { day: "numeric", month: "long", year: "numeric" });
      return `${d.day ?? ""} ${d.month ?? ""} ${d.year ?? ""}, ${clock(p)}`;
    }
  }
}
