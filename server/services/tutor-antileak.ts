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

// ── Shared safety constants (single source of truth) ──────────────────
// All pure functions and constants are defined in shared/tutor-safety-constants.ts
// and copied into the worker at prebuild. CI enforces byte-identity.
// @see shared/tutor-safety-constants.ts
// @see .github/workflows/ci.yml — "Safety-constants drift gate"

import {
  TUTOR_ANTI_LEAK_SUBSTITUTION,
  hasAnswerLeak,
} from "../../shared/tutor-safety-constants";

export { TUTOR_ANTI_LEAK_SUBSTITUTION, hasAnswerLeak };

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
