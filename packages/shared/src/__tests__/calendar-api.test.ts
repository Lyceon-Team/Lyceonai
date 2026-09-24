/**
 * @spec [Doc_05F §15, §15.1, §12.7, §16, §17.3, §17.4; lyceon-coding-standards §8.2]
 * | @implemented [2026-09-17]
 * plain English: every §15 boundary round-trips a payload shaped like the one the route
 * will serve, and the guardian payload cannot carry what §16 withholds.
 */
import { describe, expect, it } from "vitest";
import {
  acknowledgeBodySchema,
  apiErrorSchema,
  calendarQuerySchema,
  calendarResponseSchema,
  dayEditBodySchema,
  dayParamsSchema,
  doItNowResponseSchema,
  guardianCalendarResponseSchema,
  idempotentMutationBodySchema,
  launchBodySchema,
  launchResponseSchema,
  profileUpsertResponseSchema,
  versionResponseSchema,
} from "../calendar/api";
import { toGuardianCalendarDay } from "../calendar/read-model";
import type { CalendarDay } from "../calendar/read-model";

const KEY = "4b3f1a9c-2d5e-4c7b-9a1f-8e6d5c4b3a21";
const BLOCK_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "6f1d2f5a-9f8a-4a1e-8f4c-0b2f1d3e4a5b";

/** §17.1's "~N min" readout. Server-owned constants, so the payload carries them. */
const ESTIMATES = {
  practice_seconds_per_unit: 90,
  review_seconds_per_unit: 120,
};

/** §8.1's bounds, on the ready payload since 2026-09-22 so §17.3's settings sheet can
 *  offer the same presets the server validates against. */
const BOUNDS = {
  daily_minutes_min: 15,
  daily_minutes_max: 180,
  daily_minutes_presets: [15, 30, 45, 60, 90, 120],
  target_exam_date_max_days: 540,
};

const PROFILE = {
  timezone: "America/Los_Angeles",
  target_exam_date: "2026-11-07",
  target_score: 1400,
  study_days_mask: 62,
  daily_minutes: 45,
  full_length_weekday: 6,
  planner_mode: "auto",
  setup_completed_at: "2026-09-01T18:00:00Z",
} as const;

const DAY: CalendarDay = {
  local_date: "2026-09-17",
  timezone: "America/Los_Angeles",
  is_user_override: false,
  is_study_day: true,
  version_no: 7,
  status: "partial",
  blocks: [
    {
      block: {
        block_id: BLOCK_ID,
        scheduled_date: "2026-09-17",
        block_type: "practice",
        section: "M",
        scope: {
          level: "domain",
          mix: [{ domain: "Algebra", count: 20, explanation_key: "weak" }],
        },
        target_count: 20,
        source: "auto",
        derived_from_block_id: null,
        explanation_key: "weighted",
        display_ordinal: 1,
        membership_type: "created",
      },
      actual: 12,
      progress: 0.6,
      status: "partial",
    },
  ],
  extra_work: [
    {
      engine: "practice",
      section: "RW",
      domain: "Expression of Ideas",
      count: 3,
    },
  ],
  planned_count: 20,
  actual_count: 12,
  extra_count: 3,
};

const FACTS = {
  blocks_total: 1,
  blocks_completed: 0,
  blocks_partial: 1,
  blocks_missed: 0,
  blocks_in_progress: 0,
  blocks_scheduled: 0,
  questions_completed: 15,
  full_lengths_completed: 0,
  extra_questions: 3,
};

const STREAK = { current: 4, longest: null, history_complete: false };

