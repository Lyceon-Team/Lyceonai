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
 * is the fast deterministic layer — Model Armor (tutor-model-armor.ts) provides
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
 * @spec [INV-03-06; Doc-02B_V4 §20 (review rows), §21 Question Awareness,
 *        CR-02B-29; closure plan W3-8 + W4-1 review gate, owner ruling
 *        2026-09-25] | @implemented 2026-09-25
 *
 * plain English: "has the student submitted this item?" — answered from the
 * item's own row, never from the surface name alone. `true` means pre-submit:
 * the envelope carries `correct_answer: null` and the output scan is
 * answer-aware.
 *
 * Surfaces:
 * - "practice" — `practice_session_items.status`
 * - "review"   — `review_session_items.status`. Review is a graded RE-ATTEMPT:
 *   the item is served unanswered and revealed only after POST /answer. It was
 *   hard-coded post-submit here, which would have put `correct_answer` on the
 *   wire before the student answered as soon as LISA was wired into review.
 *   CR-02B-29: pre-submit the tutor receives neither answer nor explanation.
 * - "test_review" — post-submit: the exam is complete before its review phase
 *   exists (§21, "Exam review").
 * - "dashboard" — pre-submit. A dashboard conversation has no item and so no
 *   submission record; "post-submit" was an assertion nothing could back, and
 *   it put `correct_answer` on the wire whenever a general conversation
 *   attached a question id (W3-8).
 * - Unrecognized — pre-submit (fail closed).
 *
 * For practice and review: no item id, a query error, or a missing row all
 * fail closed to pre-submit. "answered" and "skipped" are the submitted
 * states in both tables' CHECK constraints.
 */
export async function isPreSubmitForSurface(
  surface: string,
  sessionItemId: string | null,
  _supabase: unknown,
): Promise<boolean> {
  switch (surface) {
    case "practice":
      return itemIsPreSubmit("practice_session_items", surface, sessionItemId);

    case "review":
      return itemIsPreSubmit("review_session_items", surface, sessionItemId);

    case "test_review":
      return false;

    case "dashboard":
      return true;

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

/** Items whose status means the student has submitted. Both tables share it. */
const SUBMITTED_ITEM_STATUSES: ReadonlySet<string> = new Set([
  "answered",
  "skipped",
]);

/**
 * Reads one session item's status. Any doubt — no id, a query error, no row —
 * is pre-submit.
 */
async function itemIsPreSubmit(
  table: "practice_session_items" | "review_session_items",
  surface: string,
  sessionItemId: string | null,
): Promise<boolean> {
  if (!sessionItemId) {
    logger.warn(
      "TUTOR_ANTILEAK",
      "pre_submit_check",
      "surface with null sessionItemId; failing closed",
      { surface },
    );
    return true;
  }

  const { data, error } = await supabaseServer
    .from(table)
    .select("status")
    .eq("id", sessionItemId)
    .maybeSingle();

  if (error || !data) {
    logger.error(
      "TUTOR_ANTILEAK",
      "pre_submit_query_failed",
      "session item status unreadable; failing closed",
      error ?? undefined,
      { surface, sessionItemId, table, rowFound: !!data },
    );
    return true;
  }

  return !SUBMITTED_ITEM_STATUSES.has(data.status as string);
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
  studentMessages?: readonly string[],
): { content: string; leaked: boolean } {
  if (!isPreSubmit) {
    return { content: text, leaked: false };
  }

  const leaked = hasAnswerLeak(text, correctAnswer, studentMessages);
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
