/**
 * No audit_logs writer puts an email address into `changes`.
 *
 * @spec [Doc-01 V8 §5.1 D01:242 ("Email addresses in `changes` JSONB → domain-only retention after
 *       90 days"); Doc-01A D01A:453, :544; owner ruling 2026-10-05 C-03 (Q15: instead of a sweep that
 *       would never find anything, a CI check that no audit writer puts an email into `changes`)] |
 *       @implemented [2026-10-05]
 *
 * plain English: the 90-day "email → domain-only" rule needs no sweep while no writer stores an
 * email in `changes`. This keeps it that way. It reads the REAL sources — the last definition of
 * every SQL function in supabase/migrations that inserts into audit_logs (or calls
 * guardian_link_audit, whose fourth argument becomes `changes`), and every
 * `.from("audit_logs").insert(` in server/ and apps/ — extracts the value written to `changes`,
 * and fails if it names an email (an `email` key or column, or an `@` literal).
 *
 * Presence first: the known writers must be found, so an extractor that matched nothing cannot
 * pass. Plants: an email added to one SQL writer and to one TS writer each turn the check red.
 *
 * trade-offs: static, not behavioural. It reads what each writer passes as `changes`; it does not
 * execute them. A writer it cannot parse fails the test (fail closed) rather than being skipped.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase/migrations");

/** Split on top-level commas (outside parentheses and single-quoted strings). */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "'" && s[i + 1] === "'") {
        cur += s[++i];
      } else if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The text inside the parenthesis that opens at `open` (exclusive), quote-aware. */
function balanced(s: string, open: number): string {
  let depth = 0;
  let inStr = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'" && s[i + 1] === "'") i++;
      else if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return s.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced parenthesis at ${open}`);
}

/** name -> body of the LAST migration that defines `public.<name>(`. */
function lastFunctionBodies(
  files: { name: string; text: string }[],
): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.text)) !== null) {
      const fname = m[1];
      if (!fname) continue;
      const rest = f.text.slice(m.index);
      const tag = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(rest);
      if (!tag || tag[1] === undefined) continue;
      const start = tag.index + tag[0].length;
      const end = rest.indexOf(tag[1], start);
      if (end < 0)
        throw new Error(`unterminated body for ${fname} in ${f.name}`);
      bodies.set(fname, rest.slice(start, end));
    }
  }
  return bodies;
}

type Finding = { writer: string; changes: string };

/** Every `changes` value an SQL body writes into audit_logs. */
function sqlChanges(fname: string, body: string): Finding[] {
  const found: Finding[] = [];
  const ins = /INSERT\s+INTO\s+public\.audit_logs\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = ins.exec(body)) !== null) {
    const colsOpen = m.index + m[0].length - 1;
    const cols = splitTopLevel(balanced(body, colsOpen)).map((c) =>
      c.toLowerCase(),
    );
    const idx = cols.indexOf("changes");
    if (idx < 0) continue; // no changes column written
    const after = body.slice(colsOpen + balanced(body, colsOpen).length + 2);
    let values: string[];
    const v = /^\s*VALUES\s*\(/i.exec(after);
    if (v) {
      values = splitTopLevel(balanced(after, v[0].length - 1));
    } else {
      const sel = /^\s*SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(after);
      if (!sel || sel[1] === undefined)
        throw new Error(`${fname}: unparsable audit_logs insert`);
      values = splitTopLevel(sel[1]);
    }
    const val = values[idx];
    if (val === undefined) throw new Error(`${fname}: no value for changes`);
    found.push({ writer: fname, changes: val });
  }
  if (fname !== "guardian_link_audit") {
    const call = /guardian_link_audit\s*\(/gi;
    while ((m = call.exec(body)) !== null) {
      const args = splitTopLevel(balanced(body, m.index + m[0].length - 1));
      const val = args[3];
      if (val === undefined)
        throw new Error(`${fname}: guardian_link_audit call without changes`);
      found.push({ writer: `${fname} -> guardian_link_audit`, changes: val });
    }
  }
  return found;
}

/** Every `changes` value a TS file writes via `.from("audit_logs").insert({...})`. */
function tsChanges(file: string, text: string): Finding[] {
  const found: Finding[] = [];
  const re = /\.from\(\s*["'`]audit_logs["'`]\s*\)\s*\.insert\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const braceAt = m.index + m[0].length - 1;
    // reuse the paren scanner on a braced literal by scanning braces
    let depth = 0;
    let end = -1;
    for (let i = braceAt; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) throw new Error(`${file}: unbalanced audit_logs insert`);
    const props = splitTopLevel(text.slice(braceAt + 1, end));
    const ch = props.find((p) => /^changes\s*:/.test(p));
    if (ch)
      found.push({
        writer: file,
        changes: ch.replace(/^changes\s*:/, "").trim(),
      });
    else found.push({ writer: file, changes: "<not written>" });
  }
  return found;
}

