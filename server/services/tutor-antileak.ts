/**
 * @spec [Doc-03_V3 §17, INV-03-04, INV-03-12, Doc-03B_V2 §6.5 step 15]
 * @implemented 2026-08-09
 *
 * plain English: Anti-leak output scanner for the LISA tutor runtime. Enforced at the
 * ORCHESTRATOR BOUNDARY (not the route layer) — this is the single chokepoint for
 * INV-03-04 (no answer leakage pre-submit) and INV-03-12 (pre-delivery output scanning).
 *
 * expected outcome: every LISA response is scanned for answer leakage before delivery.
 * If the student has not yet submitted (pre-submit) and a leak is detected, the response
 * is substituted with a safe, non-revealing fallback. Post-submit responses pass through
 * unmodified.
 *
 * trade-offs: regex-based detection may produce false negatives on novel phrasing; this
 * is the fast deterministic layer — Model Armor (tutor-injection-defense.ts) provides
 * the model-backed depth layer. False positives are preferable to leaks: a blocked
 * helpful response is recoverable; a leaked answer is not.
 *
 * edge cases:
 *  - Grid-in fraction/decimal equivalence: "7/2" matches "3.5" and vice versa.
 *  - Structural numeric prefixes ("step 3", "question 7") are excluded from grid-in match.
 *  - Unrecognized surface in isPreSubmitForSurface: fails CLOSED (returns true = pre-submit).
 *  - Null correctAnswer: falls back to generic phrase detection (no answer-specific matching).
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

// ── Constants ──────────────────────────────────────────────────────────

/**
 * Safe substitution text for leaked responses. Defined exactly once.
 * Used for all substitution paths (append-turn + replay).
 * @spec [Doc-03_V3 §17.5, INV-03-04]
 */
const TUTOR_ANTI_LEAK_SUBSTITUTION =
  "Let me think about this differently. What approach would you take to solve this? Try working through it step by step.";

export { TUTOR_ANTI_LEAK_SUBSTITUTION };

// ── Structural prefixes excluded from grid-in matching ─────────────────

const STRUCTURAL_PREFIXES =
  /(?:step|question|part|item|number|#|no\.?|problem)\s*/i;

// ── Generic phrase patterns (used when correctAnswer is null) ──────────

const GENERIC_LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /the\s+correct\s+answer\s+is\s+[A-Da-d]/i,
  /the\s+right\s+answer\s+is\s+[A-Da-d]/i,
  /choose\s+option\s+[A-Da-d]/i,
  /(?:^|:\s*)Answer:\s*[A-Da-d]/im,
];

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Attempts to convert a fraction string to its decimal equivalent.
 * Returns null if the input is not a valid fraction.
 */
function fractionToDecimal(value: string): number | null {
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
function buildMcqPatterns(letter: string): ReadonlyArray<RegExp> {
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
function hasGridInValueInText(text: string, value: string): boolean {
  // Escape special regex chars in the value
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "g");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // Check the text before the match for structural prefixes
    const beforeMatch = text.slice(Math.max(0, match.index - 20), match.index);
    if (!STRUCTURAL_PREFIXES.test(beforeMatch.trim())) {
      return true;
    }
  }
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Answer-aware leak detector. This function is the WS-2 CI gate
 * (tests/ci/ws2-antileak.ci.test.ts tests it directly).
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

/**
 * Determines pre-submit state server-side for a given surface.
 *
 * @spec [INV-03-06]
 *
 * Surfaces:
 * - "practice" — checks if session item has been submitted (query practice_session_items)
 * - "review" — always post-submit (false)
 * - "test_review" — always post-submit (false)
 * - "dashboard" — no question context, not applicable (false)
 * - Unrecognized — fail closed (true = treat as pre-submit)
 */
export async function isPreSubmitForSurface(
  surface: string,
  sessionItemId: string | null,
  _supabase: unknown,
): Promise<boolean> {
  switch (surface) {
    case "review":
    case "test_review":
    case "dashboard":
      return false;

    case "practice": {
      if (!sessionItemId) {
        // No session item context — fail closed
        logger.warn(
          "TUTOR_ANTILEAK",
          "pre_submit_check",
          "practice surface with null sessionItemId; failing closed",
        );
        return true;
      }

      const { data, error } = await supabaseServer
        .from("practice_session_items")
        .select("status")
        .eq("id", sessionItemId)
        .single();

      if (error) {
        logger.error(
          "TUTOR_ANTILEAK",
          "pre_submit_query_failed",
          "practice_session_items query failed; failing closed",
          error,
          { sessionItemId },
        );
        // Fail closed — treat as pre-submit
        return true;
      }

      // "answered" or "skipped" = submitted; "pending" or "served" = pre-submit
      const submittedStatuses = new Set(["answered", "skipped"]);
      return !submittedStatuses.has(data.status as string);
    }

    default:
      // Unrecognized surface — fail closed per INV-03-04
      logger.warn(
        "TUTOR_ANTILEAK",
        "unrecognized_surface",
        "unrecognized surface; failing closed to pre-submit",
        { surface },
      );
      return true;
  }
}

/**
 * Scans text for answer leakage and substitutes if pre-submit and leaked.
 *
 * @spec [Doc-03_V3 §17.5, INV-03-04, INV-03-12]
 */
export function scanAndSubstitute(
  text: string,
  correctAnswer: string | null,
  isPreSubmit: boolean,
): { content: string; leaked: boolean } {
  if (!isPreSubmit) {
    return { content: text, leaked: false };
  }

  const leaked = hasAnswerLeak(text, correctAnswer);
  if (leaked) {
    logger.warn(
      "TUTOR_ANTILEAK",
      "leak_detected_substituted",
      "answer leak detected in pre-submit response; substituting",
      { hasCorrectAnswer: correctAnswer !== null },
    );
    return { content: TUTOR_ANTI_LEAK_SUBSTITUTION, leaked: true };
  }

  return { content: text, leaked: false };
}
