/**
 * @spec [Lyceon_Doc_10A_V1 §6, §8.4; owner decisions 2026-10-09 on the walkthrough video, item 8 ("original,
 *       written-for-the-video SAT-style questions with real explanations, never bank items")]
 *       | @implemented [2026-10-09]
 *
 * plain English: the questions the video shows are well-formed (four distinct options, a real
 * explanation), never name a choice letter (the runner's on-screen order differs from the
 * stored one), cover every SAT domain the fixture bank carries, and appear nowhere in the
 * question bank (content/canonical/): each item's own text (its passage, or its stem when it has
 * none) and its explanation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WALKTHROUGH_GRID_IN, WALKTHROUGH_MCQ } from "./walkthrough-content";

const BANK = resolve(__dirname, "../../../content/canonical");

const DOMAINS = [
  "Algebra",
  "Advanced Math",
  "Problem Solving and Data Analysis",
  "Geometry and Trigonometry",
  "Information and Ideas",
  "Craft and Structure",
  "Standard English Conventions",
  "Expression of Ideas",
];

/** "choice A", "option (B)", "answer C is", "(D)" and the like. */
const LETTER_REFERENCE =
  /\b(choice|option|answer)\s*\(?[A-D]\)?(?![a-z])|\([A-D]\)|\b[A-D]\s+is\s+correct\b/;

function bankText(dir: string): string {
  let out = "";
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out += bankText(p);
    else if (/\.(json|ndjson|jsonl|sql|md)$/.test(name))
      out += readFileSync(p, "utf8");
  }
  return out;
}

const mcq = Object.values(WALKTHROUGH_MCQ).flat();

describe("walkthrough content", () => {
  it("covers every SAT domain, and is non-trivial", () => {
    expect(Object.keys(WALKTHROUGH_MCQ).sort()).toEqual([...DOMAINS].sort());
    expect(mcq.length).toBeGreaterThanOrEqual(DOMAINS.length);
    expect(WALKTHROUGH_GRID_IN.length).toBeGreaterThan(0);
  });

  it("gives every multiple-choice item four distinct options and a real explanation", () => {
    for (const q of mcq) {
      expect(new Set(q.options).size, q.stem).toBe(4);
      expect(q.explanation.length, q.stem).toBeGreaterThan(40);
    }
    for (const q of WALKTHROUGH_GRID_IN)
      expect(q.explanation.length, q.stem).toBeGreaterThan(40);
  });

  it("never names a choice letter in an explanation", () => {
    // The pattern bites (presence before absence).
    expect(LETTER_REFERENCE.test("The answer is choice B.")).toBe(true);
    expect(LETTER_REFERENCE.test("So (C) is right.")).toBe(true);
    for (const q of [...mcq, ...WALKTHROUGH_GRID_IN])
      expect(LETTER_REFERENCE.test(q.explanation), q.explanation).toBe(false);
  });

  it("appears nowhere in the question bank", () => {
    const bank = bankText(BANK);
    expect(bank.length).toBeGreaterThan(100_000);
    for (const q of [...mcq, ...WALKTHROUGH_GRID_IN]) {
      // A Reading and Writing stem is the standard SAT prompt ("Which choice best states the
      // main idea of the text?"), shared by design; its passage is what identifies the item.
      const own = "passage" in q && q.passage ? q.passage : q.stem;
      expect(bank.includes(own), own).toBe(false);
      expect(bank.includes(q.explanation), q.explanation).toBe(false);
    }
  });
});
