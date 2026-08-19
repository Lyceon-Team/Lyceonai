#!/usr/bin/env node
/**
 * @spec [lyceon-coding-standards §14; owner ruling 2026-08-19] | @implemented [2026-08-19]
 *
 * ACCEPT-LIST GATE — an accepted failure must name a person and a date.
 *
 * plain English: `ci/known-gaps.yaml` is the only place a check is allowed to
 * fail without failing CI. This gate is what makes that permission finite.
 *
 * It enforces two things, and both are structural rather than conventional:
 *   1. an entry missing owner, expires, reason, re_arm or command is REJECTED —
 *      you cannot add a suppression without saying who owns it and when it dies
 *   2. an entry whose `expires` is in the past turns CI RED — the suppression
 *      has to be renewed by a human decision, or the check goes back to blocking
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
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LIST = process.env.KNOWN_GAPS_FILE
  ? resolve(process.env.KNOWN_GAPS_FILE)
  : resolve(ROOT, "ci/known-gaps.yaml");

const REQUIRED = ["id", "owner", "expires", "reason", "re_arm", "command"];

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
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^entries:\s*$/.test(line)) continue;

    const item = line.match(/^  - ([a-z_]+):\s*(.*)$/);
    if (item) {
      if (cur) entries.push(cur);
      cur = {};
      folding = null;
      const [, k, v] = item;
      if (v === ">") folding = (cur[k] = { __fold: [] });
      else cur[k] = v;
      continue;
    }
    const kv = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (kv && cur) {
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
    throw new Error(`known-gaps.yaml: unparseable line -> ${line}`);
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

if (failures.length) {
  console.error("\nKNOWN-GAPS GATE: FAIL\n");
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log("\nKNOWN-GAPS GATE: PASS");
