#!/usr/bin/env node
/**
 * SCL register duplicate-id FLAG.
 *
 * Flags (a GitHub warning annotation and the job summary; never a failed build) any `SCL-NNN`
 * that heads more than one entry across docs/SpecAudit/SPEC_CHANGES_LOG.md (the legacy register,
 * closed to new entries) and docs/SpecAudit/scl/SCL-NNN-<slug>.md (one file per entry since
 * 2026-11-25), and any entry file whose name and heading disagree.
 *
 * OWNER RULING, Karl, 2026-11-25: a number collision "should not be a conflict. It should be a
 * CI failure or a flag. It doesn't even have to be a failure ... It's just data keeping and data
 * tracking." So this reports and exits 0. It replaces the hard failure described below, which
 * was written before that ruling and is kept as the history of why the check exists. New
 * entries are written by `pnpm scl:new` (scripts/scl/new.mjs), which takes the next number
 * across every remote branch and puts each entry in its own file, so parallel branches no
 * longer conflict in git at all; this flag catches the race that remains.
 *
 * Why this exists as a gate and not just a rule:
 *
 * Id collisions keep reaching the register — SCL-021, SCL-024, SCL-042,
 * SCL-043, and on 2026-09-26 SCL-171/SCL-172 twice over. Every one was written
 * by an agent that had read the register first. Reading does not reserve: two
 * sessions on branches that cannot see each other both read max=N and both
 * write N+1. No instruction prevents that, because neither session did anything
 * wrong at the moment it looked. Only a mechanical check at merge time closes
 * the window.
 *
 * The 2026-09-26 round is the sharpest evidence for that. One pair renumbered
 * out of a collision with E9b and landed on SCL-171/SCL-172; a second session
 * allocated the same two ids the same morning from a scan that was correct when
 * it ran (that second pair is now SCL-176/SCL-177); and a third claimed
 * SCL-173/SCL-174 within three minutes of a fourth session naming them as the
 * next free pair. Four sessions, no mistakes, three collisions.
 *
 * Scope, deliberately: this checks ONE file for duplicate headings. It does not
 * try to detect cross-branch races itself — that needs the pre-write query in
 * the HARD OVERRIDE rule at the top of the register. This is the backstop that
 * catches what the rule misses.
 *
 * An entry heading is a line beginning `SCL-NNN | ` at column 0. Prose
 * references to an id elsewhere in the file (banners, cross-references,
 * "amends SCL-048") are NOT headings and are correctly ignored.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTER = "docs/SpecAudit/SPEC_CHANGES_LOG.md";
const DIR = "docs/SpecAudit/scl";

/** `SCL-NNN | ` at the start of a line — the entry-heading shape. */
const ENTRY_HEADING = /^(SCL-\d{3,}) \|/;
/** `SCL-NNN-<slug>.md` — the entry-file shape. */
const ENTRY_FILE = /^(SCL-\d{3,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** Each problem becomes one warning annotation, so it shows on the pull request. */
function flag(file, line, message) {
  console.log(`::warning file=${file},line=${line}::${message}`);
}

function main() {
  /** id -> places (`file:line`) where it heads an entry */
  const seen = new Map();
  const add = (id, where) => {
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(where);
  };
  let problems = 0;

  const lines = readFileSync(resolve(ROOT, REGISTER), "utf-8").split("\n");
  lines.forEach((line, i) => {
    const m = ENTRY_HEADING.exec(line);
    if (m) add(m[1], { file: REGISTER, line: i + 1 });
  });

  const dir = resolve(ROOT, DIR);
  const files = existsSync(dir)
    ? readdirSync(dir).filter((n) => n.startsWith("SCL-")).sort()
    : [];
  for (const name of files) {
    const path = join(DIR, name);
    const named = ENTRY_FILE.exec(name);
    const first = readFileSync(resolve(ROOT, path), "utf-8").split("\n")[0] ?? "";
    const heading = ENTRY_HEADING.exec(first);
    if (!named) {
      flag(path, 1, `${name} is not named SCL-NNN-<slug>.md (lowercase words joined by hyphens).`);
      problems += 1;
    }
    if (!heading) {
      flag(path, 1, `${name} does not start with an "SCL-NNN | date | title | STATUS" heading.`);
      problems += 1;
      continue;
    }
    if (named && named[1] !== heading[1]) {
      flag(path, 1, `${name} is named ${named[1]} but its heading says ${heading[1]}.`);
      problems += 1;
    }
    add(heading[1], { file: path, line: 1 });
  }

  const duplicates = [...seen.entries()]
    .filter(([, at]) => at.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [id, at] of duplicates) {
    const places = at.map((p) => `${p.file}:${p.line}`).join(", ");
    for (const p of at) {
      flag(
        p.file,
        p.line,
        `${id} heads ${at.length} entries (${places}). The LATER allocation, by the entry's own date, renumbers: run pnpm scl:new for a fresh number and rename the file. Never renumber another workstream's branch; report it to the owner.`,
      );
    }
    problems += 1;
  }

  console.log(
    `scl-duplicate-check: ${seen.size} distinct id(s): ${lines.length} register lines, ${files.length} entry file(s) in ${DIR}`,
  );
  console.log(
    problems === 0
      ? "SCL REGISTER: CLEAN"
      : `SCL REGISTER: ${problems} FLAG(S) (warnings only, owner ruling 2026-11-25; see the annotations)`,
  );
  return 0;
}

process.exit(main());
