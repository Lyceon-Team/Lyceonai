/**
 * Shared validation utilities for canonical question rows.
 */

import {
  hasCanonicalOptionSet,
  hasSingleCanonicalCorrectAnswer,
  isValidCanonicalId,
  normalizeLifecycleStatus,
  normalizeSectionCode,
  normalizeSourceType,
} from "../../../../shared/question-bank-contract";

// Canonical columns in public.questions
export const SUPABASE_QUESTIONS_COLUMNS = [
  "id",
  "canonical_id",
  "status",
  "created_at",
  "updated_at",
  "reviewed_at",
  "reviewed_by",
  "section",
  "section_code",
  "question_type",
  "stem",
  "options",
  "correct_answer",
  "answer_text",
  "explanation",
  "option_metadata",
  "domain",
  "skill",
  "subskill",
  "skill_code",
  "difficulty",
  "source_type",
  "test_code",
  "exam",
  "ai_generated",
  "diagram_present",
  "tags",
  "competencies",
  "provenance_chunk_ids",
  "version",
] as const;

export function validateQuestionRow(
  row: Record<string, unknown>
): {
  valid: boolean;
  errors?: string[];
  droppedKeys?: string[];
  cleanedRow?: Record<string, unknown>;
} {
  const errors: string[] = [];
  const droppedKeys: string[] = [];
  const cleanedRow: Record<string, unknown> = {};

  const lifecycle = normalizeLifecycleStatus(row.status ?? null);
  if (!lifecycle) {
    errors.push("status must be one of draft | qa | published");
  }

  if (row.question_type !== "multiple_choice") {
    errors.push("question_type must be multiple_choice");
  }

  if (!row.stem || String(row.stem).trim().length === 0) {
    errors.push("stem is required");
  }

  if (!normalizeSectionCode(row.section_code ?? row.section ?? null)) {
    errors.push("section_code must normalize to M or RW");
  }

  if (!hasCanonicalOptionSet(row.options)) {
    errors.push("options must be a 4-item array with keys A/B/C/D");
  }

  if (!hasSingleCanonicalCorrectAnswer(row.correct_answer ?? null, row.options)) {
    errors.push("correct_answer must be exactly one of A/B/C/D and match options");
  }

  const canonicalId = row.canonical_id;
  if (canonicalId != null && String(canonicalId).length > 0 && !isValidCanonicalId(String(canonicalId))) {
    errors.push("canonical_id format is invalid");
  }

  if (lifecycle === "published") {
    if (!canonicalId || String(canonicalId).trim().length === 0) {
      errors.push("canonical_id is required for published questions");
    }
    if (!normalizeSourceType(row.source_type ?? null)) {
      errors.push("source_type must be 1 (PDF-derived) or 2 (AI-generated)");
    }
  }

  for (const key of Object.keys(row)) {
    if ((SUPABASE_QUESTIONS_COLUMNS as readonly string[]).includes(key)) {
      cleanedRow[key] = row[key];
    } else {
      droppedKeys.push(key);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length ? errors : undefined,
    droppedKeys: droppedKeys.length ? droppedKeys : undefined,
    cleanedRow,
  };
}
