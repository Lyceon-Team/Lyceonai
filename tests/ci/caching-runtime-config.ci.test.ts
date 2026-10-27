/**
 * `readCacheTtlMs` — the seeded row when it is usable, the documented fallback otherwise.
 *
 * @spec [Doc-01A_V1.0 §24, Appendix A.1; owner ruling (Karl) 2026-10-13 on #1232 item 2]
 * | @implemented [2026-10-13]
 *
 * plain English: the reader fails FORWARD (to the seeded value, kept in code as the fallback),
 * never closed, following `getExamRenewalConfig`. Each unusable shape is driven through a fake
 * client: no row, a non-integer, a value outside the row's own bounds, a read error, and a
 * client that throws. The seeded rows themselves, and the cache using them, are proved against
 * real Postgres in `hot-paths.observability.pg.ci.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Reply = { data: unknown; error: unknown };
let reply: Reply | "throw" = { data: null, error: null };

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "caching_runtime_config")
        throw new Error(`unexpected ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async (): Promise<Reply> => {
          if (reply === "throw") throw new Error("socket hang up");
          return reply;
        },
      };
      return chain;
    },
  },
}));

const warn = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { readCacheTtlMs } =
  await import("../../server/lib/caching-runtime-config");

describe("readCacheTtlMs", () => {
  beforeEach(() => warn.mockClear());

  it("returns the row's value, in milliseconds", async () => {
    reply = {
      data: { value: 120, min_value: 10, max_value: 3600 },
      error: null,
    };
    expect(await readCacheTtlMs("skillCatalog")).toBe(120_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["no row", { data: null, error: null }],
    [
      "a non-integer",
      { data: { value: "600", min_value: 10, max_value: 3600 }, error: null },
    ],
    [
      "below the row's min",
      { data: { value: 5, min_value: 10, max_value: 3600 }, error: null },
    ],
    [
      "above the row's max",
      { data: { value: 7200, min_value: 10, max_value: 3600 }, error: null },
    ],
    [
      "a read error",
      { data: null, error: { code: "57014", message: "timeout" } },
    ],
  ])(
    "falls forward to the documented value on %s, and warns",
    async (_label, r) => {
      reply = r;
      expect(await readCacheTtlMs("skillCatalog")).toBe(600_000);
      expect(await readCacheTtlMs("knownTimezone")).toBe(86_400_000);
      expect(warn).toHaveBeenCalled();
    },
  );

  it("falls forward when the client throws, and never rejects", async () => {
    reply = "throw";
    await expect(readCacheTtlMs("skillCatalog")).resolves.toBe(600_000);
  });
});
