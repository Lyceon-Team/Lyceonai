#!/usr/bin/env node
/**
 * @spec [lyceon-coding-standards §14; owner ruling 2026-08-19] | @implemented [2026-08-19]
 *
 * ACCEPT-LIST GATE — an accepted failure must name a person and a date.
 *
 * plain English: `ci/known-gaps.yaml` is the only place a check is allowed to
 * fail without failing CI. This gate is what makes that permission finite.
 *
 * It enforces three things, and all of them are structural rather than
 * conventional:
 *   1. an entry missing any of the ten required fields is REJECTED — you cannot
 *      add a suppression without saying who owns it, when it dies, how big it is
 *      allowed to be, how that size is measured and where the number came from
 *   2. an entry whose `expires` is in the past turns CI RED — the suppression
 *      has to be renewed by a human decision, or the check goes back to blocking
 *   3. an entry whose measured finding count exceeds `findings_ceiling` plus its
 *      stated `tolerance` turns CI RED — a gap is accepted at a size, not at any
 *      size
 *
 * WHY IT IS SHAPED THIS WAY
 *   The mechanism it replaces was three `continue-on-error: true` steps with no
 *   owner, no expiry and no re-arm criterion. One of them described its own
 *   backlog as "2 real type errors"; the real number was 41. A suppression
 *   nobody has to renew does not decay gracefully — it decays into a false
 *   description of the repo that everyone still believes.
 *
 * The gate runs BLOCKING. The accepted checks run non-blocking. So a check can
 * fail; the permission for it to fail cannot be open-ended or undocumented.
 *
 * DETERMINISM: "now" comes from KNOWN_GAPS_NOW when set (ISO date), else the
 * system clock. The override exists so this gate's OWN tests can stage an
 * expired entry without depending on the wall clock — see
 * scripts/ci/known-gaps-gate.self-test.sh.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LIST = process.env.KNOWN_GAPS_FILE
  ? resolve(process.env.KNOWN_GAPS_FILE)
  : resolve(ROOT, "ci/known-gaps.yaml");

const REQUIRED = [
  "id",
  "owner",
  "expires",
  "reason",
  "re_arm",
  "command",
  "count_command",
  "findings_ceiling",
  "tolerance",
  "ceiling_source",
];

/**
 * WHO MEASURES (owner ruling 2026-08-19). The CI runner's reading is the
 * authoritative one; a reading taken anywhere else is advisory.
 *
 * A ceiling that fires or passes depending on which machine measured last gets
 * loosened until it stops firing, and then it is decoration. So the count check
 * is FATAL here and ADVISORY elsewhere — one authoritative reading, everything
 * else informational. Schema and expiry checks are fatal everywhere; they do not
 * measure anything and cannot disagree between environments.
 */
const AUTHORITATIVE = Boolean(process.env.CI);

/**
 * Minimal YAML reader for exactly the shape this file uses: a top-level
 * `entries:` sequence of maps whose values are scalars or `>` folded blocks.
 * A dependency is not worth it for one file, and a hand parser that only
 * accepts the documented shape fails loudly on anything else — which is the
 * behaviour we want from a gate.
 */
