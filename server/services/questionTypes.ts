/**
 * Canonical question types and canonical ID utilities.
 */

import * as crypto from "crypto";

export type SectionCode = "MATH" | "RW";
export type SourceType = 0 | 1 | 2 | 3;
export type AnswerKey = "A" | "B" | "C" | "D";

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
  testCode: "SAT";
  sectionCode: SectionCode;
  sourceType: SourceType;
  stem: string;
  options: [QuestionOption, QuestionOption, QuestionOption, QuestionOption];
  correctAnswer: AnswerKey;
  answerText: string;
  explanation: string;
  competencies: Competency[];
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
  return null;
}
