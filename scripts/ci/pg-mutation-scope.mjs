/**
 * pg-mutations scope — which planted-defect groups a full-tier run must include.
 *
 * @spec [CI scope ruling (Karl, 2026-11-04): the media and marketing checks "only trigger" when
 *       a change can affect them, scoped "to the right files ... whatever industry standard is",
 *       not as a blanket on every pull request into main; owner decisions 2026-10-07 items 2-3
 *       (fail open)] | @implemented [2026-11-04]
 *
 * plain English: every pull request into `main` ran every `pg-mutations` group, so a billing
 * change waited on the worked-example video harness. Now the groups in SCOPED_GROUPS run only
 * when the change touches a file they depend on; every other group still always runs.
 *
 * A group's dependencies are COMPUTED from the tree being tested, never hand-listed, so they
 * cannot drift:
 *   - entries: the scripts its steps run (read from ci-full.yml), the vitest setup files, and
 *     the shared inputs every group has (ALWAYS: manifests, lockfile, configs, this workflow,
 *     scripts/ci/lib/, every migration);
 *   - from every TypeScript/JavaScript file reached, its imports (TypeScript's own resolver);
 *   - from harness scripts, everything under tests/, the vitest config and CLI scripts under
 *     scripts/ (not from library code or migrations, whose comments name half the repository),
 *     every repository path they name in
 *     a string: an existing file, or a directory (its whole subtree).
 * What static reading cannot see (a path built in pieces at run time) is caught by the trace
 * check: `check-trace` takes an strace of the group's tests and fails on any repository file
 * they read outside the computed set. Each scoped group runs it first, so the scope proves
 * itself every time the group runs (scripts/ci/pg-mutation-scope-trace.sh).
 *
 * It fails OPEN: no changed-file list means every group runs.
 *
 * Usage:
 *   node scripts/ci/pg-mutation-scope.mjs groups [changed-files.txt]   -> groups=["...",...]
 *   node scripts/ci/pg-mutation-scope.mjs closure <group>               -> one path per line
 *   node scripts/ci/pg-mutation-scope.mjs tests <group>                 -> the tests it runs
 *   node scripts/ci/pg-mutation-scope.mjs check-trace <group> <strace>  -> exit 1 on a miss
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW = ".github/workflows/ci-full.yml";

/** Every pg-mutations group, in matrix order. Each workflow step names exactly one. */
export const ALL_GROUPS = [
  "deletion",
  "qotd",
  "review-marketing",
  "calendar-migrations",
  "worked-examples",
  "qotd-breakdown",
];

/** The groups that run only when the change touches their dependencies. */
export const SCOPED_GROUPS = ["worked-examples", "qotd-breakdown"];

/** Inputs every group has: a change here runs every scoped group. Directories end in "/". */
export const ALWAYS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".nvmrc",
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.setup.ts",
  "postcss.config.js",
  "packages/shared/package.json",
  "apps/api/package.json",
  "packages/shared/tsconfig.json",
  WORKFLOW,
  ".github/actions/",
  "scripts/ci/lib/",
  "scripts/ci/pg-mutation-scope.mjs",
  "scripts/ci/pg-mutation-scope-trace.sh",
  "supabase/migrations/",
];

// Repository paths named in strings: a known top-level directory, or a root dotfile.
const PATH_RE =
  /(?:^|[\s"'`=(,[])((?:scripts|tests|supabase|infra|shared|server|packages|client|video-kit|content|apps|database|\.github)\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]|\.gitignore|\.gitattributes)/g;

/** Files whose path strings are followed: harnesses, tests, and CLI scripts. */
function followsLiterals(file) {
  if (file.startsWith("supabase/")) return false;
  if (/\.(sh|bash)$/.test(file)) return true;
  if (file.startsWith("tests/") && /\.(ts|tsx|mts|js|mjs)$/.test(file))
    return true;
  if (/^vitest\.(config|setup)\.ts$/.test(file)) return true;
  return file.startsWith("scripts/") && /\.(ts|mts|mjs|js|py)$/.test(file);
}

function stepGroup(step) {
  const m = /^matrix\.group == '([a-z-]+)'$/.exec(step.if ?? "");
  return m ? m[1] : null;
}

/** The scripts a group's steps run, read from ci-full.yml. */
export function groupEntries(group, root = ROOT) {
  const wf = parse(readFileSync(join(root, WORKFLOW), "utf8"));
  const steps = wf.jobs["pg-mutations"].steps ?? [];
  const out = [];
  for (const s of steps) {
    if (stepGroup(s) !== group || !s.run) continue;
    for (const m of s.run.matchAll(PATH_RE)) out.push(m[1]);
  }
  return out;
}

let tsOptions = null;
function compilerOptions(root) {
  if (tsOptions) return tsOptions;
  const read = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, root);
  tsOptions = { ...parsed.options, allowJs: true, resolveJsonModule: true };
  return tsOptions;
}

/**
 * The group's dependencies: a sorted list of repository files, and of directories (ending "/")
 * whose whole subtree counts.
 */
export function closure(group, root = ROOT) {
  const files = new Set();
  const dirs = new Set();
  const queue = [];
  // `leaf`: include the file but follow nothing in it. A test file named in a string by anything
  // but the group's own harness is never run by the group (only the harness decides which tests
  // run), so its imports are not the group's dependencies.
  const add = (raw, leaf = false) => {
    const p = normalize(raw).replace(/\/+$/, "");
    if (p === "" || p === "." || p.startsWith("..")) return;
    const abs = join(root, p);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      dirs.add(`${p}/`);
      return;
    }
    if (files.has(p)) return;
    files.add(p);
    if (!leaf) queue.push(p);
  };
  const entries = new Set();
  for (const a of ALWAYS) {
    if (a.endsWith("/")) dirs.add(a);
    else add(a);
  }
  for (const e of groupEntries(group, root)) {
    entries.add(normalize(e));
    add(e);
  }
  const opts = compilerOptions(root);
  while (queue.length > 0) {
    const f = queue.shift();
    const text = readFileSync(join(root, f), "utf8");
    if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f)) {
      for (const imp of ts.preProcessFile(text, true, true).importedFiles) {
        const r = ts.resolveModuleName(
          imp.fileName,
          join(root, f),
          opts,
          ts.sys,
        ).resolvedModule;
        if (!r || r.isExternalLibraryImport) continue;
        const rel = relative(root, r.resolvedFileName);
        if (!rel.startsWith("..") && !rel.includes("node_modules")) add(rel);
      }
    }
    if (followsLiterals(f)) {
      for (const m of text.matchAll(PATH_RE)) {
        const named = m[1];
        add(
          named,
          !entries.has(f) && /\.test\.(ts|tsx|mts|js|mjs)$/.test(named),
        );
      }
    }
  }
  return { files: [...files].sort(), dirs: [...dirs].sort() };
}

