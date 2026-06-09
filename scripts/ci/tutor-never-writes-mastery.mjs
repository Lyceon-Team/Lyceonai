#!/usr/bin/env node
/**
 * Lane-A CI gate: tutor never writes mastery (C-7 / Doc 05A INV-4 / Doc 03 INV-03-01).
 *
 * LISA is instructional-only. No tutor/LISA code path may write the mastery tables or
 * invoke the mastery write boundary. Tutor-triggered retries flow through the practice/
 * review engines, which emit the canonical event with source_family='practice'|'review'
 * (never 'tutor'); `used_tutor` is telemetry-only, never formula-facing.
 *
 * Fails the build if any tutor code path references a mastery write.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

// tutor/LISA code paths (directories + filename patterns)
const TUTOR_DIRS = ["apps/tutor", "apps/api/src/tutor", "server/routes", "apps", "server"];
const TUTOR_FILE = /(tutor|lisa)/i;

// forbidden mastery-write references inside tutor paths
const FORBIDDEN = [
  /apply_mastery_event/i,
  /apply_learning_event_to_mastery/i,        // legacy/superseded name, also forbidden
  /\.from\(\s*['"`]student_(skill|domain|cluster)_mastery['"`]\s*\)\s*\.(insert|update|upsert|delete)/i,
  /\.from\(\s*['"`]mastery_events['"`]\s*\)\s*\.(insert|update|upsert|delete)/i,
  /(INSERT|UPDATE|DELETE)\s+(INTO\s+)?(public\.)?(student_(skill|domain|cluster)_mastery|mastery_event)/i,
];

function* walk(dir) {
  let entries;
  try { entries = readdirSync(path.join(ROOT, dir)); } catch { return; }
  for (const e of entries) {
    const rel = path.join(dir, e);
    if (e === "node_modules" || e === "dist") continue;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) yield* walk(rel);
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(e)) yield rel;
  }
}

const seen = new Set();
const violations = [];
for (const dir of TUTOR_DIRS) {
  if (!existsSync(path.join(ROOT, dir))) continue;
  for (const rel of walk(dir)) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!TUTOR_FILE.test(rel)) continue;          // only tutor/LISA files
    if (/\.test\./.test(rel)) continue;
    const src = readFileSync(path.join(ROOT, rel), "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(src)) violations.push(`${rel}: tutor path references a mastery write (${re})`);
    }
  }
}

if (violations.length) {
  console.error("TUTOR-NEVER-WRITES-MASTERY: FAIL (C-7 / INV-03-01)");
  for (const v of [...new Set(violations)]) console.error("  " + v);
  process.exit(1);
}
console.log("TUTOR-NEVER-WRITES-MASTERY: PASS (no tutor/LISA path writes mastery)");
