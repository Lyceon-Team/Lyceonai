/**
 * The two lifecycle send slots, as a pure function, and the quiet-hours backstop beside them.
 *
 * @spec [owner rulings on #1284 (Karl, 2026-10-21) §2:
 *       "Weekdays: cron `0 22 * * 1-5` (22:00 UTC, Mon–Fri). Weekends: cron `0 15 * * 0,6`
 *       (15:00 UTC, Sat and Sun) … no time-zone or DST logic … keep the quiet-hours guard as a
 *       backstop (both times sit inside 08:00–21:00 Chicago all year)"] | @implemented [2026-10-21]
 *
 * plain English: every hour of a full week is checked against the two slots, and every day of two
 * years at both slot times against quiet hours, so a slot that drifted into the night (or a DST
 * edge) would show here.
 */
import { describe, expect, it } from "vitest";
import {
  isLifecycleSendSlot,
  LIFECYCLE_SEND_SLOTS,
} from "../../server/lib/lifecycle-email";
import { quietHoursDeferral } from "../../server/lib/notifications/quiet-hours";

const DAY = 86_400_000;

describe("lifecycle send slots", () => {
  it("only 22:00 UTC Monday–Friday and 15:00 UTC Saturday–Sunday, any minute of that hour", () => {
    // 2026-10-19 is a Monday.
    const allowed: string[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const at = new Date(Date.UTC(2026, 9, 19 + d, h, 37));
        if (isLifecycleSendSlot(at)) allowed.push(at.toISOString());
      }
    }
    expect(allowed).toEqual([
      "2026-10-19T22:37:00.000Z",
      "2026-10-20T22:37:00.000Z",
      "2026-10-21T22:37:00.000Z",
      "2026-10-22T22:37:00.000Z",
      "2026-10-23T22:37:00.000Z",
      "2026-10-24T15:37:00.000Z",
      "2026-10-25T15:37:00.000Z",
    ]);
    // Not the old 14:00 sweep, not 15:00 on a weekday, not 22:00 on a weekend.
    expect(isLifecycleSendSlot(new Date("2026-10-21T14:00:00Z"))).toBe(false);
    expect(isLifecycleSendSlot(new Date("2026-10-21T15:00:00Z"))).toBe(false);
    expect(isLifecycleSendSlot(new Date("2026-10-24T22:00:00Z"))).toBe(false);
  });

  it("both slots sit inside the quiet-hours window on every day of 2026 and 2027 (the backstop never fires)", () => {
    const start = Date.UTC(2026, 0, 1);
    let checked = 0;
    for (let t = start; t < Date.UTC(2028, 0, 1); t += DAY) {
      const day = new Date(t).getUTCDay();
      const hour =
        day === 0 || day === 6
          ? LIFECYCLE_SEND_SLOTS.weekendHourUtc
          : LIFECYCLE_SEND_SLOTS.weekdayHourUtc;
      const at = new Date(t + hour * 3_600_000);
      expect(isLifecycleSendSlot(at)).toBe(true);
      expect(quietHoursDeferral(at), at.toISOString()).toBeNull();
      checked += 1;
    }
    expect(checked).toBe(730);
  });
});
