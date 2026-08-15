/**
 * @spec [Doc-03A_V3.0 §18.7, SCL-024a (Doc-01A_V1 §8 config template), Doc-03B_V2 §12B.8]
 * @implemented 2026-08-09
 *
 * plain English: Loads tutor runtime config from the `tutor_context_runtime_config`
 * table (01A §8 key/value/value_type template, created by WS2 migration). Config is
 * loaded at bootstrap into an in-memory cache, then invalidated via the genesis
 * `config_invalidate` LISTEN/NOTIFY channel (01A §4). Every read goes through Zod
 * parsing so that callers never receive un-validated values.
 *
 * expected outcome: `TutorConfig.get("recent_message_window")` returns a typed,
 * Zod-validated value or the spec-mandated default. Model Armor template IDs are
 * NEVER literals — always sourced from this config (Doc 03B §12B.8 mandate).
 *
 * trade-offs / edge cases:
 *  - Fails closed on DB unreachable (throws) — a missing config must never
 *    silently degrade to unsafe defaults.
 *  - LISTEN/NOTIFY requires a raw pg connection; the Supabase HTTP client
 *    cannot subscribe. Event-driven invalidation is therefore deferred until
 *    a direct-pg transport is available. Until then, the cache is refreshed by
 *    callers via explicit `refreshCache()` or at bootstrap via `loadAll()`.
 *  - value_type in DB is a TEXT tag ('integer','string',...); the Zod schema
 *    here enforces the narrower per-key type contract.
 */
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

// ── Per-key Zod schemas (spec-mandated types + defaults) ──────────────

const tutorConfigKeySchemas = {
  recent_message_window: { schema: z.number().int().positive(), default: 12 },
  memory_summary_staleness_days: {
    schema: z.number().int().positive(),
    default: 14,
  },
  injection_length_bound_chars: {
    schema: z.number().int().positive(),
    default: 4000,
  },
  study_context_relevance_window_days: {
    schema: z.number().int().positive(),
    default: 7,
  },
  model_armor_input_template_id: { schema: z.string().min(1), default: null },
  model_armor_output_template_id: { schema: z.string().min(1), default: null },
  crisis_classifier_model_alias: {
    schema: z.string().min(1),
    default: "classifier_class",
  },
  crisis_retry_count: { schema: z.number().int().nonnegative(), default: 1 },
  // WS2 seeds (Doc 03 §24, §13, §21)
  cost_soft_alert_usd_month: {
    schema: z.number().int().nonnegative(),
    default: 10,
  },
  cost_hard_alert_usd_month: {
    schema: z.number().int().nonnegative(),
    default: 18,
  },
  cost_hard_cap_usd_month: {
    schema: z.number().int().nonnegative(),
    default: 20,
  },
  vertex_pro_daily_budget_usd: {
    schema: z.number().int().nonnegative(),
    default: 200,
  },
  vertex_pro_budget_circuit_breaker_enabled: {
    schema: z.boolean(),
    default: true,
  },
  vertex_pro_budget_circuit_breaker_warning_pct: {
    schema: z.number().int().min(0).max(100),
    default: 80,
  },
  per_question_cooldown_minutes: {
    schema: z.number().int().nonnegative(),
    default: 5,
  },
  tutor_request_timeout_seconds: {
    schema: z.number().int().positive(),
    default: 30,
  },
  conversation_reuse_days: { schema: z.number().int().positive(), default: 7 },
  // WS-L2 context config keys (Doc 03A §7.4)
  teaching_profile_freshness_days: {
    schema: z.number().int().positive(),
    default: 14,
  },
  recent_learning_pattern_freshness_days: {
    schema: z.number().int().positive(),
    default: 7,
  },
  study_context_freshness_days: {
    schema: z.number().int().positive(),
    default: 3,
  },
  friction_long_pause_seconds: {
    schema: z.number().int().positive(),
    default: 120,
  },
  observation_promotion_threshold: {
    schema: z.number().int().positive(),
    default: 5,
  },
} as const;

