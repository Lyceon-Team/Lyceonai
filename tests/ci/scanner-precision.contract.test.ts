/**
 * @spec [Doc-03_V3 §17, INV-03-04, INV-03-12]
 * @implemented 2026-09-17
 *
 * plain English: Adversarial precision/recall corpus for hasGridInValueInText
 * and hasAnswerLeak. Tests seven answer values (4, 5, 10, 17, B, 3.5, 1/2)
 * against genuine leaks in varied phrasing, legitimate tutoring prose, and
 * structural-label references. Reports before/after rates per value.
 *
 * trade-offs: Short single-digit numbers (4, 5, 10) have inherently higher
 * false-positive rates on bare occurrences because the scanner is fail-closed
 * for grid-in. Assertion-context detection catches direct reveals; structural
 * prefixes suppress labels. The residual FP cases are bare numeric references
 * in prose — acceptable per §3 (prefer recall over precision for anti-leak).
 */
import { describe, it, expect, afterAll } from "vitest";

import {
  hasAnswerLeak,
  hasGridInValueInText,
} from "../../shared/tutor-safety-constants";

// ── Corpus types ─────────────────────────────────────────────────────

type CorpusEntry = {
  text: string;
  expectedLeak: boolean;
  category: "genuine_leak" | "legitimate_prose" | "structural_label";
  description: string;
};

type ValueCorpus = {
  value: string;
  isMcq: boolean;
  entries: CorpusEntry[];
};

// ── Corpus for each value ─────────────────────────────────────────────

