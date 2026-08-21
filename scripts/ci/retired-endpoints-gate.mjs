#!/usr/bin/env node
/**
 * @spec [owner ruling 2026-08-21 Q4 — "/domains supersedes /summary. Two endpoints
 *   returning the same data in different shapes is how SAT_TAXONOMY happened. Once PR D's
 *   consumers move, it goes, with a gate asserting no caller remains."]
 * @implemented 2026-08-21
 *
 * plain English: once an endpoint is retired, this fails the build if ANY reference to its
 * path survives anywhere in the tree — client, server, tests, scripts or docs.
 *
 * WHY A GATE AND NOT JUST A DELETION.
 *   Deleting a route handler removes the server half. The caller half fails at RUNTIME, as
 *   a 404 the UI renders as an error state or an empty list — which is the fail-open shape
 *   this codebase keeps rediscovering: a broken read wearing the face of "no data". A
 *   forgotten caller is invisible to `tsc` because the path is a string. Only a text search
 *   over the committed tree can see it, so that is what runs.
 *
 *   The rule generalises past this one endpoint, which is why the retired set is a table
 *   rather than a hardcoded string: retiring the NEXT endpoint means adding one row, and
 *   the gate that proves nobody still calls it comes free.
 *
 * REPLACEMENT IS PART OF THE ENTRY. A failure that only says "this is gone" makes the
 * reader go hunting. Each row names what to call instead, and the failure prints it.
 *
 * MUTATIONS THIS MUST CATCH (verified by scripts/ci/retired-endpoints-gate.selftest.sh):
 *   - reintroduce a fetch/queryKey for a retired path anywhere → EXIT 1, names file:line
 *   - point the gate at zero files                             → EXIT 1. Zero scanned files
 *     is not zero callers: a glob that stops matching reports "clean" forever.
 *   - empty the RETIRED table                                  → EXIT 1. A gate with nothing
 *     to check is a gate that cannot fail, which is not the same as a clean tree.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);

/**
 * Retired paths. Add a row when an endpoint is deleted; never remove one — a path that
 * stops being checked is a path that can quietly come back.
 */
const RETIRED = [
  {
    path: "/api/me/mastery/summary",
    retiredIn: "PR D (owner ruling 2026-08-21 Q4)",
    replacement:
      "GET /api/me/mastery/domains — same domain grain, carrying levelKey/level/displayName",
  },
  {
    path: "/api/me/mastery/skills",
    retiredIn:
      "PR C (it joined against SAT_TAXONOMY and could never return data)",
    replacement:
      "GET /api/me/mastery/domains/:section/:domain/skills — the drill-down's second screen",
  },
  {
    path: "/api/me/mastery/add-to-plan",
    retiredIn: "PR C (owner ruling 2026-08-20 RULE 10)",
    replacement:
      "nothing — planner ownership lives in the /api/calendar day edit and regenerate flows",
  },
];

/**
 * This file names every retired path, so it would match itself. So would a changelog entry
 * describing the retirement. Both are documentation of the deletion rather than callers of
 * the deleted thing, and the distinction has to be drawn somewhere explicit.
 */
const SELF_REFERENTIAL = new Set([
  "scripts/ci/retired-endpoints-gate.mjs",
  "scripts/ci/retired-endpoints-gate.selftest.sh",
]);

/**
 * `docs/Spec/**` is the locked canonical corpus — read-only by standing rule, and not a
 * caller. `audit-out/**` holds dated point-in-time audit reports: a record of what the tree
 * looked like on a given day, which stays true even after the endpoint goes. Editing either
 * to satisfy a gate would be falsifying a record, so they are out of scope rather than
 * quietly rewritten. Everything else — live docs, contracts, code, tests — is in scope.
 */
const DEFAULT_PATHSPEC = [
  "*.ts",
  "*.tsx",
  "*.js",
  "*.mjs",
  "*.md",
  "*.yml",
  "*.yaml",
  ":(exclude)docs/Spec/**",
  ":(exclude)audit-out/**",
  ":(exclude)**/node_modules/**",
  ":(exclude)dist/**",
];

/**
 * RETIRED_ENDPOINTS_PATHSPEC exists so the self-test can narrow the scan. It is not a
 * bypass: narrowing it to nothing makes the gate EXIT 1 (see main).
 */
function listCandidateFiles() {
  const override = process.env.RETIRED_ENDPOINTS_PATHSPEC;
  const pathspec = override
    ? override.split(/\s+/).filter((part) => part.length > 0)
    : DEFAULT_PATHSPEC;
  const out = execFileSync("git", ["ls-files", "--", ...pathspec], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !SELF_REFERENTIAL.has(line))
    .filter((line) => existsSync(resolve(REPO_ROOT, line)));
}

function main() {
  if (RETIRED.length === 0) {
    console.error(
      "FAIL: the retired-endpoints table is empty, so this gate checks nothing.",
    );
    console.error(
      "      A gate that cannot fail is not the same as a clean tree. Rows are added on",
      "\n      retirement and never removed.",
    );
    process.exit(1);
  }

  const files = listCandidateFiles();
  if (files.length === 0) {
    console.error(
      "FAIL: the retired-endpoints gate scanned ZERO files. A glob that stops matching",
    );
    console.error(
      "      reports a clean tree forever; zero scanned files is a broken gate, not a pass.",
    );
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    const lines = readFileSync(resolve(REPO_ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const entry of RETIRED) {
        if (line.includes(entry.path)) {
          violations.push({
            file,
            line: index + 1,
            entry,
            text: line.trim().slice(0, 160),
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error(
      `FAIL: ${violations.length} reference(s) to a retired endpoint across ${files.length} scanned file(s).`,
    );
    console.error(
      "      A caller of a deleted route fails at runtime as a 404 the UI renders as an",
    );
    console.error(
      "      error state or an empty list — a broken read wearing the face of 'no data'.\n",
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.entry.path}`);
      console.error(`      ${v.text}`);
      console.error(`      retired in: ${v.entry.retiredIn}`);
      console.error(`      use instead: ${v.entry.replacement}\n`);
    }
    process.exit(1);
  }

  console.log(
    `OK: retired endpoints — ${files.length} file(s) scanned, no caller remains for ${RETIRED.length} retired path(s):`,
  );
  for (const entry of RETIRED) {
    console.log(`      ${entry.path}  ->  ${entry.replacement}`);
  }
}

main();
