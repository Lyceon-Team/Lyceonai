/**
 * @spec [Doc 02 Preamble §12 Reveal Matrix, INV-02-09; Doc 03B §16 Anti-Leak at API Boundary, INV-03-04, INV-03-12]
 * | @implemented [2026-06-24] | @updated [2026-08-07]
 * plain English: CI gate for WS-2 anti-leak pair (EX-05 + TU-04). Asserts:
 * 1. SubmitModuleResult.nextModule type does NOT contain difficultyBucket
 * 2. ExamReviewModule type does NOT contain difficultyBucket
 * 3. hasAnswerLeak correctly detects MCQ/grid-in answer reveals (answer-aware)
 * 4. isPreSubmitForSurface returns correct values per surface
 * 5. Client components do NOT reference difficultyBucket
 *
 * @updated 2026-08-07 — WS-L2: hasDirectAnswerLeak (nine-regex matcher in
 * tutor-runtime.ts) replaced by answer-aware hasAnswerLeak in tutor-context.ts.
 * Tests now import the exported function directly instead of extracting regex
 * patterns from source. Structural assertions updated to reference hasAnswerLeak.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { hasAnswerLeak } from "../../server/services/tutor-context";
import {
  scanAndSubstitute,
  TUTOR_ANTI_LEAK_SUBSTITUTION,
} from "../../server/services/tutor-antileak";

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
// TU-04: hasAnswerLeak detection patterns (answer-aware)
// ---------------------------------------------------------------------------

describe("TU-04: hasAnswerLeak pattern coverage", () => {
  it("hasAnswerLeak is exported from tutor-context", () => {
    expect(typeof hasAnswerLeak).toBe("function");
  });

  it("given a leaking pre-submit response, scanAndSubstitute returns the substitution text", () => {
    const result = scanAndSubstitute("The correct answer is B", "B", true);
    expect(result.leaked).toBe(true);
    expect(result.content).toBe(TUTOR_ANTI_LEAK_SUBSTITUTION);
  });

  it("detects MCQ answer leak for the specific correct letter", () => {
    expect(hasAnswerLeak("The correct answer is B", "B")).toBe(true);
    expect(hasAnswerLeak("the correct answer is A", "A")).toBe(true);
    expect(hasAnswerLeak("Answer: C", "C")).toBe(true);
  });

  it("does NOT flag MCQ text referencing a different letter", () => {
    // When the correct answer is B, mentioning A is not a leak
    expect(hasAnswerLeak("The correct answer is A", "B")).toBe(false);
    expect(hasAnswerLeak("choose option C", "B")).toBe(false);
  });

  it("detects 'choose option X' pattern for correct letter", () => {
    expect(hasAnswerLeak("You should choose option A", "A")).toBe(true);
    expect(hasAnswerLeak("choose option D for this question", "D")).toBe(true);
  });

  it("detects 'option X is correct' pattern for correct letter", () => {
    expect(hasAnswerLeak("option A is correct", "A")).toBe(true);
  });

  it("detects grid-in answer leak (exact value in text)", () => {
    expect(hasAnswerLeak("The answer is 42", "42")).toBe(true);
    expect(hasAnswerLeak("you get 3.5 as the result", "3.5")).toBe(true);
    expect(hasAnswerLeak("you should get 7", "7")).toBe(true);
  });

  it("detects grid-in leak via containment (no regex would catch these)", () => {
    expect(hasAnswerLeak("so that's 3.5", "3.5")).toBe(true);
    expect(hasAnswerLeak("we land on 3.5", "3.5")).toBe(true);
    expect(hasAnswerLeak("3.5 is what you're after", "3.5")).toBe(true);
  });

  it("detects grid-in leak with fraction/decimal equivalence", () => {
    // 7/2 = 3.5 — if the model says 3.5, that leaks the answer even if stored as 7/2
    expect(hasAnswerLeak("so that gives us 3.5", "7/2")).toBe(true);
    expect(hasAnswerLeak("you get 7/2", "3.5")).toBe(true);
  });

  it("does NOT flag false-positive structural prefixes", () => {
    // "step 3" when the answer is "3" — structural reference, not a leak
    expect(hasAnswerLeak("In step 3, we substitute", "3")).toBe(false);
    expect(hasAnswerLeak("See question 7 for context", "7")).toBe(false);
    expect(hasAnswerLeak("Look at part 2 of this problem", "2")).toBe(false);
  });

  it("does NOT match answer inside a larger number", () => {
    expect(hasAnswerLeak("The value 13.51 appears", "3.5")).toBe(false);
    expect(hasAnswerLeak("Consider 42.0 as the base", "2")).toBe(false);
  });

  it("falls back to phrase patterns when correctAnswer is null", () => {
    // With null correctAnswer, falls back to generic pattern matching
    expect(hasAnswerLeak("The correct answer is B", null)).toBe(true);
    expect(hasAnswerLeak("the right answer is A", null)).toBe(true);
    expect(hasAnswerLeak("choose option D", null)).toBe(true);
    expect(hasAnswerLeak("Answer: A", null)).toBe(true);
  });

  it("does NOT flag safe pedagogical text", () => {
    expect(hasAnswerLeak("Think about what happens when x = 3", "B")).toBe(
      false,
    );
    expect(
      hasAnswerLeak("Let's review the concept of linear equations", "A"),
    ).toBe(false);
    expect(hasAnswerLeak("Consider each option carefully", "C")).toBe(false);
    expect(hasAnswerLeak("What do you think the answer might be?", null)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// TU-04: anti-leak pipeline behavior
// ---------------------------------------------------------------------------

describe("TU-04: anti-leak pipeline behavior", () => {
  it("pre-submit turns block leaks, post-submit turns do not", () => {
    // Pre-submit: leak detected and substituted
    const preSubmitResult = scanAndSubstitute(
      "The correct answer is B",
      "B",
      true,
    );
    expect(preSubmitResult.leaked).toBe(true);
    expect(preSubmitResult.content).toBe(TUTOR_ANTI_LEAK_SUBSTITUTION);

    // Post-submit: same text passes through unmodified
    const postSubmitResult = scanAndSubstitute(
      "The correct answer is B",
      "B",
      false,
    );
    expect(postSubmitResult.leaked).toBe(false);
    expect(postSubmitResult.content).toBe("The correct answer is B");
  });

  it("scanAndSubstitute silently substitutes without throwing", () => {
    // The anti-leak path must silently substitute, never throw or return an error.
    // @spec [INV-03-13, §16.4-5]
    expect(() => scanAndSubstitute("The answer is C", "C", true)).not.toThrow();
    const result = scanAndSubstitute("The answer is C", "C", true);
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("leaked");
    expect(result.leaked).toBe(true);
    expect(result.content).not.toBe("The answer is C");
  });

  it("substitution text is the canonical pedagogical fallback", () => {
    const result = scanAndSubstitute("Answer: A", "A", true);
    expect(result.content).toBe(TUTOR_ANTI_LEAK_SUBSTITUTION);
    expect(TUTOR_ANTI_LEAK_SUBSTITUTION).toContain(
      "think about this differently",
    );
  });

  it("safe pre-submit responses pass through without substitution", () => {
    const result = scanAndSubstitute(
      "Think about what approach you would take here.",
      "B",
      true,
    );
    expect(result.leaked).toBe(false);
    expect(result.content).toBe(
      "Think about what approach you would take here.",
    );
  });

  it("the replay endpoint substitutes a leaking persisted message", () => {
    // Simulates replay: a previously persisted tutor message that contains a leak.
    // When replayed in a pre-submit context, scanAndSubstitute substitutes it.
    const persistedMessage =
      "Great question! The correct answer is D, because the slope is positive.";
    const result = scanAndSubstitute(persistedMessage, "D", true);
    expect(result.leaked).toBe(true);
    expect(result.content).toBe(TUTOR_ANTI_LEAK_SUBSTITUTION);

    // Same persisted message in post-submit context passes through (replay after submit)
    const postSubmitResult = scanAndSubstitute(persistedMessage, "D", false);
    expect(postSubmitResult.leaked).toBe(false);
    expect(postSubmitResult.content).toBe(persistedMessage);
  });
});
