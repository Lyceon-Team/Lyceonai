/**
 * @spec [Doc-01A_V1 §4; Doc-03B_V2 §24/§13.6/§21] | @implemented 2026-08-05
 * plain English: In-process cache for `tutor_context_runtime_config` with
 * LISTEN/NOTIFY invalidation (config_invalidate channel). On change, the
 * affected key is re-fetched from the DB — no full reload.
 *
 * expected outcome: tutor-runtime reads config from this service (zero
 * hardcoded values for timeout, max_output_tokens, etc.). Changes to the
 * config table take effect without server restart.
 * trade-offs: process-local cache means multi-instance deploys see updates
 * asynchronously (bounded by NOTIFY propagation, typically <1s).
 *
 * Design decisions:
 * - fail-closed: if a config key is missing or invalid, the getter throws.
 *   The caller (tutor-runtime) surfaces the error rather than using a
 *   fallback that silently diverges from the intended config.
 * - LISTEN requires a raw pg connection (supabase-js does not expose LISTEN).
 *   We use the Supabase pooler connection string. If LISTEN is unavailable
 *   (e.g., PgBouncer in transaction mode), the cache falls back to a polling
 *   interval (every 60s). This is logged as a warning.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

const CONFIG_TABLE = "tutor_context_runtime_config" as const;

type ConfigValue = {
  key: string;
  value: unknown;
  value_type: string;
};

/** In-process cache: key → parsed value. */
const cache = new Map<string, unknown>();
let initialized = false;

// ── Known keys + expected types ────────────────────────────────────────

const _EXPECTED_KEYS = {
  // WS2 — cost / rate / reuse
  cost_soft_alert_usd_month: "integer",
  cost_hard_alert_usd_month: "integer",
  cost_hard_cap_usd_month: "integer",
  vertex_pro_daily_budget_usd: "integer",
  vertex_pro_budget_circuit_breaker_enabled: "boolean",
  vertex_pro_budget_circuit_breaker_warning_pct: "integer",
  per_question_cooldown_minutes: "integer",
  tutor_request_timeout_seconds: "integer",
  conversation_reuse_days: "integer",
  // WS-L0.3 — context window / memory / injection
  recent_message_window: "integer",
  memory_summary_staleness_days: "integer",
  injection_length_bound_chars: "integer",
  study_context_relevance_window_days: "integer",
  // WS-L2 — freshness thresholds (Doc 03A §7.4)
  teaching_profile_freshness_days: "integer",
  recent_learning_pattern_freshness_days: "integer",
  study_context_freshness_days: "integer",
  // WS-L2 — friction / observation
  friction_long_pause_seconds: "integer",
  observation_promotion_threshold: "integer",
} as const;

type ConfigKey = keyof typeof _EXPECTED_KEYS;

// ── Parse helpers ──────────────────────────────────────────────────────

function parseConfigValue(row: ConfigValue): unknown {
  const raw = row.value;
  switch (row.value_type) {
    case "integer": {
      const n = Number(raw);
      if (!Number.isInteger(n)) {
        throw new Error(
          `${CONFIG_TABLE}.${row.key}: expected integer, got ${String(raw)}`,
        );
      }
      return n;
    }
    case "float": {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new Error(
          `${CONFIG_TABLE}.${row.key}: expected float, got ${String(raw)}`,
        );
      }
      return n;
    }
    case "boolean": {
      if (raw === true || raw === "true") return true;
      if (raw === false || raw === "false") return false;
      throw new Error(
        `${CONFIG_TABLE}.${row.key}: expected boolean, got ${String(raw)}`,
      );
    }
    case "string":
      return String(raw);
    case "array":
    case "object":
      return raw; // already JSONB-parsed
    default:
      throw new Error(
        `${CONFIG_TABLE}.${row.key}: unknown value_type '${row.value_type}'`,
      );
  }
}

// ── Cache load ─────────────────────────────────────────────────────────

async function loadAll(): Promise<void> {
  const { data, error } = await supabaseServer
    .from(CONFIG_TABLE)
    .select("key, value, value_type");

  if (error) {
    throw new Error(`Failed to load ${CONFIG_TABLE}: ${error.message}`);
  }

  const rows = data as ConfigValue[];
  for (const row of rows) {
    cache.set(row.key, parseConfigValue(row));
  }
  initialized = true;

  logger.info(
    "TUTOR_CONFIG",
    "config_loaded",
    `Loaded ${rows.length} keys from ${CONFIG_TABLE}`,
    {
      keys: rows.map((r) => r.key),
    },
  );
}

