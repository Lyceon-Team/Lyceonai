/**
 * MASTERY WRITE PATH GUARD TEST
 *
 * @spec [INV-03-01, Doc-05_V2 §6.2]
 * @implemented 2026-08-14
 *
 * This test enforces the critical invariant that ALL mastery writes
 * go through the canonical choke point: apps/api/src/services/mastery-write.ts
 *
 * Violation patterns detected:
 * - Direct .upsert() / .update() / .insert() / .delete() on mastery tables
 * - Direct .rpc() calls to apply_mastery_event
 * - Any write operation outside mastery-write.ts
 *
 * EXCEPTION: mastery-write.ts itself is allowed to write to mastery tables.
 *
 * Uses bounded-window scanning (via tests/ci/lib/bounded-window-scanner.ts)
 * to catch multiline Supabase chains. The previous line-by-line scanner
 * required both `.from("table")` and `.insert(` on the same line — a pattern
 * nobody in this codebase writes.
 *
 * This test MUST pass for the build to succeed.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  scanFileWithBoundedWindow,
  findTypeScriptFiles,
  assertRootsExist,
  type BoundedWindowHit,
} from "../../../tests/ci/lib/bounded-window-scanner";

const MASTERY_TABLES = [
  "student_skill_mastery",
  "student_domain_mastery",
  "student_section_projections",
  "student_kpi_rollups_current",
];

const MASTERY_RPC_FUNCTIONS = ["apply_mastery_event"];

const CANONICAL_CHOKE_POINT = "apps/api/src/services/mastery-write.ts";

// Directories to scan for violations
const SCAN_DIRECTORIES = ["apps/api/src", "server"];

interface Violation {
  file: string;
  line: number;
  content: string;
  type: "table_write" | "rpc_call";
}

/**
 * Check a file for mastery write violations.
 *
 * @spec [INV-03-01, Doc-05_V2 §6.2]
 * @implemented 2026-08-14
 *
 * plain English: detects direct writes to mastery tables outside the
 * canonical choke point. Uses bounded-window scanning: when a line
 * contains `.from("mastery_table")`, the next CHAIN_WINDOW lines are
 * collapsed into a single string and tested for write methods (.insert,
 * .update, .upsert, .delete). This catches multiline Supabase chains
 * that a line-by-line scanner would miss.
 *
 * trade-offs: the bounded window could theoretically false-positive if
 * an unrelated .insert() appears within 10 lines of a mastery table
 * .from(). In practice, code within 10 lines of a mastery .from() is
 * part of the same chain or closely related — a false positive here
 * is a code smell worth investigating regardless.
 *
 * edge cases: legitimate reads (.select) from mastery tables pass
 * because only write methods trigger a violation. Same-line writes
 * are still caught (they fall within the 1-line window trivially).
 */
