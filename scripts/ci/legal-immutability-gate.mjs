#!/usr/bin/env node
/**
 * @spec [LYCEON legal versioning Phase 1 §3, §4; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: A published legal version directory is read-only forever.
 * This gate refuses any change to the files under one, comparing the working
 * tree against the same path in the base branch, file by file.
 *
 * expected outcome: exit 0 when every published version directory that
 * already exists on the base ref is byte-identical here. Non-zero, naming the
 * file, when one is modified, deleted, or gains a file.
 *
 * WHY NOT THE CONTENT HASH. The obvious design is "rehash en.md, compare it
 * to content_hash in meta.yml next door". That only catches an author who
 * edits the body and forgets to update the hash — the mistake nobody makes.
 * Edit both in one commit and a self-referential check is green, which is the
 * shape the mistake actually takes. The reference implementation this
 * structure follows (github.com/srcfl/legal) avoids the problem by storing
 * the hash in the acceptance record, somewhere the text's author cannot
 * reach; Phase 1 cannot do that because consent code is out of scope. So git
 * history is the authority here: it is the one record a single commit cannot
 * rewrite. `content_hash` is still verified below, because a hash that does
 * not match its own file is broken whatever else is true — but it is a
 * consistency check, not the immutability mechanism.
 *
 * trade-offs:
 *  - Needs the base ref fetched. CI fetches it; locally it falls back through
 *    LEGAL_BASE_REF, origin/<GITHUB_BASE_REF>, origin/main.
 *  - If the base ref carries no legal/ directory at all — true on the commit
 *    that introduces it — there is nothing published yet to protect, and the
 *    gate says so rather than passing silently.
 *
 * edge cases:
 *  - A version directory whose meta.yml says published: false is not yet
 *    published and may still change. Only published: true is frozen.
 *  - Adding a NEW version directory is always allowed. That is how you
 *    publish. Only existing ones are sealed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const LEGAL = "legal";

/** @returns {string} stdout, trimmed */
function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function gitOk(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef() {
  const candidates = [
    process.env.LEGAL_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
    // Trunk, not an integration branch. The previous fallback was `stripe`, which was
    // where legal versioning was built; that branch has since been merged and deleted, and a
    // fallback pointing at a branch that can be deleted turns this gate off the day it is.
    // `main` is where a published version ends up and is the one ref that always exists.
    "origin/main",
    "main",
  ].filter((r) => typeof r === "string" && r.length > 0);

  for (const ref of candidates) {
    if (gitOk(["rev-parse", "--verify", `${ref}^{commit}`])) return ref;
  }
  return null;
}

const baseRef = resolveBaseRef();

console.log("legal immutability gate — published versions are read-only");
if (!baseRef) {
  console.error("✗ no base ref available to compare against");
  console.error("  Tried LEGAL_BASE_REF, origin/$GITHUB_BASE_REF, origin/main, main.");
  console.error("  Fetch the base branch, or set LEGAL_BASE_REF, and run again.");
  console.error("  Passing without a comparison point would make this gate decorative.");
  process.exit(2);
}
console.log(`  base ref: ${baseRef}\n`);

/** Every path under legal/ that exists on the base ref. */
const basePaths = gitOk(["rev-parse", "--verify", `${baseRef}:${LEGAL}`])
  ? git(["ls-tree", "-r", "--name-only", baseRef, "--", LEGAL])
      .split("\n")
      .filter(Boolean)
  : [];

if (basePaths.length === 0) {
  console.log(`✓ ${baseRef} carries no ${LEGAL}/ tree — nothing is published yet`);
  console.log("  Nothing to freeze on this run. The gate starts protecting these");
  console.log("  directories from the commit after they land.\n");
}

/** Version directories on the base ref: legal/<slug>/<version>/... */
const baseVersionDirs = new Set();
for (const p of basePaths) {
  const parts = p.split("/");
  if (parts.length >= 4) baseVersionDirs.add(parts.slice(0, 3).join("/"));
}

function readBase(p) {
  return execFileSync("git", ["show", `${baseRef}:${p}`], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function wasPublishedOnBase(versionDir) {
  const metaPath = `${versionDir}/meta.yml`;
  if (!basePaths.includes(metaPath)) return false;
  return /^published:\s*true\s*$/m.test(readBase(metaPath).toString("utf-8"));
}

let failed = false;

for (const versionDir of [...baseVersionDirs].sort()) {
  if (!wasPublishedOnBase(versionDir)) {
    console.log(`· ${versionDir} — not published on ${baseRef}, still mutable`);
    continue;
  }

  const filesOnBase = basePaths.filter((p) => p.startsWith(`${versionDir}/`));
  let dirClean = true;

  for (const p of filesOnBase) {
    const abs = path.join(REPO_ROOT, p);
    if (!fs.existsSync(abs)) {
      failed = true;
      dirClean = false;
      console.error(`✗ ${p} was DELETED from a published version`);
      continue;
    }
    if (!readBase(p).equals(fs.readFileSync(abs))) {
      failed = true;
      dirClean = false;
      console.error(`✗ ${p} was MODIFIED inside a published version`);
    }
  }

  const absDir = path.join(REPO_ROOT, versionDir);
  if (fs.existsSync(absDir)) {
    for (const name of fs.readdirSync(absDir)) {
      const p = `${versionDir}/${name}`;
      if (!filesOnBase.includes(p)) {
        failed = true;
        dirClean = false;
        console.error(`✗ ${p} was ADDED to a published version`);
      }
    }
  }

  if (dirClean) console.log(`✓ ${versionDir} — unchanged`);
}

// Consistency, not immutability: content_hash must describe its own en.md.
console.log("");
const slugs = fs.existsSync(path.join(REPO_ROOT, LEGAL))
  ? fs
      .readdirSync(path.join(REPO_ROOT, LEGAL), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  : [];

const { createHash } = await import("node:crypto");

for (const slug of slugs) {
  const slugDir = path.join(REPO_ROOT, LEGAL, slug);
  for (const entry of fs.readdirSync(slugDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(slugDir, entry.name, "meta.yml");
    const enPath = path.join(slugDir, entry.name, "en.md");
    if (!fs.existsSync(metaPath) || !fs.existsSync(enPath)) continue;

    const declared = /^content_hash:\s*sha256:([0-9a-f]{64})\s*$/m.exec(
      fs.readFileSync(metaPath, "utf-8"),
    );
    if (!declared) {
      failed = true;
      console.error(
        `✗ ${LEGAL}/${slug}/${entry.name}/meta.yml has no well-formed content_hash`,
      );
      console.error("    expected: content_hash: sha256:<64 lowercase hex>");
      continue;
    }

    const actual = createHash("sha256").update(fs.readFileSync(enPath)).digest("hex");
    if (actual !== declared[1]) {
      failed = true;
      console.error(`✗ ${LEGAL}/${slug}/${entry.name} — content_hash does not match en.md`);
      console.error(`    declared: sha256:${declared[1]}`);
      console.error(`    actual:   sha256:${actual}`);
    } else {
      console.log(`✓ ${LEGAL}/${slug}/${entry.name} — content_hash matches en.md`);
    }
  }
}

console.log("");
if (failed) {
  console.error("LEGAL IMMUTABILITY GATE: FAIL");
  console.error("");
  console.error("  A published version is the evidence of what somebody agreed to.");
  console.error("  To change a document, add a new version directory and move the");
  console.error("  manifest's \"current\" to it. Never edit one that is published.");
  process.exit(1);
}
console.log("LEGAL IMMUTABILITY GATE: PASS");
