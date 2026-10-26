/**
 * @spec [Karl's instruction 2026-10-23: vision OCR of the grammar guide before any ingestion;
 *       the Correct/Incorrect labels must survive exactly; ACT-only content must be
 *       identifiable] | @implemented [2026-10-23]
 *
 * plain English: the pure guards of scripts/rag/ocr-book.ts.
 *  - labelsInMarkdown finds the Correct/Incorrect-family labels and nothing else (not "Tip-off:",
 *    "Shortcut:", "Note:").
 *  - compareLabels reports a dropped label, an inverted label and a label attached to the wrong
 *    example, and is silent when two readings agree.
 *  - actOnlySectionStart finds the "ACT ONLY" banner, so every rule under it is flagged even
 *    when its own title does not say so.
 */
import { describe, expect, it } from "vitest";
import {
  actOnlySectionStart,
  compareLabels,
  labelsInMarkdown,
  parsePages,
} from "../../scripts/rag/ocr-book";

const PAGE = [
  "## 3. COMMA + FANBOYS",
  "",
  "**Tip-off:** comma + pronoun (e.g., *it, they*)",
  "",
  "**Incorrect:** London is a very old **city, it** has some extremely modern parts.",
  "",
  "**Correct:** London is a very old **city. It** has some extremely modern parts.",
  "",
  "**Note:** ACT grammar questions testing *however* use a semicolon.",
].join("\n");

describe("the label guard", () => {
  it("reads only the Correct/Incorrect family, in order, with each example's start", () => {
    expect(labelsInMarkdown(PAGE)).toEqual([
      { label: "Incorrect", example_start: "London is a very old" },
      { label: "Correct", example_start: "London is a very old" },
    ]);
  });

  const reading = [
    { label: "Incorrect", example_start: "London is a very old" },
    { label: "Correct", example_start: "London is a very old" },
  ];

  it("agreeing readings report nothing; other lead-ins in the reading are ignored", () => {
    expect(
      compareLabels(labelsInMarkdown(PAGE), [
        { label: "Tip-off", example_start: "comma + pronoun" },
        ...reading,
      ]),
    ).toEqual([]);
  });

  it("an inverted label is reported", () => {
    const inverted = PAGE.replace("**Incorrect:**", "**Correct:**");
    expect(compareLabels(labelsInMarkdown(inverted), reading)).toEqual([
      'label 1: transcription "Correct", independent reading "Incorrect"',
    ]);
  });

  it("a dropped label is reported", () => {
    const dropped = PAGE.replace("**Incorrect:** ", "");
    expect(compareLabels(labelsInMarkdown(dropped), reading)[0]).toMatch(
      /label count: transcription 1, independent reading 2/,
    );
  });

  it("a label attached to a different example is reported", () => {
    expect(
      compareLabels(labelsInMarkdown(PAGE), [
        { label: "Incorrect", example_start: "Paris is a very old" },
        reading[1] ?? reading[0] ?? { label: "", example_start: "" },
      ]),
    ).toEqual([
      'label 1 (Incorrect): example starts "London is a very old" vs "Paris is a very old"',
    ]);
  });
});

describe("the ACT-only section", () => {
  it("starts at the banner page and is null without one", () => {
    expect(
      actOnlySectionStart([
        "## 16. QUESTION MARKS",
        "## ACT ONLY\n[ACT ONLY]\n\n## 17. SHORTER IS BETTER",
        "## 19. PRONOUN CASE",
      ]),
    ).toBe(1);
    expect(
      actOnlySectionStart(["## 18. ADJECTIVES & ADVERBS (ACT only)"]),
    ).toBeNull();
  });
});

describe("page ranges", () => {
  it("parses lists and ranges, and refuses pages outside the book", () => {
    expect(parsePages("3,1-2,3", 30)).toEqual([1, 2, 3]);
    expect(() => parsePages("0-2", 30)).toThrow(/pages/);
    expect(() => parsePages("29-31", 30)).toThrow(/pages/);
  });
});
