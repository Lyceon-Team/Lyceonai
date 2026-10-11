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
  daysUntil,
  offeredSatTestDates,
  SAT_DATES_SOURCE_URL,
  SAT_SCORE_RELEASE_SOURCE_URL,
  SAT_TEST_DATES,
  satCalendarEvents,
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

describe("deadlines and score release dates (Doc 10B §3A; owner answer 6, 2026-10-11)", () => {
  it("every confirmed date carries College Board's published deadlines and score release, as read 2026-10-11", () => {
    const table = SAT_TEST_DATES.filter((d) => d.deadlines).map((d) => [
      d.date,
      d.deadlines?.registration,
      d.deadlines?.late_registration,
      d.deadlines?.scores_released,
    ]);
    expect(table).toEqual([
      ["2026-10-03", "2026-09-18", "2026-09-22", "2026-10-16"],
      ["2026-11-07", "2026-10-23", "2026-10-27", "2026-11-20"],
      ["2026-12-05", "2026-11-20", "2026-11-24", "2026-12-18"],
      ["2027-03-06", "2027-02-19", "2027-02-23", "2027-03-19"],
      ["2027-05-01", "2027-04-16", "2027-04-20", "2027-05-14"],
      ["2027-06-05", "2027-05-21", "2027-05-25", "2027-06-21"],
    ]);
    for (const d of SAT_TEST_DATES.filter((x) => x.deadlines)) {
      expect(d.status).toBe("confirmed");
      expect(d.deadlines?.source_url).toBe(SAT_DATES_SOURCE_URL);
      expect(d.deadlines?.scores_source_url).toBe(SAT_SCORE_RELEASE_SOURCE_URL);
      expect(d.deadlines?.verified_on).toBe("2026-10-11");
      // Order a student meets them in: register, late, test, scores.
      expect(
        (d.deadlines?.registration ?? "") <
          (d.deadlines?.late_registration ?? ""),
      ).toBe(true);
    }
  });

  it("an anticipated date carries no deadlines: published dates only, never an estimate", () => {
    const anticipated = SAT_TEST_DATES.filter(
      (d) => d.status === "anticipated",
    );
    expect(anticipated.length).toBeGreaterThan(0);
    for (const d of anticipated) expect(d.deadlines, d.date).toBeUndefined();
  });

  it("November 2026's calendar: the Nov 7 test and scores, the Dec 5 deadlines, in date order", () => {
    expect(
      satCalendarEvents("2026-11-01", "2026-11-30").map((e) => [
        e.date,
        e.kind,
        e.test_date,
      ]),
    ).toEqual([
      ["2026-11-07", "test_day", "2026-11-07"],
      ["2026-11-20", "registration_deadline", "2026-12-05"],
      ["2026-11-20", "scores_released", "2026-11-07"],
      ["2026-11-24", "late_registration_deadline", "2026-12-05"],
    ]);
    const scores = satCalendarEvents("2026-11-20", "2026-11-20").find(
      (e) => e.kind === "scores_released",
    );
    expect(scores?.source_url).toBe(SAT_SCORE_RELEASE_SOURCE_URL);
  });

  it("days to test count calendar days, and go negative after the test", () => {
    expect(daysUntil("2026-11-01", "2026-11-07")).toBe(6);
    expect(daysUntil("2026-11-01", "2026-12-05")).toBe(34);
    expect(daysUntil("2026-11-08", "2026-11-07")).toBe(-1);
    // Across the DST change (Nov 1, 2026) and a month boundary.
    expect(daysUntil("2026-10-31", "2026-11-02")).toBe(2);
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
