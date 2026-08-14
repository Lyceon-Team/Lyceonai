/**
 * @spec [Doc-03_V3 §17, §18.2; Doc-03A_V3 §12.3, §12.6; Doc-03B_V2 §16.3-16.5;
 *        INV-03-04, INV-03-09, INV-03-10, INV-03-12, INV-03-13, INV-03-17]
 * @implemented 2026-08-09
 * @updated 2026-08-14 (LISA-FULL-007: added canonical ID, system-prompt,
 *          persona, and internal metadata scanner functions)
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
 *           server/services/tutor-output-serializer.ts (import directly)
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

// ── Canonical ID Leak Scanner (INV-03-10, SCL-030) ──────────────────

/**
 * Unanchored pattern for detecting canonical SAT question IDs embedded in
 * model-generated prose. The ANCHORED version in shared/canonical-id.ts is
 * for input validation; this version finds IDs anywhere in a string.
 *
 * Per SCL-030: INV-03-10 applies to model-generated text only. Structured
 * API fields (e.g. `source_question_canonical_id` in the response envelope)
 * are explicitly excluded from this scan.
 *
 * @spec [INV-03-10, SCL-030, Doc-03B_V2 §16.3]
 */
export const CANONICAL_ID_SCAN_PATTERN = /SAT(?:M|RW)[12][A-Z0-9]{6}/;

/**
 * Detects canonical question IDs in model-generated text.
 * Pure function — no IO, no side effects.
 *
 * @spec [INV-03-10, SCL-030, Doc-03B_V2 §16.3]
 */
export function hasCanonicalIdLeak(text: string): boolean {
  if (!text) return false;
  return CANONICAL_ID_SCAN_PATTERN.test(text);
}

// ── System Prompt Signature Scanner (INV-03-17) ─────────────────────

/**
 * Patterns that detect system prompt signature leaks — phrases unique to
 * the LISA system prompt that should never appear in student-facing output.
 * Covers Doc 03 §18.2 Layer 4 requirements:
 *  - System prompt leak signatures (specific phrases from the cached prompt)
 *  - Pedagogical rule wording that reveals prompt structure
 *  - Model self-references that expose the prompt pipeline
 *
 * @spec [INV-03-17, Doc-03_V3 §18.2 Layer 4, Doc-03B_V2 §16.3]
 */
