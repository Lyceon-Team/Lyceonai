/**
 * Pure formatting for the review landing's "Review a past session" picker.
 *
 * @spec [Doc-02B_V4 §16; ruling 20 ("no stored labels" — the server ships facts, the
 *        client writes the sentence); brief R4 §2.3] | @implemented [2026-09-22]
 *
 * plain English: turns R3's `sessions[]` facts into the two lines the picker shows —
 * "Practice · 2:40 PM" and "Math · Algebra" — and groups the rows under "Today",
 * "Yesterday" or "Thu, Sep 17". Expected outcome: a student sees their own days, in
 * their own clock, without the server ever storing a display string.
 *
 * WHY EVERY FUNCTION HERE IS PURE AND TAKES `today` AS AN ARGUMENT. "Today" is the one
 * thing that cannot be derived from a row: it depends on the browser's clock and zone.
 * Passing it in makes the grouping deterministic and testable, and makes the timezone
 * bug an explicit argument rather than an implicit `new Date()` buried in a component.
 * R3 already computed each row's `local_date`/`local_time` in the zone the client sent
 * as `?tz=` (`review-pool.ts:398-420`), so the client must compare against a "today"
 * in that SAME zone — comparing against a UTC today mislabels every evening row west of
 * Greenwich.
 *
 * trade-offs: the day header needs `Intl` twice (once for today, once per label). That
 * is a handful of formatter constructions per render, which is nothing against getting
 * the student's own date wrong.
 *
 * edge cases:
 *   - a row whose parent session row is gone has `local_date: null`; it groups under
 *     "Earlier" rather than being dropped, because its questions are still queued and
 *     hiding the only way to reach them would lose them.
 *   - `filters` arrives as `unknown` (it is a jsonb column), so it is narrowed field by
 *     field and anything unrecognised degrades to "Mixed" instead of throwing.
 */

/** `YYYY-MM-DD` in the given IANA zone. `en-CA` is the locale that formats that way. */
export function localDateKey(date: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      ...(timeZone === null ? {} : { timeZone }),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // An unusable zone is expected input here, not a programming error: fall back to
    // the host's own zone rather than failing the whole picker.
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

/** The day before `key` (a `YYYY-MM-DD` string), as the same kind of string. */
function previousDayKey(key: string): string | null {
  const parsed = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
}

/**
 * "Today", "Yesterday", or "Thu, Sep 17". `todayKey` is the caller's local date, which
 * is why this never reads the clock itself.
 */
export function dayHeaderLabel(
  localDate: string | null,
  todayKey: string,
): string {
  if (localDate === null) return "Earlier";
  if (localDate === todayKey) return "Today";
  if (localDate === previousDayKey(todayKey)) return "Yesterday";

  // Parsed as UTC and formatted as UTC: `localDate` is already the student's own
  // calendar day, so re-interpreting it in any zone would shift it by one.
  const parsed = Date.parse(`${localDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return "Earlier";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(parsed));
}

/** "Practice" / "Review" — the engine a queued question originally came from. */
export function sourceEngineLabel(engine: string): string {
  return engine === "review" ? "Review" : "Practice";
}

/** The first line of a picker row: "Practice · 2:40 PM". */
export function sourceHeadline(
  engine: string,
  localTime: string | null,
): string {
  const who = sourceEngineLabel(engine);
  return localTime === null ? who : `${who} · ${localTime}`;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

const SECTION_LABELS: Readonly<Record<string, string>> = {
  M: "Math",
  RW: "Reading & Writing",
};

/**
 * The second line of a picker row: the source session's mode and filters, e.g.
 * "Math · Algebra", "Reading & Writing · Mixed", or "Diagnostic".
 *
 * `filters` is the session's raw metadata (jsonb), so every read narrows.
 */
export function sourceFiltersLine(
  mode: string | null,
  filters: unknown,
): string {
  if (mode === "diagnostic") return "Diagnostic";

  const bag: Record<string, unknown> =
    filters !== null && typeof filters === "object" && !Array.isArray(filters)
      ? (filters as Record<string, unknown>)
      : {};

  const sections = stringList(bag.sections);
  const domains = stringList(bag.domains);
  const skills = stringList(bag.skills);

  const sectionPart =
    sections.length === 1 && sections[0] !== undefined
      ? (SECTION_LABELS[sections[0]] ?? sections[0])
      : sections.length > 1
        ? "All sections"
        : null;

  const topicPart =
    domains.length === 1 && domains[0] !== undefined
      ? domains[0]
      : domains.length > 1
        ? `${domains.length} domains`
        : skills.length === 1 && skills[0] !== undefined
          ? skills[0]
          : skills.length > 1
            ? `${skills.length} skills`
            : "Mixed";

  const parts = [sectionPart, topicPart].filter(
    (p): p is string => p !== null && p.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : "Mixed";
}

/** One day's worth of picker rows, already labelled. */
export type SessionDayGroup<T> = {
  key: string;
  label: string;
  rows: T[];
};

/**
 * Group rows under day headers, newest day first, preserving R3's newest-first order
 * within each day (`review-pool.ts:592-598`).
 */
export function groupByLocalDay<T extends { local_date: string | null }>(
  rows: readonly T[],
  todayKey: string,
): SessionDayGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.local_date ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      // A dateless group sorts last: an unknown day is not a recent one.
      if (a === b) return 0;
      if (a === "") return 1;
      if (b === "") return -1;
      return a < b ? 1 : -1;
    })
    .map(([key, rows]) => ({
      key: key === "" ? "unknown" : key,
      label: dayHeaderLabel(key === "" ? null : key, todayKey),
      rows,
    }));
}
