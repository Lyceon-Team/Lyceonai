/**
 * The QOTD day in TypeScript: the rule, its windows, the no-database rules, and the server's
 * cached read of the switch.
 *
 * @spec [owner ruling "QOTD: day boundary at 04:00 UTC, social run at 04:05 UTC" (Karl,
 *       2026-10-27) items 1, 3 and 4] | @implemented [2026-10-27]
 *
 * plain English: `qotdDayOf` must agree with the database's `qotd_day` (proved there in
 * tests/ci/home-qotd.pg.ci.test.ts D1); here the same instants are checked without a database,
 * with the windows the public stats bucket uses, and the loader's failure behaviour: an unreadable
 * switch keeps the last value, else the Chicago day, and never throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  qotdDayOf,
  qotdDayWindowOf,
  qotdTodaySwitched,
  qotdTodayWithoutCutover,
} from "../../server/services/qotd/qotd-day";

const warnings: string[] = [];
vi.mock("../../server/logger", () => ({
  logger: {
    info: () => undefined,
    debug: () => undefined,
    error: () => undefined,
    warn: (_c: string, event: string) => {
      warnings.push(event);
    },
  },
}));

/** 2026-08-01 00:00 CDT: a Chicago midnight, as the migration sets it. */
const CUTOVER = new Date("2026-08-01T05:00:00.000Z");
const at = (iso: string): Date => new Date(iso);

describe("qotdDayOf", () => {
  it("before the cutover, and with no cutover known, is the America/Chicago day", () => {
    expect(qotdDayOf(at("2026-07-15T04:59:59Z"), CUTOVER)).toBe("2026-07-14");
    expect(qotdDayOf(at("2026-07-15T05:00:00Z"), CUTOVER)).toBe("2026-07-15");
    expect(qotdDayOf(at("2026-08-05T04:30:00Z"), null)).toBe("2026-08-04");
  });

  it("from the cutover on, flips at 04:00 UTC in summer and winter", () => {
    expect(qotdDayOf(at("2026-08-01T04:59:59.999Z"), CUTOVER)).toBe(
      "2026-07-31",
    );
    expect(qotdDayOf(CUTOVER, CUTOVER)).toBe("2026-08-01");
    expect(qotdDayOf(at("2026-08-05T03:59:59.999Z"), CUTOVER)).toBe(
      "2026-08-04",
    );
    expect(qotdDayOf(at("2026-08-05T04:00:00Z"), CUTOVER)).toBe("2026-08-05");
    expect(qotdDayOf(at("2026-12-15T03:59:59.999Z"), CUTOVER)).toBe(
      "2026-12-14",
    );
    expect(qotdDayOf(at("2026-12-15T04:00:00Z"), CUTOVER)).toBe("2026-12-15");
  });
});

describe("qotdDayWindowOf", () => {
  it("a day after the switch is [04:00 UTC, 04:00 UTC next day)", () => {
    const w = qotdDayWindowOf("2026-08-04", CUTOVER);
    expect(w.start.toISOString()).toBe("2026-08-04T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-05T04:00:00.000Z");
  });

  it("the windows meet at the cutover: the last Chicago day ends where the first new day starts", () => {
    const last = qotdDayWindowOf("2026-07-31", CUTOVER);
    const first = qotdDayWindowOf("2026-08-01", CUTOVER);
    expect(last.start.toISOString()).toBe("2026-07-31T05:00:00.000Z");
    expect(last.end.toISOString()).toBe(CUTOVER.toISOString());
    expect(first.start.toISOString()).toBe(CUTOVER.toISOString());
    expect(first.end.toISOString()).toBe("2026-08-02T04:00:00.000Z");
  });

  it("every instant falls in the window of its own day", () => {
    for (const iso of [
      "2026-07-31T23:00:00Z",
      "2026-08-01T04:59:59Z",
      "2026-08-01T05:00:00Z",
      "2026-08-02T03:59:59Z",
      "2026-08-02T04:00:00Z",
      "2026-12-15T03:59:59Z",
    ]) {
      const t = at(iso);
      const w = qotdDayWindowOf(qotdDayOf(t, CUTOVER), CUTOVER);
      expect(t.getTime()).toBeGreaterThanOrEqual(w.start.getTime());
      expect(t.getTime()).toBeLessThan(w.end.getTime());
    }
  });
});

describe("the rules without a database", () => {
  it("the build's today is never ahead of the switched today (it never publishes a day still open)", () => {
    for (let h = 0; h < 48; h += 0.5) {
      const t = new Date(Date.UTC(2026, 7, 4) + h * 3_600_000);
      expect(qotdTodayWithoutCutover(t) <= qotdTodaySwitched(t)).toBe(true);
    }
    // Between 04:00 UTC and Chicago midnight they differ: the build keeps the earlier day.
    expect(qotdTodayWithoutCutover(at("2026-08-05T04:05:00Z"))).toBe(
      "2026-08-04",
    );
    expect(qotdTodaySwitched(at("2026-08-05T04:05:00Z"))).toBe("2026-08-05");
  });
});

describe("loadQotdCutover", () => {
  type Reply = { data: unknown; error: { message: string } | null };
  function client(replies: Reply[]): {
    rpc: (fn: string) => Promise<Reply>;
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      rpc: async (fn: string) => {
        calls.push(fn);
        const next = replies.shift();
        if (!next) throw new Error("no reply left");
        return next;
      },
    };
  }

  beforeEach(async () => {
    warnings.length = 0;
    const { resetQotdCutoverCacheForTests } =
      await import("../../server/services/qotd/qotd-service");
    resetQotdCutoverCacheForTests();
  });

  it("reads the switch once, and serves it from the cache for five minutes", async () => {
    const { loadQotdCutover } =
      await import("../../server/services/qotd/qotd-service");
    const c = client([
      { data: CUTOVER.toISOString(), error: null },
      { data: "2026-09-01T05:00:00.000Z", error: null },
    ]);
    expect((await loadQotdCutover(c, 0))?.toISOString()).toBe(
      CUTOVER.toISOString(),
    );
    expect((await loadQotdCutover(c, 299_999))?.toISOString()).toBe(
      CUTOVER.toISOString(),
    );
    expect(c.calls).toEqual(["qotd_day_cutover"]);
    expect((await loadQotdCutover(c, 300_000))?.toISOString()).toBe(
      "2026-09-01T05:00:00.000Z",
    );
  });

  it("unreadable before any read (no migration yet): the Chicago day, logged, never thrown", async () => {
    const { loadQotdCutover, qotdToday } =
      await import("../../server/services/qotd/qotd-service");
    const missing = {
      data: null,
      error: { message: "function does not exist" },
    };
    const c = client([missing, missing]);
    expect(await loadQotdCutover(c, 0)).toBeNull();
    expect(warnings).toEqual(["day_cutover_unreadable"]);
    // 04:30 UTC on Aug 5: still Aug 4 in Chicago (a fresh read, on the real clock, fails too).
    expect(await qotdToday(c, at("2026-08-05T04:30:00Z"))).toBe("2026-08-04");
  });

  it("unreadable after a good read: keeps the last known switch", async () => {
    const { loadQotdCutover } =
      await import("../../server/services/qotd/qotd-service");
    const c = client([
      { data: CUTOVER.toISOString(), error: null },
      { data: null, error: { message: "timeout" } },
    ]);
    await loadQotdCutover(c, 0);
    expect((await loadQotdCutover(c, 300_000))?.toISOString()).toBe(
      CUTOVER.toISOString(),
    );
    expect(warnings).toEqual(["day_cutover_unreadable"]);
  });
});
