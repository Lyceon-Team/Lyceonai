/**
 * Canonical SAT question metadata types shared by runtime services.
 * Canonical ID generation/validation source of truth lives in shared/question-bank-contract.ts.
 */

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
  testCode: string; // "SAT"
  sectionCode: string; // "M" | "RW"
  sourceType: 1 | 2; // 1 = PDF-derived, 2 = AI-generated
  stem: string;
  options: QuestionOption[];
  answerChoice: "A" | "B" | "C" | "D" | null;
  answerText?: string | null;
  explanation: string | null;
  competencies: Competency[];
  difficulty?: string | null;
  tags: string[];
  sourcePdf?: string | null;
  pageNumber?: number | null;
  questionHash?: string | null;
  engineUsed?: string | null;
  engineConfidence?: number | null;
  version: number;
  questionNumber?: number | null;
  section?: string | null;
}

