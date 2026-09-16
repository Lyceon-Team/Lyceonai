#!/usr/bin/env node
/**
 * @spec [LYCEON legal versioning Phase 2 §4, §5; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: two rules that together make date drift impossible rather than
 * merely discouraged.
 *
 *   BODY PURITY  no `en.md` carries a version string or a document-header date.
 *                Both live in meta.yml and are injected at render, so a body
 *                that reintroduces one creates a second place to be wrong.
 *
 *   COPY FIDELITY  when the build output exists, every copied `en.md` under
 *                  dist/public/legal is byte-identical to its source. That is
 *                  what keeps the deploy copy an artifact rather than a fork,
 *                  and it is the condition the owner attached to permitting a
 *                  build-output copy at all.
 *
 * expected outcome: exit 0 when every body is clean and every copy matches.
 * Non-zero, naming file and line, otherwise.
 *
 * trade-offs:
 *  - The refused patterns are DOCUMENT-HEADER shapes only, not dates in
 *    general. These contracts legitimately cite dates — "applies from 19 June
 *    2026" in the Auto-Renewal Notice §7.7, directive years, statute dates — and
 *    a gate that flagged those would be untrue to the documents and would get
 *    worked around. It refuses the shapes a header actually takes.
 *  - Copy fidelity is skipped, loudly, when dist/public/legal is absent, so the
 *    gate is useful before a build without silently claiming to have checked.
 *
 * edge cases:
 *  - Only `en.md` bodies are scanned. meta.yml is SUPPOSED to contain a version
 *    and a date; that is the whole point.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const LEGAL = path.join(REPO_ROOT, "legal");
const BUILD_COPY = path.join(REPO_ROOT, "dist", "public", "legal");

/** Shapes a document header takes. Not "any date". */
const FORBIDDEN = [
  { re: /^\*\*Version\s.*\*\*\s*$/m, what: "a version line" },
  { re: /\bLast Updated\b/i, what: '"Last Updated"' },
  { re: /\*\*Effective Date:\*\*/i, what: "an Effective Date header" },
  { re: /^\s*version:\s*["']?\d/m, what: "a meta.yml version key" },
  {
    re: /^\s*effective_date:\s*\d{4}-\d{2}-\d{2}/m,
    what: "a meta.yml date key",
  },
];

let failed = false;

console.log("legal body purity gate — no version or date inside any body\n");

if (!fs.existsSync(LEGAL)) {
  console.error("✗ legal/ does not exist");
  process.exit(1);
}

/** @returns {string[]} every published body, repo-relative */
function bodies(root) {
  /** @type {string[]} */
  const found = [];
  for (const slug of fs.readdirSync(root, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const slugDir = path.join(root, slug.name);
    for (const version of fs.readdirSync(slugDir, { withFileTypes: true })) {
      if (!version.isDirectory()) continue;
      const body = path.join(slugDir, version.name, "en.md");
      if (fs.existsSync(body)) found.push(body);
    }
  }
  return found.sort();
}

const sourceBodies = bodies(LEGAL);
if (sourceBodies.length === 0) {
  console.error("✗ legal/ contains no en.md bodies — nothing to check");
  process.exit(1);
}

for (const abs of sourceBodies) {
  const rel = path.relative(REPO_ROOT, abs);
  const text = fs.readFileSync(abs, "utf-8");
  let clean = true;

  for (const { re, what } of FORBIDDEN) {
    const match = re.exec(text);
    if (!match) continue;
    failed = true;
    clean = false;
    const line = text.slice(0, match.index).split("\n").length;
    console.error(`✗ ${rel}:${line} contains ${what}`);
    console.error(`    ${match[0].trim().slice(0, 90)}`);
  }
  if (clean) console.log(`✓ ${rel}`);
}

console.log("");
if (!fs.existsSync(BUILD_COPY)) {
  console.log(
    "· dist/public/legal is absent — copy fidelity not checked on this run",
  );
  console.log("  Run `pnpm run build` first to check it.");
} else {
  const digest = (p) =>
    createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  for (const abs of sourceBodies) {
    const rel = path.relative(LEGAL, abs);
    const copy = path.join(BUILD_COPY, rel);
    if (!fs.existsSync(copy)) {
      failed = true;
      console.error(
        `✗ dist/public/legal/${rel} is MISSING from the build output`,
      );
      continue;
    }
    if (digest(abs) !== digest(copy)) {
      failed = true;
      console.error(`✗ dist/public/legal/${rel} does NOT match its source`);
      console.error(
        "    The deploy copy has forked from legal/. It is meant to",
      );
      console.error(
        "    be a regenerated artifact, never an editable second copy.",
      );
      continue;
    }
    console.log(`✓ dist/public/legal/${rel} — byte-identical to source`);
  }

  // The generated slug index. It is the one thing the hub cannot derive from
  // legal/ itself — static hosting has no directory listing — so if it drifts
  // from the directory, a published document silently stops being listed. That
  // is invisible from the document's own side, which is exactly why it is
  // checked here rather than trusted.
  const indexPath = path.join(BUILD_COPY, "index.json");
  if (!fs.existsSync(indexPath)) {
    failed = true;
    console.error("✗ dist/public/legal/index.json is MISSING from the build output");
    console.error("    The hub enumerates it; without it the page lists nothing.");
  } else {
    const onDisk = fs
      .readdirSync(LEGAL, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => fs.existsSync(path.join(LEGAL, n, "manifest.json")))
      .sort();
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      parsed = null;
    }
    const listed =
      parsed && typeof parsed === "object" && Array.isArray(parsed.slugs)
        ? [...parsed.slugs].sort()
        : null;

    if (listed === null) {
      failed = true;
      console.error("✗ dist/public/legal/index.json is not {\"slugs\": [...]}");
    } else if (listed.join("\u0000") !== onDisk.join("\u0000")) {
      failed = true;
      console.error("✗ dist/public/legal/index.json does NOT match legal/");
      const missing = onDisk.filter((s) => !listed.includes(s));
      const extra = listed.filter((s) => !onDisk.includes(s));
      if (missing.length) console.error(`    absent from the index: ${missing.join(", ")}`);
      if (extra.length) console.error(`    listed but not on disk: ${extra.join(", ")}`);
    } else {
      console.log(`✓ dist/public/legal/index.json — lists all ${listed.length} slugs`);
    }
  }
}

console.log("");
if (failed) {
  console.error("LEGAL BODY PURITY GATE: FAIL");
  console.error("");
  console.error(
    "  A version or a date belongs in meta.yml, never in en.md — it is",
  );
  console.error(
    "  injected at render. Two places to write it is two places to be",
  );
  console.error(
    "  wrong, which is the drift this structure exists to prevent.",
  );
  process.exit(1);
}
console.log("LEGAL BODY PURITY GATE: PASS");
