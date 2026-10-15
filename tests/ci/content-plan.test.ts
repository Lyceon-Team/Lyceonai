/**
 * The monthly plan's calendar (Doc 10B §3A) and the weekly batch's week (§8.2).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A.1-2, §8.1-8.2; owner brief "Doc 10B Phase 1" (Karl,
 *       2026-10-11) scope 6-7] | @implemented [2026-10-11]
 *
 * plain English: the plan skeleton's SAT rows are College Board's published dates (from
 * shared/sat-test-dates.ts), its slots are exactly the Mon/Wed/Fri 07:00 cadence, and a weekly
 * batch is named for the ISO week its posts publish in.
 */
import { describe, expect, it } from "vitest";
import {
  batchWeekProblem,
  isoWeekCycle,
  publishSlots,
} from "../../shared/content/schedule";
import { planSkeleton } from "../../scripts/content/plan-skeleton";

describe("ISO week cycles", () => {
  it("names a date's ISO week, across year ends", () => {
    expect(isoWeekCycle("2026-10-19")).toBe("2026-W43");
    expect(isoWeekCycle("2026-10-25")).toBe("2026-W43"); // Sunday ends the week
    expect(isoWeekCycle("2026-10-26")).toBe("2026-W44");
    expect(isoWeekCycle("2025-12-29")).toBe("2026-W01");
    expect(isoWeekCycle("2026-12-31")).toBe("2026-W53");
    expect(isoWeekCycle("2027-01-01")).toBe("2026-W53");
    expect(isoWeekCycle("2027-01-04")).toBe("2027-W01");
  });
  it("a post outside its batch's week is reported; a plan cycle is not a week", () => {
    expect(batchWeekProblem("2026-W43", "2026-10-23T07:00")).toBe(null);
    expect(batchWeekProblem("2026-W43", "2026-10-26T07:00")).toBe(
      "publishAt 2026-10-26T07:00 is in 2026-W44, not in its batch 2026-W43",
    );
    expect(batchWeekProblem("2026-11-plan", "2026-10-26T07:00")).toBe(null);
  });
});

describe("publish slots", () => {
  it("are every Monday, Wednesday and Friday at 07:00, and nothing else", () => {
    expect(publishSlots("2026-10-19", "2026-10-25")).toEqual([
      "2026-10-19T07:00",
      "2026-10-21T07:00",
      "2026-10-23T07:00",
    ]);
    expect(publishSlots("2026-11-01", "2026-11-30")).toHaveLength(13);
  });
});

describe("the November 2026 plan skeleton", () => {
  const plan = planSkeleton("2026-11");
  it("lists the month's College Board dates with their sources", () => {
    expect(plan).toContain(
      "| Sat, Nov 7, 2026 | SAT test day | Sat, Nov 7, 2026 | 6 |",
    );
    expect(plan).toContain(
      "| Fri, Nov 20, 2026 | Registration deadline | Sat, Dec 5, 2026 | 19 |",
    );
    expect(plan).toContain(
      "| Fri, Nov 20, 2026 | Scores released (students) | Sat, Nov 7, 2026 | 19 |",
    );
    expect(plan).toContain(
      "| Tue, Nov 24, 2026 | Late registration and changes deadline | Sat, Dec 5, 2026 | 23 |",
    );
    expect(plan).toContain(
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
    );
    expect(plan).toContain(
      "https://satsuite.collegeboard.org/scores/score-release-dates",
    );
  });
  it("has one row per slot, each with its cycle and the days to the next test", () => {
    const rows = plan.split("\n").filter((l) => /^\| 2026-W\d\d \|/.test(l));
    expect(rows).toHaveLength(13);
    expect(rows[0]).toBe(
      "| 2026-W45 | Mon, Nov 2, 2026 | Sat, Nov 7, 2026 (5) |  |  |  |  |  |",
    );
    // The day after the Nov 7 test, the next test is Dec 5.
    expect(rows[3]).toBe(
      "| 2026-W46 | Mon, Nov 9, 2026 | Sat, Dec 5, 2026 (26) |  |  |  |  |  |",
    );
  });
  it("refuses a malformed month", () => {
    expect(() => planSkeleton("2026-13")).toThrow(/YYYY-MM/);
  });
});

describe("a plan for the rest of a month (Karl, 2026-10-15)", () => {
  const plan = planSkeleton("2026-10", "2026-10-19");
  it("lists only the slots from its start date, with the days to the next test", () => {
    const rows = plan.split("\n").filter((l) => /^\| 2026-W\d\d \|/.test(l));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe(
      "| 2026-W43 | Mon, Oct 19, 2026 | Sat, Nov 7, 2026 (19) |  |  |  |  |  |",
    );
    expect(rows[5]).toBe(
      "| 2026-W44 | Fri, Oct 30, 2026 | Sat, Nov 7, 2026 (8) |  |  |  |  |  |",
    );
  });
  it("still lists the whole month's SAT calendar", () => {
    expect(plan).toContain("| Fri, Oct 23, 2026 | Registration deadline |");
  });
  it("refuses a start date outside the month", () => {
    expect(() => planSkeleton("2026-10", "2026-11-02")).toThrow(/in 2026-10/);
  });
});
