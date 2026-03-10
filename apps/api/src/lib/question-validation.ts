/**
 * Shared validation utilities for question rows
 */

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
export function validateQuestionRow(row: any): {
  valid: boolean;
  errors?: string[];
  droppedKeys?: string[];
  cleanedRow?: any
} {
  const errors: string[] = [];
  const droppedKeys: string[] = [];
  const cleanedRow: any = {};

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
      cleanedRow[key] = row[key];
    } else {
      droppedKeys.push(key);
    }
  }

  // Canonical normalization for inserts
  if (answerChoice) {
    cleanedRow.answer_choice = answerChoice;
    if (!cleanedRow.answer) cleanedRow.answer = answerChoice;
  }
  cleanedRow.type = 'mc';
  cleanedRow.question_type = 'multiple_choice';

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    droppedKeys: droppedKeys.length > 0 ? droppedKeys : undefined,
    cleanedRow,
  };
}
