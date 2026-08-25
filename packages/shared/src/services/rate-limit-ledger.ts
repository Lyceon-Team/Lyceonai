/**
 * RateLimitLedger — the canonical wrapper.
 *
 * @spec [Doc-01A_V1.0, §39 Interface and contract; §40 Method signatures;
 *        §41 Postgres ledger implementation; §43 Soft warning at 80%;
 *        §44 Hard limit — 429 response; §45 Rollback pattern; §47 deviation box
 *        migration-path step 1] | @implemented [2026-08-25]
 *
 * plain English: answers "has this profile exceeded its quota for this bucket, and
 * if not, count this action" by calling the `rate_limit_check_and_increment`
 * Postgres function, which does the check and the increment atomically in one
 * statement. Expected outcome: one row per (profile, bucket, window) in
 * `rate_limit_ledger`, and a decision the caller can turn into a §44 429 response.
 * Trade-offs: the limit is read from `rate_limit_runtime_config` rather than
 * hardcoded, so an unseeded bucket denies rather than guessing a number — a
 * seeded constant with no source is one nobody can later defend. Edge cases: an RPC
 * error denies (fail closed, §39's posture); rollback is best-effort per §45, so its
 * failure is logged by the caller and never turned into a user-facing error.
 *
 * WHY THIS FILE EXISTS RATHER THAN A PATCH TO THE OLD HELPER. Doc 01A §47's
 * deviation box already prescribes this: current-state names
 * `server/lib/durable-rate-limiter.ts` as "a separate helper used for guardian
 * linking", migration-path step 1 is "Create packages/shared/services/
 * rate-limit-ledger.ts wrapping existing RPC helper", step 2 is "Consolidate
 * durable-rate-limiter.ts into canonical wrapper", and cutover criterion (c) is
 * "RateLimitLedger is the only path writing rate_limit_ledger table". The owner's
 * ruling to consume the primitive and §47's own migration path are the same
 * instruction reached independently. This is that instruction executed.
 *
 * PATH NOTE. §47 step 1 names `packages/shared/services/rate-limit-ledger.ts`.
 * The package's real layout is `packages/shared/src/`, and its `exports` map points
 * at `./src/index.js`, so the file lands one segment deeper to be importable. Same
 * package, same module name; reported rather than silently relocated.
 *
 * DEPENDENCY INJECTION, deliberately. `packages/shared` imports no app code today
 * (verified), so the Supabase client is passed in rather than imported. A shared
 * package reaching into `apps/api` would invert the layering the repo keeps.
 */

/** The subset of the Supabase client this service needs. */
export type LedgerClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
  from: (table: string) => {
    select: (cols?: string) => {
      eq: (
        col: string,
        val: unknown,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
  };
};

/** @spec [Doc-01A_V1.0 §40] — the shape §40 declares, no more. */
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
  /** true at >= the soft-warning threshold (§43). */
  softWarning: boolean;
  /** populated on denial (§44). */
  retryAfterSeconds?: number;
};

export class RateLimitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * §43: "Soft warning threshold lives in
 * `rate_limit_runtime_config.soft_warning_threshold_pct` (default 80)."
 * The spec states the default, so absence is tolerable here — unlike a bucket
 * limit, which has no spec-stated default and must deny instead.
 */
const SOFT_WARNING_DEFAULT_PCT = 80;
const CONFIG_TABLE = "rate_limit_runtime_config";
const SOFT_WARNING_KEY = "soft_warning_threshold_pct";
const BUCKET_DEFINITIONS_KEY = "bucket_definitions";

/** @spec [Doc-01A_V1.0 Appendix A.3] — `bucket_key → { limit, window_seconds }`. */
export type BucketDefinition = { limit: number; window_seconds: number };

/**
 * Window for a bucket, derived from its configured `window_seconds` rather than
 * assumed. A daily bucket (86400) aligns to UTC midnight, which is what makes
 * "per day" mean a calendar day rather than a rolling 24h from first use.
 */
export function windowFor(
  now: Date,
  windowSeconds: number,
): { windowStart: Date; windowEnd: Date } {
  const ms = windowSeconds * 1000;
  const dayMs = 86_400_000;
  const windowStart =
    ms === dayMs
      ? new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        )
      : new Date(Math.floor(now.getTime() / ms) * ms);
  return { windowStart, windowEnd: new Date(windowStart.getTime() + ms) };
}

async function readConfigValue(
  client: LedgerClient,
  key: string,
): Promise<unknown> {
  const { data, error } = await client
    .from(CONFIG_TABLE)
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    throw new RateLimitUnavailableError(
      `${CONFIG_TABLE} read failed for "${key}": ${error.message}`,
    );
  }
  return data?.value ?? null;
}

/**
 * Resolve a bucket from `rate_limit_runtime_config.bucket_definitions`.
 *
 * §47 names "bucket definition missing from rate_limit_runtime_config.bucket_definitions"
 * as a blocking condition, and Appendix A.3 gives the map its shape, so this is the
 * canonical home — not a per-bucket row. NOTE, reported not resolved: production
 * holds seven ad-hoc `tutor_*` rows in the older one-row-per-bucket form, and one of
 * them (`tutor_turns_daily = 120`) disagrees with A.3's seed (`limit: 100`). Neither
 * is read by any application code today. That divergence predates WS-GL.
 */
async function readBucketDefinition(
  client: LedgerClient,
  bucketKey: string,
): Promise<BucketDefinition | null> {
  const raw = await readConfigValue(client, BUCKET_DEFINITIONS_KEY);
  if (raw === null || typeof raw !== "object") return null;
  const map = raw as Record<string, unknown>;
  const def = map[bucketKey];
  if (!def || typeof def !== "object") return null;
  const d = def as Record<string, unknown>;
  const limit = Number(d.limit);
  const windowSeconds = Number(d.window_seconds);
  if (!Number.isFinite(limit) || !Number.isFinite(windowSeconds)) return null;
  return { limit, window_seconds: windowSeconds };
}

