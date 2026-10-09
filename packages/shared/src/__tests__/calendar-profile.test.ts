/**
 * @spec [Doc_05F §7.1, §8.1, §8.2, §15 PUT /api/calendar/profile] | @implemented [2026-09-17]
 * plain English: the profile read shape mirrors the column CHECKs, and the write shape
 * mirrors §8.1's bounds — which arrive as an argument, because they are runtime config.
 */
import { describe, expect, it } from "vitest";
import {
  fullLengthsBeforeTarget,
  isStudyDay,
  makeStudyProfileUpsertSchema,
  maskOfStudyDows,
  studyDowsOfMask,
  studyProfileBoundsSchema,
  studyProfileSchema,
  type StudyProfileBounds,
} from "../calendar/profile";

const BOUNDS: StudyProfileBounds = {
  daily_minutes_min: 15,
  daily_minutes_max: 180,
  daily_minutes_presets: [15, 30, 45, 60, 90, 120],
  target_exam_date_max_days: 540,
};

const KEY = "4b3f1a9c-2d5e-4c7b-9a1f-8e6d5c4b3a21";

function upsert(body: unknown, localToday = "2026-09-17") {
  return makeStudyProfileUpsertSchema({ bounds: BOUNDS, localToday }).safeParse(
    body,
  );
}

