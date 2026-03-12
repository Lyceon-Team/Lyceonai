import { z } from "zod";

<<<<<<< HEAD
export const answerKeySchema = z.enum(["A", "B", "C", "D"]);
export const questionTypeSchema = z.literal("multiple_choice");
export const sectionCodeSchema = z.enum(["MATH", "RW"]);
export const difficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const sourceTypeSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const optionSchema = z.object({
  key: answerKeySchema,
  text: z.string().min(1),
});

export const optionMetadataEntrySchema = z.object({
  role: z.enum(["correct", "distractor"]),
  error_taxonomy: z.string().nullable(),
});

export const optionMetadataSchema = z.object({
  A: optionMetadataEntrySchema,
  B: optionMetadataEntrySchema,
  C: optionMetadataEntrySchema,
  D: optionMetadataEntrySchema,
});

export const canonicalQuestionSchema = z.object({
  id: z.string().uuid(),
  canonical_id: z.string().min(1),
  status: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  published_at: z.string().min(1).nullable(),
  reviewed_at: z.string().min(1).nullable(),
  reviewed_by: z.string().uuid().nullable(),

  section: z.string().min(1),
  section_code: sectionCodeSchema,
  question_type: questionTypeSchema,
  stem: z.string().min(1),
  options: z.tuple([optionSchema, optionSchema, optionSchema, optionSchema]),
  correct_answer: answerKeySchema,
  answer_text: z.string().min(1),
  explanation: z.string().min(1),
  option_metadata: optionMetadataSchema,

=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  domain: z.string().min(1),
  skill: z.string().min(1),
  subskill: z.string().min(1),
  skill_code: z.string().min(1),
<<<<<<< HEAD
  difficulty: difficultySchema,

  source_type: sourceTypeSchema,
  test_code: z.string().nullable(),
  exam: z.string().nullable(),
  ai_generated: z.boolean().nullable(),

  diagram_present: z.boolean().nullable(),
  tags: z.unknown().nullable(),
  competencies: z.unknown().nullable(),
  provenance_chunk_ids: z.unknown().nullable(),
});

export type CanonicalQuestionInput = z.infer<typeof canonicalQuestionSchema>;
=======
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
