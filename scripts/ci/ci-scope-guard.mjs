/**
 * CI scope guard — a job skipped on documentation-only PRs must not read documentation.
 *
 * @spec [CI-minutes brief 2026-10-07: "no gate weakened"] | @implemented [2026-10-07]
 *
 * plain English: scripts/ci/ci-run-scope.sh lets a pull request into an integration branch skip
 * the jobs gated on `docs_only` when it changes only files under docs/ (not docs/Spec/) or
 * root-level *.md (docs/Spec/ and docs/compliance/ excepted). That is only sound while no gated job
 * reads those files. This guard reads ci.yml, finds every job whose `if:` names `docs_only`,
 * collects the repo files its steps invoke (scripts, SQL, test files and directories, and the
 * build's own code when a step runs `pnpm run build`), and fails if any of them names, in a string,
 * a docs/ path outside those two or a root-level Markdown file. Comments are ignored. It also fails if no
 * job is gated (a check over nothing passes for the wrong reason), and if the scope script's
 * inert set drifts from the one checked here.
 *
 * trade-off: it follows what the steps name, not every module a test imports. Server code reads
 * no docs at runtime (checked when this was written); a new reader inside an imported module is
 * not seen here, and is still caught by the full run every change gets on its way to `main`.
 *
 * Usage: node scripts/ci/ci-scope-guard.mjs [--selftest]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW = ".github/workflows/ci.yml";
const SCOPE_SCRIPT = "scripts/ci/ci-run-scope.sh";
// What `pnpm run build` executes beyond the files a step names: the prerender (which reads the
// claim inventory) and the build scripts.
const BUILD_INPUTS = ["client/src/prerender", "scripts/build", "vite.config.ts", "vite-plugin-legal-content.ts"];
// docs/ subtrees a gated job may read: the scope script never treats them as documentation-only.
const READ_DOCS = ["Spec", "compliance"];
const PATH_RE =
  /(?:^|[\s"'=(])((?:scripts|tests|supabase|database|client|server|packages|shared|apps|api)\/[A-Za-z0-9_./-]+)/g;

function out(line) {
  process.stdout.write(`${line}\n`);
}

/** Lines that are code, not comments (shell/SQL/YAML `#`/`--`, JS `//` and block-comment rows). */
function codeLines(text) {
  return text
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(#|--|\/\/|\*|\/\*)/.test(line));
}

/** A string literal in `line` naming documentation the scope script treats as inert. */
function inertDocReference(line, rootMarkdown) {
  for (const m of line.matchAll(/["'`]([^"'`]*)["'`]/g)) {
    const s = m[1] ?? "";
    const read = READ_DOCS.join("|");
    if (new RegExp(`(^|[^A-Za-z0-9_])docs/(?!(?:${read})(?:/|$|[^A-Za-z0-9_]))`).test(s) || /(^|[^A-Za-z0-9_])docs\/?$/.test(s)) return s;
    for (const md of rootMarkdown) if (new RegExp(`(^|[^A-Za-z0-9_./-])${md.replace(".", "\\.")}$`).test(s)) return s;
  }
  return null;
}

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) =>
    name === "node_modules" ? [] : filesUnder(join(path, name)),
  );
}

/** Findings for one workflow text; `read` and `list` are injectable for the self-test. */
export function analyze(workflowText, { read, list, rootMarkdown }) {
  const doc = parse(workflowText);
  const jobs = Object.entries(doc?.jobs ?? {});
  const gated = jobs.filter(([, job]) => String(job?.if ?? "").includes("docs_only"));
  const findings = [];
  for (const [name, job] of gated) {
    const runText = (job.steps ?? []).map((s) => `${s.run ?? ""}\n${JSON.stringify(s.with ?? {})}`).join("\n");
    const paths = new Set();
    for (const { line } of codeLines(runText)) for (const m of line.matchAll(PATH_RE)) paths.add(m[1].replace(/[.,]$/, ""));
    if (/pnpm (-s )?run build\b/.test(runText)) for (const p of BUILD_INPUTS) paths.add(p);
    for (const p of paths) {
      for (const file of list(p)) {
        const text = read(file);
        if (text === null) continue;
        for (const { line, n } of codeLines(text)) {
          const hit = inertDocReference(line, rootMarkdown);
          if (hit !== null) findings.push(`${name}: ${file}:${n} reads "${hit}"`);
        }
      }
    }
  }
  return { gated: gated.map(([n]) => n), findings };
}

function rootMarkdownFiles() {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f !== "" && !f.includes("/"));
}

const realIo = {
  // `list` only yields files that exist, so a read cannot miss.
  read: (f) => readFileSync(join(ROOT, f), "utf8"),
  list: (p) => filesUnder(join(ROOT, p)).map((f) => f.slice(ROOT.length + 1)),
};

function runGuard() {
  const rootMarkdown = rootMarkdownFiles();
  const { gated, findings } = analyze(readFileSync(join(ROOT, WORKFLOW), "utf8"), { ...realIo, rootMarkdown });
  const failures = [...findings];
  if (gated.length === 0) failures.push(`no job in ${WORKFLOW} is gated on docs_only: the check covers nothing`);
  // The inert set checked here must be the one the scope script applies.
  const scope = readFileSync(join(ROOT, SCOPE_SCRIPT), "utf8");
  const arms = [...READ_DOCS.map((d) => `docs/${d}/*) return 1`), "docs/*) return 0", "*/*) return 1", "*.md) return 0"];
  for (const arm of arms) {
    if (!scope.includes(arm)) failures.push(`${SCOPE_SCRIPT} no longer has the inert-set rule "${arm}"; update this guard with it`);
  }
  if (failures.length > 0) {
    out(`CI SCOPE GUARD FAILED (${failures.length}):`);
    for (const f of failures) out(`  - ${f}`);
    process.exit(1);
  }
  out(`CI SCOPE GUARD OK: ${gated.length} jobs skip on docs-only PRs (${gated.join(", ")}); none reads docs/ outside docs/Spec/ and docs/compliance/, or a root-level .md`);
}

function selftest() {
  const files = {
    "scripts/ci/reads-plan.sh": 'PLAN="$ROOT/docs/plans/x.md"\n',
    "scripts/ci/reads-spec.sh": 'FIX="$ROOT/docs/Spec/fixtures.json"\n',
    "scripts/ci/comment-only.sh": "# see docs/plans/x.md\necho ok\n",
    "scripts/ci/reads-readme.mjs": 'readFileSync("README.md")\n',
    "client/src/prerender": 'path.join(root, "docs/compliance/claim-inventory.md")\n',
    "scripts/build": 'path.join(root, "docs/plans/seo/x.md")\n',
  };
  const io = { read: (f) => files[f] ?? null, list: (p) => (p in files ? [p] : []), rootMarkdown: ["README.md"] };
  const wf = (ifExpr, script) =>
    `jobs:\n  j:\n    runs-on: ubuntu-latest\n    if: ${ifExpr}\n    steps:\n      - run: bash ${script}\n`;
  const cases = [
    ["(control) a gated job reading only docs/Spec stays green", wf("needs.changes.outputs.docs_only != 'true'", "scripts/ci/reads-spec.sh"), 0],
    ["(control) a docs path in a comment is not a read", wf("needs.changes.outputs.docs_only != 'true'", "scripts/ci/comment-only.sh"), 0],
    ["(control) an ungated job may read docs", wf("always()", "scripts/ci/reads-plan.sh"), 0],
    ["(A) a gated job reading docs/plans is named", wf("needs.changes.outputs.docs_only != 'true'", "scripts/ci/reads-plan.sh"), 1],
    ["(B) a gated job reading a root-level .md is named", wf("needs.changes.outputs.docs_only != 'true'", "scripts/ci/reads-readme.mjs"), 1],
    ["(D) a gated job running the build is checked through the build's own code", `jobs:\n  j:\n    if: needs.changes.outputs.docs_only != 'true'\n    steps:\n      - run: pnpm run build\n`, 1],
  ];
  let bad = 0;
  for (const [label, text, want] of cases) {
    const got = analyze(text, io).findings.length;
    const ok = want === 0 ? got === 0 : got >= want;
    out(`  ${ok ? "ok  " : "FAIL"} ${label} (findings: ${got})`);
    if (!ok) bad += 1;
  }
  const noGate = analyze(wf("always()", "scripts/ci/reads-spec.sh"), io).gated.length === 0;
  out(`  ${noGate ? "ok  " : "FAIL"} (C) a workflow with no gated job reports none (the real run fails on that)`);
  if (!noGate) bad += 1;
  if (bad > 0) {
    out("CI SCOPE GUARD SELFTEST: FAIL");
    process.exit(1);
  }
  out("CI SCOPE GUARD SELFTEST: PASS");
}

if (process.argv.includes("--selftest")) selftest();
else runGuard();