function parseEntries(text) {
  const lines = text.split("\n");
  const entries = [];
  let cur = null;
  let folding = null;
  let lineNo = 0;
  for (const raw of lines) {
    lineNo += 1;
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^entries:\s*$/.test(line)) continue;

    const item = line.match(/^  - ([a-z_]+):\s*(.*)$/);
    if (item) {
      const [, k, v] = item;
      // The opener MUST be `- id:`. Allowing any key to open an entry is what
      // let a block lose its id and vanish: the `- ` line disappears, the
      // remaining fields become orphans, and orphans used to be skipped.
      if (k !== "id") {
        throw new Error(
          `known-gaps.yaml:${lineNo}: an entry must begin with "- id:", found "- ${k}:".\n` +
            `  Every accepted failure is addressed by its id; a block that opens with anything\n` +
            `  else cannot be referred to, and previously parsed as no entry at all.`,
        );
      }
      if (cur) entries.push(cur);
      cur = {};
      folding = null;
      if (v === ">") folding = (cur[k] = { __fold: [] });
      else cur[k] = v;
      continue;
    }
    const kv = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (kv) {
      // An indented field with no open entry is a PARSE ERROR, not a line to
      // skip. This is the fail-open Codex found (CI-GATING-001): drop the
      // `- id:` line and every following field became an orphan, the parser
      // returned zero entries, and a loop over zero entries reports zero
      // violations. Validation that iterates over parsed results cannot detect
      // a parse failure — zero entries and zero problems look identical.
      if (!cur) {
        throw new Error(
          `known-gaps.yaml:${lineNo}: field "${kv[1]}" appears before any "- id:" opener.\n` +
            `  This is a malformed block, not an empty file. Refusing to parse rather than\n` +
            `  silently dropping the entry it belongs to.`,
        );
      }
      const [, k, v] = kv;
      if (v === ">") folding = (cur[k] = { __fold: [] });
      else {
        folding = null;
        cur[k] = v;
      }
      continue;
    }
    if (folding && /^\s{6,}\S/.test(line)) {
      folding.__fold.push(line.trim());
      continue;
    }
    throw new Error(`known-gaps.yaml:${lineNo}: unparseable line -> ${line}`);
  }
  if (cur) entries.push(cur);
  for (const e of entries) {
    for (const k of Object.keys(e)) {
      if (e[k] && typeof e[k] === "object" && Array.isArray(e[k].__fold)) {
        e[k] = e[k].__fold.join(" ");
      }
    }
  }
  return entries;
}

const now = process.env.KNOWN_GAPS_NOW
  ? new Date(`${process.env.KNOWN_GAPS_NOW}T00:00:00Z`)
  : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`FAIL: KNOWN_GAPS_NOW is not a date: ${process.env.KNOWN_GAPS_NOW}`);
  process.exit(1);
}

let text;
try {
  text = readFileSync(LIST, "utf8");
} catch (err) {
  console.error(`FAIL: cannot read ${LIST} — ${err.message}`);
  process.exit(1);
}

let entries;
try {
  entries = parseEntries(text);
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}

/**
 * SECOND HALF of the CI-GATING-001 fix, and the one that does not depend on the
 * parser being right. Count the `- id:` openers in the raw text and require the
 * parser to have produced exactly that many entries.
 *
 * The parser now refuses malformed blocks, so this should be unreachable. It is
 * here because the defect class is "validation that iterates over parsed results
 * cannot detect a parse failure" — a count taken from the SOURCE rather than
 * from the parse is the only check that survives a future parser bug. Zero
 * entries and zero violations must never again be indistinguishable.
 */
const declaredBlocks = (text.match(/^ {2}- id:/gm) ?? []).length;
if (entries.length !== declaredBlocks) {
  console.error(
    `FAIL: the file contains ${declaredBlocks} "- id:" opener(s) but the parser produced ` +
      `${entries.length} entr(y|ies).\n` +
      `      An entry was dropped between the text and the parse. Refusing to validate a\n` +
      `      set that does not match the file.`,
  );
  process.exit(1);
}
if (declaredBlocks === 0) {
  console.error(
    `FAIL: ${LIST} declares no entries.\n` +
      `      An empty accept-list is not a pass — it is indistinguishable from a file that\n` +
      `      failed to parse. Delete the file and the gate step together, or keep an entry.`,
  );
  process.exit(1);
}

const failures = [];
const seen = new Set();

