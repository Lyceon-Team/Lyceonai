/**
 * ci/event-schema-registry-parity
 *
 * @spec [Doc 07A V1.0 §11.1 (hard-fail at V1: unregistered names, SDK imports outside the
 *       wrapper, pii_redaction ≠ json_schema.properties), §11.4 (envelope extras), §5.1 (the YAML
 *       is canonical); SCL-201 IS 2] | @implemented [2026-10-05]
 *
 * plain English: parses infra/event-schema-registry.yaml with the shared schema, scans every
 * product source file, and fails on (a) an `emitEvent` whose name is not a V1-active entry (or
 * is not a literal), (b) a PostHog SDK import anywhere but the two permitted modules, (c) a
 * registry entry whose redaction keys differ from its properties, and (d) a stale generated
 * registry module (regenerating must change nothing). Prints the §11.1 proof artifact — event
 * names and counts only, never a payload.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { eventRegistrySchema } from "../../packages/shared/src/event-registry-schema";
import { checkParity, type SourceFile } from "./lib/event-registry-checks";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** Product code: everything that ships, never tests or node_modules. */
const SOURCE_DIRS = [
  "client/src",
  "server",
  "apps",
  "packages",
  "shared",
  "api",
];

function collect(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    if (["node_modules", "dist", "__tests__", "__fixtures__"].includes(name))
      return [];
    const full = join(abs, name);
    const rel = relative(ROOT, full);
    if (statSync(full).isDirectory()) return collect(rel);
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) return [];
    if (/\.(test|spec)\.(ts|tsx|js)$/.test(name)) return [];
    return [rel];
  });
}

function loadSources(): SourceFile[] {
  return SOURCE_DIRS.flatMap(collect).map((path) => ({
    path,
    text: readFileSync(join(ROOT, path), "utf-8"),
  }));
}

function loadRegistry() {
  return eventRegistrySchema.parse(
    parse(
      readFileSync(join(ROOT, "infra/event-schema-registry.yaml"), "utf-8"),
    ),
  );
}

function generatedModuleIsCurrent(): boolean {
  const generated = join(
    ROOT,
    "server/lib/analytics/event-registry.generated.ts",
  );
  const before = existsSync(generated) ? readFileSync(generated, "utf-8") : "";
  execFileSync(
    "node",
    [join(ROOT, "scripts/build/generate-event-registry.mjs")],
    {
      cwd: ROOT,
      stdio: "pipe",
    },
  );
  const after = readFileSync(generated, "utf-8");
  if (before !== after) writeFileSync(generated, before);
  return before === after;
}

const registry = loadRegistry();
const sources = loadSources();
const report = checkParity(registry, sources);
const failures = [...report.failures];
if (!generatedModuleIsCurrent()) {
  failures.push(
    "server/lib/analytics/event-registry.generated.ts is stale — run pnpm run generate:event-registry",
  );
}

out("==> ci/event-schema-registry-parity");
out(`    sources scanned: ${sources.length}`);
out(
  `    code-emitted events: ${report.codeEmittedEvents.join(", ") || "(none)"}`,
);
out(`    registered (V1-active): ${report.registeredEvents.join(", ")}`);
out(
  `    proof: ${JSON.stringify({
    unregistered_events_detected: report.unregistered_events_detected,
    unredacted_property_count: report.unredacted_property_count,
    tier_distribution: report.tier_distribution,
  })}`,
);
if (sources.length < 100)
  failures.push(
    `only ${sources.length} source files scanned — the scan is not reaching the code`,
  );
if (report.codeEmittedEvents.length === 0)
  failures.push(
    "no emitEvent call site found — the scan is not reaching the code",
  );

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL: ${failure}\n`);
  process.exit(1);
}
out("    OK");
