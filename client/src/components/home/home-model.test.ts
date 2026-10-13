/**
 * Home's pure words and numbers (UI-50), over real calendar output.
 *
 * @spec [DESIGN.md §3 "Ruler progress", §4 Home; prototype Main.dc.html (the templates);
 *        evidence/wiring-table.md §3 Home; register OQ-22, OQ-39(c)] | @implemented [2026-10-03]
 *
 * The calendar days are `studentCalendarWeek`'s, built by the real read model and parsed by the
 * calendar schema, so `status`, `planned_count` and the blocks are what the server computes.
 */
import { describe, expect, it } from "vitest";
import {
  calendarReadyResponseSchema,
  type CalendarDay,
} from "@lyceon/shared/calendar";
import { toSessionCriteria } from "@lyceon/shared/session-criteria";
import {
  reviewPoolSourceSessionSchema,
  type ReviewPoolSourceSession,
} from "@lyceon/shared/review-schema";
import { studentCalendarWeek } from "@/features/calendar/calendar-week.fixture";
import { rulerFill } from "@/components/student-ui/RulerProgress";
import {
  dateLine,
  firstOpenBlock,
  freeHomeStage,
  greetingLine,
  joinList,
  planRowView,
  planTotal,
  recentSessionTitle,
  sessionTitle,
  weekSummary,
} from "./home-model";

// The route's envelope adds `requestId`, which the calendar client strips before its parse.
const { requestId: _transport, ...payload } = studentCalendarWeek("2026-10-01");
const week = calendarReadyResponseSchema.parse(payload);
const day = (date: string): CalendarDay => {
  const found = week.days.find((d) => d.local_date === date);
  if (found === undefined) throw new Error(`no ${date} in the fixture week`);
  return found;
};

describe("the header", () => {
  it("greets by the local hour, with the name when there is one", () => {
    expect(greetingLine(9, "Sam")).toBe("Good morning, Sam");
    expect(greetingLine(13, "Sam")).toBe("Good afternoon, Sam");
    expect(greetingLine(20, "  ")).toBe("Good evening");
    expect(greetingLine(20, null)).toBe("Good evening");
  });

  it("writes the date line, and the countdown only for a test date still ahead", () => {
    expect(dateLine("2026-09-28", "2026-12-05")).toBe(
      "Monday, September 28. 68 days until your SAT on Saturday, December 5.",
    );
    expect(dateLine("2026-12-04", "2026-12-05")).toBe(
      "Friday, December 4. 1 day until your SAT on Saturday, December 5.",
    );
    expect(dateLine("2026-12-05", "2026-12-05")).toBe("Saturday, December 5.");
    expect(dateLine("2026-12-06", "2026-12-05")).toBe("Sunday, December 6.");
    expect(dateLine("2026-09-28", null)).toBe("Monday, September 28.");
  });
});

describe("today's plan rows", () => {
  it("names each block the prototype's way, from the real week", () => {
    // Monday: Math (Algebra, 15) and Reading and Writing (Craft and Structure, 12).
    const monday = day("2026-09-28");
    expect(
      monday.blocks.map((b) => {
        const v = planRowView(b, week.estimates);
        return [v.title, v.detail, v.time, v.completed];
      }),
    ).toEqual([
      ["Math", "15 questions in Algebra", "About 23 min", true],
      [
        "Reading & Writing",
        "12 questions in Craft and Structure",
        "About 18 min",
        true,
      ],
    ]);
    // Tuesday's review block; Saturday's full-length test has no minutes to state.
    const review = day("2026-09-29").blocks[1];
    const test = day("2026-10-03").blocks[0];
    if (review === undefined || test === undefined) throw new Error("fixture");
    expect(planRowView(review, week.estimates)).toMatchObject({
      title: "Review",
      detail: "10 questions from your review queue",
      time: "About 10 min",
    });
    expect(planRowView(test, week.estimates)).toMatchObject({
      title: "Full-length test",
      detail: null,
      time: null,
    });
  });

  it("totals the day and finds the first block not completed", () => {
    const thursday = day("2026-10-01");
    expect(planTotal(thursday.blocks, week.estimates)).toBe("About 33 min");
    // Slot 0 is done, so the review block (slot 1) is first.
    expect(firstOpenBlock(thursday.blocks)?.block_type).toBe("review");
    // Monday is entirely done: nothing to start.
    expect(firstOpenBlock(day("2026-09-28").blocks)).toBeNull();
    // A day of only a full-length test has no stated duration.
    expect(planTotal(day("2026-10-03").blocks, week.estimates)).toBeNull();
  });

  it("writes minutes and lists the prototype's way", () => {
    // Monday's Math block is 15 questions; the per-question estimate sets its minutes
    // (15 x 92s = 23 min, 15 x 244s = 61, 15 x 520s = 130, 15 x 600s = 150).
    const math = day("2026-09-28").blocks[0];
    if (math === undefined) throw new Error("fixture");
    expect(math.block.target_count).toBe(15);
    const timeAt = (practiceSecondsPerUnit: number): string | null =>
      planRowView(math, {
        ...week.estimates,
        practice_seconds_per_unit: practiceSecondsPerUnit,
      }).time;
    expect(timeAt(92)).toBe("About 23 min");
    expect(timeAt(244)).toBe("About 1 hour");
    expect(timeAt(520)).toBe("About 2 hours");
    expect(timeAt(600)).toBe("About 3 hours"); // 150 min rounds to the nearest hour
    expect(joinList(["Algebra"])).toBe("Algebra");
    expect(joinList(["A", "B"])).toBe("A and B");
    expect(joinList(["A", "B", "C"])).toBe("A, B, and C");
  });
});

