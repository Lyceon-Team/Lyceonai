/**
 * @spec [owner ruling 2026-10-05: explanations never name a choice letter (content rule); the
 *       QOTD scheduler screen is a backstop; the letter part is case-sensitive] | @implemented [2026-10-05]
 *
 * plain English: pins the shared letter-reference pattern (shared/practice/letter-reference.ts)
 * in both directions, and that it is case-sensitive: lower-case "a" after "answer" is an
 * article, not a choice.
 */
import { describe, expect, it } from "vitest";
import {
  EXPLANATION_LETTER_REFERENCE,
  explanationNamesChoiceLetter,
} from "../../shared/practice/letter-reference";

describe("explanationNamesChoiceLetter", () => {
  it("is case-sensitive: no `i` flag", () => {
    expect(EXPLANATION_LETTER_REFERENCE.flags).not.toContain("i");
  });

  it.each([
    "To answer a different question, first find the slope.",
    "answer a different question",
    "choice a is not a label here",
    "Let B be the midpoint of segment AC; then AB = BC.",
    "In option (a) of the list, the value doubles.",
  ])("does not flag %j", (text) => {
    expect(explanationNamesChoiceLetter(text)).toBe(false);
  });

  it.each([
    "Option A is incorrect because the slope is negative.",
    "Choice C gives the correct total.",
    "The answer is B.",
    "(D) misreads the table.",
  ])("flags %j", (text) => {
    expect(explanationNamesChoiceLetter(text)).toBe(true);
  });

  it("is false for a missing explanation", () => {
    expect(explanationNamesChoiceLetter(null)).toBe(false);
    expect(explanationNamesChoiceLetter(undefined)).toBe(false);
  });
});
