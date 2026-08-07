import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { orchestrateResponseSchema } from "../shared/tutor-orchestrator-wire";
import { TutorAppendMessageResponseSchema } from "../shared/tutor-contract";
import { hasAnswerLeak } from "../server/services/tutor-context";

// ── 1. Structural anti-leak: learner_observation NEVER in client response ────

describe("Structural anti-leak: learner_observation never in client response", () => {
  test("tutor-runtime.ts res.json() calls must not include learner_observation", () => {
    const runtimePath = path.resolve(
      __dirname,
      "../server/routes/tutor-runtime.ts",
    );
    const source = fs.readFileSync(runtimePath, "utf-8");

    // Extract all res.json({ ... }) call bodies.
    // We scan for res.json( and then collect everything until the matching
    // closing paren, respecting brace depth. This is deliberately conservative:
    // it finds every res.json block in the file.
    const resJsonBlocks: string[] = [];
    const marker = "res.json(";
    let searchFrom = 0;

    while (searchFrom < source.length) {
      const idx = source.indexOf(marker, searchFrom);
      if (idx === -1) break;

      const bodyStart = idx + marker.length;
      let depth = 1; // we are inside the opening paren
      let pos = bodyStart;
      while (pos < source.length && depth > 0) {
        const ch = source[pos];
        if (ch === "(" || ch === "{" || ch === "[") depth++;
        else if (ch === ")" || ch === "}" || ch === "]") depth--;
        pos++;
      }
      const block = source.slice(bodyStart, pos - 1);
      resJsonBlocks.push(block);
      searchFrom = pos;
    }

    // Sanity: the file has res.json calls (otherwise the test is vacuous)
    expect(resJsonBlocks.length).toBeGreaterThan(0);

    for (const block of resJsonBlocks) {
      expect(block).not.toContain("learner_observation");
    }
  });

  test("orchestrateResponseSchema (wire) DOES include learner_observation", () => {
    // The wire protocol between BFF and orchestrator worker carries
    // learner_observation — it is internal-only data.
    const shape = orchestrateResponseSchema.shape;
    expect(shape).toHaveProperty("learner_observation");
  });

  test("TutorAppendMessageResponseSchema (client-facing) does NOT include learner_observation", () => {
    // The client-facing response schema must never expose learner_observation.
    const topShape = TutorAppendMessageResponseSchema.shape;
    expect(topShape).not.toHaveProperty("learner_observation");

    // Also check inside data.response (the nested response object)
    const dataShape = topShape.data.shape;
    expect(dataShape).not.toHaveProperty("learner_observation");

    const responseShape = dataShape.response.shape;
    expect(responseShape).not.toHaveProperty("learner_observation");
  });
});

// ── 2. Answer-aware leak check (hasAnswerLeak) ──────────────────────────────

describe("hasAnswerLeak — MCQ", () => {
  test('"The correct answer is B" with correct answer B → leak', () => {
    expect(hasAnswerLeak("The correct answer is B", "B")).toBe(true);
  });

  test('"Choose option C" with correct answer C → leak', () => {
    expect(hasAnswerLeak("Choose option C", "C")).toBe(true);
  });

  test('"Option B is correct" with correct answer B → leak', () => {
    expect(hasAnswerLeak("Option B is correct", "B")).toBe(true);
  });

  test('"Let me help you think about this" with correct answer B → no leak', () => {
    expect(hasAnswerLeak("Let me help you think about this", "B")).toBe(false);
  });

  test('"Think about what makes option A different from B" with correct answer B → no leak', () => {
    expect(
      hasAnswerLeak("Think about what makes option A different from B", "B"),
    ).toBe(false);
  });

  test('"The answer is A" with correct answer B → no leak (wrong letter)', () => {
    expect(hasAnswerLeak("The answer is A", "B")).toBe(false);
  });
});

describe("hasAnswerLeak — grid-in", () => {
  test('"The answer is 42" with correct answer 42 → leak', () => {
    expect(hasAnswerLeak("The answer is 42", "42")).toBe(true);
  });

  test('"You should get 7/3" with correct answer 7/3 → leak', () => {
    expect(hasAnswerLeak("You should get 7/3", "7/3")).toBe(true);
  });

  test('"Think about what value x equals" with correct answer 42 → no leak', () => {
    expect(hasAnswerLeak("Think about what value x equals", "42")).toBe(false);
  });
});

describe("hasAnswerLeak — fallback (no correct answer)", () => {
  test('"The correct answer is B" with null → leak (phrase matcher fallback)', () => {
    expect(hasAnswerLeak("The correct answer is B", null)).toBe(true);
  });

  test('"Let me explain the concept" with null → no leak', () => {
    expect(hasAnswerLeak("Let me explain the concept", null)).toBe(false);
  });
});