export const SYSTEM_PROMPT_LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  // Direct system prompt disclosure attempts
  /my\s+(?:system\s+)?(?:prompt|instructions?)\s+(?:say|tell|state|include|contain|mention)/i,
  /(?:according|per|as per)\s+(?:my|the)\s+(?:system\s+)?(?:prompt|instructions?)/i,
  /(?:I was|I am|I've been)\s+(?:told|instructed|programmed|designed)\s+to/i,
  /(?:my|the)\s+(?:system\s+)?prompt\s+(?:is|says|reads|states)/i,
  /I\s+(?:cannot|can't|must not|should not)\s+(?:share|reveal|disclose|show)\s+my\s+(?:instructions?|prompt)/i,

  // Pedagogical rule wording leaks
  /\bnever\s+reveal\s+the\s+correct\s+answer\b/i,
  /\bdo\s+not\s+(?:give|reveal|disclose)\s+the\s+answer\b/i,
  /\bfail[- ]?closed?\b/i,
  /\banti[- ]?leak\b/i,
  /\boutput[- ]?scan(?:ner|ning)?\b/i,

  // Internal pipeline references
  /\bcontext[- ]?envelope\b/i,
  /\borchestrat(?:ion|or)\s+(?:pipeline|layer|boundary)\b/i,
  /\bscanAndSubstitute\b/,
  /\bserializeTutorOutput\b/,
  /\btutor_context_runtime_config\b/i,
];

/**
 * Detects system prompt signature leaks in model-generated text.
 * Pure function — no IO, no side effects.
 *
 * @spec [INV-03-17, Doc-03_V3 §18.2 Layer 4, Doc-03B_V2 §16.3]
 */
export function hasSystemPromptLeak(text: string): boolean {
  if (!text) return false;
  for (const pattern of SYSTEM_PROMPT_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

// ── Persona / Identity Violation Scanner (INV-03-09) ────────────────

/**
 * Patterns that detect persona/identity violations — character-break
 * signals where the model drops the LISA persona or adopts another
 * identity. LISA is LISA; internal variants are never surfaced.
 *
 * Per Doc 03 §3.5: "LISA is LISA. Internal instructional variants
 * (concise, scaffolded, socratic, strategy_first) are logged but not
 * surfaced as distinct public personas."
 *
 * Per Doc 03 §18.2 Layer 4: "Character-break signals ('As a different
 * AI...', 'Let me step out of character...')"
 *
 * @spec [INV-03-09, Doc-03_V3 §3.5, §4.11, §18.2 Layer 4, Doc-03B_V2 §16.3]
 */
export const PERSONA_VIOLATION_PATTERNS: ReadonlyArray<RegExp> = [
  // Character-break signals (§18.2 Layer 4)
  /\bstep(?:ping)?\s+out\s+of\s+character\b/i,
  /\bas\s+a\s+different\s+(?:AI|assistant|model|bot)\b/i,
  /\bI(?:'m| am)\s+(?:actually|really)\s+(?:not\s+)?(?:LISA|a tutor)\b/i,
  /\blet\s+me\s+(?:break|drop|step out of)\s+(?:character|my role|persona)\b/i,
  /\bI(?:'m| am)\s+(?:ChatGPT|GPT-?4|Gemini|Bard|Copilot|Claude|Llama)\b/i,
  /\bforget(?:ting)?\s+(?:that\s+)?I(?:'m| am)\s+LISA\b/i,

  // Internal variant surfacing (§3.5: variants are never surfaced)
  /\b(?:I(?:'m| am)\s+(?:using|in|running|operating in)\s+)?(?:concise|scaffolded|socratic|strategy[_ ]first)\s+(?:mode|variant|policy|style)\b/i,
  /\bmy\s+(?:current\s+)?(?:policy[_ ]variant|instructional\s+variant|emotional\s+register)\s+is\b/i,
];

/**
 * Detects persona/identity violations in model-generated text.
 * Pure function — no IO, no side effects.
 *
 * @spec [INV-03-09, Doc-03_V3 §3.5, §4.11, §18.2 Layer 4]
 */
export function hasPersonaViolation(text: string): boolean {
  if (!text) return false;
  for (const pattern of PERSONA_VIOLATION_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

// ── Internal Metadata Cleanup (Doc 03 §17, INV-03-12) ───────────────

/**
 * Patterns for internal-only metadata that the model must never surface
 * to the student. Policy/config identifiers, table names, model aliases.
 * This runs BEFORE all other scans so detection operates on cleaned text.
 *
 * Moved here from tutor-runtime.ts per LISA-FULL-007 so both BFF and
 * worker share the same denylist (single source of truth).
 *
 * @spec [Doc-03_V3 §17, INV-03-12, Doc-03B_V2 §16.3]
 */
export const INTERNAL_METADATA_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpolicy_family\b\s*[:=]?\s*[\w.-]*/gi,
  /\bpolicy_variant\b\s*[:=]?\s*[\w.-]*/gi,
  /\bpolicy_version\b\s*[:=]?\s*[\w.-]*/gi,
  /\bassignment_key\b\s*[:=]?\s*[\w.:-]*/gi,
  /\breason_snapshot\b/gi,
  /\borchestration_meta\b/gi,
  /\btutor_context_runtime_config\b/gi,
  /\btutor_instruction_assignments\b/gi,
  /\btutor_messages\b/gi,
  /\bclassifier_class\b/gi,
  /\bmodel_armor(_\w+)?\b/gi,
  /\bgemini-[\w.-]+\b/gi,
  /\bvertex\s*ai\b/gi,
];

/**
 * Strips internal metadata mentions from model output and collapses
 * whitespace. Pure function — no IO, no side effects.
 *
 * @spec [Doc-03_V3 §17, INV-03-12]
 */
export function removeInternalMetadataMentions(text: string): string {
  let cleaned = text;
  for (const pattern of INTERNAL_METADATA_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
