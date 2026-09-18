/**
 * The UTC window of one student-local calendar day.
 *
 * @spec [Doc-05F_V1.0 §8.2 (local dates), §22.4 (midnight, LA);
 *        Doc_05F_formula_sheet.md §6]
 * | @implemented [2026-09-18]
 *
 * plain English: the adapters ask "what did this student answer on 2026-09-13, in
 * the timezone that date was planned in". Postgres stores `answered_at` as an
 * instant, so that question is a half-open instant range, and this computes it.
 *
 * WHY HERE AND NOT IN `@lyceon/shared`. The shared calendar layer is deliberately
 * `Date`-free and clock-free — it takes local dates as strings and never converts
 * between zones. Converting a local date to an instant genuinely needs the IANA
 * database, which `Intl` has and a pure string module does not. Server code may use
 * `Date`; the shared layer may not. This is the seam.
 *
 * expected outcome: §22.4 reproduces. In America/Los_Angeles, 2026-09-13 runs from
 * 2026-09-13T07:00:00Z to 2026-09-14T07:00:00Z, so a session that starts at 23:50
 * local has its pre-midnight items on the 13th and the rest on the 14th.
 *
 * edge cases: DST. The offset is resolved AT the boundary instant rather than
 * assumed, by measuring the zone's offset and re-measuring once after applying it —
 * the standard two-pass fix, which lands correctly on both the spring-forward day
 * (23 hours) and the fall-back day (25 hours).
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The offset of `timeZone` at `instant`, in minutes east of UTC.
 *
 * Formats the instant in the zone, reads the wall-clock fields back, and takes the
 * difference. `Intl` is the only thing in the runtime that knows the IANA rules.
 */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: string): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number(found.value);
  };

  // `hour` can come back as 24 for midnight under hour12:false in some runtimes.
  const hour = field("hour") % 24;
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour,
    field("minute"),
    field("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The instant at which `localDate` begins in `timeZone`. */
function startOfLocalDay(localDate: string, timeZone: string): Date {
  const match = ISO_DATE.exec(localDate);
  if (match === null) {
    throw new Error(`localDayWindowUtc: ${localDate} is not a YYYY-MM-DD date`);
  }
  const naiveUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );

  // Pass one: offset at the naive instant. Pass two: re-measure after applying it,
  // which is what makes a DST boundary land on the right side.
  const firstGuess = new Date(naiveUtc - offsetMinutesAt(new Date(naiveUtc), timeZone) * 60_000);
  const secondOffset = offsetMinutesAt(firstGuess, timeZone);
  return new Date(naiveUtc - secondOffset * 60_000);
}

export type LocalDayWindow = {
  /** Inclusive. */
  startUtc: string;
  /** EXCLUSIVE — a half-open range, so no instant belongs to two days. */
  endUtc: string;
};

/**
 * The half-open UTC window `[start, end)` covering one local day.
 *
 * Computed from the day's own start and the NEXT day's start rather than
 * start + 24h, so a 23-hour or 25-hour DST day is the length it actually is.
 */
export function localDayWindowUtc(localDate: string, timeZone: string): LocalDayWindow {
  const match = ISO_DATE.exec(localDate);
  if (match === null) {
    throw new Error(`localDayWindowUtc: ${localDate} is not a YYYY-MM-DD date`);
  }
  const start = startOfLocalDay(localDate, timeZone);
  const nextDay = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1),
  );
  const nextLocalDate = nextDay.toISOString().slice(0, 10);
  const end = startOfLocalDay(nextLocalDate, timeZone);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/**
 * True when `timeZone` is a zone this runtime knows. The route additionally checks
 * it against `pg_timezone_names`, which is the database's own list and the
 * authority — this is the cheap first pass, not the decision.
 */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