const EMAIL = /email|@/i;

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      e.name === "node_modules" ||
      e.name === "__tests__" ||
      e.name === "dist"
    )
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
}

function realSql(): { name: string; text: string }[] {
  return fs
    .readdirSync(MIG_DIR)
    .filter((n) => n.endsWith(".sql"))
    .map((n) => ({
      name: n,
      text: fs.readFileSync(path.join(MIG_DIR, n), "utf8"),
    }));
}

function realTs(): { file: string; text: string }[] {
  const files: string[] = [];
  walk(path.join(ROOT, "server"), files);
  walk(path.join(ROOT, "apps"), files);
  return files.map((f) => ({
    file: path.relative(ROOT, f),
    text: fs.readFileSync(f, "utf8"),
  }));
}

function allFindings(
  sql: { name: string; text: string }[],
  ts: { file: string; text: string }[],
): Finding[] {
  const out: Finding[] = [];
  for (const [fname, body] of lastFunctionBodies(sql))
    out.push(...sqlChanges(fname, body));
  for (const { file, text } of ts) out.push(...tsChanges(file, text));
  return out;
}

describe("audit_logs writers put no email into `changes` (C-03, Q15)", () => {
  const sql = realSql();
  const ts = realTs();

  it("presence: the known SQL and TS writers are all found", () => {
    const writers = new Set(allFindings(sql, ts).map((f) => f.writer));
    for (const w of [
      "request_account_deletion",
      "restore_account_deletion",
      "cancel_account_deletion",
      "complete_deletion_log",
      "create_guardian_link_audited -> guardian_link_audit",
      "accept_guardian_link_audited -> guardian_link_audit",
      "revoke_guardian_link_audited -> guardian_link_audit",
      "create_active_guardian_link_audited -> guardian_link_audit",
      path.join("server", "routes", "guardian-routes.ts"),
      path.join("server", "services", "retention-sweep.ts"),
      path.join("server", "services", "email-reconsent-audit.ts"),
      path.join("server", "services", "subject-access-audit.ts"),
    ]) {
      expect(writers, w).toContain(w);
    }
  });

  it("no writer's `changes` names an email", () => {
    const offenders = allFindings(sql, ts).filter((f) => EMAIL.test(f.changes));
    expect(offenders).toEqual([]);
  });

  it("plant (SQL): an email added to one writer's changes turns the check red", () => {
    const file = "20261013000000_guardian_revoke_party_check.sql";
    const planted = sql.map((f) =>
      f.name === file
        ? {
            ...f,
            text: f.text.replace(
              "jsonb_build_object('from', 'active'",
              "jsonb_build_object('email', v_email, 'from', 'active'",
            ),
          }
        : f,
    );
    expect(planted.find((f) => f.name === file)?.text).not.toBe(
      sql.find((f) => f.name === file)?.text,
    );
    const offenders = allFindings(planted, ts).filter((f) =>
      EMAIL.test(f.changes),
    );
    expect(offenders.map((o) => o.writer)).toEqual([
      "revoke_guardian_link_audited -> guardian_link_audit",
    ]);
  });

  it("plant (TS): an email added to one writer's changes turns the check red", () => {
    const file = path.join("server", "routes", "guardian-routes.ts");
    const planted = ts.map((f) =>
      f.file === file
        ? {
            ...f,
            text: f.text.replace(
              "changes: null,",
              "changes: { email: args.email },",
            ),
          }
        : f,
    );
    expect(planted.find((f) => f.file === file)?.text).not.toBe(
      ts.find((f) => f.file === file)?.text,
    );
    const offenders = allFindings(sql, planted).filter((f) =>
      EMAIL.test(f.changes),
    );
    expect(offenders.map((o) => o.writer)).toEqual([file]);
  });
});
