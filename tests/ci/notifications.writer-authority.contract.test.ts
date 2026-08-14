/**
 * Notification Writer Authority Contract
 *
 * @spec [Coding Standards §18 step 7; CLAUDE.md notification emission]
 * @implemented 2026-08-14
 *
 * plain English: ensures all notification inserts go through the central
 * preference-aware writer (notification-authority.ts). No other file may
 * insert directly into the notifications table.
 *
 * Uses bounded-window scanning to catch multiline Supabase chains:
 *   .from("notifications")
 *   .insert(payload)
 * The previous line-by-line scanner required both `.from()` and `.insert()`
 * on the same line — a pattern nobody writes. The anchor is
 * `.from("notifications")` (always on its own line); the follow-up is
 * `.insert(` within the next 10 lines.
 *
 * trade-offs: inherits bounded-window false-positive risk (see
 * tests/ci/lib/bounded-window-scanner.ts). An unrelated `.insert()` within
 * 10 lines of a notifications `.from()` would fire. In practice, code that
 * close to a notifications `.from()` is part of the same chain.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  scanFileWithBoundedWindow,
  type BoundedWindowHit,
} from "./lib/bounded-window-scanner";

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

/**
 * Anchor: `.from("notifications")` or `.from('notifications')` on a line.
 * Follow-up: the collapsed window contains `.from("notifications")` followed
 * by `.insert(` — catching multiline chains.
 */
const NOTIFICATION_FROM_ANCHOR = /\.from\s*\(\s*["'`]notifications["'`]\s*\)/;
const NOTIFICATION_INSERT_FOLLOWUP =
  /\.from\s*\(\s*["'`]notifications["'`]\s*\).*\.insert\s*\(/;

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
    if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
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

      const hits: BoundedWindowHit[] = scanFileWithBoundedWindow(
        filePath,
        NOTIFICATION_FROM_ANCHOR,
        NOTIFICATION_INSERT_FOLLOWUP,
      );

      for (const hit of hits) {
        violations.push({
          file: relativePath,
          lineNumber: hit.line,
          lineContent: hit.content,
        });
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
      violations
        .map((v) => `${v.file}:${v.lineNumber} :: ${v.lineContent}`)
        .join("\n"),
    ).toEqual([]);
  });

  it("routes calendar producer decisions through central notification authority", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const calendarRoutePath = path.join(
      repoRoot,
      "apps/api/src/routes/calendar.ts",
    );
    const source = fs.readFileSync(calendarRoutePath, "utf8");

    expect(source).toContain("publishCalendarEventNotificationBestEffort");
    expect(source).toContain(
      "await publishCalendarEventNotificationBestEffort(",
    );
  });
});
