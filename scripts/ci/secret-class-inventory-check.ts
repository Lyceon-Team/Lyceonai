/**
 * @spec  [Doc-06B §4.4]
 * @implemented 2026-09-03
 *
 * plain English: CI parity check for infra/secret-class-inventory.yaml.
 * Validates three invariants:
 *   (a) Every required:true manifest entry has ≥1 consumer file that exists
 *   (b) Every process.env.XXX read in server/apps code has a matching
 *       manifest entry (no undocumented env var reads)
 *   (c) Every canonical_owner value is well-formed (format + existence).
 *       This is structural only — it cannot verify that a cited section
 *       semantically owns the key. That is a human-review concern.
 *
 * expected outcome: exits 0 when all invariants hold, exits 1 with a
 * report of violations otherwise.
 *
 * Run: npx tsx scripts/ci/secret-class-inventory-check.ts
 *
 * Note: YAML parsing is handled by a minimal TypeScript parser tailored
 * to this manifest's structure. No Python or external YAML library required.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ──────────────────────────────────────────────────────────

type ManifestEntry = {
  id: string;
  runtime: string;
  required: boolean;
  consumer: string[];
  store: string;
  canonical_owner: string;
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
const SPEC_DIR = path.join(ROOT, "docs/Spec");

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
  // Platform-provided env vars (not application config)
  "VERCEL_ENV",
  // Legacy fallback names that alias to canonical entries in the manifest
  "DOCUMENT_AI_PROCESSOR_ID",
  "DOCUMENT_AI_LOCATION",
]);

// ── YAML parsing (minimal, tailored to this manifest's structure) ────

function parseYamlScalar(raw: string): string | boolean | number | null {
  const v = raw.trim();
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith('"')) {
    const end = v.indexOf('"', 1);
    return end > 0 ? v.slice(1, end) : v.slice(1);
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'");
    return end > 0 ? v.slice(1, end) : v.slice(1);
  }
  const commentIdx = v.indexOf(" #");
  const clean = commentIdx >= 0 ? v.slice(0, commentIdx).trim() : v;
  if (/^-?\d+$/.test(clean)) return parseInt(clean, 10);
  if (/^-?\d+\.\d+$/.test(clean)) return parseFloat(clean);
  return clean;
}

function parseManifestYaml(content: string): ManifestData {
  const lines = content.split("\n");
  const result: ManifestData = {
    schema_version: "",
    secret_classes: [],
    runtime_config: [],
    dead_config: [],
    supabase_config: [],
  };

  type Section =
    | "secret_classes"
    | "runtime_config"
    | "dead_config"
    | "supabase_config";
  let currentSection: Section | null = null;
  let entry: Record<string, unknown> | null = null;
  let listField: string | null = null;
  let listItems: string[] = [];
  let skipFolded = false;

  function flushList(): void {
    if (entry && listField) {
      entry[listField] = listItems;
      listField = null;
      listItems = [];
    }
  }

  function flushEntry(): void {
    flushList();
    if (entry && currentSection) {
      result[currentSection].push({
        id: String(entry.id ?? ""),
        runtime: String(entry.runtime ?? ""),
        required: entry.required === true,
        consumer: Array.isArray(entry.consumer)
          ? (entry.consumer as string[])
          : [],
        store: String(entry.store ?? ""),
        canonical_owner: String(entry.canonical_owner ?? ""),
      });
    }
    entry = null;
  }

  for (const line of lines) {
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (trimmed === "" || trimmed.startsWith("#")) {
      if (skipFolded && trimmed !== "" && indent <= 4) skipFolded = false;
      if (!skipFolded && trimmed !== "" && indent <= 4) {
        // fall through to process non-comment lines that end folded
      } else {
        continue;
      }
    }

    if (skipFolded) {
      if (indent > 4) continue;
      skipFolded = false;
    }

    if (indent === 0 && trimmed.includes(":")) {
      flushEntry();
      const ci = trimmed.indexOf(":");
      const key = trimmed.slice(0, ci).trim();
      const val = trimmed.slice(ci + 1).trim();
      if (key === "schema_version") {
        result.schema_version = String(parseYamlScalar(val) ?? "");
      } else if (key in result && key !== "schema_version") {
        currentSection = key as Section;
      }
      continue;
    }

    if (indent === 2 && trimmed.startsWith("- ")) {
      flushEntry();
      entry = {};
      const rest = trimmed.slice(2);
      if (rest.includes(":")) {
        const ci = rest.indexOf(":");
        const key = rest.slice(0, ci).trim();
        const val = rest.slice(ci + 1).trim();
        if (val === ">" || val === "|") {
          skipFolded = true;
        } else {
          entry[key] = parseYamlScalar(val);
        }
      }
      continue;
    }

    if (indent === 4 && entry && trimmed.includes(":")) {
      flushList();
      const ci = trimmed.indexOf(":");
      const key = trimmed.slice(0, ci).trim();
      const val = trimmed.slice(ci + 1).trim();
      if (val === ">" || val === "|") {
        skipFolded = true;
      } else if (val === "[]") {
        entry[key] = [];
      } else if (val === "") {
        listField = key;
        listItems = [];
      } else {
        entry[key] = parseYamlScalar(val);
      }
      continue;
    }

    if (indent >= 6 && listField && trimmed.startsWith("- ")) {
      const itemVal = trimmed.slice(2).trim();
      listItems.push(String(parseYamlScalar(itemVal) ?? ""));
      continue;
    }
  }

  flushEntry();
  return result;
}

function loadManifest(): ManifestData {
  const content = fs.readFileSync(MANIFEST_PATH, "utf-8");
  return parseManifestYaml(content);
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

/**
 * Check that a consumer citation `file:line` actually references the env var.
 * Reads a ±5 line window around the cited line and checks for the key name.
 * Citations without a line number fall back to file-existence only.
 * Citations with a parenthetical note like "(29+ locations)" skip line check.
 */
