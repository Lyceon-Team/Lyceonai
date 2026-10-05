/**
 * The checks behind `ci/event-schema-registry-parity` and `ci/pii-redaction-conformance`.
 *
 * @spec [Doc 07A V1.0 §11.1 (parity: (a) unregistered event names, (b) PostHog SDK imports outside
 *       the wrapper, (c) pii_redaction keys ≠ json_schema.properties keys — all hard-fail at V1),
 *       §11.2 (conformance: (a) missing posture, (b) key-set mismatch, (c) forbidden-identifier
 *       postures), §11.4 (envelope extras), §8.1.1 / §8.1.2 (hash_server_local is never a runtime
 *       posture); SCL-201 IS 2 (exactly two SDK importers: the server wrapper and the client init
 *       module)] | @implemented [2026-10-05]
 *
 * plain English: pure functions over (registry, source files). The two gate scripts read the
 * repository and print the verdict; the unit tests feed these functions deliberately broken
 * inputs, so every failure path is proved to fail, not just the clean one to pass.
 */
import {
  EVENT_REDACTION_METHODS,
  jsonSchemaPropertyKeys,
  type EventRegistry,
  type RegistryEventEntry,
} from "../../../packages/shared/src/event-registry-schema";

export type SourceFile = { path: string; text: string };

/** SCL-201 IS 2: the only modules allowed to import a PostHog SDK. */
export const ALLOWED_SDK_IMPORTERS: Readonly<Record<string, string>> = {
  "posthog-node": "server/lib/analytics/emit-event.ts",
  "posthog-js": "client/src/lib/analytics/posthog-client.ts",
};

/** `from "…"`, `import("…")`, a bare side-effect `import "…"`, and `require("…")`. */
const SDK_IMPORT =
  /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["'](posthog-node|posthog-js)(?:\/[^"']*)?["']/g;

/** `emitEvent(<subject>, "<name>"` and `emitEventWith(<deps>, <subject>, "<name>"`. */
const EMIT_CALL = /\bemitEvent(With)?\s*\(/g;

export type EmitSite = { path: string; line: number; eventName: string | null };

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/**
 * Every call site of the wrapper, with its event name when it is a string literal. A non-literal
 * name is reported with `eventName: null`: the gate cannot prove it registered, so it fails.
 */
export function findEmitSites(files: readonly SourceFile[]): EmitSite[] {
  const sites: EmitSite[] = [];
  for (const file of files) {
    if (file.path === ALLOWED_SDK_IMPORTERS["posthog-node"]) continue; // the definition itself
    for (const match of file.text.matchAll(EMIT_CALL)) {
      const start = (match.index ?? 0) + match[0].length;
      const argsToSkip = match[1] === "With" ? 2 : 1;
      let rest = file.text.slice(start);
      let ok = true;
      for (let i = 0; i < argsToSkip; i += 1) {
        const comma = rest.indexOf(",");
        if (comma === -1) {
          ok = false;
          break;
        }
        rest = rest.slice(comma + 1);
      }
      const literal = ok ? /^\s*"([a-z][a-z0-9_]*)"/.exec(rest) : null;
      sites.push({
        path: file.path,
        line: lineOf(file.text, match.index ?? 0),
        eventName: literal?.[1] ?? null,
      });
    }
  }
  return sites;
}

export type SdkImport = { path: string; line: number; sdk: string };

export function findSdkImports(files: readonly SourceFile[]): SdkImport[] {
  const found: SdkImport[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(SDK_IMPORT)) {
      const sdk = match[1];
      if (sdk === undefined) continue;
      found.push({
        path: file.path,
        line: lineOf(file.text, match.index ?? 0),
        sdk,
      });
    }
  }
  return found;
}

function redactionKeys(entry: RegistryEventEntry): string[] {
  return Object.keys(entry.pii_redaction).sort();
}

/** The keys a `pii_redaction` map must equal: properties (strict) or base_required_fields (loose). */
function declaredKeys(entry: RegistryEventEntry): string[] | null {
  if (entry.schema_tier === "strict") return jsonSchemaPropertyKeys(entry);
  return entry.base_required_fields
    ? [...entry.base_required_fields].sort()
    : null;
}

export type ParityReport = {
  failures: string[];
  codeEmittedEvents: string[];
  registeredEvents: string[];
  unregistered_events_detected: string[];
  unredacted_property_count: number;
  tier_distribution: { strict: number; loose: number };
};

