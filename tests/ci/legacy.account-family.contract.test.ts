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
  "__tests__",
  ".test.ts",
  ".spec.ts",
  ".d.ts",
];

const FORBIDDEN_LEGACY_TABLE_TOKENS = [
  '.from("lyceon_accounts")',
  ".from('lyceon_accounts')",
  '.from("lyceon_account_members")',
  ".from('lyceon_account_members')",
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

describe("Canonical Account Family Contract (accounts/account_members)", () => {
  it("forbids runtime reads/writes to legacy lyceon_* account table names", () => {
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

  it("asserts canonical account ownership uses account_members/accounts", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const accountLibPath = path.join(repoRoot, "server/lib/account.ts");
    const source = fs.readFileSync(accountLibPath, "utf8");

    expect(source).toContain("account_members");
    expect(source).toContain("accounts");
  });
});
