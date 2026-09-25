/**
 * @spec [Doc-04A_V2.2 §8.2, §8.3; E7b plant "the timer doesn't advance when the
 *        system clock moves forward"] | @implemented [2026-09-25]
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anchorClock,
  crossedAnnouncement,
  formatClock,
  remainingAt,
  spokenClock,
  timerForcedVisible,
} from "./countdown";

afterEach(() => {
  vi.useRealTimers();
});

describe("countdown (monotonic)", () => {
  it("counts down from the server value by monotonic elapsed time only", () => {
    const a = anchorClock(60_000, 1_000);
    expect(remainingAt(a, 1_000)).toBe(60_000);
    expect(remainingAt(a, 31_000)).toBe(30_000);
    expect(remainingAt(a, 90_000)).toBe(0);
  });

  it("PLANT: moving the system clock forward does not move the timer", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));
    const a = anchorClock(1_920_000, 5_000);
    const before = remainingAt(a, 5_000);
    vi.setSystemTime(new Date("2026-09-25T13:00:00Z")); // +3h wall clock
    expect(Date.now() - Date.parse("2026-09-25T10:00:00Z")).toBe(3 * 3600_000);
    // Same monotonic reading: same remaining time, whatever the wall clock says.
    expect(remainingAt(a, 5_000)).toBe(before);
    expect(remainingAt(a, 6_000)).toBe(1_919_000);
  });

  it("a monotonic reading before the anchor adds no time back", () => {
    const a = anchorClock(10_000, 5_000);
    expect(remainingAt(a, 4_000)).toBe(10_000);
  });

  it("a resync replaces the anchor rather than accumulating drift", () => {
    let a = anchorClock(60_000, 0);
    expect(remainingAt(a, 5_000)).toBe(55_000);
    a = anchorClock(54_200, 5_000); // the server says slightly less
    expect(remainingAt(a, 5_000)).toBe(54_200);
  });

  it("formats and speaks", () => {
    expect(formatClock(1_902_000)).toBe("31:42");
    expect(formatClock(258_000)).toBe("04:18");
    expect(formatClock(999)).toBe("00:01");
    expect(formatClock(0)).toBe("00:00");
    expect(spokenClock(258_000)).toBe("4 minutes 18 seconds");
    expect(spokenClock(60_000)).toBe("1 minute");
  });

  it("the timer is forced visible at five minutes and announced twice, not per tick", () => {
    expect(timerForcedVisible(300_001)).toBe(false);
    expect(timerForcedVisible(300_000)).toBe(true);
    expect(crossedAnnouncement(301_000, 299_000)).toBe("five_minutes");
    expect(crossedAnnouncement(299_000, 298_000)).toBeNull();
    expect(crossedAnnouncement(61_000, 59_000)).toBe("one_minute");
  });
});
