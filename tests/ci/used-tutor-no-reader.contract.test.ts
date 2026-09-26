/**
 * @spec [Doc-02B_V4 §16, CR-02B-16; closure plan W4-7; owner ruling W4-6]
 * @implemented 2026-09-26
 *
 * plain English: `review_error_attempts.used_tutor` records whether the student
 * messaged LISA on a review item before submitting. It is TELEMETRY ONLY — owner
 * ruling W4-6: an assisted attempt counts toward mastery exactly like an unaided
 * one — so no application code may read it: not a route, not a mastery or KPI
 * path, not a guardian view, not the UI.
 *
 * The SQL side of the same rule is gate G22 in scripts/ci/review-queue-gates.sql
 * (no function or view other than the writer names the column). This file covers
 * the TypeScript side: no production source file names `used_tutor` or a
 * camel-cased `usedTutor` at all. If a future change needs to read it — the
 * post-launch "do assisted attempts predict score gains?" analysis — that is an
 * owner decision and this test is where it gets made explicit.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Every directory that ships production application code. */
const PRODUCTION_ROOTS = [
  "server",
  "apps",
  "client/src",
  "packages",
  "shared",
  "api",
];

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /(\.test\.|\.spec\.|__tests__|\/tests?\/)/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
]);

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
    } else if (SOURCE.test(name) && !TEST.test(full)) {
      yield full;
    }
  }
}

describe("W4-7 — used_tutor is telemetry only: no production code reads it", () => {
  it("scans a non-trivial amount of production source (the scan is not vacuous)", () => {
    const files = PRODUCTION_ROOTS.flatMap((root) => [
      ...sourceFiles(path.join(ROOT, root)),
    ]);
    expect(files.length).toBeGreaterThan(200);
  });

  it("no production source file names used_tutor / usedTutor", () => {
    const readers: string[] = [];
    for (const root of PRODUCTION_ROOTS) {
      for (const file of sourceFiles(path.join(ROOT, root))) {
        if (/used_?tutor/i.test(readFileSync(file, "utf8"))) {
          readers.push(path.relative(ROOT, file));
        }
      }
    }
    expect(readers).toEqual([]);
  });
});
