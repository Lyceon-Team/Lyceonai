/**
 * Shared validation utilities for canonical public.questions rows
 */

const VALID_SECTION_CODES = new Set(["MATH", "RW"]);
const VALID_QUESTION_TYPES = new Set(["multiple_choice"]);
const VALID_ANSWER_KEYS = new Set(["A", "B", "C", "D"]);
const VALID_DIFFICULTIES = new Set([1, 2, 3]);
const VALID_SOURCE_TYPES = new Set([0, 1, 2, 3]);

export const SUPABASE_QUESTIONS_COLUMNS = [
  "id",
  "canonical_id",
  "status",
  "created_at",
  "updated_at",
  "published_at",
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
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasCanonicalOptionMetadata(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  for (const key of ["A", "B", "C", "D"]) {
    const entry = value[key];
    if (!isPlainObject(entry)) return false;
    if (entry.role !== "correct" && entry.role !== "distractor") return false;
    if (!(entry.error_taxonomy === null || typeof entry.error_taxonomy === "string")) return false;
  }
  return true;
}

export function validateQuestionRow(row: any): {
  valid: boolean;
  errors?: string[];
  droppedKeys?: string[];
  cleanedRow?: Record<string, unknown>;
} {
  const errors: string[] = [];
  const droppedKeys: string[] = [];
  const cleanedRow: Record<string, unknown> = {};

  for (const key of Object.keys(row ?? {})) {
    if ((SUPABASE_QUESTIONS_COLUMNS as readonly string[]).includes(key)) {
      cleanedRow[key] = row[key];
    } else {
      droppedKeys.push(key);
    }
  }

  if (!cleanedRow.canonical_id) errors.push("canonical_id is required");
  if (!cleanedRow.status) errors.push("status is required");
  if (!cleanedRow.section) errors.push("section is required");
  if (!cleanedRow.section_code || !VALID_SECTION_CODES.has(String(cleanedRow.section_code))) {
    errors.push("section_code must be MATH or RW");
  }
  if (!cleanedRow.question_type || !VALID_QUESTION_TYPES.has(String(cleanedRow.question_type))) {
    errors.push("question_type must be multiple_choice");
  }
  if (!cleanedRow.stem) errors.push("stem is required");

  if (!Array.isArray(cleanedRow.options) || cleanedRow.options.length !== 4) {
    errors.push("options must be a 4-item array");
  }

  if (!VALID_ANSWER_KEYS.has(String(cleanedRow.correct_answer))) {
    errors.push("correct_answer must be one of A, B, C, D");
  }

  if (!cleanedRow.answer_text || typeof cleanedRow.answer_text !== "string") {
    errors.push("answer_text is required");
  }

  if (!cleanedRow.explanation || typeof cleanedRow.explanation !== "string") {
    errors.push("explanation is required");
  }

  if (!hasCanonicalOptionMetadata(cleanedRow.option_metadata)) {
    errors.push("option_metadata must be a keyed object with A, B, C, D entries");
  }

  if (!VALID_DIFFICULTIES.has(Number(cleanedRow.difficulty))) {
    errors.push("difficulty must be 1, 2, or 3");
  }

  if (!VALID_SOURCE_TYPES.has(Number(cleanedRow.source_type))) {
    errors.push("source_type must be 0, 1, 2, or 3");
  }

  return {
    valid: errors.length === 0,
    errors: errors.length ? errors : undefined,
    droppedKeys: droppedKeys.length ? droppedKeys : undefined,
    cleanedRow,
  };
}
