/**
 * The QOTD readability rules, as one pure predicate.
 *
 * @spec [owner brief "QOTD — readability filter (Karl's option B)" (Karl, 2026-10-09) "Rules";
 *       owner brief "QOTD follow-up" (Karl, 2026-10-10): RW passage + question <= 400]
 *       | @implemented [2026-10-09; RW total 2026-10-10]
 *
 * plain English: the thresholds are the named constants (400 Math; 300 passage and 400 in total
 * for Reading and Writing), counted on visible text; the scheduler and the social generator both import this module, which
 * the import test below proves so the two can never drift apart.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPairedPassage,
  QOTD_MATH_MAX_CHARS,
  QOTD_RW_MAX_PASSAGE_CHARS,
  QOTD_RW_MAX_TOTAL_CHARS,
  qotdReadabilityProblem,
  qotdVisibleText,
} from "../../shared/qotd/readability";

describe("qotdReadabilityProblem", () => {
  it("the thresholds are Karl's numbers", () => {
    expect(QOTD_MATH_MAX_CHARS).toBe(400);
    expect(QOTD_RW_MAX_PASSAGE_CHARS).toBe(300);
    expect(QOTD_RW_MAX_TOTAL_CHARS).toBe(400);
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
        stem: "s".repeat(50),
        passage,
      });
    expect(at("p".repeat(300))).toBeNull();
    expect(at(`<p>${"p".repeat(300)}</p>\n\n`)).toBeNull();
    expect(at("p".repeat(301))).toBe("rw_passage_too_long");
    expect(qotdVisibleText("  a\n\n<b>b</b>  ")).toBe("a b");
  });

  it("Reading and Writing: a short passage with a long question is refused (passage + question <= 400)", () => {
    const rw = (passage: string, stem: string) =>
      qotdReadabilityProblem({ section: "RW", itemType: "mcq", stem, passage });
    // The production shape that passed the passage-only rule: 137 + 1 + 882 = 1,020.
    expect(rw("p".repeat(137), "s".repeat(882))).toBe("rw_too_long");
    // The boundary: 150 + 1 (the joining space) + 249 = 400 passes, one more fails.
    expect(rw("p".repeat(150), "s".repeat(249))).toBeNull();
    expect(rw("p".repeat(150), "s".repeat(250))).toBe("rw_too_long");
    // A passage over 300 still names the passage, whatever the total.
    expect(rw("p".repeat(301), "s")).toBe("rw_passage_too_long");
    // Markup in the stem is not counted.
    expect(rw("p".repeat(150), `<p>${"s".repeat(249)}</p>\n`)).toBeNull();
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
