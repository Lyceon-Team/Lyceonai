#!/usr/bin/env node
/**
 * Generate `server/lib/analytics/event-registry.generated.ts` from `infra/event-schema-registry.yaml`.
 *
 * @spec [Doc 07A V1.0 §5.1 (the YAML is canonical), §9.2 step 5 (the wrapper looks each event up
 *       in the registry at runtime)] | @implemented [2026-10-05]
 *
 * plain English: the Vercel function is an esbuild bundle, so a file read off disk at request time
 * never ships (the incident recorded in scripts/build/generate-legal-registry.mjs). The registry is
 * inlined as a module instead: esbuild bundles a static import unconditionally. The YAML stays the
 * only editable copy — `ci/event-schema-registry-parity` regenerates this module and fails on any
 * difference, so the module cannot drift into a second source.
 *
 * Shape is NOT validated here: the server parses the inlined object with the shared Zod schema at
 * module load, and both CI gates parse the YAML with the same schema.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SRC = path.join(ROOT, "infra/event-schema-registry.yaml");
const OUT = path.join(ROOT, "server/lib/analytics/event-registry.generated.ts");

const registry = parse(fs.readFileSync(SRC, "utf-8"));

const body = `/**
 * GENERATED FILE — DO NOT EDIT.
 * Written by scripts/build/generate-event-registry.mjs from infra/event-schema-registry.yaml.
 * Regenerate with: pnpm run generate:event-registry
 *
 * The event-schema registry, inlined so the serverless bundle carries it. Parsed with
 * \`eventRegistrySchema\` (packages/shared/src/event-registry-schema.ts) where it is used.
 */
export const GENERATED_EVENT_REGISTRY: unknown = ${JSON.stringify(registry, null, 2)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
