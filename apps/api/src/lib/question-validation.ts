/**
 * Shared validation utilities for question rows
 */

// Expected columns in the questions table
export const SUPABASE_QUESTIONS_COLUMNS = [
  'id', 'canonical_id', 'section', 'stem', 'question_type', 'options',
  'answer', 'exam', 'test_code', 'section_code', 'ai_generated',
  'needs_review', 'confidence', 'created_at', 'updated_at'
];

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

  // Check required fields
  if (!row.canonical_id) errors.push('canonical_id is required');
  if (!row.section) errors.push('section is required');
  if (!row.stem) errors.push('stem is required');
  if (!row.question_type) errors.push('question_type is required');

  // Copy only known columns
  for (const key of Object.keys(row)) {
    if (SUPABASE_QUESTIONS_COLUMNS.includes(key)) {
      cleanedRow[key] = row[key];
    } else {
      droppedKeys.push(key);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    droppedKeys: droppedKeys.length > 0 ? droppedKeys : undefined,
    cleanedRow,
  };
}
