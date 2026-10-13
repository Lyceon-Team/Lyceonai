/**
 * The in-process TTL cache — hit/miss, expiry, concurrent-miss dedupe, invalidation, the hard
 * staleness bound, and the size bound.
 *
 * @spec [Doc-01A_V1.0 §21, §24, §25; owner brief 2026-10-13 "first-run activation fixes" item 2
 *        ("Tests: hit/miss, TTL expiry, concurrent-miss dedupe, and that the cached result equals
 *        a fresh read")] | @implemented [2026-10-13]
 *
 * plain English: drives `createTtlCache` with an injected clock and a counting loader, so every
 * claim in its header is observed rather than assumed. "Cached equals fresh" for the two real
 * caches is proved against real Postgres in `hot-paths.caches.pg.ci.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const warn = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createTtlCache } = await import("../../server/lib/ttl-cache");

let clock = 0;
const now = (): number => clock;

function counter<T>(values: T[]): {
  load: () => Promise<T>;
  calls: () => number;
} {
  let n = 0;
  return {
    load: async () => {
      const v = values[Math.min(n, values.length - 1)] as T;
      n += 1;
      return v;
    },
    calls: () => n,
  };
}

describe("createTtlCache", () => {
  beforeEach(() => {
    clock = 1_000;
    warn.mockClear();
  });

  it("a miss loads once; a hit inside the TTL does not load again", async () => {
    const cache = createTtlCache<string>({
      name: "test:hit",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    const src = counter(["a"]);
    expect(await cache.get("k", src.load)).toBe("a");
    clock += 99;
    expect(await cache.get("k", src.load)).toBe("a");
    expect(src.calls()).toBe(1);
  });

  it("an entry at or past its TTL is refreshed from the loader", async () => {
    const cache = createTtlCache<string>({
      name: "test:ttl",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    const src = counter(["old", "new"]);
    expect(await cache.get("k", src.load)).toBe("old");
    clock += 100;
    expect(await cache.get("k", src.load)).toBe("new");
    expect(src.calls()).toBe(2);
  });

  it("concurrent misses for one key share a single load", async () => {
    const cache = createTtlCache<number>({
      name: "test:dedupe",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    let calls = 0;
    let release: (v: number) => void = () => undefined;
    const load = (): Promise<number> => {
      calls += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };
    const all = Promise.all([
      cache.get("k", load),
      cache.get("k", load),
      cache.get("k", load),
    ]);
    // Let the deferred load start before releasing it.
    await Promise.resolve();
    await Promise.resolve();
    release(7);
    expect(await all).toEqual([7, 7, 7]);
    expect(calls).toBe(1);
  });

  it("different keys load independently", async () => {
    const cache = createTtlCache<string>({
      name: "test:keys",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    expect(await cache.get("a", async () => "A")).toBe("A");
    expect(await cache.get("b", async () => "B")).toBe("B");
    expect(cache.size()).toBe(2);
  });

  it("a failed load is not cached and propagates when nothing usable is held", async () => {
    const cache = createTtlCache<string>({
      name: "test:fail",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    await expect(
      cache.get("k", async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    expect(cache.size()).toBe(0);
    expect(await cache.get("k", async () => "up")).toBe("up");
  });

  it("a loader that throws synchronously settles as a rejection, and does not wedge the key", async () => {
    const cache = createTtlCache<string>({
      name: "test:sync",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    const boom = (): Promise<string> => {
      throw new Error("sync");
    };
    await expect(cache.get("k", boom)).rejects.toThrow("sync");
    expect(await cache.get("k", async () => "ok")).toBe("ok");
  });

  it("a failed refresh serves the previous value inside the hard bound, and logs it", async () => {
    const cache = createTtlCache<string>({
      name: "test:stale",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    await cache.get("k", async () => "v1");
    clock += 200; // past TTL, inside hard bound
    const failing = async (): Promise<string> => {
      throw Object.assign(new Error("blip"), { code: "08006" });
    };
    expect(await cache.get("k", failing)).toBe("v1");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toBe("cache_stale_fallback");
    expect(warn.mock.calls[0]?.[3]).toEqual({
      cache: "test:stale",
      errorClass: expect.any(String),
      errorCode: "08006",
    });
  });

  it("past the hard bound a failed refresh propagates instead of serving stale data", async () => {
    const cache = createTtlCache<string>({
      name: "test:hard",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    await cache.get("k", async () => "v1");
    clock += 500;
    await expect(
      cache.get("k", async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });

  it("invalidate() drops entries, and a load already in flight cannot write back", async () => {
    const cache = createTtlCache<string>({
      name: "test:invalidate",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 4,
      now,
    });
    await cache.get("k", async () => "v1");
    cache.invalidate("k");
    expect(cache.size()).toBe(0);

    let release: (v: string) => void = () => undefined;
    const slow = cache.get(
      "k",
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    await Promise.resolve();
    cache.invalidate();
    release("from-before-invalidation");
    expect(await slow).toBe("from-before-invalidation");
    // The slow result was returned to its own caller but not stored.
    expect(cache.size()).toBe(0);
    expect(await cache.get("k", async () => "v2")).toBe("v2");
  });

  it("is bounded: past maxEntries the oldest insertion is evicted", async () => {
    const cache = createTtlCache<string>({
      name: "test:bound",
      ttlMs: 100,
      hardStaleMs: 500,
      maxEntries: 2,
      now,
    });
    await cache.get("a", async () => "A");
    await cache.get("b", async () => "B");
    await cache.get("c", async () => "C");
    expect(cache.size()).toBe(2);
    const reloadA = counter(["A2"]);
    expect(await cache.get("a", reloadA.load)).toBe("A2");
    expect(reloadA.calls()).toBe(1);
  });

  it("refuses a configuration that cannot hold an entry", () => {
    expect(() =>
      createTtlCache({ name: "x", ttlMs: 0, hardStaleMs: 1, maxEntries: 1 }),
    ).toThrow("ttl_cache_misconfigured");
    expect(() =>
      createTtlCache({ name: "x", ttlMs: 10, hardStaleMs: 5, maxEntries: 1 }),
    ).toThrow("ttl_cache_misconfigured");
    expect(() =>
      createTtlCache({ name: "x", ttlMs: 10, hardStaleMs: 10, maxEntries: 0 }),
    ).toThrow("ttl_cache_misconfigured");
  });
});
