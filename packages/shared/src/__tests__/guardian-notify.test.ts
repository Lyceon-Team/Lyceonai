/**
 * The predicate's cases the SQL parity test does not drive (tests/ci/guardian-notify.parity.pg.ci.test.ts
 * holds every action against real Postgres).
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A; SCL-238; Doc 05F §12.4 V-12
 *        (a started block is carried by the server whatever the list says)] | @implemented [2026-10-21]
 */
import { describe, expect, it } from "vitest";
import {
  calendarActionRecorded,
  plannedDayMinutes,
  willNotifyGuardian,
  type DayBlockBefore,
} from "../calendar/guardian-notify";

const EST = { practice_seconds_per_unit: 90, review_seconds_per_unit: 60 };
const P = (id: string, count: number, started = false): DayBlockBefore => ({
  block_id: id,
  block_type: "practice",
  target_count: count,
  started,
});

describe("guardian-notify predicate", () => {
  it("counts minutes as accountability_day_minutes does: max(1, round(n × secs / 60)), full-lengths excluded", () => {
    expect(
      plannedDayMinutes(
        [
          { block_type: "practice", target_count: 10 },
          { block_type: "review", target_count: 1 },
          { block_type: "full_length", target_count: 1 },
        ],
        EST,
      ),
    ).toBe(15 + 1);
  });

  it("clearing a day whose only block is started records nothing (the server carries it back)", () => {
    const before = [P("a", 10, true)];
    expect(
      calendarActionRecorded({
        kind: "edit_day",
        before,
        after: [],
        estimates: EST,
      }),
    ).toBe(false);
    // Presence: the same day with the block NOT started is recorded.
    expect(
      calendarActionRecorded({
        kind: "edit_day",
        before: [P("a", 10)],
        after: [],
        estimates: EST,
      }),
    ).toBe(true);
  });

  it("a first setup (no profile yet, or setup not completed) records nothing", () => {
    for (const before of [
      null,
      {
        setup_completed_at: null,
        study_days_mask: 127,
        daily_minutes: 60,
        full_length_weekday: null,
        full_length_interval_weeks: null,
      },
    ]) {
      expect(
        calendarActionRecorded({
          kind: "save_schedule",
          before,
          after: { daily_minutes: 30 },
        }),
      ).toBe(false);
    }
  });

  it("asks only when the server says a guardian is told", () => {
    const recorded = { kind: "move_block" } as const;
    expect(willNotifyGuardian(recorded, true)).toBe(true);
    expect(willNotifyGuardian(recorded, false)).toBe(false);
    expect(willNotifyGuardian({ kind: "regenerate_plan" }, true)).toBe(false);
  });
});
