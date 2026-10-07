/**
 * @spec [production QA 2026-10-07 item 15 (one shared date formatter for the student UI); owner
 *        ruling OQ-66 (g) (US date format); Doc_05F §8.2 (a local date is not an instant)]
 *        | @implemented [2026-10-07]
 *
 * plain English: the house style (US, owner ruling OQ-66 (g), Karl, 2026-10-07: "Fri, Sep 25"),
 * every style once; a local `YYYY-MM-DD` day never shifts with
 * the zone (checked in the zone furthest west and east of UTC); an instant is shown in the
 * viewer's zone; unparseable input is null. Plus the guard that keeps it the ONE formatter: no
 * student-scope source file formats a date by hand any more.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate } from "./format-date";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatDate: the house style (US, OQ-66 (g))", () => {
  it.each([
    ["month-day", "September 26"],
    ["month-day-year", "September 26, 2026"],
    ["weekday-month-day", "Saturday, September 26"],
    ["short-weekday-month-day", "Sat, Sep 26"],
  ] as const)("a local day, %s: %s", (style, expected) => {
    expect(formatDate("2026-09-26", style)).toBe(expected);
  });

  it('the ruling\'s own examples: "Fri, Sep 25", "Fri, Sep 25, 12:49 PM", "October 7, 2026", "Monday, September 28"', () => {
    expect(formatDate("2026-09-25", "short-weekday-month-day")).toBe(
      "Fri, Sep 25",
    );
    // A local day carries no clock, so the with-time form is shown on an instant (UTC here).
    expect(formatDate("2026-09-25T12:49:00Z", "date-time")).toMatch(
      /^Fri, Sep 25, \d{1,2}:49 [AP]M$/,
    );
    expect(formatDate("2026-10-07", "month-day-year")).toBe("October 7, 2026");
    expect(formatDate("2026-09-28", "weekday-month-day")).toBe(
      "Monday, September 28",
    );
  });

  it("never day-first: no style puts the day number before the month name", () => {
    const styles = [
      "month-day",
      "month-day-year",
      "weekday-month-day",
      "short-weekday-month-day",
      "date-time",
    ] as const;
    for (const style of styles) {
      const out = formatDate("2026-09-26T15:00:00Z", style) ?? "";
      // Presence first: a real date came back.
      expect([style, out]).toEqual([style, expect.stringMatching(/Sep/)]);
      expect([style, out]).not.toEqual([
        style,
        expect.stringMatching(
          /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/,
        ),
      ]);
    }
  });

  it("an instant: time and date-time on a 12-hour clock, in the viewer's zone", () => {
    // 2026-10-07T14:05Z is 2:05 PM in UTC and 7:05 AM in Los Angeles.
    const iso = "2026-10-07T14:05:00.000Z";
    const inZone = (tz: string, style: "time" | "date-time"): string | null => {
      const real = Intl.DateTimeFormat;
      const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
        this: unknown,
        locale?: string | string[],
        options?: Intl.DateTimeFormatOptions,
      ) {
        return new real(locale, { timeZone: tz, ...options });
      });
      try {
        return formatDate(iso, style);
      } finally {
        spy.mockRestore();
      }
    };
    expect(inZone("UTC", "time")).toBe("2:05 PM");
    expect(inZone("America/Los_Angeles", "time")).toBe("7:05 AM");
    expect(inZone("UTC", "date-time")).toBe("Wed, Oct 7, 2:05 PM");
    expect(inZone("Pacific/Kiritimati", "date-time")).toBe(
      "Thu, Oct 8, 4:05 AM",
    );
  });

  it("a local day never moves with the viewer's zone (UTC-12 and UTC+14)", () => {
    for (const tz of ["Etc/GMT+12", "Pacific/Kiritimati"]) {
      const real = Intl.DateTimeFormat;
      const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
        this: unknown,
        locale?: string | string[],
        options?: Intl.DateTimeFormatOptions,
      ) {
        return new real(locale, { timeZone: tz, ...options });
      });
      try {
        expect([tz, formatDate("2026-01-01", "month-day-year")]).toEqual([
          tz,
          "January 1, 2026",
        ]);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("accepts a Date", () => {
    expect(
      formatDate(new Date("2026-03-04T12:00:00Z"), "short-weekday-month-day"),
    ).toBe("Wed, Mar 4");
  });

  it.each(["", "soon", "2026-13-45", "not-a-date"])(
    "%j is not a date: null, so the caller picks its fallback",
    (bad) => {
      expect(formatDate(bad, "month-day-year")).toBeNull();
    },
  );
});

/**
 * The student-scope files that show dates, and the patterns that would mean a date formatted by
 * hand again. Guardian, admin, LISA and public (SEO) files are other verticals' and are not
 * listed (the calendar's `lib/dates.ts` sentence helpers delegate to formatDate, pinned in
 * dates.test.ts; its compact grid labels stay); `review-session-picker.ts` keeps one `en-CA` formatter that builds a
 * `YYYY-MM-DD` grouping KEY (never shown), allowed by name below.
 */
const STUDENT_DATE_FILES = [
  "components/legal/ReconsentModal.tsx",
  "components/student/StudentGuardiansPanel.tsx",
  "components/account-deletion/PendingDeletionScreen.tsx",
  "features/exam/lib/tests-home-model.ts",
  "features/exam/pages/ExamReportPage.tsx",
  "lib/review-session-picker.ts",
  "lib/notificationsApi.ts",
  "components/home/home-model.ts",
  "pages/score-report.tsx",
];

const HAND_ROLLED =
  /toLocaleDateString|toLocaleTimeString|toLocaleString\(|new Intl\.DateTimeFormat\((?!"en-CA")|weekdayDayMonth|from "date-fns"/;

describe("one formatter: the student files that show dates all use it", () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  it.each(STUDENT_DATE_FILES)(
    "%s formats dates only through formatDate",
    (file) => {
      const text = fs.readFileSync(path.join(src, file), "utf8");
      // Presence first: the file really shows a date, through the helper.
      expect(text).toMatch(/formatDate\(/);
      expect(text).toMatch(/from "@\/lib\/format-date"/);
      const offending = text
        .split("\n")
        .filter((line) => HAND_ROLLED.test(line));
      expect(offending).toEqual([]);
    },
  );
});
