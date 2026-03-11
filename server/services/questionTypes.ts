/**
 * Canonical SAT question types used by shared runtime helpers.
 * Canonical ID generation is delegated to apps/api/src/lib/canonicalId.
 */

import {
  generateCanonicalId as generateSatCanonicalId,
  mapSectionToCode as mapCanonicalSectionToCode,
  isValidCanonicalId,
} from "../../apps/api/src/lib/canonicalId";

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
  testCode: string;      // "SAT"
  sectionCode: string;   // "M" | "RW"
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
  // Legacy provenance field retained for historical data compatibility.
  // No runtime ingestion pipeline writes to this field in the current product scope.
  ingestionRunId?: string | null;
  questionHash?: string | null;
  engineUsed?: string | null;
  engineConfidence?: number | null;
  version: number;
  questionNumber?: number | null;
  section?: string | null; // Legacy section field for backward compatibility
}

export interface CanonicalIdParams {
  testCode: string;     // Must be SAT
  sectionCode: string;  // "M" | "RW"
  sourceType: 1 | 2;
  uniqueSuffix?: string;
}

/**
 * Generate a canonical ID for a question.
 * Format: SAT{M|RW}{1|2}[A-Z0-9]{6}
 */
export function generateCanonicalId(params: CanonicalIdParams): string {
  const normalizedTest = params.testCode.toUpperCase();
  if (normalizedTest !== "SAT") {
    throw new Error(`Unsupported test code for canonical ID: ${params.testCode}`);
  }

  const normalizedSection = sectionToCode(params.sectionCode);
  const source = String(params.sourceType) as "1" | "2";

  if (source !== "1" && source !== "2") {
    throw new Error(`Invalid source type for canonical ID: ${params.sourceType}`);
  }

  if (params.uniqueSuffix) {
    const candidate = `SAT${normalizedSection}${source}${params.uniqueSuffix.toUpperCase()}`;
    if (!isValidCanonicalId(candidate)) {
      throw new Error(`Invalid canonical ID suffix: ${params.uniqueSuffix}`);
    }
    return candidate;
  }

  return generateSatCanonicalId("SAT", normalizedSection, source);
}

/**
 * Map section string to canonical section code.
 */
export function sectionToCode(section: string | null | undefined): "M" | "RW" {
  if (!section) return "RW";
  return mapCanonicalSectionToCode(section);
}

/**
 * Normalize answer choice to valid format.
 */
export function normalizeAnswerChoice(answer: string | null | undefined): "A" | "B" | "C" | "D" | null {
  if (!answer) return null;

  const normalized = answer.toUpperCase().trim();
  if (["A", "B", "C", "D"].includes(normalized)) {
    return normalized as "A" | "B" | "C" | "D";
  }

  return null;
}
