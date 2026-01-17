/**
 * Ingestion v2 Canonical Question Types
 * Defines the QuestionDoc interface and canonical ID generator
 * per PRP — Ingestion v2 specifications
 */

import * as crypto from 'crypto';

export interface QuestionOption {
  key: string;
  text: string;
}

export interface Competency {
  code: string;
  raw?: string | null;
}

export interface QuestionDoc {
  canonicalId: string;
  testCode: string;      // "SAT", "ACT", "AP", etc.
  sectionCode: string;   // "M" (Math), "RW" (Reading & Writing)
  sourceType: 1 | 2;     // 1 = parsed from PDF, 2 = AI generated
  stem: string;
  options: QuestionOption[];
  answerChoice: "A" | "B" | "C" | "D" | null;
  answerText?: string | null; // For free response questions
  explanation: string | null;
  competencies: Competency[];
  difficulty?: string | null;
  tags: string[];
  sourcePdf?: string | null;
  pageNumber?: number | null;
  ingestionRunId?: string | null;
  questionHash?: string | null;
  engineUsed?: string | null;
  engineConfidence?: number | null;
  version: number;
  questionNumber?: number | null;
  section?: string | null; // Legacy section field for backward compatibility
}

export interface CanonicalIdParams {
  testCode: string;     // "SAT", "ACT", "AP"
  sectionCode: string;  // "M", "RW"
  sourceType: 1 | 2;
  uniqueSuffix?: string;
}

/**
 * Generate a canonical ID for a question
 * Format: <TEST><SECTION><SOURCE><ALPHANUM>
 * Example: SATM1A8B91Q (SAT Math, PDF source, unique suffix)
 */
export function generateCanonicalId(params: CanonicalIdParams): string {
  const { testCode, sectionCode, sourceType, uniqueSuffix } = params;
  
  // Generate a unique suffix if not provided
  const suffix = uniqueSuffix || generateUniqueAlphanumeric(6);
  
  // Format: <TEST><SECTION><SOURCE><SUFFIX>
  // TEST: SAT, ACT, AP (max 3 chars)
  // SECTION: M, RW (max 2 chars)
  // SOURCE: 1 (PDF) or 2 (AI)
  // SUFFIX: 6-8 alphanumeric characters
  return `${testCode.toUpperCase()}${sectionCode.toUpperCase()}${sourceType}${suffix}`;
}

/**
 * Generate a unique alphanumeric suffix
 */
function generateUniqueAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randomBytes = crypto.randomBytes(length);
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  
  return result;
}

/**
 * Map section string to section code
 * Converts legacy section names to PRP-compliant section codes
 */
export function sectionToCode(section: string | null | undefined): string {
  if (!section) return 'M'; // Default to Math
  
  const normalizedSection = section.toLowerCase().trim();
  
  if (normalizedSection.includes('math') || normalizedSection === 'm') {
    return 'M';
  }
  
  if (
    normalizedSection.includes('reading') || 
    normalizedSection.includes('writing') || 
    normalizedSection === 'rw' ||
    normalizedSection === 'reading and writing' ||
    normalizedSection === 'reading & writing'
  ) {
    return 'RW';
  }
  
  // Default to Math for unknown sections
  return 'M';
}

/**
 * Normalize answer choice to valid format
 */
export function normalizeAnswerChoice(answer: string | null | undefined): "A" | "B" | "C" | "D" | null {
  if (!answer) return null;
  
  const normalized = answer.toUpperCase().trim();
  if (['A', 'B', 'C', 'D'].includes(normalized)) {
    return normalized as "A" | "B" | "C" | "D";
  }
  
  return null;
}
