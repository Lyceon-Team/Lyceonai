#!/usr/bin/env node
/**
 * Lane-A CI gate: no hardcoded constants.
 *
 * DB is the source of truth (Doc 00 §6; Doc 02B INV-02B-15; Doc 05 constants governance):
 * every formula-class and operational constant is read from its DB table
 * (`mastery_constants` / `kpi_constants` / `*_runtime_config`) at execution — NEVER as a
 * literal in a PL/pgSQL function body or an app-code constant definition.
 *
 * TWO checks (both must pass):
 *  (1) SQL function bodies — the moat. No formula/operational VALUE may appear as a literal
 *      inside any CREATE FUNCTION ... $$ ... $$ in supabase/migrations/*.sql. (Formula/scoring
 *      RPCs read constants from their tables.) Seed migrations are NOT function bodies → allowed.
 *  (2) App code — NAME-based (low false-positive). No constant KEYWORD may be assigned a numeric
 *      literal in service/engine code (e.g. `const sourceWeightTest = 0.5`). Bare numbers in UI
 *      (2.5rem, scale 1.3) are ignored — only keyword=literal is flagged.
 *
 * Legacy exclusions: files slated for retirement by the genesis rebuild (GAP-MA-06,
 * `apps/api/src/services/mastery-constants.ts` etc.) are excluded; their hardcoding is the
 * tracked gap the rebuild closes, not a regression this guard should block on.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

// (1) SQL-function-body value denylist (formula + distinctive operational)
const SQL_DENY = [
  ["0.50","src weight test"],["0.30","src weight practice"],["0.20","src weight review / L1"],
  ["0.79","diff weight easy"],["1.20","diff weight hard"],
  ["0.40","mastery L2"],["0.60","mastery L3"],["0.80","mastery L4"],
  ["2.5","SM-2 ease init/max"],["1.3","SM-2 ease floor"],
  ["3840","RW exam secs"],["4200","Math exam secs"],["2500","tutor weekly cap"],["10000","tutor monthly cap"],
];

// (2) App-code NAME-based: a constant keyword assigned a numeric literal
const APP_NAME_RE =
  /\b(source_?weight\w*|ease_?factor\w*|difficulty_?weight\w*|mastery_?level\w*|position_?half_?life|min_?events_?for_?mastery|daily_?quota\w*|sm2_\w+|recency_?window\w*|graduation_?repetition\w*)\b\s*[:=]\s*-?\d+(\.\d+)?/i;

const APP_DIRS = ["apps/api/src/services", "server/services", "server/routes", "packages"];
const LEGACY = [
  /apps\/api\/src\/services\/mastery-constants\.ts$/, // GAP-MA-06 (retired WS-3)
  /canonical-runtime-views\.ts$/, /calendar\.ts$/, /\/mastery\.ts$/, // GAP-MA-06 set
];
const SKIP = [/\.test\./, /\/tests?\//, /\/fixtures?\//, /scripts\/ci\//];

function* walk(dir) {
  let entries; try { entries = readdirSync(path.join(ROOT, dir)); } catch { return; }
  for (const e of entries) {
    const rel = path.join(dir, e);
    if (e === "node_modules" || e === "dist") continue;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) yield* walk(rel);
    else if (/\.(sql|ts|tsx|js|mjs)$/.test(e)) yield rel;
  }
}
const fnBodies = (sql) => { const o=[]; const re=/\$\$([\s\S]*?)\$\$/g; let m; while((m=re.exec(sql)))o.push(m[1]); return o; };

const violations = [];
// (1) SQL function bodies
for (const rel of walk("supabase/migrations")) {
  if (/_ws2_config_constants\.sql$|mastery_constants|kpi_constants/.test(rel)) continue; // seeds
  const src = readFileSync(path.join(ROOT, rel), "utf8");
  for (const body of fnBodies(src))
    for (const [val,label] of SQL_DENY) {
      const re = new RegExp(`(?<![\\d.])${val.replace(".","\\.")}(?![\\d])`);
      if (re.test(body)) violations.push(`${rel} [fn body]: hardcoded ${val} (${label}) — read from its constants table`);
    }
}
// (2) App code, name-based
for (const dir of APP_DIRS) for (const rel of walk(dir)) {
  if (SKIP.some(r=>r.test(rel)) || LEGACY.some(r=>r.test(rel))) continue;
  const src = readFileSync(path.join(ROOT, rel), "utf8");
  src.split("\n").forEach((line,i) => {
    if (APP_NAME_RE.test(line)) violations.push(`${rel}:${i+1}: constant assigned a literal — read from its *_runtime_config/constants table: ${line.trim().slice(0,90)}`);
  });
}

if (violations.length) {
  console.error("NO-HARDCODED-CONSTANTS: FAIL");
  for (const v of [...new Set(violations)]) console.error("  " + v);
  process.exit(1);
}
console.log("NO-HARDCODED-CONSTANTS: PASS");