describe("study profile read shape", () => {
  const row = {
    timezone: "America/Los_Angeles",
    target_exam_date: "2026-11-07",
    target_exam_dates: ["2026-11-07"],
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 45,
    full_length_weekday: 6,
    full_length_interval_weeks: 2,
    planner_mode: "auto",
    setup_completed_at: "2026-09-01T18:00:00Z",
  };

  it("round-trips a row shaped like student_study_profile", () => {
    const parsed = studyProfileSchema.safeParse(row);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(row);
  });

  it("refuses a target score off the step of 10", () => {
    expect(
      studyProfileSchema.safeParse({ ...row, target_score: 1405 }).success,
    ).toBe(false);
  });

  it("refuses a target score outside 400…1600", () => {
    expect(
      studyProfileSchema.safeParse({ ...row, target_score: 1610 }).success,
    ).toBe(false);
    expect(
      studyProfileSchema.safeParse({ ...row, target_score: 390 }).success,
    ).toBe(false);
  });

  it("refuses a study_days_mask of 0 — a plan needs at least one study day", () => {
    expect(
      studyProfileSchema.safeParse({ ...row, study_days_mask: 0 }).success,
    ).toBe(false);
  });

  // INVERTED 2026-09-24 (SCL-130, R-08-17 reversed). This case used to assert the
  // opposite — that a completed setup with no target score was unconstructible, mirroring
  // the `setup_requires_target_score` CHECK. 20261002000000 drops that CHECK because
  // nothing in setup is required, so the very profile this once refused is now the one a
  // student who presses straight through ends up with. Asserting it POSITIVELY is the
  // point: a refinement quietly reintroduced here would put the field back in front of
  // every client, since this schema is what they all parse through.
  it("ACCEPTS a completed setup with no target score — nothing in setup is required", () => {
    const parsed = studyProfileSchema.safeParse({ ...row, target_score: null });
    expect(parsed.success).toBe(true);
  });

  it("accepts a completed setup with BOTH target fields null — press straight through", () => {
    const parsed = studyProfileSchema.safeParse({
      ...row,
      target_score: null,
      target_exam_date: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("allows a null target score with setup not yet complete", () => {
    expect(
      studyProfileSchema.safeParse({
        ...row,
        target_score: null,
        setup_completed_at: null,
      }).success,
    ).toBe(true);
  });

  it("refuses a key the table does not have", () => {
    expect(
      studyProfileSchema.safeParse({
        ...row,
        last_acknowledged_nonstudent_version_no: 3,
      }).success,
    ).toBe(false);
  });
});

describe("study-days mask (bit i = Postgres DOW i, Sunday = 0)", () => {
  it("reads weekdays out of 62 — Monday through Friday", () => {
    expect(studyDowsOfMask(62)).toEqual([1, 2, 3, 4, 5]);
    expect(isStudyDay(62, 0)).toBe(false);
    expect(isStudyDay(62, 6)).toBe(false);
  });

  it("round-trips through maskOfStudyDows", () => {
    expect(maskOfStudyDows([1, 2, 3, 4, 5])).toBe(62);
    expect(maskOfStudyDows([0, 6])).toBe(65);
    expect(studyDowsOfMask(65)).toEqual([0, 6]);
  });
});

describe("bounds", () => {
  it("accepts the §8.1 launch values", () => {
    expect(studyProfileBoundsSchema.safeParse(BOUNDS).success).toBe(true);
  });

  it("refuses a max below the min", () => {
    expect(
      studyProfileBoundsSchema.safeParse({ ...BOUNDS, daily_minutes_max: 10 })
        .success,
    ).toBe(false);
  });

  it("refuses a preset outside its own min…max", () => {
    expect(
      studyProfileBoundsSchema.safeParse({
        ...BOUNDS,
        daily_minutes_presets: [15, 30, 240],
      }).success,
    ).toBe(false);
  });
});

describe("profile upsert", () => {
  it("accepts a single changed field with an idempotency key", () => {
    expect(upsert({ daily_minutes: 45, idempotency_key: KEY }).success).toBe(
      true,
    );
  });

  it("refuses a body that changes nothing", () => {
    expect(upsert({ idempotency_key: KEY }).success).toBe(false);
  });

  it("refuses a body with no idempotency key — §4.2 makes it part of the mutation", () => {
    expect(upsert({ daily_minutes: 45 }).success).toBe(false);
  });

  it("refuses daily_minutes that is not one of the offered presets", () => {
    expect(upsert({ daily_minutes: 50, idempotency_key: KEY }).success).toBe(
      false,
    );
  });

  it("refuses daily_minutes outside the configured bounds even when the column allows it", () => {
    // The column CHECK is 5…600; the configured bound is 15…180.
    expect(upsert({ daily_minutes: 10, idempotency_key: KEY }).success).toBe(
      false,
    );
  });

  it("accepts an exam date inside the window and refuses one beyond it", () => {
    expect(
      upsert({ target_exam_date: "2026-11-07", idempotency_key: KEY }).success,
    ).toBe(true);
    // 2026-09-17 + 540 days = 2028-03-10.
    expect(
      upsert({ target_exam_date: "2028-03-10", idempotency_key: KEY }).success,
    ).toBe(true);
    expect(
      upsert({ target_exam_date: "2028-03-11", idempotency_key: KEY }).success,
    ).toBe(false);
  });

  it("refuses an exam date in the past and accepts today", () => {
    expect(
      upsert({ target_exam_date: "2026-09-16", idempotency_key: KEY }).success,
    ).toBe(false);
    expect(
      upsert({ target_exam_date: "2026-09-17", idempotency_key: KEY }).success,
    ).toBe(true);
  });

  it("accepts an explicit null exam date — 'not yet' is an answer", () => {
    expect(
      upsert({ target_exam_date: null, idempotency_key: KEY }).success,
    ).toBe(true);
  });

  it("refuses a field the profile does not have", () => {
    expect(
      upsert({ planner_mode: "auto", streak: 4, idempotency_key: KEY }).success,
    ).toBe(false);
  });
});

/**
 * `full_length_pair` (20261010000000) makes the weekday and the interval one decision in the
 * database. These are the tests that make it one decision at the BOUNDARY too, so the refusal
 * is a 400 that names the field rather than a 23514 the service reports as a write failure.
 *
 * The body is a partial update, so "send both or neither" is what makes the merged row
 * provably valid without this schema ever reading the stored one.
 */
describe("the exam schedule is one setting (full_length_pair)", () => {
  const both = (weekday: number | null, weeks: number | null) =>
    upsert({
      full_length_weekday: weekday,
      full_length_interval_weeks: weeks,
      idempotency_key: KEY,
    });

  it("accepts a day and a cadence together", () => {
    expect(both(6, 2).success).toBe(true);
    expect(both(0, 1).success).toBe(true);
    expect(both(3, 4).success).toBe(true);
  });

  it("accepts both null — 'I'll add them myself' is an answer", () => {
    expect(both(null, null).success).toBe(true);
  });

  it("refuses a weekday with no cadence, and says which field is missing", () => {
    const result = upsert({ full_length_weekday: 6, idempotency_key: KEY });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "full_length_interval_weeks",
    );
  });

  it("refuses a cadence with no weekday, and says which field is missing", () => {
    const result = upsert({
      full_length_interval_weeks: 2,
      idempotency_key: KEY,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "full_length_weekday",
    );
  });

  it("refuses half an 'off': one null and one set is neither on nor off", () => {
    expect(both(6, null).success).toBe(false);
    expect(both(null, 2).success).toBe(false);
  });

  it("refuses a cadence outside the four §8.1 offers", () => {
    expect(both(6, 5).success).toBe(false);
    expect(both(6, 0).success).toBe(false);
    expect(both(6, -1).success).toBe(false);
    expect(both(6, 2.5).success).toBe(false);
  });

  it("leaves a body that names NEITHER half alone — the pair it does not touch stays valid", () => {
    expect(upsert({ daily_minutes: 60, idempotency_key: KEY }).success).toBe(
      true,
    );
  });
});

/**
 * The count behind "about N practice tests before 5 December". One function, shared with
 * nothing else: it exists so the promise and the plan come from the same arithmetic.
 */
describe("fullLengthsBeforeTarget (§8.1 readout)", () => {
  const base = {
    today: "2026-09-27" as const, // a Sunday (Postgres DOW 0)
    intervalWeeks: 2,
    preferredWeekday: 6, // Saturday
    targetExamDate: "2026-12-05" as const, // also a Saturday
    finalExamLeadDays: 7,
  };

  /**
   * DERIVED BY HAND, then confirmed against the same steps the generator takes:
   *
   *   rehearsal  2026-12-05 − 7 = 2026-11-28, already a Saturday      -> counts
   *   cadence    from 2026-09-27: +14 = 10-11 (Sun) -> snap to 10-17  -> counts
   *              +14 = 10-31 (Sat)                                    -> counts
   *              +14 = 11-14 (Sat)                                    -> counts
   *              +14 = 11-28 (Sat)  — the rehearsal's date            -> already counted
   *              +14 = 12-12        — inside the lead window          -> stop
   *
   * Four distinct dates. The fifth step lands ON the rehearsal, and a student sits one
   * exam that day, not two — which is why this returns a set size and not a trip count.
   */
  it("counts four for a fortnightly Saturday student with a 5 December target", () => {
    expect(fullLengthsBeforeTarget(base)).toBe(4);
  });

  it("counts the rehearsal and a coinciding cadence date ONCE", () => {
    // Shift the target by a week so the series no longer lands on the rehearsal: the same
    // run-up now yields five sittings rather than four, which is the coincidence showing up
    // as the one date it was.
    expect(
      fullLengthsBeforeTarget({ ...base, targetExamDate: "2026-12-12" }),
    ).toBe(5);
  });

  it("counts more often for a weekly student and less for a monthly one", () => {
    const weekly = fullLengthsBeforeTarget({ ...base, intervalWeeks: 1 });
    const monthly = fullLengthsBeforeTarget({ ...base, intervalWeeks: 4 });
    expect(weekly).not.toBeNull();
    expect(monthly).not.toBeNull();
    expect(weekly as number).toBeGreaterThan(base.intervalWeeks);
    expect(monthly as number).toBeLessThan(weekly as number);
  });

  it("is unanswerable without a cadence — both halves, not just one", () => {
    expect(
      fullLengthsBeforeTarget({ ...base, intervalWeeks: null }),
    ).toBeNull();
    expect(
      fullLengthsBeforeTarget({ ...base, preferredWeekday: null }),
    ).toBeNull();
  });

  it("is unanswerable without a target date — the caller says 'every 2 weeks' instead", () => {
    expect(
      fullLengthsBeforeTarget({ ...base, targetExamDate: null }),
    ).toBeNull();
  });

  it("counts nothing when the target is already inside the lead window", () => {
    expect(
      fullLengthsBeforeTarget({ ...base, targetExamDate: "2026-10-01" }),
    ).toBe(0);
  });

  it("never counts a sitting inside the lead window, whatever the lead is", () => {
    // A 21-day lead pushes both the rehearsal and the last cadence dates out.
    const long = fullLengthsBeforeTarget({ ...base, finalExamLeadDays: 21 });
    expect(long as number).toBeLessThan(
      fullLengthsBeforeTarget(base) as number,
    );
  });
});
