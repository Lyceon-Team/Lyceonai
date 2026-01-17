/**
 * DocuPipe API Types
 * 
 * TypeScript interfaces for the DocuPipe document processing API.
 * Used for OCR + document understanding of SAT practice PDFs.
 * 
 * API Reference: https://app.docupipe.ai/docs
 */

export interface DocuPipeDocumentResponse {
  documentId: string;
  jobId: string;
}

export interface DocuPipeJobStatus {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  errorMessage?: string | null;
}

export interface DocuPipeStandardizeBatchResponse {
  jobId: string;
  standardizationIds: string[];
}

export interface DocuPipeStandardizationResult {
  id: string;
  data: unknown;
}

/**
 * SAT Practice Test Schema Output
 * 
 * This is the expected JSON structure from DocuPipe when using
 * a schema configured for SAT practice tests. The schema ID
 * should be set via DOCUPIPE_SAT_SCHEMA_ID env var.
 */
export interface SatDocuPipeSchemaOutput {
  questions: SatDocuPipeQuestion[];
  answerKeyTable?: SatDocuPipeAnswerKey[];
}

export interface SatDocuPipeQuestion {
  rawQuestionText: string;
  page?: number | null;
  sectionLabel?: string | null;
  questionNumber?: string | null;
  options?: string[] | null;
  answerCandidate?: string | null;
  explanationText?: string | null;
}

export interface SatDocuPipeAnswerKey {
  questionNumber: string;
  answer: string;
}
