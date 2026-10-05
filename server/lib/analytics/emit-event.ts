/**
 * `emitEvent` — the single server emission boundary into PostHog.
 *
 * @spec [Doc 07A V1.0 §9.1 (signature), §9.2 (the deterministic steps, RB-07A-V1-02), §9.3.1 (the
 *       exact posthog-node call), §8.1.1 / §8.2 (per-property redaction), §7.1 (analytics_user_id);
 *       SCL-201 IS 2 (this file and the client init module are the ONLY PostHog SDK importers) and
 *       IS 1 / F10 (under-13 excluded); SCL-213 (the V1 launch set)] | @implemented [2026-10-05]
 *
 * plain English, in §9.2's order:
 *   1. SDK import is confined to this module (enforced by ci/event-schema-registry-parity).
 *   2. The subject is the authenticated profile id the CALLER resolved server-side (`req.user.id`,
 *      never a client claim). A profile that does not exist is refused.
 *   3. The profile's record is loaded; its analytics_user_id, if never written, is derived (§7.1)
 *      and written once AFTER steps 4–5 and the exclusions below — the column is set-once in the
 *      database, and the derivation is deterministic, so two concurrent first emissions write
 *      the same value.
 *   4. A caller that passes a base field is refused (spoofing surface).
 *   5. The event must be in the registry.
 *   6–7. Base fields are injected by the wrapper.
 *   8. The final payload is validated against the registry's JSON Schema (Ajv).
 *   9. Each property is redacted per its declared method.
 *  10. posthog-node `captureImmediate` sends it (the serverless function may freeze after the
 *      response, so a queued send is not used).
 *  12. A no-payload proof line is logged: event name and latency only.
 * Under-13 (and an age not yet known — `is_under_13` is NULL until a date of birth is entered) is
 * refused before anything is derived or sent, and so is any event but user_signed_up on an
 * account that has not completed onboarding.
 *
 * Never throws: every outcome is a returned reason, logged without payload. Analytics failing must
 * not fail the request that triggered it, so callers `await` it and carry on.
 *
 * trade-offs: §9.2 step 11 (person-property updates) is not built — only the cohort-class events
 * use it, and SCL-213 defers them. `bucket` redaction has no bucket table at V1 (§8.1.1: "Currently
 * unused"), so an entry declaring it is refused rather than guessed at.
 */
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { PostHog } from "posthog-node";
import { analyticsEnvSchema } from "../../../packages/shared/src/env";
import {
  EVENT_BASE_FIELDS,
  eventRegistrySchema,
  type EventRegistry,
  type RegistryEventEntry,
} from "../../../packages/shared/src/event-registry-schema";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { deriveAnalyticsUserId } from "./analytics-user-id";
import { GENERATED_EVENT_REGISTRY } from "./event-registry.generated";

/**
 * Doc 07A §9.2's named reasons, plus those this build adds (recorded in SCL-213 IS 5):
 * `analytics_not_configured` (no key or salt — the product runs without analytics),
 * `excluded_under_13_or_age_unknown` (SCL-201 IS 1), `account_not_onboarded` and
 * `not_first_identity` (user_signed_up fires once, at onboarding completion),
 * `redaction_method_unsupported` (§8.1.1 `bucket` has no V1 table), `identity_unavailable` (the
 * profile read or the set-once write failed) and `send_failed` (PostHog refused the capture).
 */
export type EmitRefusal =
  | "analytics_not_configured"
  | "unauthenticated_emission_attempt"
  | "excluded_under_13_or_age_unknown"
  | "account_not_onboarded"
  | "caller_supplied_base_field"
  | "event_not_registered"
  | "schema_validation_failed"
  | "redaction_method_unsupported"
  | "not_first_identity"
  | "identity_unavailable"
  | "send_failed";

/** §9.2 step 8: a schema failure carries its details — the failing paths and keywords, no values. */
export type EmitResult =
  | { ok: true }
  | { ok: false; reason: EmitRefusal; details?: string[] };

type ProfileFacts = {
  analyticsUserId: string | null;
  isUnder13: boolean | null;
  onboarded: boolean;
};

/** Everything that touches the outside world, injectable so the steps can be tested for real. */
export type EmitDeps = {
  env: unknown;
  loadProfile: (profileId: string) => Promise<ProfileFacts | null>;
  /**
   * Writes the id if the column is still NULL. Returns the stored value either way, and whether
   * THIS call was the one that wrote it.
   */
  persistAnalyticsUserId: (
    profileId: string,
    derived: string,
  ) => Promise<{ stored: string; wroteNow: boolean }>;
  send: (message: {
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
    timestamp: Date;
  }) => Promise<void>;
  now: () => Date;
};

