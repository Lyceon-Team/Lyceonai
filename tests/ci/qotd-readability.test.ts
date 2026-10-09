/**
 * The QOTD readability rules, as one pure predicate.
 *
 * @spec [owner brief "QOTD — readability filter (Karl's option B)" (Karl, 2026-10-09) "Rules"]
 *       | @implemented [2026-10-09]
 *
 * plain English: the thresholds are the named constants (400 Math, 300 Reading and Writing),
 * counted on visible text; the scheduler and the social generator both import this module, which
 * the import test below proves so the two can never drift apart.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPairedPassage,
  QOTD_MATH_MAX_CHARS,
  QOTD_RW_MAX_PASSAGE_CHARS,
  qotdReadabilityProblem,
  qotdVisibleText,
} from "../../shared/qotd/readability";

describe("qotdReadabilityProblem", () => {
  it("the thresholds are Karl's numbers", () => {
    expect(QOTD_MATH_MAX_CHARS).toBe(400);
    expect(QOTD_RW_MAX_PASSAGE_CHARS).toBe(300);
  });

  it("multiple choice only", () => {
    expect(
      qotdReadabilityProblem({
        section: "M",
        itemType: "grid_in",
        stem: "2+2",
        passage: null,
      }),
    ).toBe("not_multiple_choice");
    expect(
      qotdReadabilityProblem({
        section: "M",
        itemType: "mcq",
        stem: "2+2",
        passage: null,
      }),
    ).toBeNull();
  });

  it("paired passages are refused, in any case and spacing; one 'Text 1' alone is not paired", () => {
    expect(isPairedPassage("<p>Text 1</p> ... <p>TEXT  2</p>")).toBe(true);
    expect(isPairedPassage("Text 1 says only this.")).toBe(false);
    expect(isPairedPassage("Text 10 and Text 20 are table names.")).toBe(false);
    expect(
      qotdReadabilityProblem({
        section: "RW",
        itemType: "mcq",
        stem: "Which choice best describes the relationship?",
        passage: "Text 1: short. Text 2: short.",
      }),
    ).toBe("paired_passage");
  });

  it("Math: passage plus question text, at most 400 visible characters", () => {
    const at = (n: number) =>
      qotdReadabilityProblem({
        section: "M",
        itemType: "mcq",
        stem: "q".repeat(n),
        passage: null,
      });
    expect(at(400)).toBeNull();
    expect(at(401)).toBe("math_too_long");
    // The passage counts too.
    expect(
      qotdReadabilityProblem({
        section: "M",
        itemType: "mcq",
        stem: "q".repeat(250),
        passage: "p".repeat(150),
      }),
    ).toBe("math_too_long");
  });

  it("Reading and Writing: the passage alone, at most 300 visible characters; markup is not counted", () => {
    const at = (passage: string) =>
      qotdReadabilityProblem({
        section: "RW",
        itemType: "mcq",
        stem: "s".repeat(500),
        passage,
      });
    expect(at("p".repeat(300))).toBeNull();
    expect(at(`<p>${"p".repeat(300)}</p>\n\n`)).toBeNull();
    expect(at("p".repeat(301))).toBe("rw_passage_too_long");
    expect(qotdVisibleText("  a\n\n<b>b</b>  ")).toBe("a b");
  });

  it("the scheduler and the social generator use this one predicate", () => {
    for (const file of [
      "server/services/qotd/schedule-job.ts",
      "shared/qotd/social.ts",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(
        /from "(?:\.\.\/)*(?:shared\/qotd\/|\.\/)readability"/,
      );
      expect(src).toContain("qotdReadabilityProblem(");
    }
  });
});