for (const [i, e] of entries.entries()) {
  const label = e.id ?? `entry #${i + 1}`;

  const missing = REQUIRED.filter((k) => !e[k] || String(e[k]).trim() === "");
  if (missing.length) {
    failures.push(
      `[schema] ${label}: missing ${missing.join(", ")}.\n` +
        `          An accepted failure must name an owner and a date. If you cannot,\n` +
        `          it is not an accepted gap — it is an unreported failure.`,
    );
    continue;
  }

  if (seen.has(e.id)) failures.push(`[schema] duplicate id: ${e.id}`);
  seen.add(e.id);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires)) {
    failures.push(`[schema] ${label}: expires must be YYYY-MM-DD, got "${e.expires}"`);
    continue;
  }
  const expires = new Date(`${e.expires}T00:00:00Z`);
  if (Number.isNaN(expires.getTime())) {
    failures.push(`[schema] ${label}: expires is not a real date: ${e.expires}`);
    continue;
  }
  if (expires < now) {
    const days = Math.floor((now - expires) / 86400000);
    failures.push(
      `[expired] ${label}: expired ${e.expires} (${days} day(s) ago), owner ${e.owner}.\n` +
        `          Fix it, or renew the entry with a new date and a reason the old one lapsed.\n` +
        `          Re-arm criterion on record: ${String(e.re_arm).slice(0, 120)}`,
    );
  }
}

console.log(`known-gaps: ${entries.length} accepted entr(y|ies), evaluated against ${now.toISOString().slice(0, 10)}`);
for (const e of entries) {
  if (e.id && e.expires) console.log(`  ${e.id.padEnd(24)} owner=${e.owner ?? "?"}  expires=${e.expires}`);
}

/**
 * CEILING CHECK (CI-GATING-002). A suppression may be accepted AT A SIZE. It may
 * not silently grow.
 *
 * The gate used to validate metadata and expiry and never look at the check's
 * actual output, so an accepted gap could expand without limit while still
 * reading as accepted. That is precisely how "2 real type errors" became 41
 * without anyone noticing.
 *
 * WHY A CEILING AND NOT AN EQUALITY, and where the number comes from.
 *
 *   An earlier revision of this comment claimed the JSON and stylish formatters
 *   count differently — 2390 vs 2399 from one run. That was WRONG and is
 *   withdrawn. Measured on this tree: `sum(messages[])` from --format json is
 *   2399, `errorCount + warningCount` is 2399, and the stylish summary line is
 *   "2399 problems". Same run, same number, three ways.
 *
 *   The real cause of the 9-count spread was two different TREES, not two
 *   environments: origin/cleanup measures 2390, this branch measures 2399, and
 *   the delta is 3 no-console + 6 no-undef in THIS FILE — added by the diff that
 *   introduced this very check. The ratchet caught its own author.
 *
 *   The ceiling stays a MAXIMUM rather than an equality because a count that
 *   must be exact goes red on any innocent change in either direction, which
 *   trains people to edit the number instead of reading it. `tolerance` is what
 *   absorbs genuine environment spread — and it is 0 here, because there is no
 *   environment spread to absorb.
 *
 * WHERE THE TOLERANCE LIVES. On the entry, never in this file. A tolerance
 * widened in the gate is invisible to anyone reviewing the accept-list, which is
 * the only place a reader looks to find out what has been accepted and at what
 * size. Self-test G12 stages exactly that mutation and proves G8 catches it.
 *
 * Skipped when KNOWN_GAPS_SKIP_COUNTS is set, which is how the schema-only self
 * -test cases avoid running a real toolchain.
 */
const advisories = [];
const measurements = [];