function consumerReferencesKey(
  consumer: string,
  keyId: string,
): { exists: boolean; references: boolean } {
  const noteMatch = consumer.match(/^(.+?) \(.+\)$/);
  const cleaned = noteMatch ? noteMatch[1] : consumer;
  const lineMatch = cleaned.match(/^(.+):(\d+)$/);

  if (!lineMatch) {
    const exists = fs.existsSync(path.join(ROOT, cleaned));
    return { exists, references: exists };
  }

  const [, filePath, lineNumStr] = lineMatch;
  const fullPath = path.join(ROOT, filePath);
  if (!fs.existsSync(fullPath)) return { exists: false, references: false };

  if (noteMatch) return { exists: true, references: true };

  const lineNum = parseInt(lineNumStr, 10);
  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");
  const start = Math.max(0, lineNum - 6);
  const end = Math.min(lines.length, lineNum + 5);
  const window = lines.slice(start, end).join("\n");
  return { exists: true, references: window.includes(keyId) };
}

function checkRequiredHaveConsumers(entries: ManifestEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of entries) {
    const consumers = entry.consumer ?? [];

    if (entry.required && consumers.length === 0) {
      violations.push(
        `REQUIRED_NO_CONSUMER: ${entry.id} (runtime=${entry.runtime}) is required:true but has no consumer`,
      );
      continue;
    }

    for (const c of consumers) {
      const result = consumerReferencesKey(c, entry.id);
      if (!result.exists) {
        violations.push(
          `CONSUMER_FILE_MISSING: ${entry.id} consumer "${c}" — file not found`,
        );
      } else if (!result.references) {
        violations.push(
          `CONSUMER_STALE: ${entry.id} consumer "${c}" — key not found in ±5 line window`,
        );
      }
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

// ── canonical_owner structural checks ─────────────────────────

/**
 * Accepted canonical_owner format: "Doc-XX §Y", "Doc-XX §Y.Z", "Doc-XX"
 * (whole document), or the literal "unspecified". XX is two digits
 * optionally followed by a letter suffix (e.g. 01, 01A, 03B, 06D).
 * Y and Z are integers.
 */
const CANONICAL_OWNER_RE = /^Doc-(\d{2}[A-Z]?)(?:\s+§(\d+(?:\.\d+)?))?$/;

function parseCanonicalOwner(
  value: string,
): { docId: string; section: string | null } | null {
  const m = CANONICAL_OWNER_RE.exec(value);
  if (!m) return null;
  return { docId: m[1], section: m[2] ?? null };
}

/**
 * Resolve a doc ID (e.g. "03C") to a file in docs/Spec/.
 *
 * Two naming conventions exist in the corpus:
 *   "Lyceon — Document NNX_ Title.md"   (01, 01A, 06B, 06D, …)
 *   "Doc NNX — Title.md"                (03B, 03C, 05A, …)
 *
 * When multiple files match (Doc-03C has a main spec and a runbook),
 * prefer the main spec: exclude files with "Runbook" or "Operations Runbook"
 * in the name, then prefer the highest version suffix (V3 > V1 > none).
 */
function resolveSpecFile(docId: string): string | null {
  if (!fs.existsSync(SPEC_DIR)) return null;

  const files = fs.readdirSync(SPEC_DIR);
  const idWithSpace = docId.replace(/^(\d{2})/, "$1");

  const candidates = files.filter((f) => {
    if (!f.endsWith(".md")) return false;
    const docPattern1 = `Document ${idWithSpace}`;
    const docPattern2 = `Doc ${idWithSpace} `;
    return (
      f.includes(docPattern1) ||
      (f.startsWith("Doc ") && f.includes(`${idWithSpace} `))
    );
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return path.join(SPEC_DIR, candidates[0]);

  const nonRunbook = candidates.filter(
    (f) => !f.includes("Runbook") && !f.includes("Test Matrix"),
  );
  const pool = nonRunbook.length > 0 ? nonRunbook : candidates;

  const versioned = pool.sort((a, b) => {
    const va = a.match(/V(\d+)/);
    const vb = b.match(/V(\d+)/);
    return (vb ? parseInt(vb[1], 10) : 0) - (va ? parseInt(va[1], 10) : 0);
  });

  return path.join(SPEC_DIR, versioned[0]);
}

/**
 * Check whether a section number exists as a heading in a spec file.
 *
 * Heading conventions in the spec corpus (two styles):
 *   ## **§N Title**       — with § prefix (Doc-01, Doc-03B top-level, Doc-03C)
 *   ## **N.M Title**      — without § prefix (Doc-06B, Doc-06D, subsections)
 * Both ## and ### levels are checked.
 *
 * For a citation "§N" (integer): accepts headings numbered N, N.0, N.1, …
 * For a citation "§N.M" (dotted): accepts that exact number or deeper (N.M.K).
 */
function sectionExistsInFile(filePath: string, sectionNum: string): boolean {
  const content = fs.readFileSync(filePath, "utf-8");
  const headingRe = /^#{2,3}\s+\*\*§?(\d+(?:\.\d+)*)\s/gm;

  let match;
  while ((match = headingRe.exec(content)) !== null) {
    const headingNum = match[1];
    if (headingNum === sectionNum) return true;
    if (headingNum.startsWith(sectionNum + ".")) return true;
  }
  return false;
}

function checkCanonicalOwners(entries: ManifestEntry[]): string[] {
  const violations: string[] = [];

  for (const entry of entries) {
    const owner = entry.canonical_owner;
    if (!owner) {
      violations.push(
        `OWNER_MISSING: ${entry.id} has no canonical_owner field`,
      );
      continue;
    }

    if (owner === "unspecified") continue;

    const parsed = parseCanonicalOwner(owner);
    if (!parsed) {
      violations.push(
        `OWNER_BAD_FORMAT: ${entry.id} canonical_owner "${owner}" does not match expected format (Doc-XX §Y or "unspecified")`,
      );
      continue;
    }

    const specFile = resolveSpecFile(parsed.docId);
    if (!specFile) {
      violations.push(
        `OWNER_DOC_NOT_FOUND: ${entry.id} canonical_owner "${owner}" — no spec file found for Doc-${parsed.docId}`,
      );
      continue;
    }

    if (parsed.section !== null) {
      if (!sectionExistsInFile(specFile, parsed.section)) {
        const fileName = path.basename(specFile);
        violations.push(
          `OWNER_SECTION_NOT_FOUND: ${entry.id} canonical_owner "${owner}" — §${parsed.section} not found in ${fileName}`,
        );
      }
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

  // Check 3: canonical_owner format + existence
  // eslint-disable-next-line no-console
  console.log(
    "secret-class-inventory-check: validating canonical_owner citations...",
  );
  const ownerViolations = checkCanonicalOwners(entries);
  violations.push(...ownerViolations);
  // eslint-disable-next-line no-console
  console.log(
    `  ${entries.length - ownerViolations.length} canonical_owner citations valid`,
  );

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
