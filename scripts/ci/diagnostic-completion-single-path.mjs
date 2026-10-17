#!/usr/bin/env node
/**
 * Diagnostic completion — ONE path. Fails the build if any code other than the canonical
 * completion path can write status = 'completed' to practice_sessions.
 *
 * @spec [SCL-236; owner ruling 2026-10-17, binding constraint 3 ("complete_diagnostic_session is
 *        the only code that can mark a diagnostic completed ... Add a check that fails CI if any
 *        other code writes status = 'completed' for a diagnostic session")] | @implemented [2026-10-17]
 *
 * plain English, two scans:
 *   (TS)  Every `status: "completed"` in server/, apps/ and packages/ source (tests excluded) that
 *         sits within WINDOW lines after a `practice_sessions` reference is a write to that table.
 *         The only one allowed is inside practice-canonical.ts's completeSession, and that body
 *         must (a) send diagnostics to the complete_diagnostic_session RPC and (b) guard its own
 *         update with `.neq("mode", "diagnostic")`. Comment lines are ignored.
 *   (SQL) Every `UPDATE public.practice_sessions ... status = 'completed'` statement in
 *         supabase/migrations is attributed to its enclosing CREATE FUNCTION. Allowed:
 *         complete_diagnostic_session, and qotd_student_answer (which completes only the 'qotd'
 *         session it has just inserted). Anything else — a new function, or a bare data
 *         statement — fails.
 * A guard is only proven by failing: scripts/ci/diagnostic-projection.mutations.sh plants a
 * second writer in each language and requires this script to go red.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const WINDOW = 20;
const TS_DIRS = ["server", "apps", "packages"];
const SKIP = [
  /node_modules/,
  /\.test\.tsx?$/,
  /\/tests?\//,
  /__tests__/,
  /\.generated\./,
  /\/dist\//,
];
const CANON_FILE = "server/routes/practice-canonical.ts";
const SQL_ALLOWED = new Set([
  "complete_diagnostic_session",
  "qotd_student_answer",
]);

const violations = [];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (SKIP.some((re) => re.test(p))) continue;
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(ent.name)) out.push(p);
  }
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** [start, end) line range of `async function completeSession(` in the canonical file. */
function completeSessionRange(lines) {
  const start = lines.findIndex((l) =>
    /^async function completeSession\(/.test(l),
  );
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^}\s*$/.test(lines[i])) {
      end = i + 1;
      break;
    }
  }
  return [start, end];
}

// ---------------------------------------------------------------- (TS)
const files = [];
for (const d of TS_DIRS) walk(path.join(ROOT, d), files);
let canonSeen = false;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const range = rel === CANON_FILE ? completeSessionRange(lines) : null;
  if (rel === CANON_FILE) {
    if (!range) {
      violations.push(
        `${rel}: completeSession not found — the canonical completion path is gone`,
      );
      continue;
    }
    canonSeen = true;
    const body = lines.slice(range[0], range[1]).join("\n");
    if (!/rpc\(\s*"complete_diagnostic_session"/.test(body)) {
      violations.push(
        `${rel}: completeSession no longer sends diagnostics to complete_diagnostic_session`,
      );
    }
    if (!/\.neq\("mode",\s*"diagnostic"\)/.test(body)) {
      violations.push(
        `${rel}: completeSession's non-diagnostic update lost its .neq("mode", "diagnostic") guard`,
      );
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (!/status:\s*["']completed["']/.test(lines[i]) || isComment(lines[i]))
      continue;
    const from = Math.max(0, i - WINDOW);
    const nearSessions = lines
      .slice(from, i + 1)
      .some((l) => /["'`]practice_sessions["'`]/.test(l) && !isComment(l));
    // practice-canonical's updateSessionLifecycle writes practice_sessions; review-canonical has
    // its own function of the same name for review_sessions, which this rule must not read as one.
    const inLifecycleCall =
      rel === CANON_FILE &&
      lines
        .slice(from, i + 1)
        .some((l) => /updateSessionLifecycle\(/.test(l) && !isComment(l));
    if (!nearSessions && !inLifecycleCall) continue;
    const inCanon = range && i >= range[0] && i < range[1];
    if (!inCanon) {
      violations.push(
        `${rel}:${i + 1}: writes status "completed" to practice_sessions outside completeSession`,
      );
    }
  }
}
if (!canonSeen)
  violations.push(`${CANON_FILE}: not scanned (moved or deleted?)`);

// ---------------------------------------------------------------- (SQL)
const migDir = path.join(ROOT, "supabase", "migrations");
for (const f of fs
  .readdirSync(migDir)
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  const sql = fs.readFileSync(path.join(migDir, f), "utf8");
  const stmt = /UPDATE\s+public\.practice_sessions\b[^;]*;/gis;
  for (let m = stmt.exec(sql); m; m = stmt.exec(sql)) {
    if (!/status\s*=\s*'completed'/i.test(m[0])) continue;
    const before = sql.slice(0, m.index);
    const fnMatches = [
      ...before.matchAll(
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(/gi,
      ),
    ];
    const lastFn = fnMatches.length ? fnMatches[fnMatches.length - 1] : null;
    // Inside that function only if no `$$;`/`$func$;`-style terminator closed it before us.
    let enclosing = null;
    if (lastFn) {
      const between = sql.slice(lastFn.index, m.index);
      const tag = /AS\s+(\$[A-Za-z_]*\$)/i.exec(between);
      const closed = tag
        ? between.indexOf(tag[1], tag.index + tag[1].length + 2) >= 0
        : true;
      if (!closed) enclosing = lastFn[1];
    }
    const line = before.split("\n").length;
    if (!enclosing || !SQL_ALLOWED.has(enclosing)) {
      violations.push(
        `supabase/migrations/${f}:${line}: UPDATE practice_sessions SET status='completed' in ${enclosing ?? "a bare statement"} — only complete_diagnostic_session (and qotd_student_answer for its own qotd session) may`,
      );
    }
  }
}

if (violations.length) {
  console.error("DIAGNOSTIC-COMPLETION-SINGLE-PATH: FAIL");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log(
  `DIAGNOSTIC-COMPLETION-SINGLE-PATH: PASS (${files.length} source files; practice_sessions completion only in completeSession -> complete_diagnostic_session; SQL writers: ${[...SQL_ALLOWED].join(", ")})`,
);
