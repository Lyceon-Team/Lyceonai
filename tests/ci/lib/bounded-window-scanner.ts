/**
 * Bounded-window scanner for static guard tests.
 *
 * @spec [INV-03-01, Doc-05_V2 §6.2, Coding Standards §5]
 * @implemented 2026-08-14
 *
 * plain English: shared utility for CI guard tests that need to detect
 * multiline Supabase chains. Guards that check for compound patterns
 * (e.g. `.from("table")` followed by `.insert(` within the same chain)
 * cannot use line-by-line scanning because this codebase universally
 * formats chains across multiple lines.
 *
 * approach: when an anchor pattern (e.g. `.from("table")`) is found on
 * a line, the next CHAIN_WINDOW lines are collapsed into a single
 * whitespace-normalized string and tested against a follow-up pattern.
 *
 * trade-offs: the bounded window could theoretically false-positive if
 * an unrelated follow-up pattern appears within CHAIN_WINDOW lines of
 * the anchor. In practice, code within 10 lines of a Supabase `.from()`
 * is part of the same chain or closely related — a false positive here
 * is a code smell worth investigating regardless.
 *
 * edge cases: legitimate operations that only match the anchor (e.g.
 * `.from("table").select(...)`) pass because the follow-up pattern is
 * not found. Same-line matches are still caught trivially (window of 1).
 */
import * as fs from "fs";
import * as path from "path";

/**
 * Maximum number of subsequent lines to include in the bounded window.
 * Supabase chains in this codebase are 2–8 lines; 10 provides margin
 * without joining unrelated code.
 */
export const CHAIN_WINDOW = 10;

export type BoundedWindowHit = {
  file: string;
  line: number;
  content: string;
};

/**
 * Scan a file for compound multiline patterns using a bounded window.
 *
 * @param filePath  Absolute path to scan
 * @param anchorPattern  Regex that must match on the anchor line (e.g. `.from("table")`)
 * @param followUpPattern  Regex tested against the collapsed window (anchor + next N lines).
 *                         Should match the full compound pattern from anchor through follow-up.
 * @param excludePaths  Set of repo-relative paths (forward-slash) to skip entirely
 * @param repoRoot  Repo root for computing relative paths (used with excludePaths)
 * @returns  Array of hits with file, line number, and anchor line content
 */
export function scanFileWithBoundedWindow(
  filePath: string,
  anchorPattern: RegExp,
  followUpPattern: RegExp,
  excludePaths?: Set<string>,
  repoRoot?: string,
): BoundedWindowHit[] {
  const hits: BoundedWindowHit[] = [];

  // Check exclusion by repo-relative path
  if (excludePaths && repoRoot) {
    const relPath = path.relative(repoRoot, filePath).split(path.sep).join("/");
    if (excludePaths.has(relPath)) return hits;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!anchorPattern.test(line)) continue;

      // Collect bounded window: this line + next CHAIN_WINDOW lines
      const windowEnd = Math.min(i + CHAIN_WINDOW, lines.length);
      const windowText = lines
        .slice(i, windowEnd)
        .join(" ")
        .replace(/\s+/g, " ");

      if (followUpPattern.test(windowText)) {
        hits.push({
          file: filePath,
          line: i + 1,
          content: line.trim(),
        });
      }
    }
  } catch {
    // Ignore read errors (missing files, permission errors)
  }

  return hits;
}

/**
 * Recursively find all .ts and .tsx files in a directory,
 * excluding standard non-source directories.
 */
export function findTypeScriptFiles(
  dir: string,
  excludeDirNames: ReadonlySet<string> = DEFAULT_EXCLUDE_DIRS,
): string[] {
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (excludeDirNames.has(entry.name)) continue;

      if (entry.isDirectory()) {
        results.push(...findTypeScriptFiles(fullPath, excludeDirNames));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore permission errors or missing directories
  }

  return results;
}

const DEFAULT_EXCLUDE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "__tests__",
  ".next",
  ".git",
]);
