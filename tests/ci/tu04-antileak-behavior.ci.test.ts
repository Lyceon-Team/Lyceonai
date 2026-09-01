/**
 * @spec [Doc 02 Preamble §12 Reveal Matrix, INV-02-09; Doc 03B §16 Anti-Leak
 *        at API Boundary, INV-03-04, INV-03-12]
 * @implemented 2026-08-09
 * plain English: CI gate for TU-04 — anti-leak behavior assertions. Tests the
 * hasAnswerLeak scanner (answer-aware pattern detection for MCQ and grid-in)
 * and the scanAndSubstitute pipeline (pre-submit blocks leaks, post-submit
 * passes through, replay path covered).
 *
 * expected outcome: all assertions confirm correct leak detection, substitution,
 * and false-positive exclusion for the anti-leak pipeline.
 */
import { describe, it, expect } from "vitest";
import { hasAnswerLeak } from "../../shared/tutor-safety-constants";
import {
  scanAndSubstitute,
  TUTOR_ANTI_LEAK_SUBSTITUTION,
} from "../../server/services/tutor-antileak";

// ---------------------------------------------------------------------------
// TU-04: hasAnswerLeak detection patterns (answer-aware)
// ---------------------------------------------------------------------------

describe("TU-04: hasAnswerLeak pattern coverage", () => {
  it("hasAnswerLeak is exported from shared safety constants", () => {
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
    expect(hasAnswerLeak("so that gives us 3.5", "7/2")).toBe(true);
    expect(hasAnswerLeak("you get 7/2", "3.5")).toBe(true);
  });

  it("does NOT flag false-positive structural prefixes", () => {
    expect(hasAnswerLeak("In step 3, we substitute", "3")).toBe(false);
    expect(hasAnswerLeak("See question 7 for context", "7")).toBe(false);
    expect(hasAnswerLeak("Look at part 2 of this problem", "2")).toBe(false);
  });

  it("does NOT match answer inside a larger number", () => {
    expect(hasAnswerLeak("The value 13.51 appears", "3.5")).toBe(false);
    expect(hasAnswerLeak("Consider 42.0 as the base", "2")).toBe(false);
  });

  it("falls back to phrase patterns when correctAnswer is null", () => {
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
    const preSubmitResult = scanAndSubstitute(
      "The correct answer is B",
      "B",
      true,
    );
    expect(preSubmitResult.leaked).toBe(true);
    expect(preSubmitResult.content).toBe(TUTOR_ANTI_LEAK_SUBSTITUTION);

    const postSubmitResult = scanAndSubstitute(
      "The correct answer is B",
      "B",
      false,
    );
    expect(postSubmitResult.leaked).toBe(false);
    expect(postSubmitResult.content).toBe("The correct answer is B");
  });

  it("scanAndSubstitute silently substitutes without throwing", () => {
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
    const persistedMessage =
      "Great question! The correct answer is D, because the slope is positive.";
    const result = scanAndSubstitute(persistedMessage, "D", true);
    expect(result.leaked).toBe(true);
    expect(result.content).toBe(TUTOR_ANTI_LEAK_SUBSTITUTION);

    const postSubmitResult = scanAndSubstitute(persistedMessage, "D", false);
    expect(postSubmitResult.leaked).toBe(false);
    expect(postSubmitResult.content).toBe(persistedMessage);
  });
});

// ---------------------------------------------------------------------------
// TU-04: Echo exemption — student-stated values are reflection, not disclosure
// ---------------------------------------------------------------------------

describe("TU-04: echo exemption", () => {
  // Case 1: Student said "17", LISA references 17 → PASSES (echo)
  it("grid-in: student said the correct value; LISA repeating it is NOT a leak", () => {
    const leaked = hasAnswerLeak(
      "Right, you mentioned 17 — let's verify that.",
      "17",
      ["I think the answer is 17"],
    );
    expect(leaked).toBe(false);
  });

  // Case 2: Student said "14" (wrong), LISA references 17 → FIRES
  it("grid-in: student said a DIFFERENT value; LISA stating the answer IS a leak", () => {
    const leaked = hasAnswerLeak("Actually, the value works out to 17.", "17", [
      "I think the answer is 14",
    ]);
    expect(leaked).toBe(true);
  });

  // Case 3: No student turn contains 17, LISA references 17 → FIRES
  it("grid-in: no student message contains the answer; LISA stating it IS a leak", () => {
    const leaked = hasAnswerLeak("The result is 17.", "17", [
      "Can you help me with this problem?",
    ]);
    expect(leaked).toBe(true);
  });

  // Case 4: Student said "17" in a tutor-role message → FIRES (role check)
  // The studentMessages parameter should only contain student-role messages.
  // If a tutor message is passed (caller error), the scanner would exempt,
  // but the contract is that callers extract student-role only. This test
  // verifies that an empty studentMessages array (no student said it) fires.
  it("grid-in: answer only in tutor turn (not student); still a leak", () => {
    const leaked = hasAnswerLeak(
      "The result is 17.",
      "17",
      [], // no student messages — the "17" was in a tutor-role message
    );
    expect(leaked).toBe(true);
  });

  // Case 5: MCQ — student said "B", LISA references B → passes; student
  // said "C", LISA references B → FIRES
  it("MCQ: student said the correct letter → echo; student said wrong letter → leak", () => {
    const echoResult = hasAnswerLeak(
      "You mentioned B — let's look at why that's right.",
      "B",
      ["I think it's B"],
    );
    expect(echoResult).toBe(false);

    const leakResult = hasAnswerLeak("Actually, the answer is B.", "B", [
      "I think it's C",
    ]);
    expect(leakResult).toBe(true);
  });

  // Supplementary: no studentMessages provided → fail-closed (pre-exemption behavior)
  it("no studentMessages parameter → fail-closed (scanner fires as before)", () => {
    const leaked = hasAnswerLeak("The result is 17.", "17");
    expect(leaked).toBe(true);
  });

  // Supplementary: generic phrase detection has NO echo exemption
  it("generic phrase detection ignores echo exemption (null correctAnswer)", () => {
    const leaked = hasAnswerLeak("The correct answer is B", null, [
      "I think it's B",
    ]);
    expect(leaked).toBe(true);
  });

  // Supplementary: echo exemption through scanAndSubstitute pipeline
  it("scanAndSubstitute passes echo through when student stated the value", () => {
    const result = scanAndSubstitute(
      "Right, 17 is what you got — let's check.",
      "17",
      true,
      ["I got 17"],
    );
    expect(result.leaked).toBe(false);
    expect(result.content).toBe("Right, 17 is what you got — let's check.");
  });
});
