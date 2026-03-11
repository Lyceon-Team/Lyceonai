/**
<<<<<<< HEAD
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
=======
 * Shared validation utilities for canonical question rows.
 */

// Canonical columns in public.questions
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
export const SUPABASE_QUESTIONS_COLUMNS = [
  'id',
  'canonical_id',
  'status',
  'created_at',
  'updated_at',
  'reviewed_at',
  'reviewed_by',
  'section',
  'section_code',
  'question_type',
  'stem',
  'options',
  'correct_answer',
  'answer_text',
  'explanation',
  'option_metadata',
  'domain',
  'skill',
  'subskill',
  'skill_code',
  'difficulty',
  'source_type',
  'test_code',
  'exam',
  'ai_generated',
  'diagram_present',
  'tags',
  'competencies',
  'provenance_chunk_ids',
] as const;

function hasFourItems(value: unknown): boolean {
  return Array.isArray(value) && value.length === 4;
}

<<<<<<< HEAD
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
=======
export function validateQuestionRow(
  row: Record<string, unknown>
): {
  valid: boolean;
  errors?: string[];
  droppedKeys?: string[];
  cleanedRow?: Record<string, unknown>;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
} {
  const errors: string[] = [];
  const droppedKeys: string[] = [];
  const cleanedRow: Record<string, unknown> = {};
<<<<<<< HEAD

<<<<<<< HEAD
  for (const key of Object.keys(row ?? {})) {
    if ((SUPABASE_QUESTIONS_COLUMNS as readonly string[]).includes(key)) {
=======
  if (!row.canonical_id) {
    errors.push('canonical_id is required');
  } else if (!isValidCanonicalId(String(row.canonical_id))) {
    errors.push('canonical_id must match SAT{M|RW}{1|2}[A-Z0-9]{6}');
  }
=======
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

  if (!row.canonical_id) errors.push('canonical_id is required');
  if (!row.status) errors.push('status is required');
  if (!row.section) errors.push('section is required');
  if (!row.section_code) errors.push('section_code is required');
  if (row.question_type !== 'multiple_choice') errors.push('question_type must be multiple_choice');
  if (!row.stem) errors.push('stem is required');
  if (!row.correct_answer) errors.push('correct_answer is required');
  if (!row.skill_code) errors.push('skill_code is required');

  if (!hasFourItems(row.options)) {
    errors.push('options must be a 4-item JSON array');
  }

  if (!hasFourItems(row.option_metadata)) {
    errors.push('option_metadata must be a 4-item JSON array');
  }

  for (const key of Object.keys(row)) {
<<<<<<< HEAD
    if (SUPABASE_QUESTIONS_COLUMNS.includes(key)) {
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
=======
    if ((SUPABASE_QUESTIONS_COLUMNS as readonly string[]).includes(key)) {
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
      cleanedRow[key] = row[key];
    } else {
      droppedKeys.push(key);
    }
  }

<<<<<<< HEAD
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

=======
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  return {
    valid: errors.length === 0,
    errors: errors.length ? errors : undefined,
    droppedKeys: droppedKeys.length ? droppedKeys : undefined,
    cleanedRow,
  };
}