/** The registry, parsed once with the shared schema; a malformed registry fails at module load. */
export const EVENT_REGISTRY: EventRegistry = eventRegistrySchema.parse(
  GENERATED_EVENT_REGISTRY,
);

const ajv = new Ajv({ allErrors: false, strict: true });
addFormats(ajv);
const validators = new Map<string, ValidateFunction>();

function validatorFor(entry: RegistryEventEntry): ValidateFunction | null {
  if (!entry.json_schema) return null;
  const cached = validators.get(entry.event_name);
  if (cached) return cached;
  const compiled = ajv.compile(entry.json_schema);
  validators.set(entry.event_name, compiled);
  return compiled;
}

function findEntry(eventName: string): RegistryEventEntry | null {
  return (
    EVENT_REGISTRY.events.find(
      (e) => e.event_name === eventName && e.V1_active,
    ) ?? null
  );
}

/** §9.2 step 9. Returns null when a declared method cannot be applied. */
function redact(
  entry: RegistryEventEntry,
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const method = entry.pii_redaction[key];
    if (method === "not_pii" || method === "opaque_id_only") {
      out[key] = value;
    } else if (method === "drop") {
      continue;
    } else {
      // `bucket` (no V1 bucket table), an unknown method, or no declaration at all.
      return null;
    }
  }
  return out;
}

function refuse(
  eventName: string,
  reason: EmitRefusal,
  details?: string[],
): EmitResult {
  logger.warn("ANALYTICS", "emit_refused", "Analytics event not emitted", {
    event: eventName,
    reason,
    ...(details ? { details } : {}),
  });
  return details ? { ok: false, reason, details } : { ok: false, reason };
}

export type EmitOptions = {
  /**
   * Emit only if this call is the one that first writes the profile's analytics_user_id. Used by
   * `user_signed_up`: the set-once write is the insert-once guard, so two concurrent onboarding
   * completions emit one event, and an account identified before (a sign-in that predates this
   * launch) never emits a second "signed up". Every OTHER event is refused until onboarding is
   * complete, so for a new account the first write is always this one.
   */
  requireFirstIdentity?: boolean;
};

