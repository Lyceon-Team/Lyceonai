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
 * a line, the scanner collects lines forward until the first
 * statement-terminating semicolon (`;` at end of a trimmed line) or
 * CHAIN_WINDOW lines, whichever comes first. The collected lines are
 * collapsed into a single whitespace-normalized string and tested
 * against a follow-up pattern.
 *
 * trade-offs: statement-boundary termination relies on Prettier
 * enforcing trailing semicolons. In code without semicolons (ASI), the
 * scanner falls back to the full CHAIN_WINDOW — same behavior as the
 * pre-fix version, which is strictly no worse.
 *
 * A `;` inside a template literal (backtick string) is string content,
 * not a statement boundary. The scanner tracks unescaped-backtick
 * parity cumulatively from the anchor line: odd count = inside a
 * template literal, so `;` on that line is ignored. Escaped backticks
 * (`\``) are excluded from the count. Nested template literals
 * (`${`...`}`) are a known limitation — they would require a recursive
 * parser, and this codebase does not use them inside Supabase chains.
 *
 * edge cases: legitimate operations that only match the anchor (e.g.
 * `.from("table").select(...)`) pass because the follow-up pattern is
 * not found. Same-line matches are still caught trivially (the anchor
 * line itself ends with `;`). A legitimate read followed by an
 * unrelated-table insert on a later statement is correctly excluded
 * because the `;` after the read terminates the window before the
 * insert is reached.
 *
 * I/O errors: read and traversal errors propagate (not swallowed).
 * A guard that cannot read what it guards must FAIL, not pass silently.
 * (LISA-AUDIT-566-002, fixed 2026-08-14)
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

  // No try/catch — I/O errors MUST propagate. A guard that cannot read
  // what it guards must FAIL, not pass silently. (LISA-AUDIT-566-002)
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!anchorPattern.test(line)) continue;

    // Collect bounded window: this line until end-of-statement or CHAIN_WINDOW.
    // A Prettier-formatted Supabase chain ends at the first line whose trimmed
    // content ends with ';'. Stopping there prevents the window from bridging
    // into the next statement (F-01 false-positive fix). If no ';' is found
    // within CHAIN_WINDOW, the full window is used (fallback, no regression).
    //
    // A ';' inside a template literal is string content, not a statement
    // boundary. Track unescaped-backtick parity: odd = inside a template
    // literal, so skip ';' on that line.
    const maxEnd = Math.min(i + CHAIN_WINDOW, lines.length);
    let windowEnd = maxEnd;
    let insideTemplateLiteral = false;
    for (let j = i; j < maxEnd; j++) {
      // Count unescaped backticks on this line to track parity
      const lineText = lines[j];
      for (let k = 0; k < lineText.length; k++) {
        if (lineText[k] === "`" && (k === 0 || lineText[k - 1] !== "\\")) {
          insideTemplateLiteral = !insideTemplateLiteral;
        }
      }
      if (!insideTemplateLiteral && lineText.trimEnd().endsWith(";")) {
        windowEnd = j + 1;
        break;
      }
    }
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

  // No try/catch — I/O errors MUST propagate. A typo'd or unreadable root
  // must crash the guard, not pass it vacuously. (LISA-AUDIT-566-002)
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

/**
 * Assert every configured scan root exists and is a directory.
 *
 * @spec [LISA-AUDIT-566-002: "assert every configured root exists and was scanned"]
 * @implemented 2026-08-14
 *
 * plain English: a typo'd root currently scans nothing and passes the guard
 * vacuously. This function catches that — call it before scanning.
 *
 * @param roots  Absolute paths to scan roots
 * @throws Error if any root does not exist or is not a directory
 */
export function assertRootsExist(roots: ReadonlyArray<string>): void {
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      throw new Error(
        `assertRootsExist: configured scan root does not exist: ${root}`,
      );
    }
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      throw new Error(
        `assertRootsExist: configured scan root is not a directory: ${root}`,
      );
    }
  }
}
