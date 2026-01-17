import { z } from 'zod';

// Base fields common to both question types
const qaBaseSchema = z.object({
  id: z.string().min(3),
  rawId: z.string().optional(),
  stem: z.string().min(3),
  explanation: z.string().nullable(),
  section: z.enum(['Reading','Writing','Math']).nullable(),
  source: z.object({ path: z.string(), page: z.number().int().min(1) }),
  tags: z.array(z.string()),
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Multiple Choice schema - must have exactly 4 options (A-D) and choice answer
export const qaMCSchema = qaBaseSchema.extend({
  type: z.literal("mc"),
  options: z.array(z.object({ key: z.enum(['A','B','C','D']), text: z.string().min(1) })).length(4),
  answer_choice: z.enum(['A','B','C','D']),
});

// Free Response schema - no options, text answer (non-empty)
export const qaFRSchema = qaBaseSchema.extend({
  type: z.literal("fr"),
  answer_text: z.string().min(1), // Non-empty text/number answer
});

// Discriminated union schema for both types
export const qaSchema = z.discriminatedUnion("type", [
  qaMCSchema,
  qaFRSchema,
]);

// Legacy schema for backward compatibility (MC only)
export const qaLegacySchema = z.object({
  id: z.string().min(3),
  rawId: z.string().optional(),
  stem: z.string().min(3),
  options: z.array(z.object({ key: z.enum(['A','B','C','D']), text: z.string().min(1) })).length(4),
  answer: z.enum(['A','B','C','D']).nullable(),
  explanation: z.string().nullable(),
  section: z.enum(['Reading','Writing','Math']).nullable(),
  source: z.object({ path: z.string(), page: z.number().int().min(1) }),
  tags: z.array(z.string()),
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});