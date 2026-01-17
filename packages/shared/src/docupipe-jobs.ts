/**
 * DocuPipe Ingestion Job Tracking Types
 * 
 * Internal types for tracking the state of DocuPipe ingestion jobs.
 * Designed for future persistence in Supabase/Firestore.
 */

export type DocuPipeIngestStatus =
  | 'uploaded'
  | 'parsed'
  | 'standardizing'
  | 'standardized'
  | 'ingested'
  | 'error';

export interface DocuPipeIngestJob {
  id: string;
  docuPipeDocumentId: string;
  uploadJobId: string;
  standardizationJobId?: string | null;
  standardizationIds?: string[] | null;
  status: DocuPipeIngestStatus;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  source?: {
    bucket?: string;
    path?: string;
    filename?: string;
  };
  questionCount?: number;
}
