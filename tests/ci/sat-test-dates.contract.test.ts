/**
 * The official SAT date list, and the one write path for a student's test dates.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09) Part A2: official dates
 *       in shared/sat-test-dates.ts with the College Board source URL and a "verified on" date;
 *       only future dates offered; "One endpoint ... Grep proof: no other write path for test
 *       dates"; SCL-223] | @implemented [2026-10-09]
 *
 * plain English: every entry names its source and the day it was checked; a past date is never
 * offered (including on the date itself); and the only server code that writes
 * `student_study_profile` is the calendar profile service behind PUT /api/calendar/profile. The
 * write-path proof reads the source tree, so a second writer added anywhere fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  offeredSatTestDates,
  SAT_DATES_SOURCE_URL,
  SAT_TEST_DATES,
  satDateOptions,
} from "../../shared/sat-test-dates";

describe("official SAT dates", () => {
  it("every entry cites College Board and a verified-on date", () => {
    expect(SAT_TEST_DATES.length).toBeGreaterThan(5);
    for (const d of SAT_TEST_DATES) {
      expect(d.source_url).toBe(SAT_DATES_SOURCE_URL);
      expect(d.source_url).toMatch(/^https:\/\/satsuite\.collegeboard\.org\//);
      expect(d.verified_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("lists every date College Board publishes, through June 2028 (verified 2026-10-09)", () => {
    // Owner ruling on #1166 item 3: confirmed and anticipated, as far out as College Board goes.
    expect(SAT_TEST_DATES.map((d) => d.date)).toEqual([
      "2026-10-03",
      "2026-11-07",
      "2026-12-05",
      "2027-03-06",
      "2027-05-01",
      "2027-06-05",
      "2027-08-28",
      "2027-09-18",
      "2027-10-09",
      "2027-11-06",
      "2027-12-04",
      "2028-03-04",
      "2028-05-06",
      "2028-06-03",
    ]);
  });

  it("no surface labels a date as expected or anticipated", () => {
    const surfaces = [
      "client/src/components/sat-dates/SatDatePicker.tsx",
      "client/src/pages/profile-complete.tsx",
      "client/src/components/settings/ProfileSection.tsx",
      "client/src/components/home/qotd/HomeQotdSection.tsx",
    ];
    for (const f of surfaces) {
      const src = fs.readFileSync(f, "utf8");
      // Presence first: the surface really renders SAT dates.
      expect(src).toMatch(/sat-test-dates|SatDatePicker/);
      expect(src).not.toMatch(/\b(expected|anticipated)\b/i);
    }
  });

  it("only dates after today are offered, ascending", () => {
    const offered = offeredSatTestDates("2026-11-07").map((d) => d.date);
    // Presence before absence: later dates are there.
    expect(offered[0]).toBe("2026-12-05");
    expect(offered).not.toContain("2026-11-07");
    expect(offered).not.toContain("2026-10-03");
    expect([...offered].sort()).toEqual(offered);
  });

  it("a saved future date that is not on the list is still shown, a past one is not", () => {
    const options = satDateOptions("2026-10-09", ["2026-10-24", "2026-09-01"]);
    expect(options.map((o) => o.date)).toContain("2026-10-24");
    expect(options.find((o) => o.date === "2026-10-24")?.official).toBe(false);
    expect(options.map((o) => o.date)).not.toContain("2026-09-01");
  });
});

describe("one write path for test dates", () => {
  const roots = ["server", "apps/api/src", "client/src"];
  const WRITE =
    /\.from\(\s*["']student_study_profile["']\s*\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\(/;

  function files(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...files(p));
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        out.push(p);
    }
    return out;
  }

  it("only the calendar profile service writes student_study_profile", () => {
    const writers = roots
      .flatMap((r) => files(r))
      .filter((f) => WRITE.test(fs.readFileSync(f, "utf8")));
    expect(writers).toEqual([
      path.join("server", "services", "calendar", "profile-service.ts"),
    ]);
  });

  it("every client surface that saves a test date goes through PUT /api/calendar/profile", () => {
    const surfaces = [
      "client/src/pages/profile-complete.tsx",
      "client/src/components/settings/ProfileSection.tsx",
    ];
    for (const f of surfaces) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).toMatch(/useStudyProfileMutation|putStudyProfile/);
      expect(src).toMatch(/target_exam_dates/);
    }
  });
});