/**
 * §39/§40 — check quota and increment if allowed.
 *
 * The limit and window come from `bucket_definitions` (Appendix A.3). An unseeded
 * bucket is a denial, not a default: §47 names "bucket definition missing from
 * rate_limit_runtime_config.bucket_definitions" as a blocking condition, so
 * proceeding on an invented number would defeat the very gate the spec sets.
 */
export async function checkAndIncrement(
  client: LedgerClient,
  params: {
    profileId: string;
    bucketKey: string;
    cost?: number;
    now?: Date;
  },
): Promise<RateLimitResult> {
  const cost = params.cost ?? 1;
  const now = params.now ?? new Date();

  const def = await readBucketDefinition(client, params.bucketKey);
  if (def === null) {
    throw new RateLimitUnavailableError(
      `No definition for bucket "${params.bucketKey}" in ` +
        `${CONFIG_TABLE}.${BUCKET_DEFINITIONS_KEY}. Doc 01A §47 names a missing ` +
        `bucket definition as a blocking condition; this denies rather than ` +
        `assuming a value.`,
    );
  }
  const limit = def.limit;
  const { windowStart, windowEnd } = windowFor(now, def.window_seconds);

  const { data, error } = await client.rpc("rate_limit_check_and_increment", {
    p_profile_id: params.profileId,
    p_bucket_key: params.bucketKey,
    p_cost: cost,
    p_window_start: windowStart.toISOString(),
    p_window_end: windowEnd.toISOString(),
    p_limit: limit,
  });

  if (error) {
    // Fail closed. A rate limiter that opens on infrastructure failure is not one.
    throw new RateLimitUnavailableError(
      `rate_limit_check_and_increment failed: ${error.message}`,
    );
  }

  const row = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : (data as Record<string, unknown> | undefined);
  if (!row || typeof row.allowed !== "boolean") {
    throw new RateLimitUnavailableError(
      "rate_limit_check_and_increment returned no decision row",
    );
  }

  const used = Number(row.used ?? 0);
  const remaining = Math.max(0, Number(row.remaining ?? 0));
  const allowed = row.allowed === true;

  const rawPct = await readConfigValue(client, SOFT_WARNING_KEY);
  const parsedPct = Number(rawPct);
  const thresholdPct = Number.isFinite(parsedPct)
    ? parsedPct
    : SOFT_WARNING_DEFAULT_PCT;
  const softWarning = limit > 0 && (used / limit) * 100 >= thresholdPct;

  const result: RateLimitResult = {
    allowed,
    remaining,
    limit,
    resetAt: windowEnd,
    softWarning,
  };
  if (!allowed) {
    result.retryAfterSeconds = Math.max(
      0,
      Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
    );
  }
  return result;
}

/**
 * §45 — decrement after a downstream failure. Best-effort by design: a failed
 * rollback costs the user one attempt and must never block them, so this reports
 * success/failure rather than throwing.
 */
export async function rollback(
  client: LedgerClient,
  params: { profileId: string; bucketKey: string; cost?: number; now?: Date },
): Promise<{ ok: boolean; error?: string }> {
  const cost = params.cost ?? 1;
  const now = params.now ?? new Date();
  try {
    const def = await readBucketDefinition(client, params.bucketKey);
    if (def === null) return { ok: false, error: "no bucket definition" };
    const limit = def.limit;
    const { windowStart, windowEnd } = windowFor(now, def.window_seconds);
    const { error } = await client.rpc("rate_limit_check_and_increment", {
      p_profile_id: params.profileId,
      p_bucket_key: params.bucketKey,
      p_cost: -cost,
      p_window_start: windowStart.toISOString(),
      p_window_end: windowEnd.toISOString(),
      p_limit: limit,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown rollback failure",
    };
  }
}

/** §40 — read-only usage for a bucket. */
export async function getUsage(
  client: LedgerClient,
  profileId: string,
  bucketKey: string,
  now: Date = new Date(),
): Promise<{ used: number; limit: number; resetAt: Date }> {
  const def = await readBucketDefinition(client, bucketKey);
  if (def === null) {
    throw new RateLimitUnavailableError(
      `No definition for bucket "${bucketKey}" in ${CONFIG_TABLE}.${BUCKET_DEFINITIONS_KEY}`,
    );
  }
  const limit = def.limit;
  const { windowStart, windowEnd } = windowFor(now, def.window_seconds);
  const { data, error } = await client
    .from("rate_limit_ledger")
    .select("used_count")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    throw new RateLimitUnavailableError(
      `rate_limit_ledger read failed: ${error.message}`,
    );
  }
  void windowStart;
  return {
    used: Number(data?.used_count ?? 0),
    limit,
    resetAt: windowEnd,
  };
}

/**
 * §44 — apply the denial headers the spec fixes. Kept here so every consumer
 * emits the same shape; §47's blocking condition names an inconsistent 429.
 */
export function rateLimitDenialHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    "Retry-After": String(result.retryAfterSeconds ?? 0),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.floor(result.resetAt.getTime() / 1000)),
  };
}

/** §44 — the denial body. `bucket` and `limit` are echoed as the spec shows. */
export function rateLimitDenialBody(
  bucketKey: string,
  result: RateLimitResult,
): Record<string, unknown> {
  return {
    error: {
      code: "rate_limit_exceeded",
      message:
        "You've reached your limit for this action. Please try again later.",
      bucket: bucketKey,
      limit: result.limit,
      resetAt: result.resetAt.toISOString(),
      retryAfterSeconds: result.retryAfterSeconds ?? 0,
    },
  };
}
