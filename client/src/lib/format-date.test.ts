/**
 * @spec [production QA 2026-10-07 item 15 (one shared date formatter for the student UI); the
 *        prototypes' date forms; Doc_05F §8.2 (a local date is not an instant)]
 *        | @implemented [2026-10-07]
 *
 * plain English: the house style, every style once; a local `YYYY-MM-DD` day never shifts with
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

describe("formatDate: the house style", () => {
  it.each([
    ["day-month", "26 September"],
    ["day-month-year", "26 September 2026"],
    ["day-short-month-year", "26 Sep 2026"],
    ["weekday-day-month", "Saturday, 26 September"],
    ["short-weekday-day-month", "Sat 26 Sep"],
  ] as const)("a local day, %s: %s", (style, expected) => {
    expect(formatDate("2026-09-26", style)).toBe(expected);
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
    expect(inZone("UTC", "date-time")).toBe("7 October 2026, 2:05 PM");
    expect(inZone("Pacific/Kiritimati", "date-time")).toBe(
      "8 October 2026, 4:05 AM",
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
        expect([tz, formatDate("2026-01-01", "day-month-year")]).toEqual([
          tz,
          "1 January 2026",
        ]);
      } finally {
        spy.mockRestore();
      }
    }
  });

  it("accepts a Date", () => {
    expect(
      formatDate(new Date("2026-03-04T12:00:00Z"), "day-short-month-year"),
    ).toBe("4 Mar 2026");
  });

  it.each(["", "soon", "2026-13-45", "not-a-date"])(
    "%j is not a date: null, so the caller picks its fallback",
    (bad) => {
      expect(formatDate(bad, "day-month-year")).toBeNull();
    },
  );
});

/**
 * The student-scope files that show dates, and the patterns that would mean a date formatted by
 * hand again. Guardian, admin, calendar, LISA and public (SEO) files are other verticals' and
 * are not listed; `review-session-picker.ts` keeps one `en-CA` formatter that builds a
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
