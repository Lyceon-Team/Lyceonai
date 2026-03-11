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
