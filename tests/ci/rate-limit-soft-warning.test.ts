/**
 * @spec [Doc-01A_V1.0 §43 ("Soft warning threshold lives in
 *       rate_limit_runtime_config.soft_warning_threshold_pct (default 80)"), Appendix A.3
 *       (default 80, min 50, max 95); owner ruling 2026-10-05 (QOTD follow-up, item 5)]
 *       | @implemented [2026-10-05]
 *
 * plain English: the "approaching the limit" header must fire near the limit, not on the first
 * request. Production has no soft_warning_threshold_pct row, and the absent value used to read
 * as Number(null) = 0, so every request — 1 of 120 used — carried X-RateLimit-Warning. These
 * drive checkAndIncrement (both ledgers share it) with a config table that has no such row.
 */
import { describe, expect, it } from "vitest";
import {
  checkAndIncrement,
  softWarningThresholdPct,
  type LedgerClient,
} from "../../packages/shared/src/services/rate-limit-ledger";

function clientWith(used: number, threshold: unknown): LedgerClient {
  return {
    rpc: async () => ({
      data: [{ allowed: true, used, remaining: 120 - used }],
      error: null,
    }),
    from: () => ({
      select: () => ({
        eq: (_col: string, key: unknown) => ({
          maybeSingle: async () => {
            if (key === "bucket_definitions")
              return {
                data: {
                  value: { qotd_read_ip: { limit: 120, window_seconds: 3600 } },
                },
                error: null,
              };
            if (key === "soft_warning_threshold_pct" && threshold !== undefined)
              return { data: { value: threshold }, error: null };
            return { data: null, error: null };
          },
        }),
      }),
    }),
  } as unknown as LedgerClient;
}

const SUBJECT = { subjectHmac: "a".repeat(64), bucketKey: "qotd_read_ip" };

describe("soft warning threshold", () => {
  it("with no configured row, the first request (1/120) carries no warning", async () => {
    const r = await checkAndIncrement(clientWith(1, undefined), SUBJECT);
    expect(r.remaining).toBe(119);
    expect(r.softWarning).toBe(false);
  });

  it("with no configured row, the warning starts at the spec default of 80% (96/120), not before", async () => {
    expect(
      (await checkAndIncrement(clientWith(95, undefined), SUBJECT)).softWarning,
    ).toBe(false);
    expect(
      (await checkAndIncrement(clientWith(96, undefined), SUBJECT)).softWarning,
    ).toBe(true);
  });

  it("a configured value within 50-95 is used", async () => {
    expect(
      (await checkAndIncrement(clientWith(60, 50), SUBJECT)).softWarning,
    ).toBe(true);
    expect(
      (await checkAndIncrement(clientWith(59, 50), SUBJECT)).softWarning,
    ).toBe(false);
  });

  it.each([
    [null, 80],
    [undefined, 80],
    ["", 80],
    ["abc", 80],
    [0, 80],
    [10, 80],
    [100, 80],
    [50, 50],
    ["90", 90],
    [95, 95],
  ])("softWarningThresholdPct(%j) = %d", (raw, expected) => {
    expect(softWarningThresholdPct(raw)).toBe(expected);
  });
});
