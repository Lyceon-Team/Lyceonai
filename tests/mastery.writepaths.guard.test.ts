/**
 * Mastery Write Paths Guard Test
 * 
 * Sprint 3 PR-2: Enhanced guard test enforcing mastery source of truth invariants.
 * 
 * REQUIREMENT: Only apps/api/src/services/mastery-write.ts should contain
 * write operations (.insert, .update, .upsert, rpc) on canonical mastery tables:
 * - student_skill_mastery
 * - student_cluster_mastery
 * 
 * INVARIANTS ENFORCED:
 * 1. No direct SQL writes to mastery tables outside mastery-write.ts
 * 2. No RPC calls to upsert_skill_mastery or upsert_cluster_mastery outside mastery-write.ts
 * 3. Read functions must not mutate mastery state
 * 
 * This is a deterministic, filesystem-only test that scans source code
 * to prevent future drift.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Canonical choke point module (only this file should have mastery writes)
const CHOKE_POINT_MODULE = "apps/api/src/services/mastery-write.ts";

// Canonical mastery tables
const MASTERY_TABLES = ["student_skill_mastery", "student_cluster_mastery"];

// Write operation patterns to detect
const WRITE_PATTERNS = [
  ".insert(",
  ".update(",
  ".upsert(",
  "rpc(",
  ".delete(",  // Also prevent deletes
];

// Specific mastery RPC calls that should only be in choke point
const MASTERY_RPC_CALLS = [
  "upsert_skill_mastery",
  "upsert_cluster_mastery",
];

// Directories to scan
const SCAN_DIRS = ["apps/api/src", "server", "client/src"];

// Directories/files to exclude
const EXCLUDE_PATTERNS = [
  "node_modules",
  "dist",
  ".git",
  ".next",
  "build",
  "__tests__",
  ".test.ts",
  ".spec.ts",
  ".d.ts",
];

interface FileViolation {
  file: string;
  table: string;
  writePattern: string;
  lineNumber: number;
  lineContent: string;
}

/**
 * Recursively scan directory for files
 */
