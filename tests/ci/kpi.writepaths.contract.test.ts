import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

type Violation = {
  file: string;
  lineNumber: number;
  lineContent: string;
  token: string;
};

const RUNTIME_ROOTS = ["apps/api/src", "server"];
const EXCLUDED_SEGMENTS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  "__tests__",
  ".test.ts",
  ".spec.ts",
  ".d.ts",
];

const WRITE_TOKENS = [
  "upsertStudentKpiCountersCurrent(",
  "persistCanonicalPracticeKpiSnapshot(",
  '.from("student_kpi_counters_current")',
  '.from("student_kpi_snapshots")',
  'rpc("upsert_student_kpi_counters_current"',
];

const CHOKE_POINT_CALL_TOKENS = [
  "await upsertStudentKpiCountersCurrent(",
  "await persistCanonicalPracticeKpiSnapshot(",
];

function normalizeRepoPath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function scanFiles(dir: string, repoRoot: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = normalizeRepoPath(repoRoot, fullPath);

    if (EXCLUDED_SEGMENTS.some((segment) => relativePath.includes(segment))) {
      continue;
    }

    if (entry.isDirectory()) {
      out.push(...scanFiles(fullPath, repoRoot));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(fullPath);
    }
  }

  return out;
}

function collectViolations(repoRoot: string, tokens: string[], allowedFiles: Set<string>): Violation[] {
  const violations: Violation[] = [];

  for (const root of RUNTIME_ROOTS) {
    const files = scanFiles(path.join(repoRoot, root), repoRoot);

    for (const filePath of files) {
      const relativePath = normalizeRepoPath(repoRoot, filePath);
      if (allowedFiles.has(relativePath)) {
        continue;
      }

      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const token of tokens) {
          if (lines[i].includes(token)) {
            violations.push({
              file: relativePath,
              lineNumber: i + 1,
              lineContent: lines[i].trim(),
              token,
            });
          }
        }
      }
    }
  }

  return violations;
}

describe("KPI write path contract", () => {
  it("blocks local KPI writer helper ownership in mounted runtime", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const writeHelperViolations = collectViolations(repoRoot, WRITE_TOKENS.slice(0, 2), new Set());

    expect(
      writeHelperViolations,
      writeHelperViolations
        .map((violation) => `${violation.file}:${violation.lineNumber} -> ${violation.token} :: ${violation.lineContent}`)
        .join("\n")
    ).toEqual([]);
  });

  it("blocks direct writes to compatibility KPI tables/RPC in mounted runtime", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const tableWriteViolations = collectViolations(repoRoot, WRITE_TOKENS.slice(2), new Set());

    expect(
      tableWriteViolations,
      tableWriteViolations
        .map((violation) => `${violation.file}:${violation.lineNumber} -> ${violation.token} :: ${violation.lineContent}`)
        .join("\n")
    ).toEqual([]);
  });

  it("blocks legacy KPI writer invocation tokens in mounted runtime", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const invocationViolations = collectViolations(
      repoRoot,
      CHOKE_POINT_CALL_TOKENS,
      new Set(),
    );

    expect(
      invocationViolations,
      invocationViolations
        .map((violation) => `${violation.file}:${violation.lineNumber} -> ${violation.token} :: ${violation.lineContent}`)
        .join("\n"),
    ).toEqual([]);
  });
});
