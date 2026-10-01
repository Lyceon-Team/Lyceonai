/**
 * G-NEW-16 — the streak as of today (owner ruling 2026-09-30).
 * @spec [Guardian_Closure_Plan G-NEW-16] | @implemented [2026-09-30]
 */
import { describe, expect, it } from "vitest";
import { streakAsOfToday } from "../streak-as-of-today";

const today = "2026-09-30";

describe("streakAsOfToday", () => {
  it("active today keeps the stored streak", () => {
    expect(
      streakAsOfToday({
        stored: 5,
        lastActiveLocalDate: today,
        todayLocalDate: today,
      }),
    ).toBe(5);
  });
  it("active yesterday keeps it: today can still extend it", () => {
    expect(
      streakAsOfToday({
        stored: 5,
        lastActiveLocalDate: "2026-09-29",
        todayLocalDate: today,
      }),
    ).toBe(5);
  });
  it("last active two days ago reads 0", () => {
    expect(
      streakAsOfToday({
        stored: 5,
        lastActiveLocalDate: "2026-09-28",
        todayLocalDate: today,
      }),
    ).toBe(0);
  });
  it("last active three days ago reads 0", () => {
    expect(
      streakAsOfToday({
        stored: 5,
        lastActiveLocalDate: "2026-09-27",
        todayLocalDate: today,
      }),
    ).toBe(0);
  });
  it("across a month boundary, yesterday is still yesterday", () => {
    expect(
      streakAsOfToday({
        stored: 2,
        lastActiveLocalDate: "2026-09-30",
        todayLocalDate: "2026-10-01",
      }),
    ).toBe(2);
  });
  it("a positive streak with no last-active date is not trusted", () => {
    expect(
      streakAsOfToday({
        stored: 5,
        lastActiveLocalDate: null,
        todayLocalDate: today,
      }),
    ).toBe(0);
  });
  it("a future last-active date (clock skew) counts as today", () => {
    expect(
      streakAsOfToday({
        stored: 4,
        lastActiveLocalDate: "2026-10-01",
        todayLocalDate: today,
      }),
    ).toBe(4);
  });
  it("zero stays zero", () => {
    expect(
      streakAsOfToday({
        stored: 0,
        lastActiveLocalDate: today,
        todayLocalDate: today,
      }),
    ).toBe(0);
  });
});
