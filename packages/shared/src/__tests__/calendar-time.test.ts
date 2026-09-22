/**
 * @spec [Doc_05F §8.2, §13 (sort order), §22.4] | @implemented [2026-09-17]
 * plain English: the calendar's time primitives are integer arithmetic on strings. These
 * tests pin the two things the allocator depends on — that one instant sorts as one instant
 * whatever offset form it arrives in, and that a local date is a real date.
 */
import { describe, expect, it } from "vitest";
import {
  addDaysToLocalDate,
  daysBetweenLocalDates,
  instantSortKey,
  isValidInstant,
  isValidLocalDate,
  localDateSchema,
  postgresDowOfLocalDate,
} from "../calendar/time";

describe("local dates", () => {
  it("accepts a real date and refuses one that only looks like a date", () => {
    expect(isValidLocalDate("2026-09-17")).toBe(true);
    expect(isValidLocalDate("2026-02-28")).toBe(true);
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2024-02-29")).toBe(true);
    expect(isValidLocalDate("2000-02-29")).toBe(true);
    expect(isValidLocalDate("1900-02-29")).toBe(false);
    expect(isValidLocalDate("2026-02-31")).toBe(false);
    expect(isValidLocalDate("2026-13-01")).toBe(false);
    expect(isValidLocalDate("2026-9-17")).toBe(false);
    expect(localDateSchema.safeParse("2026-04-31").success).toBe(false);
  });

  it("adds days across a month and a year boundary", () => {
    expect(addDaysToLocalDate("2026-09-17", 540)).toBe("2028-03-10");
    expect(addDaysToLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToLocalDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysToLocalDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("counts days between dates in both directions", () => {
    expect(daysBetweenLocalDates("2026-09-13", "2026-09-17")).toBe(4);
    expect(daysBetweenLocalDates("2026-09-17", "2026-09-13")).toBe(-4);
    expect(daysBetweenLocalDates("2026-09-17", "2026-09-17")).toBe(0);
  });

  it("uses the Postgres DOW convention — Sunday is 0, never ISODOW", () => {
    expect(postgresDowOfLocalDate("2026-09-13")).toBe(0); // Sunday
    expect(postgresDowOfLocalDate("2026-09-14")).toBe(1); // Monday
    expect(postgresDowOfLocalDate("2026-09-19")).toBe(6); // Saturday
    expect(postgresDowOfLocalDate("1970-01-01")).toBe(4); // Thursday
  });
});

describe("instants", () => {
  it("refuses a timestamp with no zone — it has no instant", () => {
    expect(isValidInstant("2026-09-14T06:50:00")).toBe(false);
    expect(isValidInstant("2026-09-14")).toBe(false);
    expect(isValidInstant("2026-09-14T24:00:00Z")).toBe(false);
    expect(isValidInstant("2026-09-14T06:60:00Z")).toBe(false);
    expect(isValidInstant("2026-02-31T06:00:00Z")).toBe(false);
  });

  it("accepts the forms Postgres and the Supabase client actually produce", () => {
    expect(isValidInstant("2026-09-14T06:50:00Z")).toBe(true);
    expect(isValidInstant("2026-09-14T06:50:00+00:00")).toBe(true);
    expect(isValidInstant("2026-09-14 06:50:00+00")).toBe(true);
    expect(isValidInstant("2026-09-14T06:50:00.123456+00:00")).toBe(true);
  });

  it("sorts one instant as one instant, whatever offset it wears", () => {
    const utc = instantSortKey("2026-09-14T06:50:00Z");
    expect(instantSortKey("2026-09-14T06:50:00+00:00")).toBe(utc);
    expect(instantSortKey("2026-09-14 06:50:00+00")).toBe(utc);
    expect(instantSortKey("2026-09-13T23:50:00-07:00")).toBe(utc);
    expect(instantSortKey("2026-09-14T08:50:00+02:00")).toBe(utc);
  });

  it("orders §22.4's midnight session by real time, not by string shape", () => {
    // 23:50 in Los Angeles is 06:50Z the next day. A lexicographic sort of the LOCAL strings
    // would put the post-midnight items first; the sort key does not.
    const beforeMidnight = instantSortKey("2026-09-13T23:50:00-07:00");
    const afterMidnight = instantSortKey("2026-09-14T00:10:00-07:00");
    expect(beforeMidnight).toBeLessThan(afterMidnight);
  });

  it("is the epoch millisecond count", () => {
    expect(instantSortKey("1970-01-01T00:00:00Z")).toBe(0);
    expect(instantSortKey("1970-01-01T00:00:01.500Z")).toBe(1500);
  });
});
