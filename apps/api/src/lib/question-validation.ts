/**
 * Shared validation utilities for canonical public.questions rows
 */

<<<<<<< HEAD
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

=======
import { isValidCanonicalId } from './canonicalId';

// Expected columns in the questions table
export const SUPABASE_QUESTIONS_COLUMNS = [
  'id', 'canonical_id', 'section', 'stem', 'question_type', 'type', 'options',
  'answer', 'answer_choice', 'exam', 'test_code', 'section_code', 'ai_generated',
  'needs_review', 'confidence', 'created_at', 'updated_at', 'explanation'
];

function parseOptions(raw: unknown): Array<{ key: string; text: string }> {
  if (Array.isArray(raw)) return raw as Array<{ key: string; text: string }>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeAnswerChoice(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  return normalized;
}

// Basic validation for question rows
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
export function validateQuestionRow(row: any): {
  valid: boolean;
  errors?: string[];
  droppedKeys?: string[];
<<<<<<< HEAD
  cleanedRow?: Record<string, unknown>;
=======
  cleanedRow?: any
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
} {
  const errors: string[] = [];
  const droppedKeys: string[] = [];
  const cleanedRow: Record<string, unknown> = {};

<<<<<<< HEAD
  for (const key of Object.keys(row ?? {})) {
    if ((SUPABASE_QUESTIONS_COLUMNS as readonly string[]).includes(key)) {
=======
  if (!row.canonical_id) {
    errors.push('canonical_id is required');
  } else if (!isValidCanonicalId(String(row.canonical_id))) {
    errors.push('canonical_id must match SAT{M|RW}{1|2}[A-Z0-9]{6}');
  }

  if (!row.section) errors.push('section is required');
  if (!row.stem) errors.push('stem is required');

  const normalizedType = row.type === 'mc' ? 'mc' : row.question_type === 'multiple_choice' ? 'mc' : row.type;
  if (normalizedType !== 'mc') {
    errors.push('Only MC questions are allowed by canonical runtime contract');
  }

  const options = parseOptions(row.options);
  if (options.length < 2) {
    errors.push('options must contain at least two choices for MC questions');
  }

  const answerChoice = normalizeAnswerChoice(row.answer_choice ?? row.answer);
  if (!answerChoice) {
    errors.push('answer_choice is required for MC questions');
  } else {
    const optionKeys = new Set(
      options
        .map((opt) => normalizeAnswerChoice(opt?.key))
        .filter((k): k is string => Boolean(k))
    );
    if (!optionKeys.has(answerChoice)) {
      errors.push('answer_choice must match one of the option keys');
    }
  }

  // Copy only known columns
  for (const key of Object.keys(row)) {
    if (SUPABASE_QUESTIONS_COLUMNS.includes(key)) {
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
      cleanedRow[key] = row[key];
    } else {
      droppedKeys.push(key);
    }
  }

<<<<<<< HEAD
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
=======
  // Canonical normalization for inserts
  if (answerChoice) {
    cleanedRow.answer_choice = answerChoice;
    if (!cleanedRow.answer) cleanedRow.answer = answerChoice;
  }
  cleanedRow.type = 'mc';
  cleanedRow.question_type = 'multiple_choice';
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57

  return {
    valid: errors.length === 0,
    errors: errors.length ? errors : undefined,
    droppedKeys: droppedKeys.length ? droppedKeys : undefined,
    cleanedRow,
  };
}
