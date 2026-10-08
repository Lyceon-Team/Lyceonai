/**
 * The quota read's `freeDailyLimit` for every reader (OQ-68 (d), UI-64) — the decision mapping.
 *
 * @spec [student-UI register UI-64, owner ruling OQ-68 (d) (Karl, 2026-10-08): "The '40
 *        questions' copy reads the server quota value (the same source as the 402)"; Doc 02B §12
 *        Entitlement Matrix, §41 (`daily_quota_free`)] | @implemented [2026-10-08]
 *
 * plain English: `freeDailyLimitFor` and `toPracticeQuota` (server/lib/practice-quota.ts), with
 * the config read (`getPracticeDailyFreeQuota`) standing in at 37, a value that is not the seeded
 * 40. A free decision's own `limit` (the 402's number) is the free limit; an entitled or admin
 * decision, whose `limit` is the per-session cap or nothing, takes the config row instead, never
 * the cap. The wire shape carries it on both shapes and still refuses a free decision without
 * numbers. The real route over real Postgres is `tests/ci/practice-quota.pg.ci.test.ts` and
 * `tests/ci/practice-config-copy.pg.ci.test.ts`; this file needs no database, so the review-UI
 * mutation gate can plant against it.
 */
import { describe, expect, it, vi } from "vitest";
import type { RateLimitDecision } from "../../apps/api/src/lib/rate-limit-ledger";

const CONFIG_DAILY_QUOTA_FREE = 37;
const configReads = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../server/lib/account", () => ({
  getPracticeDailyFreeQuota: async (): Promise<number> => {
    configReads.count += 1;
    return 37;
  },
}));
vi.mock("../../apps/api/src/lib/rate-limit-ledger", () => ({
  checkAndReservePracticeQuota: async (): Promise<never> => {
    throw new Error("not called in this file");
  },
}));

const { freeDailyLimitFor, toPracticeQuota } =
  await import("../../server/lib/practice-quota");

function decision(over: Partial<RateLimitDecision>): RateLimitDecision {
  return {
    allowed: true,
    code: "PRACTICE_OK",
    message: "",
    limitType: "practice",
    current: 3,
    limit: CONFIG_DAILY_QUOTA_FREE,
    remaining: CONFIG_DAILY_QUOTA_FREE - 3,
    resetAt: "2026-10-09T05:00:00.000Z",
    cooldownUntil: null,
    reservationId: null,
    duplicate: false,
    ...over,
  };
}

describe("freeDailyLimitFor (OQ-68 (d))", () => {
  it("a free decision: its own limit, the number the 402 carries; no second read", async () => {
    configReads.count = 0;
    expect(await freeDailyLimitFor(decision({}))).toBe(CONFIG_DAILY_QUOTA_FREE);
    expect(configReads.count).toBe(0);
  });

  it("an entitled decision: the config row, never the per-session cap it reports", async () => {
    configReads.count = 0;
    const entitled = decision({
      code: "PRACTICE_BYPASS_ENTITLED",
      limit: 25,
      remaining: 25,
    });
    expect(await freeDailyLimitFor(entitled)).toBe(CONFIG_DAILY_QUOTA_FREE);
    expect(configReads.count).toBe(1);
  });

  it("the admin bypass (no numbers at all): the config row", async () => {
    const admin = decision({
      code: "RATE_LIMIT_BYPASS_ADMIN",
      current: null,
      limit: null,
      remaining: null,
      resetAt: null,
    });
    expect(await freeDailyLimitFor(admin)).toBe(CONFIG_DAILY_QUOTA_FREE);
  });
});

describe("toPracticeQuota carries freeDailyLimit on both shapes", () => {
  it("free: limit and freeDailyLimit are the same served number", async () => {
    const d = decision({});
    const quota = toPracticeQuota(d, await freeDailyLimitFor(d));
    expect(quota).toEqual({
      ok: true,
      value: {
        unlimited: false,
        limit: CONFIG_DAILY_QUOTA_FREE,
        remaining: CONFIG_DAILY_QUOTA_FREE - 3,
        resetAt: "2026-10-09T05:00:00.000Z",
        freeDailyLimit: CONFIG_DAILY_QUOTA_FREE,
      },
    });
  });

  it("paid: no cap of their own (nulls), and the free plan's limit for the copy", async () => {
    const d = decision({ code: "PRACTICE_BYPASS_ENTITLED", limit: 25 });
    const quota = toPracticeQuota(d, await freeDailyLimitFor(d));
    expect(quota).toEqual({
      ok: true,
      value: {
        unlimited: true,
        limit: null,
        remaining: null,
        resetAt: null,
        freeDailyLimit: CONFIG_DAILY_QUOTA_FREE,
      },
    });
  });

  it("a free decision without numbers is refused, not filled in", async () => {
    const d = decision({ limit: null, remaining: null, resetAt: null });
    expect(toPracticeQuota(d, await freeDailyLimitFor(d))).toEqual({
      ok: false,
      error: "quota_decision_incomplete",
    });
  });
});