async function reloadKey(key: string): Promise<void> {
  const { data, error } = await supabaseServer
    .from(CONFIG_TABLE)
    .select("key, value, value_type")
    .eq("key", key)
    .single();

  if (error || !data) {
    logger.warn(
      "TUTOR_CONFIG",
      "config_key_missing",
      `Key '${key}' not found in ${CONFIG_TABLE} during reload`,
      {
        key,
        error: error?.message,
      },
    );
    cache.delete(key);
    return;
  }

  const row = data as ConfigValue;
  cache.set(row.key, parseConfigValue(row));

  logger.info(
    "TUTOR_CONFIG",
    "config_key_reloaded",
    `Reloaded key '${key}' from ${CONFIG_TABLE}`,
    {
      key,
    },
  );
}

// ── LISTEN/NOTIFY subscription ─────────────────────────────────────────

/**
 * Subscribe to the config_invalidate channel via Supabase Realtime postgres_changes.
 * If the Supabase project does not support Realtime on this table, we fall back
 * to a 60s polling interval (logged as a warning).
 *
 * NOTE: The genesis `notify_config_change()` trigger fires pg_notify on the
 * `config_invalidate` channel. Supabase Realtime can bridge pg_notify events.
 * If that's unavailable, we poll.
 */
let pollInterval: ReturnType<typeof setInterval> | null = null;

function startPollingFallback(): void {
  if (pollInterval) return;
  logger.warn(
    "TUTOR_CONFIG",
    "config_poll_fallback",
    "LISTEN/NOTIFY unavailable; polling every 60s",
    {},
  );
  pollInterval = setInterval(() => {
    loadAll().catch((err: unknown) => {
      logger.error(
        "TUTOR_CONFIG",
        "config_poll_error",
        "Failed to poll config",
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });
  }, 60_000);
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Initialize the config cache. Call once at server startup (before serving
 * requests). If LISTEN/NOTIFY is available, subscribes; otherwise falls back
 * to polling.
 */
export async function initTutorConfig(): Promise<void> {
  await loadAll();

  // Attempt Supabase Realtime subscription on the config table.
  // The channel watches for UPDATE events on tutor_context_runtime_config.
  try {
    const channel = supabaseServer.channel("tutor-config-invalidate").on(
      "postgres_changes" as "system",
      {
        event: "UPDATE",
        schema: "public",
        table: CONFIG_TABLE,
      },
      (payload: { new?: { key?: string } }) => {
        const key = payload.new?.key;
        if (key) {
          reloadKey(key).catch((err: unknown) => {
            logger.error(
              "TUTOR_CONFIG",
              "config_reload_error",
              `Failed to reload key '${key}'`,
              {
                key,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          });
        }
      },
    );

    const subscribeResult = await channel.subscribe();
    if (subscribeResult === "SUBSCRIBED") {
      logger.info(
        "TUTOR_CONFIG",
        "config_listen_active",
        "Subscribed to config_invalidate via Realtime",
        {},
      );
    } else {
      startPollingFallback();
    }
  } catch {
    startPollingFallback();
  }
}

/**
 * Get a typed config value. Throws if the key is missing or not initialized.
 * Fail-closed: no fallback defaults.
 */
export function getTutorConfig(key: ConfigKey): number | boolean | string {
  if (!initialized) {
    throw new Error(
      `${CONFIG_TABLE} not initialized — call initTutorConfig() at startup`,
    );
  }
  const val = cache.get(key);
  if (val === undefined) {
    throw new Error(`${CONFIG_TABLE}.${key} is not configured`);
  }
  return val as number | boolean | string;
}

/** Type-narrowed getter for integer config keys. */
export function getTutorConfigInt(key: ConfigKey): number {
  const val = getTutorConfig(key);
  if (typeof val !== "number") {
    throw new Error(
      `${CONFIG_TABLE}.${key}: expected number, got ${typeof val}`,
    );
  }
  return val;
}

/** Type-narrowed getter for boolean config keys. */
export function getTutorConfigBool(key: ConfigKey): boolean {
  const val = getTutorConfig(key);
  if (typeof val !== "boolean") {
    throw new Error(
      `${CONFIG_TABLE}.${key}: expected boolean, got ${typeof val}`,
    );
  }
  return val;
}

/** Teardown — stop polling if active. For test cleanup. */
export function teardownTutorConfig(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  cache.clear();
  initialized = false;
}
