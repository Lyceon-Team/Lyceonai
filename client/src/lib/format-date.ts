/**
 * The one date formatter for the student UI.
 *
 * @spec [production QA 2026-10-07 item 15 (Karl: "one shared date formatter app-wide" for the
 *        student UI); owner ruling OQ-66 (g), Karl, 2026-10-07: "US date format, \"Fri, Sep 25\",
 *        through the shared formatter. Re-check every date surface."; Doc_05F §8.2 (a plan date
 *        is the student's LOCAL date, not an instant)] | @implemented [2026-10-07]
 *
 * plain English: every student surface that shows a date or a time asks this module, by style,
 * so the same moment never reads three ways on three pages (before item 15: "October 7, 2026",
 * "7 Oct 2026", "10/7/2026" and "Thu, Oct 7" side by side). The house style is US English (OQ-66
 * (g), which replaced the prototypes' day-first "Fri 25 Sep" on 2026-10-07): month before day
 * ("October 7, 2026"), a comma after a weekday ("Fri, Sep 25"), month names in full unless the
 * style says short, and a 12-hour clock ("2:05 PM").
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
 * always "Sep"), but the ORDER and the punctuation are assembled here from `formatToParts`,
 * because locales and ICU versions disagree on them, and a date line must not change with the
 * browser. Not for the calendar's compact grid labels (features/calendar/lib/dates.ts keeps its
 * `M/D – M/D` title, column heads and day numbers, which are not sentences) and not for the
 * guardian or admin surfaces, which are other verticals' pages.
 */

export type DateStyle =
  /** "September 26" */
  | "month-day"
  /** "September 26, 2026" */
  | "month-day-year"
  /** "Monday, September 28" */
  | "weekday-month-day"
  /** "Fri, Sep 25" */
  | "short-weekday-month-day"
  /** "2:05 PM" */
  | "time"
  /** "Fri, Sep 25, 12:49 PM" */
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

/** "Fri, Sep 25": the short form, alone or ahead of a time. */
function shortWeekdayMonthDay(p: Parsed): string {
  const d = dayParts(p, { weekday: "short", month: "short", day: "numeric" });
  return `${d.weekday ?? ""}, ${d.month ?? ""} ${d.day ?? ""}`;
}

/** A date or time in the house style (see the module note), or null for an unparseable value. */
export function formatDate(
  value: string | Date,
  style: DateStyle,
): string | null {
  const p = parse(value);
  if (p === null) return null;
  switch (style) {
    case "month-day": {
      const d = dayParts(p, { month: "long", day: "numeric" });
      return `${d.month ?? ""} ${d.day ?? ""}`;
    }
    case "month-day-year": {
      const d = dayParts(p, { month: "long", day: "numeric", year: "numeric" });
      return `${d.month ?? ""} ${d.day ?? ""}, ${d.year ?? ""}`;
    }
    case "weekday-month-day": {
      const d = dayParts(p, { weekday: "long", month: "long", day: "numeric" });
      return `${d.weekday ?? ""}, ${d.month ?? ""} ${d.day ?? ""}`;
    }
    case "short-weekday-month-day":
      return shortWeekdayMonthDay(p);
    case "time":
      return clock(p);
    case "date-time":
      return `${shortWeekdayMonthDay(p)}, ${clock(p)}`;
  }
}
