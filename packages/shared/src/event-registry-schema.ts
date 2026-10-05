/**
 * The shape of `infra/event-schema-registry.yaml`.
 *
 * @spec [Doc 07A V1.0 §5.2 (top-level schema), §5.3 (strict-tier entry), §5.4 (loose-tier entry),
 *       §7 (person properties), §8.1.1 (event_redaction_method — four methods; hash_server_local
 *       is excluded), §8.2 (pii_redaction key set == json_schema.properties key set)]
 *       | @implemented [2026-10-05]
 *
 * plain English: one Zod schema, read by three consumers — the build-time generator that turns
 * the YAML into a bundled module, the runtime `emitEvent` wrapper, and the two CI gates
 * (`ci/event-schema-registry-parity`, `ci/pii-redaction-conformance`). The gates decide pass or
 * fail; this schema only fixes the shape, so a registry that does not parse is a failure in every
 * consumer at once rather than a different failure in each.
 *
 * trade-offs: `json_schema` is kept as an opaque JSON object here and compiled by Ajv where it is
 * used — Zod is not a JSON Schema validator, and a hand-rolled subset would be a second one.
 */
import { z } from "zod";

/** Doc 07A §8.1.1: the runtime enum. `hash_server_local` is proof-artifact only (§8.1.2). */
export const EVENT_REDACTION_METHODS = [
  "not_pii",
  "opaque_id_only",
  "bucket",
  "drop",
] as const;
export const eventRedactionMethodSchema = z.enum(EVENT_REDACTION_METHODS);
export type EventRedactionMethod = z.infer<typeof eventRedactionMethodSchema>;

/** Doc 07A §6.1, with the cohort class of §6.0. */
export const canonicalEventClassSchema = z.enum([
  "auth",
  "cohort",
  "billing",
  "practice",
  "exam",
  "tutor",
  "mastery",
  "system",
]);

/** Doc 07A §6.1: the four base fields every payload carries, injected by the wrapper only. */
export const EVENT_BASE_FIELDS = [
  "event_name",
  "timestamp",
  "analytics_user_id",
  "schema_version",
] as const;

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const jsonObjectSchema = z.record(z.unknown());

/** Redaction values are left as strings here so the conformance gate can NAME a bad one. */
const piiRedactionSchema = z.record(z.string());

export const registryEventEntrySchema = z
  .object({
    event_name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    schema_tier: z.enum(["strict", "loose"]),
    canonical_event_class: canonicalEventClassSchema,
    owner: z.string().min(1),
    V1_active: z.boolean(),
    schema_version: semverSchema,
    description: z.string().min(1),
    json_schema: jsonObjectSchema.optional(),
    base_required_fields: z.array(z.string()).optional(),
    pii_redaction: piiRedactionSchema,
    retention_class: z.string().min(1),
  })
  .strict();
export type RegistryEventEntry = z.infer<typeof registryEventEntrySchema>;

export const registryPersonPropertySchema = z
  .object({
    property_name: z.string().min(1),
    description: z.string().min(1),
    type: z.string().min(1),
    mutability: z.enum(["immutable", "mutable"]),
    derivation: z.string().min(1).optional(),
    pii_redaction_method: z.string(),
    retention_class: z.string().min(1),
  })
  .strict();

export const eventRegistrySchema = z
  .object({
    schema_version: semverSchema,
    last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    owner_doc: z.string().min(1),
    events: z.array(registryEventEntrySchema).min(1),
    person_properties: z.array(registryPersonPropertySchema),
    retention_classes: z.array(
      z
        .object({
          class_name: z.string().min(1),
          description: z.string().min(1),
          pending_07E_resolution: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type EventRegistry = z.infer<typeof eventRegistrySchema>;

/** The `properties` key set of a strict-tier entry's JSON Schema, or null when it has none. */
export function jsonSchemaPropertyKeys(
  entry: RegistryEventEntry,
): string[] | null {
  const props = entry.json_schema?.["properties"];
  if (props === null || typeof props !== "object" || Array.isArray(props))
    return null;
  return Object.keys(props).sort();
}
