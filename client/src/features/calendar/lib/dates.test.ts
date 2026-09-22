/**
 * @spec [Doc_05F_Study_Calendar, §8.2 local dates, R-08-30 Monday-anchored local ISO week]
 *
 * plain English: pins the two things this module exists to guarantee — the week the student
 * sees starts on a MONDAY, and a plan date never shifts by a day. Both are easy to break and
 * silent when broken: a Sunday is the day a `getUTCDay()`-anchored week gets wrong, and a DST
 * boundary is the day a local-`Date` implementation gets wrong.
 */
import { describe, expect, it } from "vitest";
import {
  MONTH_GRID_LENGTH,
  WEEKDAY_HEADERS,
  WEEK_LENGTH,
  addDays,
  addMonths,
  dayOfMonth,
  dayOfWeek,
  daysBetween,
  isSameMonth,
  longDate,
  monthGridDates,
  monthName,
  rangeForView,
  rangeLabel,
  shortDate,
  shortWeekday,
  startOfMonth,
  startOfWeek,
  weekDates,
} from "./dates";

/** Monday 2026-09-21 … Sunday 2026-09-27 — one whole week, verified against the calendar. */
const WEEK_OF_21_SEPTEMBER_2026 = [
  "2026-09-21", // Monday
  "2026-09-22", // Tuesday
  "2026-09-23", // Wednesday
  "2026-09-24", // Thursday
  "2026-09-25", // Friday
  "2026-09-26", // Saturday
  "2026-09-27", // Sunday
] as const;