function scanDirectory(dir: string, repoRoot: string): string[] {
  const files: string[] = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, fullPath);

    // Skip excluded patterns
    if (EXCLUDE_PATTERNS.some((pattern) => relativePath.includes(pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...scanDirectory(fullPath, repoRoot));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Check if a file contains mastery table writes outside the choke point
 */
function checkFileForViolations(
  filePath: string,
  repoRoot: string
): FileViolation[] {
  const violations: FileViolation[] = [];
  const relativePath = path.relative(repoRoot, filePath);

  // Skip the choke point module itself
  if (relativePath === CHOKE_POINT_MODULE || relativePath.endsWith(CHOKE_POINT_MODULE)) {
    return violations;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Check if file mentions any mastery table
  const mentionsMasteryTable = MASTERY_TABLES.some((table) =>
    content.includes(table)
  );

  if (!mentionsMasteryTable) {
    return violations;
  }

  // File mentions mastery tables, check for write operations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Check if line contains a write pattern
    for (const writePattern of WRITE_PATTERNS) {
      if (line.includes(writePattern)) {
        // Check if this line or nearby lines reference mastery tables
        // Look at current line and 2 lines before/after for context
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length - 1, i + 2);
        const contextLines = lines.slice(contextStart, contextEnd + 1).join("\n");

        for (const table of MASTERY_TABLES) {
          if (contextLines.includes(table)) {
            violations.push({
              file: relativePath,
              table,
              writePattern,
              lineNumber,
              lineContent: line.trim(),
            });
            break; // Only report once per line
          }
        }
      }
    }
  }

  return violations;
}

describe("Mastery Write Paths Guard", () => {
  it("should enforce single choke point for mastery writes", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const allViolations: FileViolation[] = [];

    // Scan all relevant directories
    for (const scanDir of SCAN_DIRS) {
      const fullPath = path.join(repoRoot, scanDir);
      const files = scanDirectory(fullPath, repoRoot);

      for (const file of files) {
        const violations = checkFileForViolations(file, repoRoot);
        allViolations.push(...violations);
      }
    }

    // Build detailed error message if violations found
    if (allViolations.length > 0) {
      const errorMessage = [
        "",
        "❌ MASTERY WRITE CHOKE POINT VIOLATION DETECTED",
        "",
        `Found ${allViolations.length} violation(s) outside the canonical choke point.`,
        "",
        "Only this file should write to mastery tables:",
        `  ✓ ${CHOKE_POINT_MODULE}`,
        "",
        "Violations found:",
        ...allViolations.map((v, idx) => {
          return [
            `  ${idx + 1}. ${v.file}:${v.lineNumber}`,
            `     Table: ${v.table}`,
            `     Pattern: ${v.writePattern}`,
            `     Code: ${v.lineContent}`,
          ].join("\n");
        }),
        "",
        "ACTION REQUIRED:",
        "  - Move write logic to applyMasteryUpdate() in mastery-write.ts",
        "  - Update the code to call the choke point instead of direct writes",
        "",
      ].join("\n");

      throw new Error(errorMessage);
    }

    // Test passes - confirm choke point exists
    const chokePointPath = path.join(repoRoot, CHOKE_POINT_MODULE);
    expect(fs.existsSync(chokePointPath)).toBe(true);
  });

  it("should verify choke point module contains expected write operations", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const chokePointPath = path.join(repoRoot, CHOKE_POINT_MODULE);

    expect(fs.existsSync(chokePointPath), "Choke point module must exist").toBe(true);

    const content = fs.readFileSync(chokePointPath, "utf-8");

    // Verify it contains the canonical RPC calls
    expect(content).toContain("upsert_skill_mastery");
    expect(content).toContain("upsert_cluster_mastery");
    expect(content).toContain("student_skill_mastery");
    expect(content).toContain("student_cluster_mastery");

    // Verify it contains the canonical function
    expect(content).toContain("applyMasteryUpdate");
    
    // Verify it has proper documentation
    expect(content).toContain("CANONICAL MASTERY WRITE CHOKE POINT");
  });

  it("should prevent RPC calls to mastery functions outside choke point", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const violations: FileViolation[] = [];

    // Scan all relevant directories
    for (const scanDir of SCAN_DIRS) {
      const fullPath = path.join(repoRoot, scanDir);
      const files = scanDirectory(fullPath, repoRoot);

      for (const file of files) {
        const relativePath = path.relative(repoRoot, file);
        
        // Skip the choke point module itself
        if (relativePath === CHOKE_POINT_MODULE || relativePath.endsWith(CHOKE_POINT_MODULE)) {
          continue;
        }

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");

        // Check for mastery RPC calls
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNumber = i + 1;

          for (const rpcCall of MASTERY_RPC_CALLS) {
            if (line.includes(rpcCall)) {
              violations.push({
                file: relativePath,
                table: "mastery_rpc",
                writePattern: rpcCall,
                lineNumber,
                lineContent: line.trim(),
              });
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      const errorMessage = [
        "",
        "❌ MASTERY RPC CALL VIOLATION DETECTED",
        "",
        `Found ${violations.length} direct RPC call(s) to mastery functions outside the choke point.`,
        "",
        "Only this file should call mastery RPCs:",
        `  ✓ ${CHOKE_POINT_MODULE}`,
        "",
        "Violations found:",
        ...violations.map((v, idx) => {
          return [
            `  ${idx + 1}. ${v.file}:${v.lineNumber}`,
            `     RPC: ${v.writePattern}`,
            `     Code: ${v.lineContent}`,
          ].join("\n");
        }),
        "",
        "ACTION REQUIRED:",
        "  - Remove direct RPC calls",
        "  - Use applyMasteryUpdate() from mastery-write.ts instead",
        "",
      ].join("\n");

      throw new Error(errorMessage);
    }

    expect(violations.length).toBe(0);
  });
});
