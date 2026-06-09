#!/usr/bin/env node
/**
 * Lane-A CI gate: no hardcoded constants.
 *
 * DB is the source of truth (Doc 00 §6; Doc 02B INV-02B-15; Doc 05 constants governance):
 * every formula-class and operational constant is read from its DB table
 * (`mastery_constants` / `kpi_constants` / `*_runtime_config`) at execution — NEVER as a
 * literal in a PL/pgSQL function body or an app-code constant definition.
 *
 * THREE checks (all must pass):
 *  (1) FORMULA function bodies — the moat, ALLOWLIST / fail-closed (Codex F-001). Inside the
 *      named mastery formula functions, NO numeric literal is permitted except an explicit,
 *      documented STRUCTURAL allowlist (the algebraic form: 0.5 half-life base, 1.0 accuracy
 *      ceiling, 100.0 percent scale, difficulty enum 1/2/3, level codes 0..4, zero/identity
 *      guards). Every TUNABLE constant (half-life, min-events, weights, difficulty weights,
 *      level boundaries, rounding decimals, clamp bounds) MUST be read from mastery_constants.
 *      A NEW unguarded literal therefore fails CLOSED — proven by guards-selftest.sh planting
 *      EVERY locked formula constant (30, 5, 0.50, …, 1.0, 2, 4, 6) and asserting red.
 *  (2) Non-formula SQL function bodies — VALUE denylist (belt-and-suspenders) for operational +
 *      formula values leaking into any other function body. Seed migrations are not bodies.
 *  (3) App code — NAME-based (low false-positive): no constant KEYWORD assigned a numeric
 *      literal in service/engine code. Bare numbers in UI (2.5rem) are ignored.
 *
 * Legacy exclusions: files slated for retirement by the genesis rebuild (GAP-MA-06) are excluded.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

// ── (1) FORMULA functions: the moat. Strict allowlist applies ONLY to these bodies. ──
// New formula/scoring functions (05B KPI/domain refreshers, 05C projections) MUST be added here.
const FORMULA_FUNCTIONS = new Set([
  "compute_mastery_for_entity",
  "lookup_mastery_level",
  "canonicalize_mastery_constants",
  "canonicalize_mastery_constants_serialized",
  "recompute_skill_mastery",
]);

// Allowed STRUCTURAL numeric contexts inside a formula body. Each entry is the algebraic form
// of the formula (Doc 05A §6), NOT a tunable parameter. Matches are masked out before the
// residual-literal scan; anything left is a hardcoded constant that must come from the table.
const STRUCTURAL_ALLOW = [
  [/POWER\(\s*0\.5\s*,/gi,                      "half-life decay base (the 'half' in half-life)"],
  [/LEAST\(\s*1\.0\s*,/gi,                      "per-source accuracy probability ceiling [0,1]"],
  [/\b100\.0\b/g,                               "percent scaling (pct = score × 100)"],
  [/pos\s*-\s*1\b/gi,                           "0-based position offset (pos-1)"],
  [/WHEN\s+1\s+THEN/gi,                         "difficulty enum code: easy=1"],
  [/WHEN\s+2\s+THEN/gi,                         "difficulty enum code: medium=2"],
  [/WHEN\s+3\s+THEN/gi,                         "difficulty enum code: hard=3"],
  [/\bIN\s*\(\s*1\s*,\s*2\s*,\s*3\s*\)/gi,      "difficulty domain {1,2,3}"],
  [/\b[01234]::smallint\b/gi,                   "mastery level codes 0..4"],
  [/,\s*0\s*\)/g,                               "zero guard in NULLIF/COALESCE(..., 0)"],
  [/ELSE\s+0\b/gi,                              "zero default in renormalization CASE"],
  [/[<>]=?\s*0\b/g,                             "comparison/guard against zero (bad-data counters)"],
  [/::integer\s*,\s*2\s*\)/g,                   "Doc 05A §6 defensive fallback for ROUND_MASTERY_PCT_DECIMALS"],
  [/LIMIT\s+1\b/gi,                             "single most-recent row"],
  [/event_count_total\s*=\s*0\b/gi,             "event-count reset on empty history"],
];

// Locked formula constants the self-test must each turn the guard RED for (proves coverage).
// (Exported informally for guards-selftest.sh; kept in sync by review.)
const LOCKED_FORMULA_CONSTANTS = [
  "30", "5", "0.50", "0.30", "0.20", "0.79", "1.0", "1.20",
  "0.19", "0.39", "0.40", "0.59", "0.60", "0.80", "0.0", "4", "2", "6",
];

// ── (2) Non-formula SQL bodies: value denylist (operational + formula) ──
const SQL_DENY = [
  ["0.50","src weight test"],["0.30","src weight practice"],["0.20","src weight review / L1"],
  ["0.79","diff weight easy"],["1.20","diff weight hard"],
  ["0.40","mastery L2"],["0.60","mastery L3"],["0.80","mastery L4"],
  ["2.5","SM-2 ease init/max"],["1.3","SM-2 ease floor"],
  ["3840","RW exam secs"],["4200","Math exam secs"],["2500","tutor weekly cap"],["10000","tutor monthly cap"],
];

// ── (3) App-code NAME-based: a constant keyword assigned a numeric literal ──
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

// Strip comments + string literals so only code-path numerics remain.
function stripNonCode(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, " ")     // block comments
    .replace(/--[^\n]*/g, " ")             // line comments
    .replace(/E?'(?:''|[^'])*'/g, " ");    // string / escape-string literals
}

