/**
 * Shared validation utilities for canonical question rows.
 */

// Canonical columns in public.questions
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
