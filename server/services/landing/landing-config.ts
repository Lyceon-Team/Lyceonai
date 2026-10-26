/**
 * The one reader of the smart landing's runtime config: the four `landing_*` keys of
 * `practice_runtime_config`.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26): "Ships behind a kill switch (env/config)
 *        so Karl can turn the rotation off and fall back to dashboard instantly"; ruling E ("behind
 *        the runtime-config kill switch"); ruling C (dashboard 1/3, weights adjustable in config);
 *        Doc-01A_V1.0 §24 (TTL + hard staleness; values live in the service's *_runtime_config
 *        table); migration 20261113000000_smart_landing.sql (the seed)] | @implemented [2026-10-26]
 *
 * plain English: returns the parsed config, cached for `caching_runtime_config
 * .landing_config_cache_ttl_seconds` (60 s seeded), so turning the rotation off reaches every
 * server within one TTL, no deploy.
 *
 * FAILS SAFE, ON PURPOSE: a missing key, an unreadable row or a value that does not parse is
 * logged as an ERROR and read as "rotation off" (`LANDING_OFF`). The rotation is an experiment;
 * the safe state is every student landing on Home exactly as before it existed.
 */
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { createTtlCache } from "../../lib/ttl-cache";
import {
  CACHE_TTL_CONFIG,
  readCacheTtlMs,
} from "../../lib/caching-runtime-config";
import {
  landingConfigSchema,
  type LandingConfig,
} from "../../../packages/shared/src/smart-landing-schema";

export const LANDING_CONFIG_KEYS = {
  enabled: "landing_rotation_enabled",
  dashboardShare: "landing_dashboard_share",
  weights: "landing_arm_weights",
  salt: "landing_salt",
} as const;

/** The state used whenever the config cannot be trusted: no rotation. */
export const LANDING_OFF: LandingConfig = {
  enabled: false,
  dashboardShare: 0,
  weights: {},
  salt: "off",
};

async function readLandingConfig(): Promise<LandingConfig> {
  const { data, error } = await supabaseServer
    .from("practice_runtime_config")
    .select("key, value")
    .in("key", Object.values(LANDING_CONFIG_KEYS));
  if (error) {
    logger.error(
      "LANDING",
      "config_unreadable",
      "practice_runtime_config landing keys could not be read; the rotation is off",
      classifyError(error),
    );
    return LANDING_OFF;
  }
  const byKey = new Map(
    (data ?? []).map((row: { key: string; value: unknown }) => [
      row.key,
      row.value,
    ]),
  );
  const parsed = landingConfigSchema.safeParse({
    enabled: byKey.get(LANDING_CONFIG_KEYS.enabled),
    dashboardShare: byKey.get(LANDING_CONFIG_KEYS.dashboardShare),
    weights: byKey.get(LANDING_CONFIG_KEYS.weights),
    salt: byKey.get(LANDING_CONFIG_KEYS.salt),
  });
  if (!parsed.success) {
    logger.error(
      "LANDING",
      "config_invalid",
      "practice_runtime_config landing keys are missing or malformed; the rotation is off",
      { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
    );
    return LANDING_OFF;
  }
  return parsed.data;
}

const LANDING_CONFIG_TTL_MS =
  CACHE_TTL_CONFIG.landingConfig.fallbackSeconds * 1000;

const LANDING_CONFIG_CACHE = createTtlCache<LandingConfig>({
  name: "landing:runtime_config",
  ttlMs: LANDING_CONFIG_TTL_MS,
  ttlFrom: () => readCacheTtlMs("landingConfig"),
  hardStaleMs: LANDING_CONFIG_TTL_MS,
  maxEntries: 1,
});

/** Drop the cached config (tests). */
export function invalidateLandingConfigCache(): void {
  LANDING_CONFIG_CACHE.invalidate();
}

export async function loadLandingConfig(): Promise<LandingConfig> {
  return LANDING_CONFIG_CACHE.get("landing", readLandingConfig);
}
