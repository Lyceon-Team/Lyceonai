/**
 * Pure formatting for the review landing's "Review a past session" picker.
 *
 * @spec [Doc-02B_V4 §16; ruling 20 ("no stored labels" — the server ships facts, the
 *        client writes the sentence); brief R4 §2.3] | @implemented [2026-09-22]
 *
 * plain English: turns R3's `sessions[]` facts into the two lines the picker shows —
 * "Practice, 2:40 PM" (UI-52) and "Math · Algebra" — and groups the rows under "Today",
 * "Yesterday" or "Thu, Sep 17" (US style, OQ-66 (g)). Expected outcome: a student sees their own days, in
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
 *   - `filters` is narrowed field by field and anything unrecognised degrades to "Mixed"
 *     instead of throwing. Since F-52 a practice row carries its criteria flat (before, practice
 *     nested them under `session_spec`, so every practice row read "Mixed").
 */

import { displayFormName } from "@lyceon/shared/exam-form-display";
import { formatDate } from "@/lib/format-date";

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

  // `localDate` is already the student's own calendar day, which the one student formatter
  // never shifts by a zone (QA 2026-10-07 item 15; OQ-66 (g), Karl, 2026-10-07: US style,
  // "Thu, Sep 17").
  return formatDate(localDate, "short-weekday-month-day") ?? "Earlier";
}

/**
 * "Practice" / "Review" / "Full-length test" — the engine a queued question originally
 * came from (wording: owner ruling OQ-62 (b), Karl, 2026-10-05, was "Practice test").
 * `full_length` is a full-length test: its wrong and blank items
 * are queued once it is scored (SCL-158), and the student picks it here exactly as they
 * pick a practice session.
 */
export function sourceEngineLabel(engine: string): string {
  if (engine === "review") return "Review";
  if (engine === "full_length") return "Full-length test";
  return "Practice";
}

/**
 * The first line of a picker row, as the Review prototype writes it (`{kind}, {time}`, UI-52):
 * "Practice, 2:40 PM".
 */
export function sourceHeadline(
  engine: string,
  localTime: string | null,
): string {
  const who = sourceEngineLabel(engine);
  return localTime === null ? who : `${who}, ${localTime}`;
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
 * "Math · Algebra", "Reading & Writing · Mixed", "Diagnostic", or — for a full-length
 * test — the form's display name, "Full-Length Test 1" for a stored "Practice Test 1" (owner
 * ruling 2026-10-05, `displayFormName`; "Full-length test" when the server sent none, e.g. a
 * form no longer published).
 *
 * `filters` is the row's criteria (`{sections, domains, skills, difficulties}`, F-52) or a
 * full-length row's `{test_form_name}`; it is still read as `unknown` and narrowed field by
 * field, so anything unrecognised degrades to "Mixed".
 */
export function sourceFiltersLine(
  mode: string | null,
  filters: unknown,
  engine?: string,
): string {
  if (mode === "diagnostic") return "Diagnostic";

  const bag: Record<string, unknown> =
    filters !== null && typeof filters === "object" && !Array.isArray(filters)
      ? (filters as Record<string, unknown>)
      : {};

  // A full-length test row carries exactly one fact, its form's name (review-pool.ts).
  if (typeof bag.test_form_name === "string" && bag.test_form_name.length > 0) {
    return displayFormName(bag.test_form_name);
  }
  if (engine === "full_length") return "Full-length test";

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