export async function emitEventWith(
  deps: EmitDeps,
  profileId: string,
  eventName: string,
  payload: Record<string, unknown>,
  options: EmitOptions = {},
): Promise<EmitResult> {
  const env = analyticsEnvSchema.safeParse(deps.env);
  if (!env.success || !env.data.POSTHOG_API_KEY || !env.data.ANALYTICS_SALT) {
    return { ok: false, reason: "analytics_not_configured" };
  }
  const salt = env.data.ANALYTICS_SALT;

  // Steps 2–3: resolve the authenticated subject and load its record. No anonymous path.
  let profile: ProfileFacts | null;
  try {
    profile = await deps.loadProfile(profileId);
  } catch (err: unknown) {
    logger.error(
      "ANALYTICS",
      "emit_profile_read",
      "Analytics profile read failed",
      err,
      { event: eventName },
    );
    return { ok: false, reason: "identity_unavailable" };
  }
  if (!profile) return refuse(eventName, "unauthenticated_emission_attempt");

  // Step 4: a spoofed base field is refused outright.
  if (
    EVENT_BASE_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(payload, field),
    )
  ) {
    return refuse(eventName, "caller_supplied_base_field");
  }

  // Step 5.
  const entry = findEntry(eventName);
  if (!entry) return refuse(eventName, "event_not_registered");

  // SCL-201 IS 1: under-13, and an age not yet known, are excluded before anything is derived.
  if (profile.isUnder13 !== false) {
    // Not logged: excluding a minor is the policy working, not a fault.
    return { ok: false, reason: "excluded_under_13_or_age_unknown" };
  }
  // Only user_signed_up may precede onboarding completion (its own call site is the completion).
  if (options.requireFirstIdentity !== true && !profile.onboarded) {
    return { ok: false, reason: "account_not_onboarded" };
  }

  // Step 3 (continued): the immutable id, derived and written once if it was never written.
  let analyticsUserId = profile.analyticsUserId;
  let wroteIdentityNow = false;
  if (analyticsUserId === null) {
    try {
      const persisted = await deps.persistAnalyticsUserId(
        profileId,
        deriveAnalyticsUserId(profileId, salt),
      );
      analyticsUserId = persisted.stored;
      wroteIdentityNow = persisted.wroteNow;
    } catch (err: unknown) {
      logger.error(
        "ANALYTICS",
        "emit_identity_write",
        "analytics_user_id write failed",
        err,
        { event: eventName },
      );
      return { ok: false, reason: "identity_unavailable" };
    }
  }
  if (options.requireFirstIdentity === true && !wroteIdentityNow) {
    // Expected on a repeat completion or a pre-existing account: not a fault, not logged.
    return { ok: false, reason: "not_first_identity" };
  }

  // Steps 6–7.
  const timestamp = deps.now();
  const finalPayload: Record<string, unknown> = {
    ...payload,
    event_name: entry.event_name,
    timestamp: timestamp.toISOString(),
    analytics_user_id: analyticsUserId,
    schema_version: entry.schema_version,
  };

  // Step 8.
  const validate = validatorFor(entry);
  if (!validate) return refuse(eventName, "schema_validation_failed");
  if (!validate(finalPayload)) {
    return refuse(
      eventName,
      "schema_validation_failed",
      (validate.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.keyword}`,
      ),
    );
  }

  // Step 9.
  const redacted = redact(entry, finalPayload);
  if (!redacted) return refuse(eventName, "redaction_method_unsupported");

  // Step 10.
  const started = Date.now();
  try {
    await deps.send({
      distinctId: analyticsUserId,
      event: entry.event_name,
      properties: redacted,
      timestamp,
    });
  } catch (err: unknown) {
    logger.error("ANALYTICS", "emit_send", "PostHog capture failed", err, {
      event: eventName,
    });
    return { ok: false, reason: "send_failed" };
  }

  // Step 12: no payload body — name and latency only.
  logger.info("ANALYTICS", "emit_ok", "Analytics event emitted", {
    event: entry.event_name,
    latencyMs: Date.now() - started,
  });
  return { ok: true };
}

let client: PostHog | null = null;

function posthogClient(apiKey: string, host: string | undefined): PostHog {
  client ??= new PostHog(apiKey, {
    host: host ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
    requestTimeout: 3000,
  });
  return client;
}

const defaultDeps: EmitDeps = {
  env: process.env,
  async loadProfile(profileId) {
    const { data, error } = await supabaseServer
      .from("profiles")
      .select("analytics_user_id, is_under_13, profile_completed_at")
      .eq("id", profileId)
      .maybeSingle();
    if (error)
      throw new Error(`profiles read failed: ${error.code ?? "unknown"}`);
    if (!data) return null;
    const row = data as {
      analytics_user_id: string | null;
      is_under_13: boolean | null;
      profile_completed_at: string | null;
    };
    return {
      analyticsUserId: row.analytics_user_id,
      isUnder13: row.is_under_13,
      onboarded: row.profile_completed_at !== null,
    };
  },
  async persistAnalyticsUserId(profileId, derived) {
    const { data: written, error } = await supabaseServer
      .from("profiles")
      .update({ analytics_user_id: derived })
      .eq("id", profileId)
      .is("analytics_user_id", null)
      .select("id");
    if (error)
      throw new Error(
        `analytics_user_id write failed: ${error.code ?? "unknown"}`,
      );
    const wroteNow = Array.isArray(written) && written.length === 1;
    // Re-read: whichever writer won, the stored value is the one every event must carry.
    const { data, error: readError } = await supabaseServer
      .from("profiles")
      .select("analytics_user_id")
      .eq("id", profileId)
      .single();
    if (readError)
      throw new Error(
        `analytics_user_id re-read failed: ${readError.code ?? "unknown"}`,
      );
    const stored = (data as { analytics_user_id: string | null })
      .analytics_user_id;
    if (stored === null)
      throw new Error("analytics_user_id still NULL after write");
    return { stored, wroteNow };
  },
  async send(message) {
    const env = analyticsEnvSchema.parse(process.env);
    if (!env.POSTHOG_API_KEY)
      throw new Error("POSTHOG_API_KEY missing at send");
    await posthogClient(env.POSTHOG_API_KEY, env.POSTHOG_HOST).captureImmediate(
      message,
    );
  },
  now: () => new Date(),
};

/** Doc 07A §9.1. `profileId` is the server-resolved authenticated user — never a client value. */
export function emitEvent(
  profileId: string,
  eventName: string,
  payload: Record<string, unknown>,
  options: EmitOptions = {},
): Promise<EmitResult> {
  return emitEventWith(defaultDeps, profileId, eventName, payload, options);
}