describe("GET /api/calendar", () => {
  it("accepts a from/to query and refuses a reversed range", () => {
    expect(
      calendarQuerySchema.safeParse({ from: "2026-09-17", to: "2026-09-30" })
        .success,
    ).toBe(true);
    expect(calendarQuerySchema.safeParse({}).success).toBe(true);
    expect(
      calendarQuerySchema.safeParse({ from: "2026-09-30", to: "2026-09-17" })
        .success,
    ).toBe(false);
  });

  it("refuses a date that matches the pattern but is not a date", () => {
    expect(calendarQuerySchema.safeParse({ from: "2026-02-31" }).success).toBe(
      false,
    );
  });

  it("round-trips the full response", () => {
    const payload = {
      status: "ready" as const,
      profile: PROFILE,
      bounds: BOUNDS,
      estimates: ESTIMATES,
      days: [DAY],
      facts: FACTS,
      streak: STREAK,
      latest_unacknowledged_nonstudent_change: {
        version_no: 7,
        trigger: "weekly",
        created_at: "2026-09-15T09:00:00Z",
      },
      diagnostic_state: "baseline_ready",
      device_timezone_mismatch: {
        profile_timezone: "America/Los_Angeles",
        device_timezone: "America/New_York",
      },
      // §17.2's engine picker. Production's own list on 2026-09-24.
      enabled_block_types: ["practice", "review"],
    };
    const parsed = calendarResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(payload);
  });

  it("round-trips the PRE-SETUP arm, and it carries no plan fields", () => {
    // Owner ruling on addendum item 26. The union is discriminated on `status`, so a
    // client cannot read `days` without first proving the calendar is ready — and the
    // pre-setup arm is `.strict()`, so a stray `profile` or `days` is refused outright.
    const payload = {
      status: "setup_required" as const,
      defaults: {
        timezone: "America/Chicago",
        daily_minutes_presets: [15, 30, 45, 60, 90, 120],
        daily_minutes_min: 15,
        daily_minutes_max: 180,
        target_exam_date_max_days: 540,
      },
    };
    const parsed = calendarResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(payload);

    expect(
      calendarResponseSchema.safeParse({ ...payload, days: [DAY] }).success,
    ).toBe(false);
    expect(
      calendarResponseSchema.safeParse({ status: "setup_required" }).success,
    ).toBe(false);
  });

  it("refuses a payload with no status at all", () => {
    expect(
      calendarResponseSchema.safeParse({
        profile: PROFILE,
        estimates: ESTIMATES,
        days: [DAY],
        facts: FACTS,
        streak: STREAK,
        latest_unacknowledged_nonstudent_change: null,
        diagnostic_state: "baseline_ready",
      }).success,
    ).toBe(false);
  });

  it("accepts a null latest_unacknowledged_nonstudent_change (§12.7)", () => {
    expect(
      calendarResponseSchema.safeParse({
        status: "ready",
        profile: PROFILE,
        bounds: BOUNDS,
        estimates: ESTIMATES,
        days: [],
        facts: FACTS,
        streak: STREAK,
        latest_unacknowledged_nonstudent_change: null,
        diagnostic_state: "baseline_ready",
        enabled_block_types: ["practice", "review"],
      }).success,
    ).toBe(true);
  });

  it("REFUSES a ready payload with no enabled_block_types — §17.2 has nothing to offer", () => {
    // The picker is built from this list. Optional would mean "no engines" on a surface
    // that should have been given the list, and an empty picker reads as a broken button
    // rather than as a missing field.
    expect(
      calendarResponseSchema.safeParse({
        status: "ready",
        profile: PROFILE,
        bounds: BOUNDS,
        estimates: ESTIMATES,
        days: [],
        facts: FACTS,
        streak: STREAK,
        latest_unacknowledged_nonstudent_change: null,
        diagnostic_state: "baseline_ready",
      }).success,
    ).toBe(false);
  });

  it("refuses an unknown trigger on the plan-updated banner", () => {
    expect(
      calendarResponseSchema.safeParse({
        status: "ready",
        profile: PROFILE,
        estimates: ESTIMATES,
        days: [],
        facts: FACTS,
        streak: STREAK,
        latest_unacknowledged_nonstudent_change: {
          version_no: 7,
          trigger: "nightly",
          created_at: "2026-09-15T09:00:00Z",
        },
        diagnostic_state: "baseline_ready",
      }).success,
    ).toBe(false);
  });
});

