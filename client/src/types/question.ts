/**
<<<<<<< HEAD
 * Canonical client-side question type.
=======
 * QuestionVM - View Model for rendering questions in the UI
 * 
 * This is the canonical client-side type for displaying questions.
 * It abstracts away storage internals and provides a clean interface for UI components.
>>>>>>> 6a60baa79edc08652c60fd03f24f552b8e2f6e57
 */

export type AnswerKey = 'A' | 'B' | 'C' | 'D';
export type QuestionDifficulty = 1 | 2 | 3;
export type SourceType = 0 | 1 | 2 | 3;

export interface QuestionOption {
  key: AnswerKey;
  text: string;
}

export interface OptionMetaEntry {
  role: 'correct' | 'distractor';
  error_taxonomy: string | null;
}

export interface OptionMetadata {
  A: OptionMetaEntry;
  B: OptionMetaEntry;
  C: OptionMetaEntry;
  D: OptionMetaEntry;
}

export interface QuestionVM {
  id: string;
  canonical_id?: string | null;
  exam?: string | null;
  test_code?: string | null;
  section_code?: 'MATH' | 'RW' | null;
  section?: string | null;
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  skill_code?: string | null;
  difficulty?: QuestionDifficulty | null;
  source_type?: SourceType | null;
  competencies?: unknown | null;
  stem: string;
  options: [QuestionOption, QuestionOption, QuestionOption, QuestionOption] | QuestionOption[];
  question_type: 'multiple_choice';
  explanation?: string | null;
  tags?: unknown | null;
  option_metadata?: OptionMetadata | null;
}

export interface ValidationResult {
  isCorrect: boolean;
  questionType?: 'multiple_choice';
  correctAnswerKey?: AnswerKey | null;
  feedback?: string;
}

export interface PracticeQuestion extends QuestionVM {
  userAnswer?: string | null;
  isAnswered?: boolean;
  validationResult?: ValidationResult | null;
}

export function toQuestionVM(apiQuestion: any): QuestionVM {
  return {
    id: String(apiQuestion.id),
    canonical_id: apiQuestion.canonical_id ?? null,
    exam: apiQuestion.exam ?? null,
    test_code: apiQuestion.test_code ?? null,
    section_code: apiQuestion.section_code ?? null,
    section: apiQuestion.section ?? null,
    domain: apiQuestion.domain ?? null,
    skill: apiQuestion.skill ?? null,
    subskill: apiQuestion.subskill ?? null,
    skill_code: apiQuestion.skill_code ?? null,
    difficulty: normalizeDifficulty(apiQuestion.difficulty),
    source_type: normalizeSourceType(apiQuestion.source_type),
    competencies: apiQuestion.competencies ?? null,
    stem: String(apiQuestion.stem ?? ''),
    options: normalizeOptions(apiQuestion.options),
    question_type: 'multiple_choice',
    explanation: apiQuestion.explanation ?? null,
    tags: apiQuestion.tags ?? null,
    option_metadata: normalizeOptionMetadata(apiQuestion.option_metadata),
  };
}

function normalizeDifficulty(value: unknown): QuestionDifficulty | null {
  return value === 1 || value === 2 || value === 3 ? (value as QuestionDifficulty) : null;
}

function normalizeSourceType(value: unknown): SourceType | null {
  return value === 0 || value === 1 || value === 2 || value === 3 ? (value as SourceType) : null;
}

function normalizeOptions(options: unknown): QuestionOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .filter((opt): opt is { key: AnswerKey; text: string } => {
      return !!opt && typeof opt === 'object' && ['A', 'B', 'C', 'D'].includes((opt as any).key) && typeof (opt as any).text === 'string';
    })
    .map((opt) => ({ key: opt.key, text: opt.text }));
}

function normalizeOptionMetadata(value: unknown): OptionMetadata | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const metadata = value as Record<string, unknown>;
  if (!('A' in metadata) || !('B' in metadata) || !('C' in metadata) || !('D' in metadata)) {
    return null;
  }

  return metadata as unknown as OptionMetadata;
}