// Pull every CREATE FUNCTION name + its first $$...$$ body, in file order.
function namedFunctionBodies(sql) {
  const out = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(/gi;
  const marks = [];
  let m;
  while ((m = re.exec(sql))) marks.push({ name: m[1], idx: m.index });
  for (let i = 0; i < marks.length; i++) {
    const seg = sql.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : sql.length);
    const body = seg.match(/\$\$([\s\S]*?)\$\$/);
    if (body) out.push({ name: marks[i].name, body: body[1] });
  }
  return out;
}

// Residual numeric literals in a formula body after masking the structural allowlist.
function formulaResidual(body) {
  let s = stripNonCode(body);
  for (const [re] of STRUCTURAL_ALLOW) s = s.replace(re, " ");
  return s.match(/(?<![A-Za-z_])\d+(?:\.\d+)?/g) || [];
}

const violations = [];
for (const rel of walk("supabase/migrations")) {
  if (/_ws2_config_constants\.sql$|mastery_constants|kpi_constants/.test(rel)) continue; // seeds
  const src = readFileSync(path.join(ROOT, rel), "utf8");
  for (const { name, body } of namedFunctionBodies(src)) {
    if (FORMULA_FUNCTIONS.has(name)) {
      // (1) strict allowlist — fail closed on any non-structural literal.
      const residual = formulaResidual(body);
      if (residual.length)
        violations.push(`${rel} [formula ${name}]: non-structural literal(s) ${[...new Set(residual)].join(", ")} — read from mastery_constants (allowlist: structural form only)`);
    } else {
      // (2) value denylist on non-formula bodies.
      const code = stripNonCode(body);
      for (const [val, label] of SQL_DENY) {
        const re = new RegExp(`(?<![\\d.])${val.replace(".", "\\.")}(?![\\d])`);
        if (re.test(code)) violations.push(`${rel} [fn ${name}]: hardcoded ${val} (${label}) — read from its constants table`);
      }
    }
  }
}
// (3) App code, name-based
for (const dir of APP_DIRS) for (const rel of walk(dir)) {
  if (SKIP.some(r => r.test(rel)) || LEGACY.some(r => r.test(rel))) continue;
  const src = readFileSync(path.join(ROOT, rel), "utf8");
  src.split("\n").forEach((line, i) => {
    if (APP_NAME_RE.test(line)) violations.push(`${rel}:${i+1}: constant assigned a literal — read from its *_runtime_config/constants table: ${line.trim().slice(0,90)}`);
  });
}

if (violations.length) {
  console.error("NO-HARDCODED-CONSTANTS: FAIL");
  for (const v of [...new Set(violations)]) console.error("  " + v);
  process.exit(1);
}
console.log(`NO-HARDCODED-CONSTANTS: PASS (formula allowlist over ${FORMULA_FUNCTIONS.size} functions; ${LOCKED_FORMULA_CONSTANTS.length} locked constants self-tested)`);
