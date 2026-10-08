#!/usr/bin/env node
/**
 * @spec [Codex re-audit of #1073 + #1108 + #1113 on cleanup @ 0f1d7afb, finding 4, ruled by Karl
 *        2026-10-06: "Delete or unexport every unused file and export in student-scope code …
 *        Add a deadcode:student script (knip scoped to those paths via the committed config) that
 *        exits 0, and run it as a blocking CI step."] | @implemented [2026-10-06]
 *
 * plain English: runs knip with the committed `knip.json` in production mode (shipped code only:
 * an export that only a test imports counts as unused) and fails if any unused file, export,
 * exported type or duplicate export falls inside the student-UI vertical's scope, listed in
 * `scripts/ci/deadcode-student.scope.json`. Everything outside the scope is other verticals'
 * backlog (student-UI register §8) and is ignored here.
 *
 * Usage:
 *   node scripts/ci/deadcode-student.mjs              # run knip, gate the scope
 *   node scripts/ci/deadcode-student.mjs --json f     # gate an existing knip JSON report
 *   node scripts/ci/deadcode-student.mjs --selftest   # prove the filter keeps and drops correctly
 *
 * Trade-offs and edge cases:
 * - knip itself reports the whole repo; the scope is applied to its JSON report here, because a
 *   knip `ignore` would also stop knip analysing those files and invent findings elsewhere.
 * - The scope's `exclude` list names test-support files (fixtures and harnesses that only tests
 *   import, which production mode cannot see a consumer for) and guardian-owned files inside the
 *   student directories. Each entry says why.
 * - knip exits 1 whenever it lists anything (it always does, for other verticals); that exit
 *   code is not the verdict. The verdict is the scoped count, and a report that cannot be read
 *   fails closed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KNIP = "knip@5.88.1";
const SCOPE_FILE = "scripts/ci/deadcode-student.scope.json";

/** Glob → RegExp for the scope list: `**` spans directories, `*` stays inside one. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (glob[i + 1] === "/") i += 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function makeInScope(scope) {
  const inc = scope.include.map(globToRegExp);
  const exc = scope.exclude.map((e) => globToRegExp(e.glob));
  return (file) => inc.some((r) => r.test(file)) && !exc.some((r) => r.test(file));
}

/** The scoped findings of a knip JSON report, one line each. */
export function scopedFindings(report, inScope) {
  if (!report || typeof report !== "object" || !Array.isArray(report.issues)) {
    throw new Error("knip report is not readable (no `issues` array)");
  }
  const out = [];
  for (const file of Array.isArray(report.files) ? report.files : []) {
    if (inScope(file)) out.push(`unused file      ${file}`);
  }
  for (const issue of report.issues) {
    if (!inScope(issue.file)) continue;
    for (const e of issue.exports ?? []) out.push(`unused export    ${issue.file}:${e.line} ${e.name}`);
    for (const e of issue.types ?? []) out.push(`unused type      ${issue.file}:${e.line} ${e.name}`);
    for (const group of issue.duplicates ?? []) {
      out.push(`duplicate export ${issue.file} ${group.map((d) => d.name).join(" = ")}`);
    }
  }
  return out.sort();
}

function selftest() {
  const scope = {
    include: ["client/src/components/student-ui/**", "client/src/pages/practice.tsx"],
    exclude: [{ glob: "**/*.fixture.ts", why: "test support" }],
  };
  const inScope = makeInScope(scope);
  const report = {
    files: ["client/src/components/student-ui/Dead.tsx", "client/src/lib/other.ts", "client/src/components/student-ui/a.fixture.ts"],
    issues: [
      { file: "client/src/components/student-ui/filter-bar/x.ts", exports: [{ name: "a", line: 1 }], types: [{ name: "T", line: 2 }], duplicates: [] },
      { file: "client/src/pages/practice.tsx", exports: [], types: [], duplicates: [[{ name: "A" }, { name: "default" }]] },
      { file: "client/src/pages/practice-old.tsx", exports: [{ name: "b", line: 3 }], types: [], duplicates: [] },
      { file: "server/x.ts", exports: [{ name: "c", line: 4 }], types: [], duplicates: [] },
    ],
  };
  const got = scopedFindings(report, inScope);
  const want = [
    "duplicate export client/src/pages/practice.tsx A = default",
    "unused export    client/src/components/student-ui/filter-bar/x.ts:1 a",
    "unused file      client/src/components/student-ui/Dead.tsx",
    "unused type      client/src/components/student-ui/filter-bar/x.ts:2 T",
  ];
  const ok = JSON.stringify(got) === JSON.stringify(want);
  let unreadable = false;
  try {
    scopedFindings({}, inScope);
  } catch {
    unreadable = true;
  }
  const empty = scopedFindings({ files: [], issues: [] }, inScope).length === 0;
  console.log(`${ok ? "ok  " : "FAIL"} keeps in-scope files, exports, types and duplicates; drops out-of-scope and excluded`);
  console.log(`${unreadable ? "ok  " : "FAIL"} an unreadable report throws (fails closed)`);
  console.log(`${empty ? "ok  " : "FAIL"} a clean report yields nothing`);
  if (!(ok && unreadable && empty)) {
    console.log(JSON.stringify(got, null, 2));
    process.exit(1);
  }
  console.log("DEADCODE:STUDENT SELF-TEST: PASS");
}

function main(argv) {
  if (argv.includes("--selftest")) return selftest();
  const scope = JSON.parse(readFileSync(SCOPE_FILE, "utf8"));
  const inScope = makeInScope(scope);
  let raw;
  const jsonAt = argv.indexOf("--json");
  if (jsonAt !== -1) {
    raw = readFileSync(argv[jsonAt + 1], "utf8");
  } else {
    try {
      raw = execFileSync(
        "pnpm",
        ["dlx", KNIP, "--config", "knip.json", "--no-progress", "--reporter", "json", "--production", "--include", "files,exports,types,duplicates"],
        { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
      );
    } catch (err) {
      // knip exits 1 whenever it lists anything; its stdout is still the report.
      raw = String(err.stdout ?? "");
    }
  }
  let findings;
  try {
    findings = scopedFindings(JSON.parse(raw), inScope);
  } catch (err) {
    console.error(`DEADCODE:STUDENT: FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(`DEADCODE:STUDENT (${KNIP}, production mode, scope ${SCOPE_FILE}: ${scope.include.length} include, ${scope.exclude.length} exclude)`);
  for (const line of findings) console.log(`  ${line}`);
  if (findings.length > 0) {
    console.error(`DEADCODE:STUDENT: FAIL — ${findings.length} unused file(s)/export(s)/type(s) in the student-UI scope`);
    process.exit(1);
  }
  console.log("DEADCODE:STUDENT: PASS — 0 unused files, exports, types or duplicate exports in the student-UI scope");
}

main(process.argv.slice(2));
