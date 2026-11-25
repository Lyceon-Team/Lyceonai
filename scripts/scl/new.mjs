#!/usr/bin/env node
/**
 * pnpm scl:new — allocate the next SCL number and write the entry file.
 *
 * Owner ruling, Karl, 2026-11-25: "if any of the agents want to write a spec change, they have to
 * read across every open PR to make sure that they're getting the latest number, and that's it
 * ... it should not be a conflict. It should be a CI failure or a flag." Also: the tool that
 * gives the number writes where the entry belongs.
 *
 * plain English: every SCL entry used to be appended to the end of one file,
 * docs/SpecAudit/SPEC_CHANGES_LOG.md, so any two branches that each added one entry conflicted,
 * every time, whatever their numbers. New entries are now one file each, under
 * docs/SpecAudit/scl/, named `SCL-NNN-<slug>.md`. Two branches adding entries never touch the
 * same file, so they never conflict. Two branches that pick the SAME number still produce two
 * different files (the slugs differ), so that is not a conflict either: CI flags it
 * (scripts/ci/scl-duplicate-check.mjs) and the later entry renumbers.
 *
 * How the number is chosen: `git fetch --all --prune`, then the highest `SCL-NNN` heading on
 * EVERY remote branch (which includes the head branch of every open pull request), in both the
 * legacy register and the scl/ folder, plus this working tree. The new number is that + 1.
 *
 * Usage:
 *   pnpm scl:new --slug founding-lapse --branch cleanup --title "One line: what changes"
 *   options: --no-fetch (use the refs already fetched), --dry-run (print the number only)
 *
 * The file it writes holds the heading line and the template fields to fill in. Nothing else
 * is touched: no shared file is appended to.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LEGACY = "docs/SpecAudit/SPEC_CHANGES_LOG.md";
const DIR = "docs/SpecAudit/scl";
const HEADING = /^SCL-(\d{3,}) \|/gm;
const FILENAME = /^SCL-(\d{3,})-[a-z0-9-]+\.md$/;
const BRANCHES = ["questions", "lisa", "calendar", "exam", "guardian", "review", "cleanup", "seo", "social"];

function parseArgs(argv) {
  const out = { fetch: true, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--no-fetch") out.fetch = false;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--slug" || a === "--branch" || a === "--title") {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
      i += 1;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function git(args) {
  // stderr is dropped: a ref without the register or the folder is expected, and the probe's
  // thrown error (handled at each call) is the signal, not git's "fatal:" line.
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Highest SCL number in `text`'s entry headings. */
function maxIn(text) {
  let max = 0;
  for (const m of text.matchAll(HEADING)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Highest SCL number on one ref: legacy register headings and scl/ file names. */
function maxOnRef(ref) {
  let max = 0;
  try {
    max = maxIn(git(["show", `${ref}:${LEGACY}`]));
  } catch {
    // The ref predates the register or never had it: it claims no number there.
    max = 0;
  }
  let names = "";
  try {
    names = git(["ls-tree", "--name-only", `${ref}:${DIR}`]);
  } catch {
    // The ref predates the scl/ folder: it claims no number there.
    names = "";
  }
  for (const name of names.split("\n")) {
    const m = FILENAME.exec(name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function maxInWorktree() {
  let max = existsSync(join(ROOT, LEGACY)) ? maxIn(readFileSync(join(ROOT, LEGACY), "utf8")) : 0;
  if (existsSync(join(ROOT, DIR))) {
    for (const name of readdirSync(join(ROOT, DIR))) {
      const m = FILENAME.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun) {
    if (!args.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)) {
      throw new Error("--slug is required: lowercase words joined by hyphens, e.g. founding-lapse");
    }
    if (!args.branch || !BRANCHES.includes(args.branch)) {
      throw new Error(`--branch is required: the integration branch the change belongs to (${BRANCHES.join(", ")})`);
    }
    if (!args.title) throw new Error("--title is required: one line saying what changes");
  }

  if (args.fetch) git(["fetch", "--all", "--prune", "--quiet"]);
  const refs = git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/"])
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r && !r.endsWith("/HEAD"));

  let max = maxInWorktree();
  let from = "this working tree";
  for (const ref of refs) {
    const m = maxOnRef(ref);
    if (m > max) {
      max = m;
      from = ref;
    }
  }
  const id = `SCL-${String(max + 1).padStart(3, "0")}`;
  console.log(`scl:new: highest allocated is SCL-${String(max).padStart(3, "0")} (on ${from}), across ${refs.length} remote branch(es); next is ${id}`);
  if (args.dryRun) return;

  const date = new Date().toISOString().slice(0, 10);
  const file = join(DIR, `${id}-${args.slug}.md`);
  mkdirSync(join(ROOT, DIR), { recursive: true });
  writeFileSync(
    join(ROOT, file),
    [
      `${id} | ${date} | ${args.title} | PROPOSED`,
      `Branch: ${args.branch}`,
      "Status: PROPOSED.",
      "WAS: ",
      "IS: ",
      "Preserves: ",
      "Owner action: ",
      "Build artifact: ",
      `Id: \`${id}\` allocated by \`pnpm scl:new\` on ${date}: highest on any remote branch was SCL-${String(max).padStart(3, "0")} (${from}).`,
      "",
    ].join("\n"),
  );
  console.log(`scl:new: wrote ${file}`);
}

try {
  main();
} catch (err) {
  console.error(`scl:new: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