if (!failures.length && !process.env.KNOWN_GAPS_SKIP_COUNTS) {
  for (const e of entries) {
    let raw;
    try {
      raw = execSync(e.count_command, {
        cwd: ROOT,
        encoding: "utf8",
        shell: "/bin/bash",
        maxBuffer: 64 * 1024 * 1024,
      }).trim();
    } catch (err) {
      // A non-zero exit is expected — these commands wrap failing checks. What
      // matters is the number they print on stdout.
      raw = String(err.stdout ?? "").trim();
    }
    const actual = Number(raw.split("\n").pop());
    const ceiling = Number(e.findings_ceiling);
    const tolerance = Number(e.tolerance);

    if (!Number.isFinite(actual)) {
      failures.push(
        `[count] ${e.id}: count_command did not print an integer.\n` +
          `          command : ${e.count_command}\n` +
          `          got     : ${JSON.stringify(raw.slice(-120))}\n` +
          `          A ceiling that cannot be measured is not a ceiling.`,
      );
      continue;
    }
    if (!Number.isFinite(ceiling)) {
      failures.push(`[count] ${e.id}: findings_ceiling is not a number: ${e.findings_ceiling}`);
      continue;
    }
    // A tolerance must be a stated non-negative integer. Anything else — a blank,
    // a word, a negative — is a tolerance nobody wrote down, which is exactly what
    // becomes the new floor.
    if (!Number.isInteger(tolerance) || tolerance < 0) {
      failures.push(
        `[count] ${e.id}: tolerance must be a non-negative integer, got "${e.tolerance}".\n` +
          `          State 0 if the measurement is deterministic. A tolerance that is not\n` +
          `          written down becomes the new floor.`,
      );
      continue;
    }
    const limit = ceiling + tolerance;

    // A count of zero for a check that is on the accept-list is not good news —
    // it is almost always a broken count_command silently reading as "under the
    // ceiling". That is the same fail-open shape as CI-GATING-001, and it bit
    // this very gate during development: a mangled sed returned 0 and passed.
    // If a gap really has reached zero, the entry is finished and belongs
    // deleted, not accepted.
    if (actual === 0) {
      failures.push(
        `[count] ${e.id}: count_command reported 0 finding(s).\n` +
          `          command : ${e.count_command}\n` +
          `          Either the check now passes — in which case DELETE this entry and drop\n` +
          `          continue-on-error — or the count_command is broken and has been reading\n` +
          `          as "under ceiling" without measuring anything.`,
      );
      continue;
    }

    const stated = tolerance > 0 ? `ceiling ${ceiling} + tolerance ${tolerance} = ${limit}` : `ceiling ${ceiling}, tolerance 0`;
    measurements.push(`${e.id.padEnd(24)} ${actual} finding(s), ${stated}`);

    if (actual > limit) {
      const msg =
        `[count] ${e.id}: ${actual} finding(s) against ${stated} — the accepted gap GREW by ` +
        `${actual - limit}.\n` +
        `          Owner ${e.owner}. Either fix the new findings, or raise the ceiling\n` +
        `          deliberately and say why. An accepted failure may sit at a size; it may\n` +
        `          not expand quietly.\n` +
        `          Ceiling on record was measured on: ${e.ceiling_source}`;
      // FATAL in CI, ADVISORY anywhere else. The CI runner's reading is the
      // authoritative one; a local reading that disagrees is information, not a
      // verdict. Without this split the same commit passes on one machine and
      // fails on another, and the ceiling gets raised until it stops firing.
      if (AUTHORITATIVE) failures.push(msg);
      else advisories.push(msg);
    }
  }
}

for (const m of measurements) console.log(`  ${m}`);

if (advisories.length) {
  console.log(
    `\nADVISORY — this is not the authoritative measurement.\n` +
      `  CI is where the ceiling is decided (CI=1 makes these fatal). A local reading can\n` +
      `  differ because the tree differs, and a local tree is not what merges.\n`,
  );
  for (const a of advisories) console.log(`  ${a}\n`);
}

// Record what THIS runner measured, so the authoritative number is on the run
// itself rather than only in a file someone updated by hand.
if (process.env.GITHUB_STEP_SUMMARY && measurements.length) {
  try {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### known-gaps measurements (authoritative)\n\n` +
        measurements.map((m) => `- \`${m}\``).join("\n") +
        `\n`,
    );
  } catch (err) {
    console.error(`WARN: could not write the step summary — ${err.message}`);
  }
}

if (failures.length) {
  console.error("\nKNOWN-GAPS GATE: FAIL\n");
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log("\nKNOWN-GAPS GATE: PASS");
