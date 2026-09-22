/**
 * U5 (pure half) — the session picker groups by LOCAL day and formats the two lines.
 *
 * @spec [ruling 20; brief R4 §2.3, U5] | @implemented [2026-09-22]
 *
 * PLANT (brief R4 §3, U5): "format in UTC instead of the browser timezone". The plant
 * target is `review.tsx`'s `todayKey`, which is computed with `localDateKey(new Date(),
 * browserTimeZone())`. Swapping `browserTimeZone()` for `"UTC"` there makes the
 * evening-west-of-Greenwich case below label "Today" as "Yesterday". These tests pin
 * the pure functions; `review.test.tsx` pins the wiring that feeds them.
 */
import { describe, expect, it } from "vitest";
import {
  dayHeaderLabel,
  groupByLocalDay,
  localDateKey,
  sourceEngineLabel,
  sourceFiltersLine,
  sourceHeadline,
} from "./review-session-picker";

describe("localDateKey", () => {
  it("resolves the calendar day in the GIVEN zone, not UTC", () => {
    // 2026-09-18T02:30:00Z is still 2026-09-17 in Los Angeles (UTC-7).
    const instant = new Date("2026-09-18T02:30:00.000Z");
    expect(localDateKey(instant, "America/Los_Angeles")).toBe("2026-09-17");
    expect(localDateKey(instant, "UTC")).toBe("2026-09-18");
  });

  it("falls back to the host zone rather than throwing on a bad zone", () => {
    const instant = new Date("2026-09-18T02:30:00.000Z");
    expect(localDateKey(instant, "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dayHeaderLabel", () => {
  it('labels the caller\'s own day "Today"', () => {
    expect(dayHeaderLabel("2026-09-17", "2026-09-17")).toBe("Today");
  });

  it('labels the day before "Yesterday"', () => {
    expect(dayHeaderLabel("2026-09-16", "2026-09-17")).toBe("Yesterday");
  });

  it("labels anything older with a weekday and date", () => {
    expect(dayHeaderLabel("2026-09-17", "2026-09-22")).toBe("Thu, Sep 17");
  });

  it("does not shift the date when rendering the long form", () => {
    // The row's local_date is already the student's calendar day. Re-interpreting it
    // in a western zone would print Sep 16 for a Sep 17 row.
    expect(dayHeaderLabel("2026-09-17", "2026-10-01")).toContain("Sep 17");
  });

  it('groups a session whose parent row is gone under "Earlier" rather than dropping it', () => {
    expect(dayHeaderLabel(null, "2026-09-17")).toBe("Earlier");
  });

  it("MISLABELS when today is computed in the wrong zone — what the U5 plant breaks", () => {
    const instant = new Date("2026-09-18T02:30:00.000Z");
    const rowLocalDate = localDateKey(instant, "America/Los_Angeles");
    const correctToday = localDateKey(instant, "America/Los_Angeles");
    const utcToday = localDateKey(instant, "UTC");

    expect(dayHeaderLabel(rowLocalDate, correctToday)).toBe("Today");
    expect(dayHeaderLabel(rowLocalDate, utcToday)).toBe("Yesterday");
  });
});

describe("sourceHeadline / sourceEngineLabel", () => {
  it('formats "Practice · 2:40 PM"', () => {
    expect(sourceHeadline("practice", "2:40 PM")).toBe("Practice · 2:40 PM");
  });

  it('labels a review-sourced row "Review · 3:10 PM"', () => {
    expect(sourceHeadline("review", "3:10 PM")).toBe("Review · 3:10 PM");
    expect(sourceEngineLabel("review")).toBe("Review");
  });

  it("drops the separator when the server could not resolve a time", () => {
    expect(sourceHeadline("practice", null)).toBe("Practice");
  });
});

describe("sourceFiltersLine", () => {
  it('reads "Math · Algebra" from a single-section, single-domain session', () => {
    expect(
      sourceFiltersLine("balanced", { sections: ["M"], domains: ["Algebra"] }),
    ).toBe("Math · Algebra");
  });

  it('reads "Reading & Writing · Mixed" when no topic filter was set', () => {
    expect(sourceFiltersLine("balanced", { sections: ["RW"] })).toBe(
      "Reading & Writing · Mixed",
    );
  });

  it('reads "Diagnostic" from a diagnostic session regardless of filters', () => {
    expect(sourceFiltersLine("diagnostic", { sections: ["M"] })).toBe(
      "Diagnostic",
    );
  });

  it("degrades to Mixed rather than throwing on junk in the jsonb column", () => {
    expect(sourceFiltersLine(null, "not-an-object")).toBe("Mixed");
    expect(sourceFiltersLine(null, null)).toBe("Mixed");
    expect(sourceFiltersLine(null, { sections: [1, 2, 3] })).toBe("Mixed");
  });
});

describe("groupByLocalDay", () => {
  const rows = [
    { local_date: "2026-09-17", id: "a" },
    { local_date: "2026-09-16", id: "b" },
    { local_date: "2026-09-17", id: "c" },
    { local_date: null, id: "d" },
  ];

  it("groups newest day first and keeps the server's order inside a day", () => {
    const groups = groupByLocalDay(rows, "2026-09-17");
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "Earlier",
    ]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("sorts a dateless group last — an unknown day is not a recent one", () => {
    const groups = groupByLocalDay(rows, "2026-09-17");
    expect(groups[groups.length - 1]?.rows.map((r) => r.id)).toEqual(["d"]);
  });

  it("returns nothing for an empty pool", () => {
    expect(groupByLocalDay([], "2026-09-17")).toEqual([]);
  });
});
