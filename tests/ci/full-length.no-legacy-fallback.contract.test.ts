/**
 * @spec [Doc 04 family (full-length rebuild, pending); E1 exam deletion ruling,
 *   2026-09-23] | @implemented [2026-09-23]
 *
 * plain English: E1 exam deletion ruling, 2026-09-23: pre-baseline full-length
 * runtime removed pending Doc 04 rebuild.
 *
 * BEFORE: this file read apps/api/src/services/fullLengthExam.ts and
 * server/routes/full-length-exam-routes.ts, asserted they avoided the legacy
 * exam_* tables, and asserted they DID read full_length_exam_sessions /
 * _questions / _responses. Those tables were never created by any migration in
 * the baseline pipeline, which is exactly the production failure ("Could not
 * find the table 'public.full_length_exam_sessions'" / "'public.test_forms'").
 *
 * NOW: it asserts (1) the deleted service and router stay deleted, and (2) no
 * runtime code under server/ or apps/api/src reads any pre-baseline exam table —
 * the legacy exam_* family, the full_length_exam_* family, test_forms, or the
 * two dropped exam config tables. This is not vacuous: it is the guard that
 * stops the prod error class from coming back through a partial restore before
 * the Doc 04 rebuild defines its own tables.
 *
 * edge cases: tests, docs and migrations are excluded — migrations legitimately
 * name historical tables, and tests may name them in fixtures.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");

const DELETED_RUNTIME_FILES = [
  "apps/api/src/services/fullLengthExam.ts",
  "apps/api/src/services/fullLengthScoreTables.ts",
  "apps/api/src/services/exams",
  "server/routes/full-length-exam-routes.ts",
  "server/lib/runtime-contract-disable.ts",
];

const PRE_BASELINE_EXAM_TABLES = [
  "exam_attempts",
  "exam_responses",
  "exam_score_rollups",
  "exam_forms",
  "exam_form_items",
  "full_length_exam_sessions",
  "full_length_exam_modules",
  "full_length_exam_questions",
  "full_length_exam_responses",
  "test_forms",
  "test_form_items",
  "exam_runtime_config",
  "exam_runtime_config_history",
  "full_length_adaptive_config",
  "full_length_adaptive_config_history",
];

const FORBIDDEN_TOKENS = PRE_BASELINE_EXAM_TABLES.flatMap((table) => [
  `.from("${table}")`,
  `.from('${table}')`,
]);

const RUNTIME_ROOTS = ["server", "apps/api/src"];
const EXCLUDED_SEGMENTS = [
  "node_modules",
  "dist",
  "__tests__",
  ".test.ts",
  ".spec.ts",
  ".d.ts",
];

function listRuntimeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relative = path
      .relative(repoRoot, fullPath)
      .split(path.sep)
      .join("/");
    if (EXCLUDED_SEGMENTS.some((segment) => relative.includes(segment)))
      continue;
    if (entry.isDirectory()) {
      out.push(...listRuntimeFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

describe("Full-length pre-baseline runtime stays deleted (E1)", () => {
  it("the deleted full-length service, router and disable helper are absent", () => {
    const present = DELETED_RUNTIME_FILES.filter((relative) =>
      fs.existsSync(path.join(repoRoot, relative)),
    );
    expect(present, present.join("\n")).toEqual([]);
  });

  it("no runtime code under server/ or apps/api/src reads a pre-baseline exam table", () => {
    const violations: string[] = [];
    for (const root of RUNTIME_ROOTS) {
      for (const filePath of listRuntimeFiles(path.join(repoRoot, root))) {
        const relative = path
          .relative(repoRoot, filePath)
          .split(path.sep)
          .join("/");
        const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          for (const token of FORBIDDEN_TOKENS) {
            if (line.includes(token)) {
              violations.push(`${relative}:${index + 1} -> ${token}`);
            }
          }
        });
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