/** The test files the group's harnesses run: the ones its step scripts name. */
export function groupTests(group, root = ROOT) {
  const out = new Set();
  for (const e of groupEntries(group, root)) {
    const abs = join(root, e);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    for (const m of readFileSync(abs, "utf8").matchAll(PATH_RE)) {
      const t = normalize(m[1]);
      if (/\.test\.(ts|tsx)$/.test(t) && existsSync(join(root, t))) out.add(t);
    }
  }
  return [...out].sort();
}

/** Whether a changed file is one of the group's dependencies. */
export function touches(dep, changedFile) {
  return (
    dep.files.includes(changedFile) ||
    dep.dirs.some((d) => changedFile.startsWith(d))
  );
}

/** The groups to run for these changed files; `null` (unknown) runs every group. */
export function groupsToRun(changed, root = ROOT) {
  if (changed === null) return [...ALL_GROUPS];
  return ALL_GROUPS.filter((g) => {
    if (!SCOPED_GROUPS.includes(g)) return true;
    const dep = closure(g, root);
    return changed.some((f) => touches(dep, f));
  });
}

/**
 * Repository files an strace log shows were read (successful open/stat), relative to `root`.
 * node_modules and .git are not the repository's own files.
 */
export function tracedReads(traceText, root = ROOT) {
  const out = new Set();
  for (const line of traceText.split("\n")) {
    if (!/\b(openat|open)\(/.test(line) || /= -1 /.test(line)) continue;
    const m = /"([^"]+)"/.exec(line);
    if (!m) continue;
    let p = m[1];
    if (p.startsWith(`${root}/`)) p = p.slice(root.length + 1);
    else if (p.startsWith("/")) continue;
    p = normalize(p);
    if (
      p.startsWith("..") ||
      p.startsWith(".git/") ||
      p.includes("node_modules")
    )
      continue;
    const abs = join(root, p);
    if (existsSync(abs) && statSync(abs).isFile()) out.add(p);
  }
  return [...out].sort();
}

/** Files read during the trace that the group's computed dependencies do not include. */
export function untracked(group, traceText, root = ROOT) {
  const dep = closure(group, root);
  return tracedReads(traceText, root).filter((f) => !touches(dep, f));
}

function readChanged(path) {
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "groups") {
    const groups = groupsToRun(
      process.env.ALL === "true" ? null : readChanged(a),
    );
    process.stdout.write(`groups=${JSON.stringify(groups)}\n`);
    return;
  }
  if (cmd === "tests" && a) {
    const tests = groupTests(a);
    if (tests.length === 0) {
      process.stderr.write(`tests: ${a}'s step scripts name no test file\n`);
      process.exit(1);
    }
    process.stdout.write(tests.join("\n") + "\n");
    return;
  }
  if (cmd === "closure" && a) {
    const dep = closure(a);
    process.stdout.write([...dep.files, ...dep.dirs].join("\n") + "\n");
    return;
  }
  if (cmd === "check-trace" && a && b) {
    const reads = tracedReads(readFileSync(b, "utf8"));
    if (reads.length === 0) {
      process.stderr.write(
        "check-trace: the trace shows no repository file read (a trace over nothing proves nothing)\n",
      );
      process.exit(1);
    }
    const miss = untracked(a, readFileSync(b, "utf8"));
    if (miss.length > 0) {
      process.stderr.write(
        `check-trace: ${a}'s tests read ${miss.length} file(s) outside its computed dependencies, ` +
          "so a change to them would skip the group. Name them where the scope can see them " +
          "(an import, or a path string in the test or harness), or add them to ALWAYS:\n" +
          miss.map((f) => `  ${f}`).join("\n") +
          "\n",
      );
      process.exit(1);
    }
    process.stdout.write(
      `check-trace: ${a}: ${reads.length} repository files read, all within its dependencies\n`,
    );
    return;
  }
  process.stderr.write(
    "usage: pg-mutation-scope.mjs groups [changed.txt] | closure <group> | tests <group> | check-trace <group> <strace.txt>\n",
  );
  process.exit(2);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
)
  main();