describe("mutations", () => {
  it("every idempotent mutation body requires a uuid key", () => {
    expect(
      idempotentMutationBodySchema.safeParse({ idempotency_key: KEY }).success,
    ).toBe(true);
    expect(idempotentMutationBodySchema.safeParse({}).success).toBe(false);
    expect(
      idempotentMutationBodySchema.safeParse({ idempotency_key: "abc" })
        .success,
    ).toBe(false);
  });

  it("day params parse a local date", () => {
    expect(dayParamsSchema.safeParse({ date: "2026-09-17" }).success).toBe(
      true,
    );
    expect(dayParamsSchema.safeParse({ date: "17-09-2026" }).success).toBe(
      false,
    );
  });

  it("a version response is a positive integer", () => {
    expect(versionResponseSchema.safeParse({ version_no: 7 }).success).toBe(
      true,
    );
    expect(versionResponseSchema.safeParse({ version_no: 0 }).success).toBe(
      false,
    );
  });

  it("a day edit sends the full member list, and an empty list is a cleared day", () => {
    expect(
      dayEditBodySchema.safeParse({ members: [], idempotency_key: KEY })
        .success,
    ).toBe(true);
    const body = {
      members: [
        { kind: "carried", block_id: BLOCK_ID },
        {
          kind: "created",
          block: {
            block_type: "practice",
            section: "RW",
            scope: {
              level: "domain",
              mix: [
                {
                  domain: "Craft and Structure",
                  count: 10,
                  explanation_key: "balanced",
                },
              ],
            },
            target_count: 10,
            explanation_key: "weighted",
          },
        },
      ],
      idempotency_key: KEY,
    };
    const parsed = dayEditBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(body);
  });

  it("a created full_length member cannot ask for more than one exam", () => {
    expect(
      dayEditBodySchema.safeParse({
        members: [
          {
            kind: "created",
            block: {
              block_type: "full_length",
              section: null,
              scope: { form_id: null },
              target_count: 2,
              explanation_key: "exam_cadence",
            },
          },
        ],
        idempotency_key: KEY,
      }).success,
    ).toBe(false);
  });

  it("a created member cannot forge a block's lineage", () => {
    expect(
      dayEditBodySchema.safeParse({
        members: [
          {
            kind: "created",
            block: {
              block_type: "review",
              section: null,
              scope: { mode: "queue" },
              target_count: 5,
              explanation_key: "review_due",
              derived_from_block_id: BLOCK_ID,
            },
          },
        ],
        idempotency_key: KEY,
      }).success,
    ).toBe(false);
  });

  it("acknowledgement carries a version number and nothing else (§12.7, monotonic)", () => {
    expect(acknowledgeBodySchema.safeParse({ version_no: 7 }).success).toBe(
      true,
    );
    expect(
      acknowledgeBodySchema.safeParse({ version_no: 7, idempotency_key: KEY })
        .success,
    ).toBe(false);
  });

  it("a profile upsert response may or may not have triggered a regeneration", () => {
    expect(
      profileUpsertResponseSchema.safeParse({ profile: PROFILE }).success,
    ).toBe(true);
    expect(
      profileUpsertResponseSchema.safeParse({ profile: PROFILE, version_no: 8 })
        .success,
    ).toBe(true);
  });

  it("do-it-now returns the new block", () => {
    expect(
      doItNowResponseSchema.safeParse({
        version_no: 8,
        block: DAY.blocks[0]?.block,
      }).success,
    ).toBe(true);
  });
});

