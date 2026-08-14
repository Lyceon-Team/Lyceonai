/**
 * @spec [Doc 02 Preamble §12 Reveal Matrix, INV-02-09]
 * @implemented 2026-08-09
 * plain English: CI gate asserting EX-05: difficultyBucket must NOT appear in
 * any client-facing type or component. These are structural invariant assertions
 * (file content scanning), not runtime behavior tests — this is intentional:
 * the invariant ("field X must not exist in type Y") is inherently a source-level
 * property. A runtime test cannot prove a field's absence from a type definition.
 *
 * expected outcome: all assertions pass confirming no client-visible surface
 * references difficultyBucket or difficulty_bucket.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("EX-05: difficultyBucket stripped from client-facing serialization", () => {
  it("SubmitModuleResult.nextModule does NOT contain difficultyBucket", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../apps/api/src/services/fullLengthExam.ts"),
      "utf-8",
    );
    const submitResultBlock = src.match(
      /export interface SubmitModuleResult\s*\{[\s\S]*?\n\}/,
    );
    expect(submitResultBlock).not.toBeNull();
    expect(submitResultBlock![0]).not.toContain("difficultyBucket");
  });

  it("ExamReviewModule does NOT contain difficultyBucket", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../apps/api/src/services/fullLengthExam.ts"),
      "utf-8",
    );
    const reviewModuleBlock = src.match(
      /export interface ExamReviewModule\s*\{[\s\S]*?\n\}/,
    );
    expect(reviewModuleBlock).not.toBeNull();
    expect(reviewModuleBlock![0]).not.toContain("difficultyBucket");
  });

  it("review mapping does NOT populate difficultyBucket", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../apps/api/src/services/fullLengthExam.ts"),
      "utf-8",
    );
    const reviewFn = src.match(
      /async function getExamReviewAfterCompletion[\s\S]*?^}/m,
    );
    expect(reviewFn).not.toBeNull();
    expect(reviewFn![0]).not.toMatch(/difficultyBucket\s*:/);
    expect(reviewFn![0]).not.toMatch(/difficulty_bucket/);
  });

  it("FullLengthReviewView.tsx does NOT reference difficultyBucket", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../client/src/components/full-length-exam/FullLengthReviewView.tsx",
      ),
      "utf-8",
    );
    expect(src).not.toContain("difficultyBucket");
    expect(src).not.toContain("difficulty_bucket");
  });

  it("ExamRunner.tsx does NOT reference difficultyBucket", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../client/src/components/full-length-exam/ExamRunner.tsx",
      ),
      "utf-8",
    );
    expect(src).not.toContain("difficultyBucket");
    expect(src).not.toContain("difficulty_bucket");
  });

  it("no client-facing file in client/ references difficultyBucket", () => {
    const clientDir = path.resolve(__dirname, "../../client/src");
    const violations: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          walk(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))
        ) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (
            content.includes("difficultyBucket") ||
            content.includes("difficulty_bucket")
          ) {
            violations.push(path.relative(clientDir, fullPath));
          }
        }
      }
    }

    walk(clientDir);
    expect(
      violations,
      `Client files referencing difficultyBucket: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});