describe("startOfWeek (R-08-30)", () => {
  it("anchors the week on Monday, including for a Sunday (R-08-30)", () => {
    // 2026-09-27 is a Sunday. A `getUTCDay()`-anchored week puts Sunday at 0 and would
    // return 2026-09-27 itself; R-08-30 says the week it belongs to began on 2026-09-21.
    expect(dayOfWeek("2026-09-27")).toBe(0);
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
  });

  it("maps every day of one week to the same Monday", () => {
    for (const date of WEEK_OF_21_SEPTEMBER_2026) {
      expect(startOfWeek(date)).toBe("2026-09-21");
    }
  });

  it("is a fixed point on a Monday", () => {
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("crosses back into the previous month when the week does", () => {
    // Thursday 2026-10-01 belongs to the week that began Monday 2026-09-28.
    expect(startOfWeek("2026-10-01")).toBe("2026-09-28");
  });

  it("puts Monday first in the column headers, matching the grids", () => {
    expect([...WEEKDAY_HEADERS]).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });
});

describe("addDays", () => {
  it("adds a day inside a month", () => {
    expect(addDays("2026-09-21", 1)).toBe("2026-09-22");
  });

  it("crosses a month boundary in both directions", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("crosses a year boundary in both directions", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("handles February in a non-leap year and the leap day in a leap one", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("returns the same date for zero", () => {
    expect(addDays("2026-09-21", 0)).toBe("2026-09-21");
  });
});

describe("addDays across a DST transition (§8.2: a plan date is not a moment)", () => {
  // These are the two US transition dates for 2026. Parsing a plan date into a LOCAL `Date`
  // and adding 24h lands a day early or late here; the module parses to UTC midnight so that
  // a plan day stays a plan day regardless of the runner's zone.
  it("adds days correctly across the spring-forward date (2026-03-08)", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-03-01", 14)).toBe("2026-03-15");
    expect(addDays("2026-03-09", -2)).toBe("2026-03-07");
  });

  it("adds days correctly across the fall-back date (2026-11-01)", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDays("2026-10-25", 14)).toBe("2026-11-08");
    expect(addDays("2026-11-02", -2)).toBe("2026-10-31");
  });

  it("counts whole days across both transitions (no 23h or 25h day)", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
  });

  it("keeps the week Monday-anchored on a transition date", () => {
    // 2026-03-08 and 2026-11-01 are both Sundays — the two cases that stack both bugs.
    expect(startOfWeek("2026-03-08")).toBe("2026-03-02");
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
  });
});

describe("weekDates", () => {
  it("returns 7 dates starting on Monday", () => {
    const dates = weekDates("2026-09-24");
    expect(dates).toHaveLength(WEEK_LENGTH);
    expect(dates[0]).toBe("2026-09-21");
    expect([...dates]).toEqual([...WEEK_OF_21_SEPTEMBER_2026]);
  });

  it("returns the same week for every day in it, Sunday included", () => {
    const fromMonday = [...weekDates("2026-09-21")];
    for (const date of WEEK_OF_21_SEPTEMBER_2026) {
      expect([...weekDates(date)]).toEqual(fromMonday);
    }
  });

  it("spans two months when the week does", () => {
    expect([...weekDates("2026-10-01")]).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });
});

describe("monthGridDates", () => {
  it("is always 42 dates — six rows of seven, so the page never reflows", () => {
    for (const cursor of [
      "2026-02-10",
      "2026-09-15",
      "2026-11-30",
      "2028-02-01",
    ]) {
      expect(monthGridDates(cursor)).toHaveLength(MONTH_GRID_LENGTH);
    }
  });

  it("starts on the Monday on or before the 1st", () => {
    // 2026-09-01 is a Tuesday, so the grid opens on Monday 2026-08-31.
    const grid = monthGridDates("2026-09-15");
    expect(grid[0]).toBe("2026-08-31");
    expect(dayOfWeek(grid[0] ?? "")).toBe(1);
    expect(grid[MONTH_GRID_LENGTH - 1]).toBe("2026-10-11");
  });

  it("starts on the 1st itself when the 1st IS a Monday", () => {
    // 2026-06-01 is a Monday.
    expect(dayOfWeek("2026-06-01")).toBe(1);
    expect(monthGridDates("2026-06-20")[0]).toBe("2026-06-01");
  });

  it("includes every day of the month", () => {
    const grid = new Set(monthGridDates("2026-09-15"));
    for (let day = 1; day <= 30; day += 1) {
      expect(grid.has(`2026-09-${String(day).padStart(2, "0")}`)).toBe(true);
    }
  });

  it("includes every day of a February that starts on a Sunday", () => {
    // 2026-02-01 is a Sunday — the widest spill into the previous month.
    const grid = monthGridDates("2026-02-14");
    expect(grid[0]).toBe("2026-01-26");
    const dates = new Set(grid);
    for (let day = 1; day <= 28; day += 1) {
      expect(dates.has(`2026-02-${String(day).padStart(2, "0")}`)).toBe(true);
    }
  });

  it("is the same grid for every day in the month", () => {
    const fromFirst = [...monthGridDates("2026-09-01")];
    expect([...monthGridDates("2026-09-30")]).toEqual(fromFirst);
    expect([...monthGridDates("2026-09-15")]).toEqual(fromFirst);
  });

  it("is seven consecutive dates per row, with no gaps or repeats", () => {
    const grid = monthGridDates("2026-09-15");
    expect(new Set(grid).size).toBe(MONTH_GRID_LENGTH);
    for (let index = 1; index < grid.length; index += 1) {
      expect(grid[index]).toBe(addDays(grid[index - 1] ?? "", 1));
    }
  });
});

describe("rangeForView", () => {
  it("spans exactly the seven days of the week in week view", () => {
    expect(rangeForView("week", "2026-09-24")).toEqual({
      from: "2026-09-21",
      to: "2026-09-27",
    });
  });

  it("spans the WHOLE month grid, not the calendar month (§15 read range)", () => {
    // If the read stopped at the 1st, the grid's first row would render empty and read as
    // rest days. `from` must be BEFORE the 1st whenever the 1st is not a Monday.
    const range = rangeForView("month", "2026-09-15");
    expect(range.from).toBe("2026-08-31");
    expect(range.from < "2026-09-01").toBe(true);
    expect(range.to).toBe("2026-10-11");
    expect(range.to > "2026-09-30").toBe(true);
  });

  it("covers every date the month grid renders", () => {
    const grid = monthGridDates("2026-02-14");
    const range = rangeForView("month", "2026-02-14");
    for (const date of grid) {
      expect(date >= range.from && date <= range.to).toBe(true);
    }
  });
});

describe("rangeLabel", () => {
  it("names the day range inside one month", () => {
    expect(rangeLabel("week", "2026-09-22")).toBe("21 – 27 September");
  });

  it("abbreviates both months when the week spans two", () => {
    expect(rangeLabel("week", "2026-09-30")).toBe("28 Sep – 4 Oct");
  });

  it("names the month and year in month view", () => {
    expect(rangeLabel("month", "2026-09-15")).toBe("September 2026");
    expect(rangeLabel("month", "2026-01-31")).toBe("January 2026");
  });
});

describe("daysBetween", () => {
  it("counts whole days forward", () => {
    expect(daysBetween("2026-09-21", "2026-09-28")).toBe(7);
  });

  it("is zero for the same date", () => {
    expect(daysBetween("2026-09-21", "2026-09-21")).toBe(0);
  });

  it("is NEGATIVE when `to` is earlier than `from`", () => {
    expect(daysBetween("2026-09-28", "2026-09-21")).toBe(-7);
    expect(daysBetween("2027-01-01", "2026-12-31")).toBe(-1);
  });

  it("counts across a year boundary", () => {
    expect(daysBetween("2026-12-25", "2027-01-04")).toBe(10);
  });
});

describe("longDate and shortDate", () => {
  it('formats the side sheet line as "Monday 21 September"', () => {
    expect(longDate("2026-09-21")).toBe("Monday 21 September");
  });

  it("formats a Sunday with the right weekday name", () => {
    expect(longDate("2026-09-27")).toBe("Sunday 27 September");
  });

  it('formats the compact line as "Mon 21 Sep"', () => {
    expect(shortDate("2026-09-21")).toBe("Mon 21 Sep");
    expect(shortDate("2026-10-04")).toBe("Sun 4 Oct");
  });

  it("does not zero-pad the day of the month", () => {
    expect(longDate("2026-09-01")).toBe("Tuesday 1 September");
    expect(shortDate("2026-09-01")).toBe("Tue 1 Sep");
  });
});

describe("the small helpers the grids lean on", () => {
  it("startOfMonth returns the 1st of the date's own month", () => {
    expect(startOfMonth("2026-09-21")).toBe("2026-09-01");
    expect(startOfMonth("2026-09-01")).toBe("2026-09-01");
  });

  it("addMonths walks whole months from the 1st, across a year boundary", () => {
    expect(addMonths("2026-09-21", 1)).toBe("2026-10-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("dayOfMonth and monthName read the date, not the runner's clock", () => {
    expect(dayOfMonth("2026-09-21")).toBe(21);
    expect(monthName("2026-01-15")).toBe("January");
    expect(monthName("2026-12-15")).toBe("December");
  });

  it("isSameMonth compares month AND year", () => {
    expect(isSameMonth("2026-09-01", "2026-09-30")).toBe(true);
    expect(isSameMonth("2026-09-30", "2026-10-01")).toBe(false);
    expect(isSameMonth("2026-09-15", "2027-09-15")).toBe(false);
  });

  it("shortWeekday uses the Sunday-zero names `dayOfWeek` returns", () => {
    expect(shortWeekday("2026-09-21")).toBe("Mon");
    expect(shortWeekday("2026-09-27")).toBe("Sun");
  });
});
