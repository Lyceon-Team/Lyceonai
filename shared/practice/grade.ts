/**
 * The canonical answer grader, shared by practice, review, the full-length exam path and the
 * public Question of the Day.
 *
 * @spec [Doc-02B_V4 §14; TIGHTENING-1 correct_variants grading; docs/plans/seo/seo-marketing-vertical.md
 *       Q2; owner Step 0 decision 7 (2026-10-05)] | @implemented [2026-10-05]
 *
 * plain English: moved verbatim from server/routes/practice-canonical.ts (which re-exports it)
 * so a caller can grade without importing the authenticated practice route module. Behaviour,
 * signature and failure codes are unchanged; the only edit is the option type spelled by its
 * shared name (practice-canonical's local alias `McOption` = `CanonicalMcOption`).
 */
import {
  normalizeAnswerKey,
  resolveSelectedCanonicalKey,
  type CanonicalItemType,
  type CanonicalMcOption,
} from "../question-bank-contract";

// Server-side serving record. correct_answer / explanation / correct_variants live here for
// grading ONLY and are never projected to the student DTO. For grid_in, options is [] and the
// accepted-answer set rides in correct_variants; for mcq, correct_variants is null.
export type CanonicalQuestionForServing = {
  id: string;
  canonical_id: string;
  section_code: string;
  item_type: CanonicalItemType;
  stem: string;
  passage: string | null;
  options: CanonicalMcOption[];
  difficulty: string | number | null;
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  exam?: string | null;
  structure_cluster_id?: string | null;
  correct_answer: string | null;
  explanation: string | null;
  correct_variants: string[] | null;
  assets: unknown | null;
  option_metadata: unknown | null;
  estimated_time_seconds: number | null;
};

// @spec [Doc-02B_V4 §14; TIGHTENING-1 correct_variants grading] | @implemented 2026-07-09
// Unified grader — MCQ key-match vs grid-in correct_variants array membership.
// Grid-in grades against the snapshot correct_variants, NOT parseGridInValue.
// Fail closed on malformed data — no fallback grading path.
// Exported 2026-09-21 (brief R3 §1 check 2): review calls the SAME function
// rather than copying it. No signature or behaviour change.
export type GradeResult =
  | {
      ok: true;
      isCorrect: boolean;
      outcome: "correct" | "incorrect";
      selectedCanonicalKey: string;
      correctOptionId: string | null;
    }
  | { ok: false; status: number; error: string; message: string };

// Exported 2026-09-21 (brief R3 §1 check 2): review calls the SAME function
// rather than copying it. No signature or behaviour change.
export function gradeAnswer(
  canonicalQuestion: CanonicalQuestionForServing,
  selectedAnswer: string,
  optionTokenMap: Record<string, string> | null,
): GradeResult {
  const isGridIn = canonicalQuestion.item_type === "grid_in";

  if (isGridIn) {
    const variants = canonicalQuestion.correct_variants;
    if (!variants || variants.length === 0) {
      return {
        ok: false,
        status: 422,
        error: "invalid_question_data",
        message:
          "Grid-in question is missing correct_variants and cannot be graded.",
      };
    }
    const trimmed = selectedAnswer.trim();
    if (!trimmed) {
      return {
        ok: false,
        status: 400,
        error: "invalid_answer",
        message: "selectedAnswer must be a non-empty string for grid-in.",
      };
    }
    const isCorrect = variants.includes(trimmed);
    return {
      ok: true,
      isCorrect,
      outcome: isCorrect ? "correct" : "incorrect",
      selectedCanonicalKey: trimmed,
      correctOptionId: null,
    };
  }

  // MCQ path
  if (!optionTokenMap) {
    return {
      ok: false,
      status: 409,
      error: "session_item_mapping_missing",
      message: "The served option mapping is missing for this session item.",
    };
  }

  const correctAnswerKey = normalizeAnswerKey(canonicalQuestion.correct_answer);
  if (!correctAnswerKey) {
    return {
      ok: false,
      status: 422,
      error: "invalid_question_data",
      message: "This question is missing an answer key and cannot be graded.",
    };
  }

  // One resolution rule for practice, review and the full-length exam (E6).
  const selectedCanonicalKey = resolveSelectedCanonicalKey(
    selectedAnswer,
    optionTokenMap,
  );

  if (!selectedCanonicalKey) {
    return {
      ok: false,
      status: 400,
      error: "invalid_answer",
      message:
        "selectedAnswer must match a served option token or canonical option key.",
    };
  }

  const correctOptionId =
    Object.entries(optionTokenMap).find(
      (entry) => entry[1] === correctAnswerKey,
    )?.[0] ?? null;

  const isCorrect = selectedCanonicalKey === correctAnswerKey;
  return {
    ok: true,
    isCorrect,
    outcome: isCorrect ? "correct" : "incorrect",
    selectedCanonicalKey,
    correctOptionId,
  };
}

