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

  it("tutor-runtime imports hasAnswerLeak from tutor-context", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    expect(src).toContain("hasAnswerLeak");
    expect(src).toMatch(
      /import\s*\{[^}]*hasAnswerLeak[^}]*\}\s*from\s*["']\.\.\/services\/tutor-context/,
    );
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
    expect(nextChunk).toContain("hasAnswerLeak");
    expect(nextChunk).not.toMatch(
      /source_surface\s*===\s*["']practice["']\s*\)\s*\{[\s\S]{0,200}hasAnswerLeak/,
    );
  });

  // §16.4-5 + INV-03-13: the append-turn block path must SILENTLY substitute the
  // shared pedagogical fallback, NOT return a 422 error. The violating 422 block
  // code must not exist anywhere in the route.
  it("append-turn block path silently substitutes (no 422 TUTOR_ANTI_LEAK_BLOCKED)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    // The violating error code is fully removed from the route.
    expect(src).not.toContain("TUTOR_ANTI_LEAK_BLOCKED");

    // The append-turn path computes a safeContent substitution from the leak check.
    const appendTurnSection = src.slice(
      src.indexOf("const cleaned = removeInternalMetadataMentions"),
    );
    const nextChunk = appendTurnSection.slice(0, 1500);
    expect(nextChunk).toContain("const safeContent");
    // Leak detection drives the ternary; substitution selects the shared fallback.
    expect(nextChunk).toContain("hasAnswerLeak(cleaned, correctAnswer)");
    expect(nextChunk).toContain("TUTOR_ANTI_LEAK_SUBSTITUTION");
    // The block path never calls sendTutorError (no error response on a leak).
    const blockToInsert = nextChunk.slice(
      0,
      nextChunk.indexOf("tutor_messages"),
    );
    expect(blockToInsert).not.toContain("sendTutorError");
  });

  // Parallel-paths rule: both block paths (append-turn + replay) emit ONE shared
  // substitution, the same way.
  it("both block paths use the single shared TUTOR_ANTI_LEAK_SUBSTITUTION constant", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes/tutor-runtime.ts"),
      "utf-8",
    );
    // Defined exactly once as a module-level constant.
    const defMatches =
      src.match(/const TUTOR_ANTI_LEAK_SUBSTITUTION\s*=/g) ?? [];
    expect(defMatches).toHaveLength(1);

    // Referenced by both the append-turn path and the replay path.
    const refMatches = src.match(/TUTOR_ANTI_LEAK_SUBSTITUTION/g) ?? [];
    // 1 definition + 2 usages (append-turn safeContent, replay message).
    expect(refMatches.length).toBeGreaterThanOrEqual(3);

    // The literal pedagogical fallback appears exactly once (the constant), never
    // duplicated inline at a usage site.
    const literalMatches =
      src.match(/Let me think about this differently\./g) ?? [];
    expect(literalMatches).toHaveLength(1);
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
    expect(replaySection).toContain("hasAnswerLeak");
    expect(replaySection).toContain("TUTOR_ANTI_LEAK_SUBSTITUTION");
  });
});
