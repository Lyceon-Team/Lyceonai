import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_LEGACY_TABLE_TOKENS = [
  '.from("exam_attempts")',
  ".from('exam_attempts')",
  '.from("exam_responses")',
  ".from('exam_responses')",
  '.from("exam_score_rollups")',
  ".from('exam_score_rollups')",
  '.from("exam_forms")',
  ".from('exam_forms')",
  '.from("exam_form_items")',
  ".from('exam_form_items')",
];

describe("Full-length canonical scoring/read contract", () => {
  it("does not reference legacy exam_* tables from mounted full-length runtime paths", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const targets = [
      path.join(repoRoot, "apps", "api", "src", "services", "fullLengthExam.ts"),
      path.join(repoRoot, "server", "routes", "full-length-exam-routes.ts"),
    ];

    const violations: string[] = [];
    for (const filePath of targets) {
      const source = fs.readFileSync(filePath, "utf8");
      const relative = path.relative(repoRoot, filePath).split(path.sep).join("/");
      for (const token of FORBIDDEN_LEGACY_TABLE_TOKENS) {
        if (source.includes(token)) {
          violations.push(`${relative} -> ${token}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("anchors scoring/review reads on canonical full-length tables", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const servicePath = path.join(repoRoot, "apps", "api", "src", "services", "fullLengthExam.ts");
    const source = fs.readFileSync(servicePath, "utf8");

    expect(source).toContain('.from("full_length_exam_sessions")');
    expect(source).toContain('.from("full_length_exam_questions")');
    expect(source).toContain('.from("full_length_exam_responses")');
  });
});

