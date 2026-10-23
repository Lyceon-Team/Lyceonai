/**
 * Reader for `caching_runtime_config` — the one owner of that config read.
 *
 * @spec [Doc-01A_V1.0 §24 ("Values live per-service in the respective *_runtime_config table"),
 *        Appendix A.1 `caching_runtime_config`; owner ruling (Karl) 2026-10-13 on #1232 item 2
 *        ("Seed caching_runtime_config with the two lifetimes (timezone 24h, skill catalog
 *        10 min) and read them from there")] | @implemented [2026-10-13]
 *
 * plain English: the TTL, in milliseconds, of one named in-process cache, read from the row the
 * migration `20261103000000_caching_runtime_config_seed.sql` seeds. `server/lib/ttl-cache.ts`
 * calls this on a cache MISS only — alongside the data load, not before it — so a hit costs no
 * round trip and a miss costs no extra sequential one.
 *
 * FAIL FORWARD, NOT CLOSED — the convention of `getExamRenewalConfig`
 * (`server/lib/entitlement-runtime-config.ts`): an absent row, a malformed value, a value outside
 * the row's own min/max, or a failed read all return the documented fallback, which is the same
 * number the seed writes. Failing closed here would mean "no cache", i.e. every request back on
 * the database because one config row is missing — the exact load this cache exists to remove.
 * A failed read is logged at WARN; a missing or out-of-bounds row at WARN once per read.
 *
 * edge cases: the values are seconds in the table and milliseconds out of here. No per-student
 * data is involved: the keys are cache names.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "./redact";

/** The cache-lifetime keys, each with its fallback (seconds) — the values the seed writes. */
export const CACHE_TTL_CONFIG = {
  knownTimezone: {
    key: "known_timezone_cache_ttl_seconds",
    fallbackSeconds: 86_400,
  },
  skillCatalog: {
    key: "skill_catalog_cache_ttl_seconds",
    fallbackSeconds: 600,
  },
  /**
   * @spec [owner ruling (Karl) 2026-10-15 on #1238 item (b): "a 60-second cache for the two config
   *        reads"] | @implemented [2026-10-15] — `calendar_runtime_config` plus practice's
   * seconds-per-question, as one cached value (`server/services/calendar/config.ts`).
   */
  calendarConfig: {
    key: "calendar_config_cache_ttl_seconds",
    fallbackSeconds: 60,
  },
  /**
   * @spec [owner rulings on #1277 (Karl, 2026-10-21), ruling 1 (review session size as a runtime
   *        config key)] | @implemented [2026-10-21] — `review_runtime_config.session_size`
   * (`server/services/review-config.ts`).
   */
  reviewConfig: {
    key: "review_config_cache_ttl_seconds",
    fallbackSeconds: 60,
  },
} as const;

export type CacheTtlName = keyof typeof CACHE_TTL_CONFIG;

function boundOf(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** The TTL of the named cache, in milliseconds. Never throws. */
export async function readCacheTtlMs(name: CacheTtlName): Promise<number> {
  const { key, fallbackSeconds } = CACHE_TTL_CONFIG[name];
  const fallback = fallbackSeconds * 1000;

  let row: { value?: unknown; min_value?: unknown; max_value?: unknown } | null;
  try {
    const { data, error } = await supabaseServer
      .from("caching_runtime_config")
      .select("value, min_value, max_value")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      logger.warn(
        "CACHE",
        "cache_ttl_config_read_failed",
        "caching_runtime_config could not be read; the cache uses its documented fallback TTL",
        { key, ...classifyError(error) },
      );
      return fallback;
    }
    row = data;
  } catch (error: unknown) {
    logger.warn(
      "CACHE",
      "cache_ttl_config_read_failed",
      "caching_runtime_config could not be read; the cache uses its documented fallback TTL",
      { key, ...classifyError(error) },
    );
    return fallback;
  }

  const value = boundOf(row?.value);
  const min = boundOf(row?.min_value);
  const max = boundOf(row?.max_value);
  if (
    value === null ||
    !Number.isInteger(value) ||
    value <= 0 ||
    (min !== null && value < min) ||
    (max !== null && value > max)
  ) {
    logger.warn(
      "CACHE",
      "cache_ttl_config_unusable",
      "caching_runtime_config has no usable value for this cache; the documented fallback TTL is used",
      { key, present: row !== null },
    );
    return fallback;
  }
  return value * 1000;
}
