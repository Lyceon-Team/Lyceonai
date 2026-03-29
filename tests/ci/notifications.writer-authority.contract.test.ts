import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

type Violation = {
  file: string;
  lineNumber: number;
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

const ALLOWED_NOTIFICATION_WRITER_FILES = new Set([
  "server/services/notification-authority.ts",
]);

const DIRECT_INSERT_TOKENS = [
  '.from("notifications").insert(',
  ".from('notifications').insert(",
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

function collectViolations(repoRoot: string): Violation[] {
  const violations: Violation[] = [];
  for (const root of RUNTIME_ROOTS) {
    const files = scanFiles(path.join(repoRoot, root), repoRoot);
    for (const filePath of files) {
      const relativePath = normalizeRepoPath(repoRoot, filePath);
      if (ALLOWED_NOTIFICATION_WRITER_FILES.has(relativePath)) {
        continue;
      }
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (DIRECT_INSERT_TOKENS.some((token) => lines[i].includes(token))) {
          violations.push({
            file: relativePath,
            lineNumber: i + 1,
            lineContent: lines[i].trim(),
          });
        }
      }
    }
  }
  return violations;
}

describe("Notification Writer Authority Contract", () => {
  it("keeps mounted user-facing notification inserts in the central preference-aware writer", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const violations = collectViolations(repoRoot);

    expect(
      violations,
      violations.map((v) => `${v.file}:${v.lineNumber} :: ${v.lineContent}`).join("\n"),
    ).toEqual([]);
  });

  it("routes calendar producer decisions through central notification authority", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const calendarRoutePath = path.join(repoRoot, "apps/api/src/routes/calendar.ts");
    const source = fs.readFileSync(calendarRoutePath, "utf8");

    expect(source).toContain("publishCalendarEventNotificationBestEffort");
    expect(source).toContain("await publishCalendarEventNotificationBestEffort(");
  });
});