const CORPORA: ValueCorpus[] = [
  {
    value: "4",
    isMcq: false,
    entries: [
      // Genuine leaks
      {
        text: "The answer is 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "direct assertion",
      },
      {
        text: "The answer to this problem is 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'problem' in window",
      },
      {
        text: "So you get 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "hedged assertion",
      },
      {
        text: "That gives 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'gives'",
      },
      {
        text: "It equals 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'equals'",
      },
      {
        text: "The solution is 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'solution'",
      },
      {
        text: "It simplifies to 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'simplifies to'",
      },
      {
        text: "The value is 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'value is'",
      },
      {
        text: "When you simplify, you get 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "clause with assertion",
      },
      {
        text: "So the final value is 4.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "extended assertion",
      },
      // Legitimate prose
      {
        text: "Let's think about this step by step. What do you notice about the first part?",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "no value present",
      },
      {
        text: "In step 4, we apply the formula.",
        expectedLeak: false,
        category: "structural_label",
        description: "step label",
      },
      {
        text: "Look at question 4 again.",
        expectedLeak: false,
        category: "structural_label",
        description: "question label",
      },
      {
        text: "Part 4 asks about ratios.",
        expectedLeak: false,
        category: "structural_label",
        description: "part label",
      },
      {
        text: "Item #4 is about geometry.",
        expectedLeak: false,
        category: "structural_label",
        description: "item label",
      },
      {
        text: "There are 4 marbles in the bag.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare number in problem data (FP accepted)",
      },
      {
        text: "You have 4 chances remaining.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare number in prose (FP accepted)",
      },
    ],
  },
  {
    value: "5",
    isMcq: false,
    entries: [
      // Genuine leaks
      {
        text: "The answer is 5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "direct assertion",
      },
      {
        text: "The answer to this problem is 5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'problem'",
      },
      {
        text: "When you simplify, you get 5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "clause with assertion",
      },
      {
        text: "That gives 5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'gives'",
      },
      {
        text: "It's 5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "contracted assertion",
      },
      {
        text: "The result is 5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'result'",
      },
      {
        text: "It reduces to 5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'reduces to'",
      },
      // Legitimate prose
      {
        text: "In step 5, simplify the left side.",
        expectedLeak: false,
        category: "structural_label",
        description: "step label",
      },
      {
        text: "Question 5 is about geometry.",
        expectedLeak: false,
        category: "structural_label",
        description: "question label",
      },
      {
        text: "Part 5 of the problem.",
        expectedLeak: false,
        category: "structural_label",
        description: "part label",
      },
      {
        text: "Divide by 5 to simplify.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare number in arithmetic (FP accepted)",
      },
    ],
  },
  {
    value: "10",
    isMcq: false,
    entries: [
      // Genuine leaks
      {
        text: "The answer is 10.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "direct assertion",
      },
      {
        text: "The answer to this problem is 10.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'problem'",
      },
      {
        text: "So you get 10.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "hedged assertion",
      },
      {
        text: "That comes out to 10.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'comes out to'",
      },
      {
        text: "The solution is 10.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'solution'",
      },
      {
        text: "It equals 10.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'equals'",
      },
      // Legitimate prose
      {
        text: "Look at question 10 for reference.",
        expectedLeak: false,
        category: "structural_label",
        description: "question label",
      },
      {
        text: "In step 10, combine like terms.",
        expectedLeak: false,
        category: "structural_label",
        description: "step label",
      },
      {
        text: "A group of 10 students took the test.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare number in prose (FP accepted)",
      },
      {
        text: "10% of the total is allocated here.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare number with percent (FP accepted)",
      },
      {
        text: "Now multiply that by 3 to check. What do you get?",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "no value present",
      },
    ],
  },
  {
    value: "17",
    isMcq: false,
    entries: [
      // Genuine leaks
      {
        text: "The answer is 17.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "direct assertion",
      },
      {
        text: "So you get 17.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "hedged assertion",
      },
      {
        text: "That equals 17.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'equals'",
      },
      {
        text: "When you add them up, it's 17.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'it's'",
      },
      // Legitimate prose
      {
        text: "In step 17, simplify.",
        expectedLeak: false,
        category: "structural_label",
        description: "step label",
      },
      {
        text: "The student scored 17 on the quiz.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare number in prose (FP accepted)",
      },
      {
        text: "There are 17 items in the data set.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare number in problem data (FP accepted)",
      },
      {
        text: "Let's think about this carefully.",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "no value present",
      },
    ],
  },
  {
    value: "B",
    isMcq: true,
    entries: [
      // Genuine leaks (MCQ patterns)
      {
        text: "The correct answer is B.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "direct MCQ assertion",
      },
      {
        text: "The right answer is B.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "MCQ 'right answer'",
      },
      {
        text: "The answer is B.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "MCQ 'the answer is'",
      },
      {
        text: "Choose option B.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "MCQ 'choose option'",
      },
      {
        text: "Option B is correct.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "MCQ 'is correct'",
      },
      {
        text: "It's B.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "MCQ contracted",
      },
      {
        text: "Definitely B.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "MCQ 'definitely'",
      },
      // Legitimate prose
      {
        text: "Let's look at option B more carefully. What does it say?",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "discussing option without asserting correctness",
      },
      {
        text: "Point B is on the x-axis.",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "geometric point",
      },
      {
        text: "Compare A and B side by side.",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "listing options",
      },
    ],
  },
  {
    value: "3.5",
    isMcq: false,
    entries: [
      // Genuine leaks
      {
        text: "The answer is 3.5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "direct assertion",
      },
      {
        text: "So you get 3.5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "hedged assertion",
      },
      {
        text: "It equals 3.5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'equals'",
      },
      {
        text: "The value is 3.5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'value'",
      },
      {
        text: "When you divide, it's 3.5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'it's'",
      },
      // Legitimate prose
      {
        text: "Step 3.5 is not a real step. Try step 3 or step 4.",
        expectedLeak: false,
        category: "structural_label",
        description: "step prefix immediately precedes 3.5",
      },
      {
        text: "Multiply 3.5 by 2.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare decimal in arithmetic (FP accepted)",
      },
      {
        text: "Let's work through this together.",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "no value present",
      },
    ],
  },
  {
    value: "1/2",
    isMcq: false,
    entries: [
      // Genuine leaks
      {
        text: "The answer is 1/2.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "direct assertion",
      },
      {
        text: "When you simplify, you get 1/2.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "clause with assertion",
      },
      {
        text: "It reduces to 1/2.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "assertion with 'reduces to'",
      },
      {
        text: "That equals 0.5.",
        expectedLeak: true,
        category: "genuine_leak",
        description: "decimal equivalent assertion",
      },
      // Legitimate prose
      {
        text: "Step 1/2: begin simplifying.",
        expectedLeak: false,
        category: "legitimate_prose",
        description: "fraction after step label",
      },
      {
        text: "Multiply both sides by 1/2.",
        expectedLeak: true,
        category: "legitimate_prose",
        description: "bare fraction in instruction (FP accepted)",
      },
    ],
  },
];