type TutorConfigKey = keyof typeof tutorConfigKeySchemas;

/**
 * Infer return type per key — string keys return string, number keys return number, etc.
 */
type TutorConfigValue<K extends TutorConfigKey> = z.infer<
  (typeof tutorConfigKeySchemas)[K]["schema"]
>;

// ── DB row schema (01A §8 template) ──────────────────────────────────

const configRowSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  value_type: z.enum([
    "integer",
    "string",
    "boolean",
    "array",
    "object",
    "float",
  ]),
  owner: z.string(),
  description: z.string(),
  environment: z.string(),
  updated_at: z.string(),
});

// ── Cache ────────────────────────────────────────────────────────────

const cache: Map<string, unknown> = new Map();
let cacheLoaded = false;

/**
 * Coerce a JSONB `value` column according to its `value_type` tag.
 * The DB stores JSONB, so numbers arrive as numbers, strings as
 * JSON-encoded strings (e.g. `"\"America/Chicago\""` for a string value),
 * and booleans as `true`/`false`.
 */
function coerceValue(raw: unknown, valueType: string): unknown {
  if (raw === null || raw === undefined) {
    return raw;
  }

  switch (valueType) {
    case "integer":
      return typeof raw === "number" ? raw : Number(raw);
    case "float":
      return typeof raw === "number" ? raw : parseFloat(String(raw));
    case "string":
      return typeof raw === "string" ? raw : String(raw);
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      return Boolean(raw);
    case "array":
    case "object":
      return raw;
    default:
      return raw;
  }
}

/**
 * @spec [Doc-03A_V3.0 §18.7, SCL-024a, Doc-03B_V2 §12B.8]
 *
 * Single canonical tutor runtime config loader. Reads from
 * `tutor_context_runtime_config` (01A §8 key-value template).
 * Config is cached in-memory; invalidation via `config_invalidate`
 * NOTIFY channel or explicit `refreshCache()`.
 *
 * Model Armor template IDs are NEVER literals — always from this config.
 */
export class TutorConfig {
  /**
   * @spec [Doc-03A_V3.0 §18.7]
   * Loads all config rows from `tutor_context_runtime_config` into the
   * in-memory cache. Fails closed (throws) if the table is unreachable —
   * a missing config must never silently degrade.
   *
   * expected outcome: cache is populated with coerced, typed values.
   * trade-offs: full table scan on each call; acceptable for a small
   * config table (<50 rows). Called once at bootstrap and on invalidation.
   */
  static async loadAll(): Promise<Map<string, unknown>> {
    const { data, error } = await supabaseServer
      .from("tutor_context_runtime_config")
      .select(
        "key, value, value_type, owner, description, environment, updated_at",
      );

    if (error) {
      logger.error(
        "TUTOR_CONFIG",
        "load_all_failed",
        "Failed to load tutor_context_runtime_config; failing closed",
        { message: error.message, code: error.code },
      );
      throw new Error(
        `TutorConfig.loadAll failed: ${error.message} (code: ${error.code})`,
      );
    }

    if (!data) {
      logger.error(
        "TUTOR_CONFIG",
        "load_all_empty",
        "tutor_context_runtime_config returned null data; failing closed",
      );
      throw new Error("TutorConfig.loadAll: null data from DB");
    }

    cache.clear();

    for (const row of data) {
      const parsed = configRowSchema.safeParse(row);
      if (!parsed.success) {
        logger.warn(
          "TUTOR_CONFIG",
          "row_parse_failed",
          `Config row failed Zod parse; skipping`,
          {
            key: (row as { key?: string }).key,
            errors: parsed.error.flatten(),
          },
        );
        continue;
      }
      const coerced = coerceValue(parsed.data.value, parsed.data.value_type);
      cache.set(parsed.data.key, coerced);
    }

    cacheLoaded = true;
    logger.info(
      "TUTOR_CONFIG",
      "cache_loaded",
      `Loaded ${cache.size} config keys from tutor_context_runtime_config`,
    );

    return new Map(cache);
  }

