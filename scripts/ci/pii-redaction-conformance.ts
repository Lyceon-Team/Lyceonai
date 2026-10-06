/**
 * ci/pii-redaction-conformance
 *
 * @spec [Doc 07A V1.0 §11.2 (hard-fail at V1: missing posture, pii_redaction ≠ properties,
 *       forbidden-identifier-type posture), §8.1.1 (the four runtime methods; hash_server_local
 *       excluded), §11.4 (envelope extras)] | @implemented [2026-10-05]
 *
 * plain English: parses the registry with the shared schema and fails if any property lacks a
 * declared posture, any posture names no property, any method is not one of the four runtime
 * methods (hash_server_local is named as its own failure), or any property or person property is
 * a forbidden identifier type (contact details, names, raw cross-system user ids). Prints the
 * per-registry coverage report — declarations only, no payloads.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { eventRegistrySchema } from "../../packages/shared/src/event-registry-schema";
import { checkPiiConformance } from "./lib/event-registry-checks";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const registry = eventRegistrySchema.parse(
  parse(readFileSync(join(ROOT, "infra/event-schema-registry.yaml"), "utf-8")),
);
const report = checkPiiConformance(registry);

process.stdout.write("==> ci/pii-redaction-conformance\n");
process.stdout.write(
  `    events: ${registry.events.length}, person properties: ${registry.person_properties.length}\n`,
);
process.stdout.write(
  `    proof: ${JSON.stringify({
    posture_coverage_percent: report.posture_coverage_percent,
    forbidden_identifier_types_detected:
      report.forbidden_identifier_types_detected,
    orphan_properties: report.orphan_properties,
  })}\n`,
);
if (report.failures.length > 0) {
  for (const failure of report.failures)
    process.stderr.write(`FAIL: ${failure}\n`);
  process.exit(1);
}
process.stdout.write("    OK\n");
