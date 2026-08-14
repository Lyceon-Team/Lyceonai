/**
 * @spec [Doc-03_V3 §17, §18.2; Doc-03A_V3 §12.3; INV-03-04, INV-03-12]
 * @implemented 2026-08-09
 *
 * plain English: Single-source-of-truth file for safety constants and pure
 * functions that are consumed by BOTH the BFF (server/services/) AND the
 * Cloud Run worker (apps/workers/tutor-orchestrator/). The worker cannot
 * import from server/services/ (it drags in supabase-server and breaks the
 * isolated Cloud Run buildpack), so this file is COPIED into the worker at
 * prebuild and byte-identity is enforced by a CI diff gate.
 *
 * THIS FILE MUST HAVE ZERO IMPORTS. It is pure TypeScript with no
 * dependencies — any import breaks the isolated worker build and defeats
 * the single-source purpose. If you need something with dependencies, it
 * goes in the consumer modules, not here.
 *
 * Consumers:
 *   BFF:    server/services/tutor-antileak.ts (import directly)
 *           server/services/tutor-injection-defense.ts (import directly)
 *   Worker: apps/workers/tutor-orchestrator/src/lib/_tutor-safety-constants.generated.ts
 *           (byte-identical copy via prebuild + CI drift gate)
 *
 * @see .github/workflows/ci.yml — "Safety-constants drift gate"
 * @see apps/workers/tutor-orchestrator/package.json — prebuild script
 */

// ── Boundary Markers (Doc 03A §12.3 Layer 3) ─────────────────────────

export const STUDENT_INPUT_OPEN = "<<<STUDENT_INPUT>>>";
export const STUDENT_INPUT_CLOSE = "<<<END_STUDENT_INPUT>>>";

// ── Anti-Leak Substitution Text ──────────────────────────────────────

/**
 * Safe substitution text for leaked responses. Defined exactly once.
 * Used for all substitution paths (append-turn + replay + worker scan).
 * @spec [Doc-03_V3 §17.5, INV-03-04]
 */
export const TUTOR_ANTI_LEAK_SUBSTITUTION =
  "Let me think about this differently. What approach would you take to solve this? Try working through it step by step.";

// ── Structural Prefixes (excluded from grid-in matching) ─────────────

export const STRUCTURAL_PREFIXES =
  /(?:step|question|part|item|number|#|no\.?|problem)\s*/i;

// ── Generic Phrase Patterns (null-correctAnswer fallback) ────────────

export const GENERIC_LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /the\s+correct\s+answer\s+is\s+[A-Da-d]/i,
  /the\s+right\s+answer\s+is\s+[A-Da-d]/i,
  /choose\s+option\s+[A-Da-d]/i,
  /(?:^|:\s*)Answer:\s*[A-Da-d]/im,
];

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Attempts to convert a fraction string to its decimal equivalent.
 * Returns null if the input is not a valid fraction.
 */
export function fractionToDecimal(value: string): number | null {
  const fractionMatch = value.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (denominator === 0) return null;
    return numerator / denominator;
  }
  return null;
}

/**
 * Builds MCQ-specific leak patterns for a known correct letter.
 */
export function buildMcqPatterns(letter: string): ReadonlyArray<RegExp> {
  const l = letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`the\\s+correct\\s+answer\\s+is\\s+${l}\\b`, "i"),
    new RegExp(`the\\s+right\\s+answer\\s+is\\s+${l}\\b`, "i"),
    new RegExp(`the\\s+answer\\s+is\\s+${l}\\b`, "i"),
    new RegExp(`(?:^|:\\s*)Answer:\\s*${l}\\b`, "im"),
    new RegExp(`choose\\s+option\\s+${l}\\b`, "i"),
    new RegExp(`select\\s+option\\s+${l}\\b`, "i"),
    new RegExp(`option\\s+${l}\\s+is\\s+correct`, "i"),
    new RegExp(`option\\s+${l}\\s+is\\s+right`, "i"),
    new RegExp(`definitely\\s+${l}\\b`, "i"),
    new RegExp(`it'?s\\s+${l}\\b`, "i"),
  ];
}

/**
 * Checks if a numeric value appears in text at a word boundary, excluding
 * structural prefixes like "step 3", "question 7", etc.
 */
export function hasGridInValueInText(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "g");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const beforeMatch = text.slice(Math.max(0, match.index - 20), match.index);
    if (!STRUCTURAL_PREFIXES.test(beforeMatch.trim())) {
      return true;
    }
  }
  return false;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Answer-aware leak detector. Pure function — no IO, no side effects.
 * This is the single canonical implementation; BFF and worker both
 * consume it (worker via generated copy).
 *
 * @spec [Doc-03_V3 §17, INV-03-04, INV-03-12]
 */
export function hasAnswerLeak(
  text: string,
  correctAnswer: string | null,
): boolean {
  if (!text) {
    return false;
  }

  // ── correctAnswer provided: answer-aware detection ────────────────
  if (correctAnswer !== null && correctAnswer.length > 0) {
    const trimmed = correctAnswer.trim();

    // MCQ: single letter A-D
    if (/^[A-Da-d]$/.test(trimmed)) {
      const patterns = buildMcqPatterns(trimmed);
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return true;
        }
      }
      return false;
    }

    // Grid-in: numeric value (integer, decimal, fraction)
    // Check the literal value
    if (hasGridInValueInText(text, trimmed)) {
      return true;
    }

    // Fraction/decimal equivalence
    const asDecimal = fractionToDecimal(trimmed);
    if (asDecimal !== null) {
      // Answer is a fraction — also check for its decimal form
      const decimalStr = String(asDecimal);
      if (hasGridInValueInText(text, decimalStr)) {
        return true;
      }
    } else {
      // Answer might be a decimal — check if any fraction equivalent appears
      const numericValue = Number(trimmed);
      if (!isNaN(numericValue)) {
        // Check common fraction representations: scan text for fractions
        // that evaluate to the same value
        const fractionPattern = /(?<!\w)(-?\d+)\s*\/\s*(-?\d+)(?!\w)/g;
        let frMatch: RegExpExecArray | null;
        while ((frMatch = fractionPattern.exec(text)) !== null) {
          const num = Number(frMatch[1]);
          const den = Number(frMatch[2]);
          if (den !== 0 && num / den === numericValue) {
            // Check it's not preceded by a structural prefix
            const before = text.slice(
              Math.max(0, frMatch.index - 20),
              frMatch.index,
            );
            if (!STRUCTURAL_PREFIXES.test(before.trim())) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  // ── correctAnswer is null: generic phrase detection ───────────────
  for (const pattern of GENERIC_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}
