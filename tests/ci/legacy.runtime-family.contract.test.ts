import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

type Violation = {
  file: string;
  lineNumber: number;
  token: string;
  lineContent: string;
};

const RUNTIME_ROOTS = ["server", "apps/api/src"];
const EXCLUDED_SEGMENTS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  "tests",
  "docs",
  "coverage",
  "supabase/migrations",
  "__tests__",
  ".test.ts",
  ".spec.ts",
  ".d.ts",
];

const FORBIDDEN_LEGACY_TABLE_TOKENS = [
  '.from("exam_attempts")',
  ".from('exam_attempts')",
  '.from("exam_sections")',
  ".from('exam_sections')",
  '.from("exam_responses")',
  ".from('exam_responses')",
  '.from("exam_score_rollups")',
  ".from('exam_score_rollups')",
  '.from("chat_messages")',
  ".from('chat_messages')",
  '.from("attempts")',
  ".from('attempts')",
];

function normalizeRepoPath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function scanFiles(dir: string, repoRoot: string): string[] {
  if (!fs.existsSync(dir)) return [];
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

describe("Legacy Runtime Family Canonicalization Contract", () => {
  it("prevents mounted runtime reads/writes to legacy exam/chat/attempts tables", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const violations: Violation[] = [];

    for (const root of RUNTIME_ROOTS) {
      const files = scanFiles(path.join(repoRoot, root), repoRoot);
      for (const filePath of files) {
        const relativePath = normalizeRepoPath(repoRoot, filePath);
        const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          for (const token of FORBIDDEN_LEGACY_TABLE_TOKENS) {
            if (lines[i].includes(token)) {
              violations.push({
                file: relativePath,
                lineNumber: i + 1,
                token,
                lineContent: lines[i].trim(),
              });
            }
          }
        }
      }
    }

    expect(
      violations,
      violations.map((v) => `${v.file}:${v.lineNumber} -> ${v.token} :: ${v.lineContent}`).join("\n"),
    ).toEqual([]);
  });
});
