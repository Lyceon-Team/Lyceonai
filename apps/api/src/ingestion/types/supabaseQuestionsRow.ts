/**
 * Canonical Supabase Question Row Schema
 * 
 * SINGLE SOURCE OF TRUTH: Derived from questions_rows.csv export
 * 
 * RULES:
 * - If ingestion produces fields not in this schema → DROP THEM
 * - If required fields are missing → FAIL THE INSERT
 * - All writes MUST use service role key (bypasses RLS)
 */

export const SUPABASE_QUESTIONS_COLUMNS = [
  'id',
  'document_id',
  'question_number',
  'section',
  'stem',
  'question_type',
  'type',
  'options',
  'answer',
  'answer_choice',
  'answer_text',
  'explanation',
  'difficulty',
  'difficulty_level',
  'unit_tag',
  'tags',
  'classification',
  'source_mapping',
  'page_number',
  'position',
  'embedding',
  'ai_generated',
  'provenance_chunk_ids',
  'confidence',
  'needs_review',
  'parsing_metadata',
  'reviewed_at',
  'reviewed_by',
  'created_at',
  'canonical_id',
] as const;

export type SupabaseQuestionsColumn = typeof SUPABASE_QUESTIONS_COLUMNS[number];

export interface SupabaseQuestionRow {
  id?: string;
  document_id?: string | null;
  question_number?: number | null;
  section?: string | null;
  stem: string;
  question_type?: string | null;
  type?: string | null;
  options?: Array<{ key: string; text: string }> | null;
  answer?: string | null;
  answer_choice?: string | null;
  answer_text?: string | null;
  explanation?: string | null;
  difficulty?: string | null;
  difficulty_level?: number | null;
  unit_tag?: string | null;
  tags?: string[] | null;
  classification?: string | null;
  source_mapping?: Record<string, any> | null;
  page_number?: number | null;
  position?: number | null;
  embedding?: number[] | null;
  ai_generated?: boolean | null;
  provenance_chunk_ids?: string[] | null;
  confidence?: number | null;
  needs_review?: boolean | null;
  parsing_metadata?: Record<string, any> | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  created_at?: string | null;
}

export interface QuestionRowValidationResult {
  valid: boolean;
  cleanedRow: Record<string, any> | null;
  errors: string[];
  droppedKeys: string[];
}

/**
 * Runtime validator for question rows before Supabase insert.
 * - Drops any keys not in SUPABASE_QUESTIONS_COLUMNS
 * - Validates required fields (stem)
 * - Returns cleaned row ready for insert
 */
export function validateQuestionRow(
  row: Record<string, any>
): QuestionRowValidationResult {
  const errors: string[] = [];
  const droppedKeys: string[] = [];
  const cleanedRow: Record<string, any> = {};
  
  const allowedColumns = new Set<string>(SUPABASE_QUESTIONS_COLUMNS);
  
  for (const [key, value] of Object.entries(row)) {
    if (allowedColumns.has(key)) {
      if (value !== undefined) {
        cleanedRow[key] = value;
      }
    } else {
      droppedKeys.push(key);
    }
  }
  
  if (!cleanedRow.stem || typeof cleanedRow.stem !== 'string' || cleanedRow.stem.trim().length < 5) {
    errors.push('Missing or invalid stem (required, min 5 chars)');
  }
  
  if (cleanedRow.options !== undefined && cleanedRow.options !== null) {
    if (!Array.isArray(cleanedRow.options)) {
      errors.push('Options must be an array');
    }
  }
  
  if (droppedKeys.length > 0) {
    console.log(`[Validator] Dropped non-schema keys: ${droppedKeys.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    cleanedRow: errors.length === 0 ? cleanedRow : null,
    errors,
    droppedKeys,
  };
}

/**
 * Batch validate and clean question rows.
 * Returns only valid rows, logs validation failures.
 */
export function validateQuestionRows(
  rows: Record<string, any>[]
): { validRows: Record<string, any>[]; invalidCount: number; allDroppedKeys: Set<string> } {
  const validRows: Record<string, any>[] = [];
  let invalidCount = 0;
  const allDroppedKeys = new Set<string>();
  
  for (let i = 0; i < rows.length; i++) {
    const result = validateQuestionRow(rows[i]);
    
    result.droppedKeys.forEach(k => allDroppedKeys.add(k));
    
    if (result.valid && result.cleanedRow) {
      validRows.push(result.cleanedRow);
    } else {
      invalidCount++;
      console.warn(`[Validator] Row ${i} invalid: ${result.errors.join(', ')}`);
    }
  }
  
  return { validRows, invalidCount, allDroppedKeys };
}
