/**
 * In-process TTL cache — Doc 01A's tier-1 cache, as one shared primitive.
 *
 * @spec [Doc-01A_V1.0 Part III §21 (tier 1: per-instance `Map<string, CacheEntry>`), §24 (TTL +
 *        hard staleness: a fresh hit, a refresh on expiry, the stale entry served only while a
 *        refresh FAILS and only inside the hard bound), §25 (keys `<subsystem>:<entity>:<id>`);
 *        owner brief 2026-10-13 "first-run activation fixes" item 2 ("cache in process ...
 *        bounded, with a TTL and an explicit invalidation story ... concurrency-safe (dedupe
 *        concurrent misses). Never cache per-student data")]
 * | @implemented [2026-10-13]
 *
 * plain English: `get(key, load)` answers from memory while the entry is younger than its TTL,
 * and otherwise calls `load` once — concurrent misses for the same key share that one call — and
 * keeps the result. If a refresh throws and the previous value is still inside the hard
 * staleness bound, the previous value is served and the failure is logged at WARN (§24's
 * `cache_stale_fallback`); past the bound, or with nothing cached, the error propagates.
 * Failures are never cached. `invalidate()` drops entries and makes any load already in flight
 * unable to write back (a generation counter), so an invalidation is never undone by a slow
 * read that started before it.
 *
 * WHAT IT IS FOR: process-wide reference data — a database fact or a catalog — that is the same
 * for every caller. It is NOT for per-student data (Doc 01A §25: no request-specific keys at
 * this tier); every instance is named, and each caller's header says why its value qualifies.
 *
 * trade-offs: Doc 01A §22 pairs this tier with LISTEN/NOTIFY invalidation. That needs a
 * long-lived session connection per instance, which the Vercel function runtime this API
 * deploys to does not hold, so caches built on this primitive are TTL-only — the "degraded
 * mode" §26 already describes, by design rather than by accident. A deploy starts fresh
 * instances, so a deploy clears every cache. §24 also puts TTL values in `*_runtime_config`
 * rows, and since the owner's ruling of 2026-10-13 on #1232 (item 2) they live there: a caller
 * passes `ttlFrom`, which is read on a MISS, in parallel with the data load, and the entry
 * stores the TTL it was read with. A hit therefore costs no round trip and a miss no extra
 * sequential one; a changed row takes effect at each instance's next refresh. `ttlMs` stays as
 * the TTL when no `ttlFrom` is given (tests, and any future caller without a config row).
 *
 * edge cases: the map is bounded (`maxEntries`); inserting past the bound evicts the oldest
 * insertion first (a `Map` iterates in insertion order), so a caller keyed by client-supplied
 * strings cannot grow memory without limit. A `now` function can be injected for tests.
 */
import { logger } from "../logger";
import { classifyError } from "./redact";

type CacheEntry<T> = {
  value: T;
  /** TTL boundary (Doc 01A §24 `expiresAt`). */
  expiresAt: number;
  /** Hard staleness boundary (Doc 01A §24 `hardStaleAt`). */
  hardStaleAt: number;
};

export type TtlCacheOptions = {
  /** `<subsystem>:<entity>` — the key prefix and the name in logs (Doc 01A §25). */
  name: string;
  ttlMs: number;
  /**
   * The TTL to store a fresh entry with, read on every miss alongside the load (Doc 01A §24:
   * from the cache's `*_runtime_config` row). The hard bound is never below it.
   */
  ttlFrom?: () => Promise<number>;
  hardStaleMs: number;
  maxEntries: number;
  now?: () => number;
};

export type TtlCache<T> = {
  get(id: string, load: () => Promise<T>): Promise<T>;
  /** Drop one entry, or every entry when `id` is omitted. Loads in flight cannot write back. */
  invalidate(id?: string): void;
  /** Entries currently held (fresh or stale). For tests and diagnostics. */
  size(): number;
};

export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  if (options.ttlMs <= 0 || options.hardStaleMs < options.ttlMs) {
    throw new Error(
      `ttl_cache_misconfigured: ${options.name} needs 0 < ttlMs <= hardStaleMs`,
    );
  }
  if (options.maxEntries < 1) {
    throw new Error(
      `ttl_cache_misconfigured: ${options.name} needs maxEntries >= 1`,
    );
  }
  // Read through `Date.now()` at call time, not a captured reference, so a replaced clock
  // (a test's fake Date) is honoured.
  const now = options.now ?? ((): number => Date.now());
  const entries = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();
  let generation = 0;

  const keyOf = (id: string): string => `${options.name}:${id}`;

  function store(key: string, value: T, at: number, ttlMs: number): void {
    // Re-inserting moves the key to the newest position, so eviction stays oldest-first.
    entries.delete(key);
    while (entries.size >= options.maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      entries.delete(oldest.value);
    }
    entries.set(key, {
      value,
      expiresAt: at + ttlMs,
      hardStaleAt: at + Math.max(options.hardStaleMs, ttlMs),
    });
  }

  function refresh(key: string, load: () => Promise<T>): Promise<T> {
    const startedIn = generation;
    // Deferred one microtask, so `pending` is assigned and registered in `inflight` before the
    // body can run — even a `load` that throws synchronously settles through the same path.
    const pending: Promise<T> = Promise.resolve().then(async (): Promise<T> => {
      try {
        const [value, ttlMs] = await Promise.all([
          load(),
          options.ttlFrom ? options.ttlFrom() : options.ttlMs,
        ]);
        if (startedIn === generation) store(key, value, now(), ttlMs);
        return value;
      } catch (error: unknown) {
        const previous = entries.get(key);
        if (previous !== undefined && previous.hardStaleAt > now()) {
          logger.warn(
            "CACHE",
            "cache_stale_fallback",
            "a cache refresh failed; serving the previous value inside its hard staleness bound",
            { cache: options.name, ...classifyError(error) },
          );
          return previous.value;
        }
        throw error;
      } finally {
        if (inflight.get(key) === pending) inflight.delete(key);
      }
    });
    inflight.set(key, pending);
    return pending;
  }

  return {
    get(id: string, load: () => Promise<T>): Promise<T> {
      const key = keyOf(id);
      const entry = entries.get(key);
      if (entry !== undefined && entry.expiresAt > now()) {
        return Promise.resolve(entry.value);
      }
      return inflight.get(key) ?? refresh(key, load);
    },
    invalidate(id?: string): void {
      generation += 1;
      if (id === undefined) {
        entries.clear();
        inflight.clear();
        return;
      }
      entries.delete(keyOf(id));
      inflight.delete(keyOf(id));
    },
    size(): number {
      return entries.size;
    },
  };
}
