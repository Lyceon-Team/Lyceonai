/**
 * Canonical Supabase Question Row Interface
 * 
 * This interface MUST match the public.questions table schema exactly.
 * Derived from questions_rows.csv - the single source of truth.
 * 
 * RULE: If ingestion produces fields not in this interface → DROP THEM
 * RULE: If required fields are missing → FAIL THE JOB
 */

export interface SupabaseQuestionRow {
  id?: string;
  course_id?: string | null;
  document_id?: string | null;
  question_number?: number | null;
  canonical_id: string;
  section: string;
  stem: string;
  question_type: string;
  type?: string;
  options?: Record<string, string> | string[] | null;
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
  ai_generated?: boolean;
  provenance_chunk_ids?: string[] | null;
  confidence?: number | null;
  needs_review?: boolean;
  parsing_metadata?: Record<string, any> | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  created_at?: string;
  updated_at?: string;
  exam?: string;
  test_code?: string | null;
  section_code?: string | null;
  source_type?: string | null;
  competencies?: string[] | null;
  version?: number;
}

/**
 * Column names for public.questions table
 * Used to filter/validate ingestion output
 */
export const SUPABASE_QUESTIONS_COLUMNS = [
  'id', 'course_id', 'document_id', 'question_number', 'canonical_id',
  'section', 'stem', 'question_type', 'type', 'options',
  'answer', 'answer_choice', 'answer_text', 'explanation',
  'difficulty', 'difficulty_level', 'unit_tag', 'tags', 'classification',
  'source_mapping', 'page_number', 'position', 'embedding',
  'ai_generated', 'provenance_chunk_ids', 'confidence', 'needs_review',
  'parsing_metadata', 'reviewed_at', 'reviewed_by', 'created_at', 'updated_at',
  'exam', 'canonical_id', 'test_code', 'section_code', 'source_type',
  'competencies', 'version'
] as const;

export interface SupabaseIngestionRunRow {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  configuration?: Record<string, any> | null;
  started_at?: string;
  finished_at?: string | null;
  total_questions?: number;
  succeeded?: number;
  failed?: number;
  notes_json?: Record<string, any> | null;
  created_at?: string;
}