export function checkParity(
  registry: EventRegistry,
  files: readonly SourceFile[],
): ParityReport {
  const failures: string[] = [];
  const active = new Set(
    registry.events.filter((e) => e.V1_active).map((e) => e.event_name),
  );

  // (a) registration presence.
  const sites = findEmitSites(files);
  const unregistered = new Set<string>();
  for (const site of sites) {
    if (site.eventName === null) {
      failures.push(
        `${site.path}:${site.line} emits an event whose name is not a string literal`,
      );
    } else if (!active.has(site.eventName)) {
      unregistered.add(site.eventName);
      failures.push(
        `${site.path}:${site.line} emits "${site.eventName}", which is not a V1-active registry entry`,
      );
    }
  }

  // (b) wrapper bypass.
  for (const imp of findSdkImports(files)) {
    if (ALLOWED_SDK_IMPORTERS[imp.sdk] !== imp.path) {
      failures.push(
        `${imp.path}:${imp.line} imports ${imp.sdk}; only ${ALLOWED_SDK_IMPORTERS[imp.sdk] ?? "(none)"} may`,
      );
    }
  }

  // (c) registry/property mismatch.
  let unredacted = 0;
  const seen = new Set<string>();
  for (const entry of registry.events) {
    if (seen.has(entry.event_name))
      failures.push(`registry lists "${entry.event_name}" twice`);
    seen.add(entry.event_name);
    if (entry.schema_tier === "strict" && !entry.json_schema) {
      failures.push(`"${entry.event_name}" is strict-tier with no json_schema`);
    }
    if (
      entry.schema_tier === "strict" &&
      entry.json_schema?.["additionalProperties"] !== false
    ) {
      failures.push(
        `"${entry.event_name}" is strict-tier without additionalProperties: false`,
      );
    }
    const props = declaredKeys(entry);
    const redacted = redactionKeys(entry);
    if (props === null) {
      failures.push(`"${entry.event_name}" declares no property set`);
      continue;
    }
    const missing = props.filter((p) => !redacted.includes(p));
    unredacted += missing.length;
    if (missing.length > 0 || redacted.some((r) => !props.includes(r))) {
      failures.push(
        `"${entry.event_name}" pii_redaction keys [${redacted.join(", ")}] != property keys [${props.join(", ")}]`,
      );
    }
  }

  const codeEmitted = [
    ...new Set(sites.flatMap((s) => (s.eventName ? [s.eventName] : []))),
  ].sort();
  return {
    failures,
    codeEmittedEvents: codeEmitted,
    registeredEvents: [...active].sort(),
    unregistered_events_detected: [...unregistered].sort(),
    unredacted_property_count: unredacted,
    tier_distribution: {
      strict: registry.events.filter((e) => e.schema_tier === "strict").length,
      loose: registry.events.filter((e) => e.schema_tier === "loose").length,
    },
  };
}

/**
 * Doc 07A §11.2 (c) and RB-07-Parent-V1-04: identifier types that must never be an event property
 * — hashes of contact details or names, and raw cross-system user ids. Matched on the property
 * NAME; a posture cannot make them acceptable.
 */
const FORBIDDEN_IDENTIFIER_PROPERTY =
  /(?:^|_)(?:email|phone)(?:_|$)|^(?:full_name|first_name|last_name|display_name|user_name|username)(?:_hash(?:ed)?)?$|^(?:user_id|profile_id|student_id|guardian_id|supabase_user_id|auth_user_id|ip|ip_address)$/;

export type ConformanceReport = {
  failures: string[];
  posture_coverage_percent: number;
  forbidden_identifier_types_detected: string[];
  orphan_properties: string[];
};

export function checkPiiConformance(
  registry: EventRegistry,
): ConformanceReport {
  const failures: string[] = [];
  const runtime = new Set<string>(EVENT_REDACTION_METHODS);
  const forbidden: string[] = [];
  const orphans: string[] = [];
  let declaredProps = 0;
  let coveredProps = 0;

  for (const entry of registry.events) {
    const props = declaredKeys(entry) ?? [];
    const redacted = Object.keys(entry.pii_redaction);
    if (redacted.length === 0)
      failures.push(`"${entry.event_name}" has no pii_redaction posture`);
    for (const prop of props) {
      declaredProps += 1;
      if (Object.prototype.hasOwnProperty.call(entry.pii_redaction, prop))
        coveredProps += 1;
      else orphans.push(`${entry.event_name}.${prop} (no posture)`);
      if (FORBIDDEN_IDENTIFIER_PROPERTY.test(prop))
        forbidden.push(`${entry.event_name}.${prop}`);
    }
    for (const key of redacted) {
      if (!props.includes(key))
        orphans.push(`${entry.event_name}.${key} (posture for no property)`);
      const method = entry.pii_redaction[key] ?? "";
      if (method === "hash_server_local") {
        failures.push(
          `"${entry.event_name}.${key}" uses hash_server_local, which is proof-artifact only (§8.1.2)`,
        );
      } else if (!runtime.has(method)) {
        failures.push(
          `"${entry.event_name}.${key}" has unknown redaction method "${method}"`,
        );
      }
    }
  }
  for (const prop of registry.person_properties) {
    if (!runtime.has(prop.pii_redaction_method)) {
      failures.push(
        `person property "${prop.property_name}" has redaction method "${prop.pii_redaction_method}", not a runtime method`,
      );
    }
    if (FORBIDDEN_IDENTIFIER_PROPERTY.test(prop.property_name)) {
      forbidden.push(`person_properties.${prop.property_name}`);
    }
  }
  for (const orphan of orphans) failures.push(`orphan: ${orphan}`);
  for (const f of forbidden) failures.push(`forbidden identifier type: ${f}`);

  return {
    failures,
    posture_coverage_percent:
      declaredProps === 0
        ? 0
        : Math.round((coveredProps / declaredProps) * 10000) / 100,
    forbidden_identifier_types_detected: forbidden,
    orphan_properties: orphans,
  };
}
