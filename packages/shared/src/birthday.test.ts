/**
 * The birthday rules, once, for both sides.
 *
 * @spec [owner brief "birthday input" (Karl, 2026-11-04); live bug 2026-11-04 (four profiles
 *       saved the CURRENT year)] | @implemented [2026-11-04]
 *
 * plain English: `resolveBirthday` is the one judge the browser and the server both run, so these
 * are the rules for both. The first describe block is the live bug: the dates that were actually
 * stored, each of which every previous check accepted.
 */
import { describe, expect, it } from "vitest";
import {
  BIRTH_MONTHS,
  birthYearPlaceholder,
  birthdayPartsFromIso,
  EMPTY_BIRTHDAY,
  errorFor,
  formatBirthdayConfirmation,
  resolveBirthday,
} from "./birthday";

/** The day Karl reported the bug, so "current year" means 2026 throughout. */
const TODAY = new Date("2026-11-04T12:00:00Z");

function resolve(month: string, day: string, year: string) {
  return resolveBirthday({ month, day, year }, TODAY);
}

describe("the live bug: a birthday in the current year", () => {
  // Exactly the four rows found in `profiles.date_of_birth` on 2026-11-04.
  it.each([
    ["Karl's test account", "4", "4", "2026"],
    ["z3k3.008@gmail.com", "4", "3", "2026"],
    ["dixitastha02@gmail.com (its own sign-up date)", "11", "4", "2026"],
    ["tolembeknuradil@gmail.com", "6", "19", "2026"],
  ])("refuses the stored date for %s", (_who, month, day, year) => {
    const result = resolve(month, day, year);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // The YEAR is named as the wrong field, because in every one of these it was.
    expect(errorFor(result.errors, "year")).toBe(
      "Check the year — that's less than 5 years ago.",
    );
  });

  it("accepts the year Karl actually entered, and keeps it exactly", () => {
    const result = resolve("4", "4", "2006");
    expect(result).toEqual({
      ok: true,
      iso: "2006-04-04",
      month: 4,
      day: 4,
      year: 2006,
    });
  });
});

describe("required fields — nothing is pre-filled", () => {
  it("names all three when nothing has been entered", () => {
    const result = resolveBirthday(EMPTY_BIRTHDAY, TODAY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.map((e) => [e.field, e.message])).toEqual([
      ["month", "Choose your birth month."],
      ["day", "Enter your birth day."],
      ["year", "Enter your birth year."],
    ]);
  });

  it.each([
    ["no month", "", "4", "2006", "month"],
    ["no day", "4", "", "2006", "day"],
    ["no year", "4", "4", "", "year"],
  ])("refuses with %s", (_label, month, day, year, field) => {
    const result = resolve(month, day, year);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(errorFor(result.errors, field as "month" | "day" | "year")).not.toBe(
      null,
    );
  });

  it("the Year placeholder is a hint, not a value", () => {
    // today − 13, as the brief asks. It is a placeholder attribute; `resolveBirthday`
    // never sees it, which this proves: an empty year is still an error.
    expect(birthYearPlaceholder(TODAY)).toBe("2013");
    const result = resolve("4", "4", "");
    expect(result.ok).toBe(false);
  });
});

describe("a 4-digit year", () => {
  it.each([
    ["1", "1"],
    ["06", "2-digit"],
    ["200", "3-digit"],
  ])("refuses %s (%s) rather than widening it to a century", (year) => {
    const result = resolve("4", "4", year);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(errorFor(result.errors, "year")).toBe(
      "Enter the full 4-digit year, like 2006.",
    );
  });

  it("accepts exactly four digits", () => {
    expect(resolve("4", "4", "2006").ok).toBe(true);
  });
});

describe("a real calendar date", () => {
  it.each([
    ["February 30", "2", "30"],
    ["February 31", "2", "31"],
    ["April 31", "4", "31"],
    ["June 31", "6", "31"],
  ])("refuses %s", (_label, month, day) => {
    const result = resolve(month, day, "2006");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(errorFor(result.errors, "day")).toMatch(/doesn't exist in/);
  });

  it("refuses February 29 in a common year and accepts it in a leap year", () => {
    expect(resolve("2", "29", "2007").ok).toBe(false);
    expect(resolve("2", "29", "2004").ok).toBe(true);
  });

  it.each([
    ["day 0", "4", "0"],
    ["day 32", "4", "32"],
  ])("refuses %s", (_label, month, day) => {
    expect(resolve(month, day, "2006").ok).toBe(false);
  });

  it("refuses a non-numeric day or year rather than coercing it", () => {
    expect(resolve("4", "4th", "2006").ok).toBe(false);
    expect(resolve("4", "4", "two thousand six").ok).toBe(false);
  });
});

describe("no future dates, and a plausible age", () => {
  it("refuses tomorrow, naming the future", () => {
    const result = resolve("11", "5", "2026");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(errorFor(result.errors, "year")).toBe(
      "Your date of birth can't be in the future.",
    );
  });

  it("refuses a year in the future", () => {
    expect(resolve("1", "1", "2027").ok).toBe(false);
  });

  it("refuses under the 5-year floor, and accepts exactly 5", () => {
    // The floor is the owner's ruling of 2026-11-04; it is what the current-year
    // dates fall foul of. Today is 2026-11-04, so five years ago is 2021-11-04.
    expect(resolve("11", "4", "2021").ok).toBe(true); // exactly 5 today
    expect(resolve("11", "5", "2021").ok).toBe(false); // 4, by one day
  });

  it("refuses over the 120-year ceiling, and accepts exactly 120", () => {
    expect(resolve("11", "4", "1906").ok).toBe(true); // exactly 120 today
    expect(resolve("11", "4", "1905").ok).toBe(false); // 121, one year over
  });

  it("still accepts an under-13 student — the gate is elsewhere", () => {
    // Doc-01 §37.1: an under-13 date is ACCEPTED here and held at the guardian link.
    // The floor must not pre-empt that.
    const result = resolve("4", "4", "2016");
    expect(result.ok).toBe(true);
  });
});

describe("the confirmation line", () => {
  it("reads the date back in plain language", () => {
    expect(formatBirthdayConfirmation(4, 4, 2006)).toBe("Born April 4, 2006.");
    expect(formatBirthdayConfirmation(12, 25, 1999)).toBe(
      "Born December 25, 1999.",
    );
  });

  it("does not shift the day across a timezone", () => {
    // Built from the parts, never from a Date — the whole point is that the value
    // the person typed is the value shown and stored.
    for (const m of BIRTH_MONTHS) {
      expect(formatBirthdayConfirmation(m.value, 1, 2006)).toBe(
        `Born ${m.label} 1, 2006.`,
      );
    }
  });
});

describe("round trip", () => {
  it("fills the three fields from a stored date and back again", () => {
    const parts = birthdayPartsFromIso("2006-04-04");
    expect(parts).toEqual({ month: "4", day: "4", year: "2006" });
    const back = resolveBirthday(parts, TODAY);
    expect(back.ok && back.iso).toBe("2006-04-04");
  });

  it("gives empty fields for a null or malformed stored date", () => {
    expect(birthdayPartsFromIso(null)).toEqual(EMPTY_BIRTHDAY);
    expect(birthdayPartsFromIso("2006-02-31")).toEqual(EMPTY_BIRTHDAY);
  });
});
