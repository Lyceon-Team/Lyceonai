/**
 * QuestionVM - View Model for rendering questions in the UI
 * 
 * This is the canonical client-side type for displaying questions.
 * It abstracts away ingestion internals and provides a clean interface for UI components.
 */

export interface QuestionOption {
  key: string;
  text: string;
}

export interface QuestionVM {
  id: string;
  canonicalId?: string | null;
  exam?: string | null;
  testCode?: string | null;
  sectionCode?: string | null;
  section?: string | null;
  difficulty?: string | null;
  competencies?: Array<{ code: string; raw?: string | null }> | null;
  stem: string;
  options: QuestionOption[];
  type: 'mc' | 'fr';
  explanation?: string | null;
  tags?: string[] | null;
}

export interface ValidationResult {
  isCorrect: boolean;
  mode?: 'mc' | 'fr';
  correctAnswerKey?: string | null;
  feedback?: string;
}

export interface PracticeQuestion extends QuestionVM {
  userAnswer?: string | null;
  isAnswered?: boolean;
  validationResult?: ValidationResult | null;
}

export function toQuestionVM(apiQuestion: any): QuestionVM {
  return {
    id: apiQuestion.id,
    canonicalId: apiQuestion.canonicalId || apiQuestion.canonical_id || null,
    exam: apiQuestion.exam || apiQuestion.testCode || apiQuestion.test_code || null,
    testCode: apiQuestion.testCode || apiQuestion.test_code || null,
    sectionCode: apiQuestion.sectionCode || apiQuestion.section_code || null,
    section: apiQuestion.section || null,
    difficulty: apiQuestion.difficulty || null,
    competencies: apiQuestion.competencies || null,
    stem: apiQuestion.stem || '',
    options: normalizeOptions(apiQuestion.options),
    type: apiQuestion.type || (apiQuestion.options?.length > 0 ? 'mc' : 'fr'),
    explanation: apiQuestion.explanation || null,
    tags: apiQuestion.tags || null,
  };
}

function normalizeOptions(options: any): QuestionOption[] {
  if (!options || !Array.isArray(options)) {
    return [];
  }
  
  return options.map((opt: any, index: number) => {
    if (typeof opt === 'string') {
      const letter = String.fromCharCode(65 + index);
      return { key: letter, text: opt };
    }
    if (typeof opt === 'object' && opt !== null) {
      return {
        key: opt.key || String.fromCharCode(65 + index),
        text: opt.text || String(opt),
      };
    }
    return { key: String.fromCharCode(65 + index), text: String(opt) };
  });
}