function checkFileForViolations(filePath: string): Violation[] {
  const violations: Violation[] = [];

  // Skip the canonical choke point itself
  if (filePath.includes(CANONICAL_CHOKE_POINT.replace(/\//g, path.sep))) {
    return violations;
  }

  // ── Table write detection (bounded-window, multiline-safe) ──────
  for (const table of MASTERY_TABLES) {
    const anchorPattern = new RegExp(
      `\\.from\\s*\\(\\s*["'\`]${table}["'\`]\\s*\\)`,
    );
    const writePattern = new RegExp(
      `\\.from\\s*\\(\\s*["'\`]${table}["'\`]\\s*\\)` +
        `.*\\.(insert|update|upsert|delete)\\s*\\(`,
    );

    const hits: BoundedWindowHit[] = scanFileWithBoundedWindow(
      filePath,
      anchorPattern,
      writePattern,
    );

    for (const hit of hits) {
      violations.push({
        file: hit.file,
        line: hit.line,
        content: hit.content,
        type: "table_write",
      });
    }
  }

  // ── RPC detection (single-line — always on one line) ──────────
  // No try/catch — I/O errors MUST propagate so the guard fails closed.
  // (LISA-AUDIT-566-002)
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    for (const rpcFunc of MASTERY_RPC_FUNCTIONS) {
      const rpcPattern = new RegExp(
        `\\.rpc\\s*\\(\\s*["'\`]${rpcFunc}["'\`]`,
      );

      if (rpcPattern.test(line)) {
        violations.push({
          file: filePath,
          line: lineNumber,
          content: line.trim(),
          type: "rpc_call",
        });
      }
    }
  }

  return violations;
}

describe("Mastery Write Path Guard", () => {
  it("should enforce that all mastery writes go through mastery-write.ts", () => {
    const projectRoot = path.resolve(__dirname, "../../..");

    // Assert every configured root exists BEFORE scanning.
    // A typo'd root would scan nothing and pass vacuously. (LISA-AUDIT-566-002)
    const fullRoots = SCAN_DIRECTORIES.map((d) => path.join(projectRoot, d));
    assertRootsExist(fullRoots);

    const allViolations: Violation[] = [];

    for (const scanDir of SCAN_DIRECTORIES) {
      const fullScanPath = path.join(projectRoot, scanDir);
      const files = findTypeScriptFiles(fullScanPath);

      for (const file of files) {
        const violations = checkFileForViolations(file);
        allViolations.push(...violations);
      }
    }

    if (allViolations.length > 0) {
      const violationReport = allViolations
        .map((v) => {
          const relPath = path.relative(projectRoot, v.file);
          return `  ${relPath}:${v.line} - ${v.type}\n    ${v.content}`;
        })
        .join("\n\n");

      const errorMessage = `
MASTERY WRITE PATH VIOLATION DETECTED

All mastery writes MUST go through: ${CANONICAL_CHOKE_POINT}

The following files contain direct writes to mastery tables:

${violationReport}

FIX: Update these files to call applyMasteryEvent() instead of directly
writing to mastery tables or calling RPC functions.

This is a CRITICAL security and consistency invariant.
`;

      throw new Error(errorMessage);
    }

    // Test passes - no violations found
    expect(allViolations.length).toBe(0);
  });

  it("should verify that mastery-write.ts exists and exports applyMasteryEvent", () => {
    const projectRoot = path.resolve(__dirname, "../../..");
    const chokePointPath = path.join(projectRoot, CANONICAL_CHOKE_POINT);

    expect(
      fs.existsSync(chokePointPath),
      `Canonical choke point ${CANONICAL_CHOKE_POINT} must exist at ${chokePointPath}`,
    ).toBe(true);

    const content = fs.readFileSync(chokePointPath, "utf-8");

    expect(
      content.includes("export async function applyMasteryEvent"),
      "mastery-write.ts must export applyMasteryEvent function",
    ).toBe(true);

    expect(
      content.includes("apply_mastery_event"),
      "mastery-write.ts must call apply_mastery_event",
    ).toBe(true);
  });

  /**
   * @spec [INV-03-01, Doc-05_V2 §6.2]
   * @implemented 2026-08-14
   *
   * plain English: verifies the REAL diagnostic routes file
   * (server/routes/diagnostic-routes.ts) does not bypass the mastery-write
   * choke point. The previous test targeted a phantom path
   * (apps/api/src/routes/diagnostic.ts) that never existed, passing
   * vacuously via fs.existsSync early return. Rewritten per audit F-08.
   */
  it("should verify that diagnostic routes do not bypass mastery-write chokepoint", () => {
    const projectRoot = path.resolve(__dirname, "../../..");
    const diagnosticPath = path.join(
      projectRoot,
      "server/routes/diagnostic-routes.ts",
    );

    expect(
      fs.existsSync(diagnosticPath),
      "server/routes/diagnostic-routes.ts must exist",
    ).toBe(true);

    const content = fs.readFileSync(diagnosticPath, "utf-8");

    // Diagnostic routes may READ from mastery tables (e.g. weakest-skills
    // endpoint reads student_skill_mastery). The invariant is about WRITES:
    // no .insert(), .update(), .upsert(), .delete() on mastery tables.
    const violations = checkFileForViolations(diagnosticPath);

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  L${v.line} [${v.type}]: ${v.content}`)
        .join("\n");
      throw new Error(
        `diagnostic-routes.ts bypasses mastery-write chokepoint:\n${report}`,
      );
    }

    expect(violations.length).toBe(0);

    // Diagnostic routes must NOT directly call the mastery RPC
    expect(
      !content.includes('.rpc("apply_mastery_event"'),
      "diagnostic-routes.ts must NOT directly call apply_mastery_event RPC",
    ).toBe(true);
  });
});