describe("launch (§15.1)", () => {
  it("the body is the client instance and platform — never an idempotency key", () => {
    expect(
      launchBodySchema.safeParse({
        client_instance_id: "ci-1",
        platform: "web",
      }).success,
    ).toBe(true);
    expect(
      launchBodySchema.safeParse({
        client_instance_id: "ci-1",
        platform: "web",
        idempotency_key: KEY,
      }).success,
    ).toBe(false);
  });

  it("refuses a platform outside the practice_sessions CHECK", () => {
    expect(
      launchBodySchema.safeParse({
        client_instance_id: "ci-1",
        platform: "desktop",
      }).success,
    ).toBe(false);
  });

  it("round-trips {engine, session_id, next, resumed}", () => {
    const payload = {
      engine: "practice",
      session_id: SESSION_ID,
      next: "/practice/session/6f1d2f5a-9f8a-4a1e-8f4c-0b2f1d3e4a5b",
      resumed: true,
    };
    const parsed = launchResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(payload);
  });
});

describe("guardian read (§16, R-08-22)", () => {
  it("the projection drops explanation_key, source, lineage, override and version", () => {
    const guardianDay = toGuardianCalendarDay(DAY);
    const serialised = JSON.stringify(guardianDay);
    expect(serialised).not.toContain("explanation_key");
    expect(serialised).not.toContain("weighted");
    expect(serialised).not.toContain("is_user_override");
    expect(serialised).not.toContain("version_no");
    expect(serialised).not.toContain("membership_type");
  });

  it("keeps the facts a guardian is entitled to see", () => {
    const guardianDay = toGuardianCalendarDay(DAY);
    expect(guardianDay.status).toBe("partial");
    expect(guardianDay.actual_count).toBe(12);
    expect(guardianDay.blocks[0]?.actual).toBe(12);
    expect(guardianDay.blocks[0]?.block.target_count).toBe(20);
  });

  it("round-trips the guardian response and refuses the student's day shape", () => {
    const payload = {
      status: "ready" as const,
      // Owner ruling 2026-09-22: the guardian payload carries the same estimates the
      // student's does — minutes are not among §16's exclusions.
      estimates: ESTIMATES,
      days: [toGuardianCalendarDay(DAY)],
      facts: FACTS,
      streak: STREAK,
    };
    expect(guardianCalendarResponseSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(
      guardianCalendarResponseSchema.safeParse({
        status: "ready",
        // Present and valid on purpose: without it this would be rejected for the MISSING
        // field, and the test would stop proving that the student DAY shape is refused.
        estimates: ESTIMATES,
        days: [DAY],
        facts: FACTS,
        streak: STREAK,
      }).success,
    ).toBe(false);
  });

  it("the guardian pre-setup arm carries NO defaults — a guardian cannot run setup", () => {
    expect(
      guardianCalendarResponseSchema.safeParse({ status: "setup_required" })
        .success,
    ).toBe(true);
    // `.strict()` refuses the student's defaults block on the guardian arm, so the chips
    // cannot reach a caller who has no write path to use them with.
    expect(
      guardianCalendarResponseSchema.safeParse({
        status: "setup_required",
        defaults: {
          timezone: "America/Chicago",
          daily_minutes_presets: [15],
          daily_minutes_min: 15,
          daily_minutes_max: 180,
          target_exam_date_max_days: 540,
        },
      }).success,
    ).toBe(false);
  });

  it("has no profile field at all", () => {
    expect(
      guardianCalendarResponseSchema.safeParse({
        days: [],
        facts: FACTS,
        streak: STREAK,
        profile: PROFILE,
        estimates: ESTIMATES,
      }).success,
    ).toBe(false);
  });
});

describe("the error envelope (Coding Standards §8.2)", () => {
  it("is {error:{message, code?, details?}}", () => {
    expect(
      apiErrorSchema.safeParse({ error: { message: "Not entitled" } }).success,
    ).toBe(true);
    expect(
      apiErrorSchema.safeParse({
        error: {
          message: "Invalid input",
          code: "bad_request",
          details: { field: "members" },
        },
      }).success,
    ).toBe(true);
    expect(apiErrorSchema.safeParse({ message: "Not entitled" }).success).toBe(
      false,
    );
  });
});
