/**
 * @spec [Doc_05F §7.1, §8.1, §8.2, §15 PUT /api/calendar/profile] | @implemented [2026-09-17]
 * plain English: the profile read shape mirrors the column CHECKs, and the write shape
 * mirrors §8.1's bounds — which arrive as an argument, because they are runtime config.
 */
import { describe, expect, it } from "vitest";
import {
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
  return makeStudyProfileUpsertSchema({ bounds: BOUNDS, localToday }).safeParse(body);
}

describe("study profile read shape", () => {
  const row = {
    timezone: "America/Los_Angeles",
    target_exam_date: "2026-11-07",
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 45,
    full_length_weekday: 6,
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
    expect(studyProfileSchema.safeParse({ ...row, target_score: 1405 }).success).toBe(false);
  });

  it("refuses a target score outside 400…1600", () => {
    expect(studyProfileSchema.safeParse({ ...row, target_score: 1610 }).success).toBe(false);
    expect(studyProfileSchema.safeParse({ ...row, target_score: 390 }).success).toBe(false);
  });

  it("refuses a study_days_mask of 0 — a plan needs at least one study day", () => {
    expect(studyProfileSchema.safeParse({ ...row, study_days_mask: 0 }).success).toBe(false);
  });

  it("refuses a completed setup with no target score (setup_requires_target_score)", () => {
    const parsed = studyProfileSchema.safeParse({ ...row, target_score: null });
    expect(parsed.success).toBe(false);
  });

  it("allows a target score with setup not yet complete", () => {
    expect(
      studyProfileSchema.safeParse({ ...row, target_score: null, setup_completed_at: null })
        .success,
    ).toBe(true);
  });

  it("refuses a key the table does not have", () => {
    expect(
      studyProfileSchema.safeParse({ ...row, last_acknowledged_nonstudent_version_no: 3 })
        .success,
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
      studyProfileBoundsSchema.safeParse({ ...BOUNDS, daily_minutes_max: 10 }).success,
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
    expect(upsert({ daily_minutes: 45, idempotency_key: KEY }).success).toBe(true);
  });

  it("refuses a body that changes nothing", () => {
    expect(upsert({ idempotency_key: KEY }).success).toBe(false);
  });

  it("refuses a body with no idempotency key — §4.2 makes it part of the mutation", () => {
    expect(upsert({ daily_minutes: 45 }).success).toBe(false);
  });

  it("refuses daily_minutes that is not one of the offered presets", () => {
    expect(upsert({ daily_minutes: 50, idempotency_key: KEY }).success).toBe(false);
  });

  it("refuses daily_minutes outside the configured bounds even when the column allows it", () => {
    // The column CHECK is 5…600; the configured bound is 15…180.
    expect(upsert({ daily_minutes: 10, idempotency_key: KEY }).success).toBe(false);
  });

  it("accepts an exam date inside the window and refuses one beyond it", () => {
    expect(upsert({ target_exam_date: "2026-11-07", idempotency_key: KEY }).success).toBe(
      true,
    );
    // 2026-09-17 + 540 days = 2028-03-10.
    expect(upsert({ target_exam_date: "2028-03-10", idempotency_key: KEY }).success).toBe(
      true,
    );
    expect(upsert({ target_exam_date: "2028-03-11", idempotency_key: KEY }).success).toBe(
      false,
    );
  });

  it("refuses an exam date in the past and accepts today", () => {
    expect(upsert({ target_exam_date: "2026-09-16", idempotency_key: KEY }).success).toBe(
      false,
    );
    expect(upsert({ target_exam_date: "2026-09-17", idempotency_key: KEY }).success).toBe(
      true,
    );
  });

  it("accepts an explicit null exam date — 'not yet' is an answer", () => {
    expect(upsert({ target_exam_date: null, idempotency_key: KEY }).success).toBe(true);
  });

  it("refuses a field the profile does not have", () => {
    expect(upsert({ planner_mode: "auto", streak: 4, idempotency_key: KEY }).success).toBe(
      false,
    );
  });
});
