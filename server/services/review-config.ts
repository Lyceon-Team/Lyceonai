/**
 * The one reader of `review_runtime_config.session_size` for the server layer.
 *
 * @spec [owner rulings on #1277 (Karl, 2026-10-21), ruling 1: "Review session size defaults to
 *        10, stored as a runtime config key with bounds (min 5), so it can be lowered to 5
 *        without a code change ... No session ever takes the whole queue. Any caller-provided
 *        size is capped by this key"; Doc-01A_V1.0 §24 (TTL + hard staleness; "Values live
 *        per-service in the respective *_runtime_config table"); migration
 *        20261109000000_review_open_session_admission.sql (the seed: 10, min 5, max 20)]
 * | @implemented [2026-10-21]
 *
 * plain English: every review start (the Review page's, Home's, a calendar block's) is capped at
 * this many questions. `reviewSessionSize(requested)` is the cap rule, in one place:
 *
 *     size = min(requested > 0 ? requested : key, key)
 *
 * so a start that asks for nothing takes the key's value, a smaller request is honoured, and a
 * larger one (a calendar block whose target is 15 or 30) is cut to the key.
 *
 * NO FALLBACK, ON PURPOSE. A missing row, a non-integer value, or a value outside the row's own
 * `min_value..max_value` (or below 1) is a LOUD failure: an ERROR log and a thrown
 * `ReviewConfigError`, which the start turns into a 500. It is never clamped or defaulted,
 * because a silently substituted size is a size nobody reviewed, and the same migration that
 * seeds this row creates the admission function the start needs anyway, so an environment
 * without the row cannot start a review session either way.
 *
 * trade-offs: cached in process (Doc 01A §24) for `caching_runtime_config
 * .review_config_cache_ttl_seconds` (60 s seeded; 60 s when that row is unusable), with the hard
 * staleness bound equal to the TTL, so an expired entry is never served in place of a failed
 * refresh. Lowering the size to 5 therefore reaches every instance within one TTL, no deploy.
 *
 * edge cases: the value is read as JSON; a JSON string ("10") is malformed, not coerced.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import { classifyError } from "../lib/redact";
import { createTtlCache } from "../lib/ttl-cache";
import {
  CACHE_TTL_CONFIG,
  readCacheTtlMs,
} from "../lib/caching-runtime-config";

export const REVIEW_SESSION_SIZE_KEY = "session_size";

const sessionSizeRowSchema = z.object({
  value: z.number().int(),
  min_value: z.number().int().nullable(),
  max_value: z.number().int().nullable(),
});

export class ReviewConfigError extends Error {
  readonly key: string;
  constructor(key: string, detail: string) {
    super(`review_runtime_config: ${key} ${detail}`);
    this.name = "ReviewConfigError";
    this.key = key;
  }
}

function fail(detail: string, extra: Record<string, unknown> = {}): never {
  logger.error(
    "REVIEW_CONFIG",
    "session_size_unusable",
    "review_runtime_config.session_size is missing or out of its bounds; review starts fail until it is fixed",
    { key: REVIEW_SESSION_SIZE_KEY, detail, ...extra },
  );
  throw new ReviewConfigError(REVIEW_SESSION_SIZE_KEY, detail);
}

async function readSessionSize(): Promise<number> {
  const { data, error } = await supabaseServer
    .from("review_runtime_config")
    .select("value, min_value, max_value")
    .eq("key", REVIEW_SESSION_SIZE_KEY)
    .maybeSingle();
  if (error) fail("could not be read", classifyError(error));
  if (data === null) fail("is not seeded");
  const parsed = sessionSizeRowSchema.safeParse(data);
  if (!parsed.success) fail("is not an integer with integer bounds");
  const { value, min_value: min, max_value: max } = parsed.data;
  if (
    value < 1 ||
    (min !== null && value < min) ||
    (max !== null && value > max)
  ) {
    fail("is outside its bounds", { value, min, max });
  }
  return value;
}

const REVIEW_CONFIG_TTL_MS =
  CACHE_TTL_CONFIG.reviewConfig.fallbackSeconds * 1000;

const REVIEW_CONFIG_CACHE = createTtlCache<number>({
  name: "review:runtime_config",
  ttlMs: REVIEW_CONFIG_TTL_MS,
  ttlFrom: () => readCacheTtlMs("reviewConfig"),
  // Equal to the TTL ON PURPOSE: a refresh that fails after expiry throws (the loud failure).
  hardStaleMs: REVIEW_CONFIG_TTL_MS,
  maxEntries: 1,
});

/** Drop the cached size (tests, and an operator path if one is ever wanted). */
export function invalidateReviewConfigCache(): void {
  REVIEW_CONFIG_CACHE.invalidate();
}

/**
 * The size of the review session a start with `requested` questions gets (ruling 1's cap rule):
 * `min(requested > 0 ? requested : key, key)`. Throws `ReviewConfigError` when the key is
 * unusable.
 */
export async function reviewSessionSize(
  requested: number | null,
): Promise<number> {
  const key = await REVIEW_CONFIG_CACHE.get(
    REVIEW_SESSION_SIZE_KEY,
    readSessionSize,
  );
  return requested !== null && requested > 0 ? Math.min(requested, key) : key;
}
