/**
 * @spec  [Doc-06B §4.4]
 * @implemented 2026-09-03
 *
 * plain English: CI parity check for infra/secret-class-inventory.yaml.
 * Validates two invariants:
 *   (a) Every required:true manifest entry has ≥1 consumer file that exists
 *   (b) Every process.env.XXX read in server/apps code has a matching
 *       manifest entry (no undocumented env var reads)
 *
 * expected outcome: exits 0 when both invariants hold, exits 1 with a
 * report of violations otherwise.
 *
 * Run: npx tsx scripts/ci/secret-class-inventory-check.ts
 *
 * Note: Uses child_process to call python3 for YAML parsing since
 * js-yaml is not in the project's dependencies. No new deps required.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────

type ManifestEntry = {
  id: string;
  runtime: string;
  required: boolean;
  consumer: string[];
  store: string;
};

type ManifestData = {
  schema_version: string;
  secret_classes: ManifestEntry[];
  runtime_config: ManifestEntry[];
  dead_config: ManifestEntry[];
  supabase_config: ManifestEntry[];
};

// ── Constants ──────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "../..");
const MANIFEST_PATH = path.join(ROOT, "infra/secret-class-inventory.yaml");

/** Directories to scan for process.env reads */
const SCAN_DIRS = [
  path.join(ROOT, "server"),
  path.join(ROOT, "apps"),
  path.join(ROOT, "packages/shared/src"),
];

/** Files/dirs to skip during scanning */
const SKIP_PATTERNS = [
  /node_modules/,
  /\.test\./,
  /\.spec\./,
  /\.ci\./,
  /__tests__/,
  /tests\//,
  /\.d\.ts$/,
  /dist\//,
  /build\//,
  /coverage\//,
  /\/scripts\//, // one-off developer/backfill scripts, not runtime code
];

/** Env vars read in code that are not runtime config (test detection, etc.) */
const KNOWN_NON_CONFIG = new Set([
  "VITEST",
  "CI",
  "TEST",
  "JEST_WORKER_ID",
  "npm_lifecycle_event",
  "HOME",
  "PATH",
  "TERM",
  "HOSTNAME",
  "LANG",
  "SHELL",
  "USER",
  "PWD",
  "TZ",
  // Legacy fallback names that alias to canonical entries in the manifest
  "DOCUMENT_AI_PROCESSOR_ID",
  "DOCUMENT_AI_LOCATION",
]);

// ── YAML parsing (via python3 helper — no js-yaml dependency) ──────

function loadManifest(): ManifestData {
  const helperPath = path.join(ROOT, "scripts/ci/_yaml-to-json.py");
  const jsonStr = execSync(
    `python3 ${JSON.stringify(helperPath)} ${JSON.stringify(MANIFEST_PATH)}`,
    {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(jsonStr) as ManifestData;
}

// ── Helpers ────────────────────────────────────────────────────────

function allEntries(data: ManifestData): ManifestEntry[] {
  return [
    ...(data.secret_classes ?? []),
    ...(data.runtime_config ?? []),
    ...(data.dead_config ?? []),
    ...(data.supabase_config ?? []),
  ];
}

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (SKIP_PATTERNS.some((p) => p.test(full))) continue;
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Scan source files for process.env.XXX reads.
 * Returns a Map of env var name → set of file paths that read it.
 */
function scanEnvReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  const envAccessPattern =
    /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]|env\.([A-Z][A-Z0-9_]*)|env\[["']([A-Z][A-Z0-9_]*)["']\]/g;

  for (const dir of SCAN_DIRS) {
    for (const file of walkFiles(dir)) {
      const content = fs.readFileSync(file, "utf-8");
      let match;
      while ((match = envAccessPattern.exec(content)) !== null) {
        const name = match[1] ?? match[2] ?? match[3] ?? match[4];
        if (!name || KNOWN_NON_CONFIG.has(name)) continue;
        const relFile = path.relative(ROOT, file);
        if (!reads.has(name)) reads.set(name, new Set());
        reads.get(name)!.add(relFile);
      }
    }
  }

  return reads;
}

// ── Checks ─────────────────────────────────────────────────────────

function checkRequiredHaveConsumers(entries: ManifestEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of entries) {
    if (!entry.required) continue;
    const consumers = entry.consumer ?? [];
    if (consumers.length === 0) {
      violations.push(
        `REQUIRED_NO_CONSUMER: ${entry.id} (runtime=${entry.runtime}) is required:true but has no consumer`,
      );
      continue;
    }
    // Verify at least one consumer file exists
    const anyExists = consumers.some((c) => {
      const filePath = c.replace(/:\d+$/, "").replace(/ \(.+\)$/, "");
      return fs.existsSync(path.join(ROOT, filePath));
    });
    if (!anyExists) {
      violations.push(
        `REQUIRED_MISSING_FILE: ${entry.id} (runtime=${entry.runtime}) consumer files not found: ${consumers.join(", ")}`,
      );
    }
  }
  return violations;
}

function checkCodeReadsInManifest(
  entries: ManifestEntry[],
  codeReads: Map<string, Set<string>>,
): string[] {
  const violations: string[] = [];
  const manifestIds = new Set(entries.map((e) => e.id));

  for (const [envVar, files] of codeReads) {
    if (!manifestIds.has(envVar)) {
      const fileList = [...files].slice(0, 3).join(", ");
      const more = files.size > 3 ? ` (+${files.size - 3} more)` : "";
      violations.push(
        `UNDOCUMENTED_READ: ${envVar} read in ${fileList}${more} but absent from manifest`,
      );
    }
  }
  return violations;
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  // eslint-disable-next-line no-console
  console.log("secret-class-inventory-check: loading manifest...");
  const data = loadManifest();
  const entries = allEntries(data);
  // eslint-disable-next-line no-console
  console.log(`  ${entries.length} entries loaded`);

  // eslint-disable-next-line no-console
  console.log("secret-class-inventory-check: scanning source for env reads...");
  const codeReads = scanEnvReads();
  // eslint-disable-next-line no-console
  console.log(`  ${codeReads.size} distinct env vars found in source`);

  const violations: string[] = [];

  // Check 1: required entries have consumers
  const reqViolations = checkRequiredHaveConsumers(entries);
  violations.push(...reqViolations);

  // Check 2: code reads are documented in manifest
  const undocumented = checkCodeReadsInManifest(entries, codeReads);
  violations.push(...undocumented);

  // Report
  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log("\n✅ secret-class-inventory-check PASSED");
    // eslint-disable-next-line no-console
    console.log(
      `  ${entries.filter((e) => e.required).length} required entries verified`,
    );
    // eslint-disable-next-line no-console
    console.log(`  ${codeReads.size} code env reads covered by manifest`);
    process.exit(0);
  } else {
    // eslint-disable-next-line no-console
    console.error(
      `\n❌ secret-class-inventory-check FAILED (${violations.length} violations)\n`,
    );
    for (const v of violations) {
      // eslint-disable-next-line no-console
      console.error(`  • ${v}`);
    }
    process.exit(1);
  }
}

main();
