<<<<<<< HEAD
export type AnswerKey = "A" | "B" | "C" | "D";
export type SectionCode = "MATH" | "RW";
export type QuestionType = "multiple_choice";
export type Difficulty = 1 | 2 | 3;
export type SourceType = 0 | 1 | 2 | 3;

export type QuestionOption = {
  key: AnswerKey;
  text: string;
};

export type OptionMetaEntry = {
  role: "correct" | "distractor";
  error_taxonomy: string | null;
};

export type OptionMetadata = {
  A: OptionMetaEntry;
  B: OptionMetaEntry;
  C: OptionMetaEntry;
  D: OptionMetaEntry;
};

export type CanonicalQuestion = {
  id: string;
  canonical_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;

  section: string;
  section_code: SectionCode;
  question_type: QuestionType;
  stem: string;
  options: [QuestionOption, QuestionOption, QuestionOption, QuestionOption];
  correct_answer: AnswerKey;
  answer_text: string;
  explanation: string;
  option_metadata: OptionMetadata;

  domain: string;
  skill: string;
  subskill: string;
  skill_code: string;
  difficulty: Difficulty;

  source_type: SourceType;
  test_code: string | null;
  exam: string | null;
  ai_generated: boolean | null;

  diagram_present: boolean | null;
  tags: unknown | null;
  competencies: unknown | null;
  provenance_chunk_ids: unknown | null;
};
=======
export type QuestionOptionKey = 'A' | 'B' | 'C' | 'D';

export interface CanonicalQuestionOption {
  key: QuestionOptionKey;
  text: string;
}

export interface CanonicalOptionMetadata {
  key: QuestionOptionKey;
  text: string;
  is_correct: boolean;
}

export interface CanonicalQuestionRecord {
  id: string;
  canonical_id: string;
  status: 'draft' | 'reviewed';
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  section: string;
  section_code: 'MATH' | 'RW';
  question_type: 'multiple_choice';
  stem: string;
  options: [
    CanonicalQuestionOption,
    CanonicalQuestionOption,
    CanonicalQuestionOption,
    CanonicalQuestionOption
  ];
  correct_answer: QuestionOptionKey;
  answer_text: string;
  explanation: string;
  option_metadata: [
    CanonicalOptionMetadata,
    CanonicalOptionMetadata,
    CanonicalOptionMetadata,
    CanonicalOptionMetadata
  ];
  domain: string;
  skill: string;
  subskill: string;
  skill_code: string;
  difficulty: string;
  source_type: 'synthetic' | 'official' | 'hybrid' | 'unknown';
  test_code: string | null;
  exam: string | null;
  ai_generated: boolean | null;
  diagram_present: boolean | null;
  tags: unknown[] | null;
  competencies: unknown[] | null;
  provenance_chunk_ids: unknown[] | null;
}

export type QAItem = CanonicalQuestionRecord;
export type QAItemLegacy = CanonicalQuestionRecord;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
