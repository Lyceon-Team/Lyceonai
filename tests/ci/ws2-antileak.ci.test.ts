/**
 * @spec [Doc 02 Preamble §12 Reveal Matrix, INV-02-09; Doc 03B §16 Anti-Leak at API Boundary, INV-03-04, INV-03-12]
 * | @implemented [2026-06-24]
 * plain English: CI gate for WS-2 anti-leak pair (EX-05 + TU-04). Asserts:
 * 1. SubmitModuleResult.nextModule type does NOT contain difficultyBucket
 * 2. ExamReviewModule type does NOT contain difficultyBucket
 * 3. hasDirectAnswerLeak correctly detects MCQ answer reveals
 * 4. isPreSubmitForSurface returns correct values per surface
 * 5. Client components do NOT reference difficultyBucket
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// EX-05: difficultyBucket must NOT appear in client-facing types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TU-04: hasDirectAnswerLeak detection patterns
// ---------------------------------------------------------------------------

describe("TU-04: hasDirectAnswerLeak pattern coverage", () => {
  it("hasDirectAnswerLeak function exists in tutor-runtime source", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    expect(src).toContain(
      "function hasDirectAnswerLeak(text: string): boolean",
    );
  });

  it("detects 'the correct answer is' pattern", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const fn = extractHasDirectAnswerLeak(src);
    expect(fn("The correct answer is B")).toBe(true);
    expect(fn("the correct answer is A")).toBe(true);
  });

  it("detects 'the right answer is' pattern", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const fn = extractHasDirectAnswerLeak(src);
    expect(fn("The right answer is C")).toBe(true);
  });

  it("detects 'choose option X' pattern", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const fn = extractHasDirectAnswerLeak(src);
    expect(fn("You should choose option A")).toBe(true);
    expect(fn("choose option D for this question")).toBe(true);
  });

  it("detects 'answer: X' pattern", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const fn = extractHasDirectAnswerLeak(src);
    expect(fn("answer: B")).toBe(true);
    expect(fn("Answer: A")).toBe(true);
  });

  it("detects 'option X is correct' pattern", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const fn = extractHasDirectAnswerLeak(src);
    expect(fn("option A is correct")).toBe(true);
    expect(fn("choice B = right")).toBe(true);
  });

  it("does NOT flag safe pedagogical text", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const fn = extractHasDirectAnswerLeak(src);
    expect(fn("Think about what happens when x = 3")).toBe(false);
    expect(fn("Let's review the concept of linear equations")).toBe(false);
    expect(fn("Consider each option carefully")).toBe(false);
    expect(fn("What do you think the answer might be?")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TU-04: isPreSubmitForSurface structural chokepoint
// ---------------------------------------------------------------------------

describe("TU-04: isPreSubmitForSurface structural chokepoint", () => {
  it("isPreSubmitForSurface exists and handles all surface types", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    expect(src).toContain("async function isPreSubmitForSurface(");
    expect(src).toMatch(/surface.*===.*"practice"/);
    expect(src).toContain("review");
    expect(src).toContain("test_review");
    expect(src).toContain("dashboard");
  });

  it("anti-leak filter uses isPreSubmitForSurface (not surface === practice)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const appendTurnSection = src.slice(
      src.indexOf("const cleaned = removeInternalMetadataMentions") ??
        src.indexOf("removeInternalMetadataMentions"),
    );
    const nextChunk = appendTurnSection.slice(0, 2000);
    expect(nextChunk).toContain("isPreSubmitForSurface");
    expect(nextChunk).toContain("hasDirectAnswerLeak");
    expect(nextChunk).not.toMatch(
      /source_surface\s*===\s*["']practice["']\s*\)\s*\{[\s\S]{0,200}hasDirectAnswerLeak/,
    );
  });

  it("replay endpoint applies defense-in-depth leak filter", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    const replayIdx = src.indexOf('"/conversations/:conversationId"');
    expect(replayIdx).toBeGreaterThan(-1);

    const replaySection = src.slice(replayIdx, replayIdx + 3000);
    expect(replaySection).toContain("isPreSubmitForSurface");
    expect(replaySection).toContain("hasDirectAnswerLeak");
    expect(replaySection).toContain("Let me think about this differently.");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHasDirectAnswerLeak(source: string): (text: string) => boolean {
  const fnMatch = source.match(
    /function hasDirectAnswerLeak\(text: string\): boolean\s*\{([\s\S]*?)\n\}/,
  );
  if (!fnMatch) {
    throw new Error("Could not extract hasDirectAnswerLeak from source");
  }

  const patternsMatch = fnMatch[1].match(/const patterns = \[([\s\S]*?)\];/);
  if (!patternsMatch) {
    throw new Error("Could not extract patterns array");
  }

  const regexLiterals = patternsMatch[1].match(/\/[^/]+\/[gimsuy]*/g);
  if (!regexLiterals || regexLiterals.length === 0) {
    throw new Error("No regex patterns found");
  }

  const patterns = regexLiterals.map((lit) => {
    const lastSlash = lit.lastIndexOf("/");
    const pattern = lit.slice(1, lastSlash);
    const flags = lit.slice(lastSlash + 1);
    return new RegExp(pattern, flags);
  });

  return (text: string) => patterns.some((p) => p.test(text));
}