describe("the week summary", () => {
  it("counts done days over the days that ask for work", () => {
    // Mon complete; Tue, Wed, Thu partial; Fri, Sat upcoming; Sun rest (no plan).
    expect(weekSummary(week.days)).toBe("1 of 6 days done.");
  });

  it("adds 'N questions planned each day' only when every planned day plans the same", () => {
    const same = week.days
      .filter((d) => d.planned_count > 0)
      .map((d) => ({ ...d, planned_count: 35 }));
    expect(weekSummary(same)).toBe(
      "1 of 6 days done. 35 questions planned each day.",
    );
    expect(weekSummary([])).toBeNull();
  });
});

describe("session names (OQ-22)", () => {
  it("uses the most specific criteria, then the shipped fallbacks", () => {
    const c = (stored: unknown) => toSessionCriteria(stored);
    expect(
      sessionTitle(
        "practice",
        c({ domains: ["Algebra"], skills: ["Linear functions"] }),
        "M",
      ),
    ).toBe("Linear functions");
    expect(
      sessionTitle(
        "practice",
        c({ domains: ["Algebra", "Advanced Math"] }),
        "M",
      ),
    ).toBe("Algebra, Advanced Math");
    expect(sessionTitle("review", c({ sections: ["RW"] }), null)).toBe(
      "Reading & Writing",
    );
    expect(sessionTitle("review", c(null), null)).toBe("Review session");
    expect(sessionTitle("practice", c(null), "M")).toBe("Math");
    expect(sessionTitle("practice", c(null), null)).toBe("Practice");
  });
});

/**
 * UI-66 (OQ-53 (e), owner ruling 2026-10-05): a recent-session row (`/api/review/pool`) is named
 * as an open row is. Every row is parsed by the pool's own row schema, so `filters` has the
 * shapes the server sends since F-52 (the strict four arrays, a full-length `{test_form_name}`,
 * or null) and no other.
 */
describe("recent-session names (UI-66)", () => {
  const row = (over: Record<string, unknown>): ReviewPoolSourceSession =>
    reviewPoolSourceSessionSchema.parse({
      source_engine: "practice",
      source_session_id: "s-1",
      created_at: "2026-10-07T14:40:00Z",
      local_date: "2026-10-07",
      local_time: "9:40 AM",
      mode: "custom",
      filters: null,
      open_count: 3,
      ...over,
    });
  const criteria = (c: Record<string, string[]>) => ({
    sections: [],
    domains: [],
    skills: [],
    difficulties: [],
    ...c,
  });

  it("names a practice or review row by its criteria, through sessionTitle", () => {
    expect(
      recentSessionTitle(
        row({
          filters: criteria({
            sections: ["M"],
            domains: ["Algebra"],
            skills: ["Linear functions"],
          }),
        }),
      ),
    ).toBe("Linear functions");
    expect(
      recentSessionTitle(
        row({ filters: criteria({ sections: ["M"], domains: ["Algebra"] }) }),
      ),
    ).toBe("Algebra");
    expect(
      recentSessionTitle(
        row({
          source_engine: "review",
          mode: "filter",
          filters: criteria({ sections: ["RW"] }),
        }),
      ),
    ).toBe("Reading & Writing");
  });

  it("falls back as the open rows do when a row carries no criteria", () => {
    expect(recentSessionTitle(row({}))).toBe("Practice");
    expect(recentSessionTitle(row({ filters: criteria({}) }))).toBe("Practice");
    expect(
      recentSessionTitle(row({ source_engine: "review", mode: "queue" })),
    ).toBe("Review session");
  });

  it("names a full-length row by its form, a diagnostic by the shipped label", () => {
    expect(
      recentSessionTitle(
        row({
          source_engine: "full_length",
          mode: null,
          filters: { test_form_name: "Practice Test 1" },
        }),
      ),
    ).toBe("Full-Length Test 1");
    expect(
      recentSessionTitle(
        row({ source_engine: "full_length", mode: null, filters: null }),
      ),
    ).toBe("Full-length test");
    expect(
      recentSessionTitle(
        row({ mode: "diagnostic", filters: criteria({ sections: ["M"] }) }),
      ),
    ).toBe("Diagnostic");
  });
});

describe("the free Home's stage", () => {
  it("decides pending before no_baseline and offers nothing on an unknown status", () => {
    expect(freeHomeStage("baseline_pending")).toBe("pending");
    expect(freeHomeStage("no_baseline")).toBe("diagnostic");
    expect(freeHomeStage("baseline_only")).toBe("after");
    expect(freeHomeStage("computed")).toBe("after");
    expect(freeHomeStage(undefined)).toBe("unknown");
  });
});

describe("the ruler (DESIGN.md §3: 40 ticks)", () => {
  it("scales the student's own count to whole ticks, never past 40", () => {
    // The full ruler is 40 ticks: a complete count fills exactly 40, whatever the whole.
    expect(rulerFill(1, 1)).toBe(40);
    expect(rulerFill(26, 26)).toBe(40);
    expect(rulerFill(12, 40)).toBe(12);
    expect(rulerFill(7, 26)).toBe(11);
    expect(rulerFill(50, 40)).toBe(40);
    expect(rulerFill(0, 40)).toBe(0);
    expect(rulerFill(5, 0)).toBe(0);
  });
});
