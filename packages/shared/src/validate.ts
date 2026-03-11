import { z } from 'zod';

const optionKeySchema = z.enum(['A', 'B', 'C', 'D']);

const canonicalOptionSchema = z.object({
  key: optionKeySchema,
  text: z.string().min(1),
});

const canonicalOptionMetadataSchema = z.object({
  key: optionKeySchema,
  text: z.string().min(1),
  is_correct: z.boolean(),
});

const optionsSchema = z.tuple([
  canonicalOptionSchema,
  canonicalOptionSchema,
  canonicalOptionSchema,
  canonicalOptionSchema,
]);

const optionMetadataSchema = z.tuple([
  canonicalOptionMetadataSchema,
  canonicalOptionMetadataSchema,
  canonicalOptionMetadataSchema,
  canonicalOptionMetadataSchema,
]);

export const canonicalQuestionSchema = z.object({
  id: z.string().uuid(),
  canonical_id: z.string().min(1),
  status: z.enum(['draft', 'reviewed']),
  created_at: z.string(),
  updated_at: z.string(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  section: z.string().min(1),
  section_code: z.enum(['MATH', 'RW']),
  question_type: z.literal('multiple_choice'),
  stem: z.string().min(1),
  options: optionsSchema,
  correct_answer: optionKeySchema,
  answer_text: z.string(),
  explanation: z.string(),
  option_metadata: optionMetadataSchema,
  domain: z.string().min(1),
  skill: z.string().min(1),
  subskill: z.string().min(1),
  skill_code: z.string().min(1),
  difficulty: z.string().min(1),
  source_type: z.enum(['synthetic', 'official', 'hybrid', 'unknown']),
  test_code: z.string().nullable(),
  exam: z.string().nullable(),
  ai_generated: z.boolean().nullable(),
  diagram_present: z.boolean().nullable(),
  tags: z.array(z.unknown()).nullable(),
  competencies: z.array(z.unknown()).nullable(),
  provenance_chunk_ids: z.array(z.unknown()).nullable(),
});

export const qaSchema = canonicalQuestionSchema;
export const qaMCSchema = canonicalQuestionSchema;
export const qaFRSchema = z.never();
export const qaLegacySchema = canonicalQuestionSchema;