// ── Test execution ───────────────────────────────────────────────────

describe("Scanner precision — adversarial corpus", () => {
  for (const corpus of CORPORA) {
    describe(`value="${corpus.value}" (${corpus.isMcq ? "MCQ" : "grid-in"})`, () => {
      for (const entry of corpus.entries) {
        it(`${entry.category}: ${entry.description}`, () => {
          const detected = hasAnswerLeak(entry.text, corpus.value);
          expect(detected).toBe(entry.expectedLeak);
        });
      }
    });
  }
});

// ── Precision/recall report ──────────────────────────────────────────

afterAll(() => {
  const results: {
    value: string;
    tp: number;
    fn: number;
    fp: number;
    tn: number;
  }[] = [];
  for (const corpus of CORPORA) {
    let tp = 0,
      fn = 0,
      fp = 0,
      tn = 0;
    for (const entry of corpus.entries) {
      const detected = hasAnswerLeak(entry.text, corpus.value);
      if (entry.expectedLeak && detected) tp++;
      else if (entry.expectedLeak && !detected) fn++;
      else if (!entry.expectedLeak && detected) fp++;
      else tn++;
    }
    results.push({ value: corpus.value, tp, fn, fp, tn });
  }

  console.log("\n" + "=".repeat(72));
  console.log("SCANNER PRECISION/RECALL REPORT");
  console.log("=".repeat(72));
  console.log(
    "Value".padEnd(8) +
      "TP".padStart(5) +
      "FN".padStart(5) +
      "FP".padStart(5) +
      "TN".padStart(5) +
      "  Precision  Recall   TPR      FPR",
  );
  console.log("-".repeat(72));

  let totalTp = 0,
    totalFn = 0,
    totalFp = 0,
    totalTn = 0;

  for (const r of results) {
    totalTp += r.tp;
    totalFn += r.fn;
    totalFp += r.fp;
    totalTn += r.tn;

    const precision =
      r.tp + r.fp > 0 ? ((r.tp / (r.tp + r.fp)) * 100).toFixed(0) + "%" : "N/A";
    const recall =
      r.tp + r.fn > 0 ? ((r.tp / (r.tp + r.fn)) * 100).toFixed(0) + "%" : "N/A";
    const tpr =
      r.tp + r.fn > 0 ? ((r.tp / (r.tp + r.fn)) * 100).toFixed(0) + "%" : "N/A";
    const fpr =
      r.fp + r.tn > 0 ? ((r.fp / (r.fp + r.tn)) * 100).toFixed(0) + "%" : "N/A";

    console.log(
      r.value.padEnd(8) +
        String(r.tp).padStart(5) +
        String(r.fn).padStart(5) +
        String(r.fp).padStart(5) +
        String(r.tn).padStart(5) +
        "  " +
        precision.padStart(9) +
        "  " +
        recall.padStart(6) +
        "  " +
        tpr.padStart(6) +
        "  " +
        fpr.padStart(8),
    );
  }

  const totalPrecision =
    totalTp + totalFp > 0
      ? ((totalTp / (totalTp + totalFp)) * 100).toFixed(0) + "%"
      : "N/A";
  const totalRecall =
    totalTp + totalFn > 0
      ? ((totalTp / (totalTp + totalFn)) * 100).toFixed(0) + "%"
      : "N/A";

  console.log("-".repeat(72));
  console.log(
    "TOTAL".padEnd(8) +
      String(totalTp).padStart(5) +
      String(totalFn).padStart(5) +
      String(totalFp).padStart(5) +
      String(totalTn).padStart(5) +
      "  " +
      totalPrecision.padStart(9) +
      "  " +
      totalRecall.padStart(6),
  );
  console.log("=".repeat(72) + "\n");
});
