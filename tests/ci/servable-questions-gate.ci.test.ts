/**
 * Servable-questions gate — CI contract test
 *
 * @spec [Doc-02A_V6 §16; Doc-02B_V4 §14; Coding Standards §5]
 * @implemented [2026-07-24]
 *
 * Scans server and app source code for direct `.from("questions")` /
 * `.from('questions')` calls and fails if any file outside the explicit
 * allowlist queries the questions table directly.
 *
 * Student-serving SELECTION reads must go through `servable_questions`
 * (published + no issue_flags + security_invoker). Direct access is
 * allowed only for:
 *   - HISTORICAL RECONSTRUCTION (already-served item lookups by ID)
 *   - INFRA (health checks, connectivity probes)
 *   - ADMIN / PUBLISH pipeline (authoring, ingestion, backfill)
 *   - TUTOR / RAG (question loading by canonical ID)
 *   - MASTERY (metadata lookup by ID)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");

const SERVER_DIRS = [
  path.join(REPO_ROOT, "server"),
  path.join(REPO_ROOT, "apps/api/src"),
];

const ALLOWLIST: Record<string, string> = {
  "server/routes/questions-runtime.ts":
    "HISTORICAL: getQuestionById, submitQuestionFeedback",
  "server/routes/tutor-runtime.ts":
    "HISTORICAL: existence checks, ID resolution",
  "server/services/question-publish.ts": "ADMIN: authoring/publish pipeline",
  "server/scripts/cleanup-question-stems.ts": "ADMIN: maintenance script",
  "apps/api/src/routes/healthz.ts": "INFRA: health check",
  "apps/api/src/db/client.ts": "INFRA: connectivity probe",
  "apps/api/src/lib/supabase-server.ts": "INFRA: server setup",
  "apps/api/src/lib/rag-service.ts":
    "HISTORICAL: question loading by canonical ID",
  "apps/api/src/services/fullLengthExam.ts":
    "HISTORICAL: form canonical ID resolution, deferred materialization snapshots",
  "apps/api/src/services/studentMastery.ts":
    "HISTORICAL: mastery metadata lookup by ID",
};

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectTsFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

const DIRECT_QUESTIONS_RE = /\.from\(["']questions["']\)/;

describe("servable_questions gate", () => {
  const allFiles: string[] = [];
  for (const dir of SERVER_DIRS) {
    allFiles.push(...collectTsFiles(dir));
  }

  it("scanned at least 10 server files (sanity check)", () => {
    expect(allFiles.length).toBeGreaterThan(10);
  });

  it("no unapproved direct .from('questions') calls", () => {
    const violations: string[] = [];

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (!DIRECT_QUESTIONS_RE.test(content)) continue;

      const relPath = path.relative(REPO_ROOT, filePath);
      if (relPath in ALLOWLIST) continue;

      const lines = content.split("\n");
      const matchingLines: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (DIRECT_QUESTIONS_RE.test(lines[i])) {
          matchingLines.push(i + 1);
        }
      }
      violations.push(`${relPath}:${matchingLines.join(",")}`);
    }

    expect(violations).toEqual([]);
  });

  it("every allowlisted file actually exists", () => {
    const missing = Object.keys(ALLOWLIST).filter(
      (relPath) => !fs.existsSync(path.join(REPO_ROOT, relPath)),
    );
    expect(missing).toEqual([]);
  });

  it("every allowlisted file actually has .from('questions')", () => {
    const stale = Object.keys(ALLOWLIST).filter((relPath) => {
      const fullPath = path.join(REPO_ROOT, relPath);
      if (!fs.existsSync(fullPath)) return false;
      const content = fs.readFileSync(fullPath, "utf-8");
      return !DIRECT_QUESTIONS_RE.test(content);
    });
    expect(stale).toEqual([]);
  });
});
