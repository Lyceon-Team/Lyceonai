/**
<<<<<<< HEAD
 * Canonical question types and canonical ID utilities.
 */

import * as crypto from "crypto";

export type SectionCode = "MATH" | "RW";
export type SourceType = 0 | 1 | 2 | 3;
export type AnswerKey = "A" | "B" | "C" | "D";
=======
 * Canonical SAT question types used by shared runtime helpers.
 * Canonical ID generation is delegated to apps/api/src/lib/canonicalId.
 */

import {
  generateCanonicalId as generateSatCanonicalId,
  mapSectionToCode as mapCanonicalSectionToCode,
  isValidCanonicalId,
} from "../../apps/api/src/lib/canonicalId";
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57

export interface QuestionOption {
  key: AnswerKey;
  text: string;
}

export interface Competency {
  code: string;
  raw?: string | null;
}

export interface QuestionDoc {
  canonicalId: string;
<<<<<<< HEAD
  testCode: "SAT";
  sectionCode: SectionCode;
  sourceType: SourceType;
=======
  testCode: string;      // "SAT"
  sectionCode: string;   // "M" | "RW"
  sourceType: 1 | 2;     // 1 = parsed from PDF, 2 = AI generated
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  stem: string;
  options: [QuestionOption, QuestionOption, QuestionOption, QuestionOption];
  correctAnswer: AnswerKey;
  answerText: string;
  explanation: string;
  competencies: Competency[];
<<<<<<< HEAD
  difficulty: 1 | 2 | 3;
  tags: unknown | null;
}

export interface CanonicalIdParams {
  testCode: "SAT";
  sectionCode: SectionCode;
  sourceType: SourceType;
  uniqueSuffix?: string;
}

export function generateCanonicalId(params: CanonicalIdParams): string {
  const { testCode, sectionCode, sourceType, uniqueSuffix } = params;
  const suffix = uniqueSuffix || generateUniqueAlphanumeric(6);
  return `${testCode}${sectionCode}${sourceType}${suffix}`;
}

function generateUniqueAlphanumeric(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const randomBytes = crypto.randomBytes(length);
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }

  return result;
}

export function isValidCanonicalId(id: string): boolean {
  return /^SAT(MATH|RW)[0-3][A-Z0-9]{6}$/.test(id);
}

export function sectionToCode(section: string | null | undefined): SectionCode {
  const normalizedSection = (section || "").toLowerCase().trim();
  if (normalizedSection.includes("math")) return "MATH";
  return "RW";
}

export function normalizeAnswerChoice(answer: string | null | undefined): AnswerKey | null {
  if (!answer) return null;
  const normalized = answer.toUpperCase().trim();
  if (["A", "B", "C", "D"].includes(normalized)) {
    return normalized as AnswerKey;
  }
=======
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

>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
  return null;
}