  /**
   * @spec [Doc-03A_V3.0 §18.7]
   * Returns the cached value for a known config key, validated through
   * the key's Zod schema. Returns the spec-mandated default if the key
   * is absent from the cache or fails validation.
   *
   * For keys with no spec default (e.g. Model Armor template IDs),
   * returns `null` when absent — callers MUST handle the null case.
   *
   * expected outcome: type-safe value matching the key's schema.
   * trade-offs: returns default on parse failure (logged as warning),
   * rather than throwing — individual key misconfigurations should not
   * crash the runtime.
   */
  static get<K extends TutorConfigKey>(key: K): TutorConfigValue<K> {
    const entry = tutorConfigKeySchemas[key];
    const raw = cache.get(key);

    if (raw === undefined || raw === null) {
      if (!cacheLoaded) {
        logger.warn(
          "TUTOR_CONFIG",
          "cache_not_loaded",
          `TutorConfig.get("${key}") called before loadAll; returning default`,
          { key },
        );
      }
      return entry.default as TutorConfigValue<K>;
    }

    const result = entry.schema.safeParse(raw);
    if (!result.success) {
      logger.warn(
        "TUTOR_CONFIG",
        "value_parse_failed",
        `Config key "${key}" failed Zod validation; returning default`,
        { key, raw, errors: result.error.flatten() },
      );
      return entry.default as TutorConfigValue<K>;
    }

    return result.data as TutorConfigValue<K>;
  }

  /**
   * @spec [Doc-01A_V1 §4, Doc-03A_V3.0 §18.7]
   * Re-fetches all config from DB and repopulates the cache.
   * Called when a `config_invalidate` NOTIFY event is received for
   * table `tutor_context_runtime_config`, or manually by operators.
   *
   * expected outcome: cache is refreshed; stale values replaced.
   */
  static async refreshCache(): Promise<void> {
    logger.info(
      "TUTOR_CONFIG",
      "cache_refresh",
      "Refreshing tutor config cache",
    );
    await TutorConfig.loadAll();
  }

  /**
   * @spec [Doc-01A_V1 §4]
   * Handler for the `config_invalidate` NOTIFY event. Filters for
   * events targeting `tutor_context_runtime_config` and triggers a
   * cache refresh.
   *
   * expected outcome: cache is refreshed only for tutor config events.
   * trade-offs: currently a full reload (not per-key); acceptable for
   * the small config table size.
   *
   * NOTE: This handler is designed to be registered with a raw pg
   * LISTEN subscription. The Supabase HTTP client cannot LISTEN;
   * until a direct-pg transport is wired, callers use `refreshCache()`
   * explicitly or rely on bootstrap `loadAll()`.
   */
  static async handleConfigInvalidation(payload: string): Promise<void> {
    let parsed: { table?: string; key?: string };
    try {
      parsed = JSON.parse(payload) as { table?: string; key?: string };
    } catch {
      logger.warn(
        "TUTOR_CONFIG",
        "notify_parse_failed",
        "Failed to parse config_invalidate payload",
        { payload },
      );
      return;
    }

    if (parsed.table !== "tutor_context_runtime_config") {
      return;
    }

    logger.info(
      "TUTOR_CONFIG",
      "invalidation_received",
      `Config invalidation event for key "${parsed.key ?? "unknown"}"`,
      { key: parsed.key },
    );

    await TutorConfig.refreshCache();
  }

  /**
   * Returns whether the cache has been populated via `loadAll()`.
   * Useful for health checks and startup sequencing.
   */
  static isCacheLoaded(): boolean {
    return cacheLoaded;
  }
}
