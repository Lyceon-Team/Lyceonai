import { z } from "zod";

export const OptionKeySchema = z.enum(["A", "B", "C", "D"]);

// Tiered metadata enums (Milestone B)
export const MathDomainSchema = z.enum([
  "Algebra",
  "Advanced Math",
  "Problem Solving & Data Analysis",
  "Geometry & Trigonometry"
]);

export const DifficultyLevelSchema = z.enum(["easy", "medium", "hard", "unknown"]);

export const CopyRiskSchema = z.enum(["low", "medium", "high"]);
export const StyleMatchSchema = z.enum(["good", "ok", "poor"]);
export const DifficultyMatchSchema = z.enum(["match", "mismatch", "unknown"]);

export type MathDomain = z.infer<typeof MathDomainSchema>;
export type DifficultyLevel = z.infer<typeof DifficultyLevelSchema>;
export type CopyRisk = z.infer<typeof CopyRiskSchema>;
export type StyleMatch = z.infer<typeof StyleMatchSchema>;
export type DifficultyMatch = z.infer<typeof DifficultyMatchSchema>;

// Style page schema with tiered metadata
export const StylePageSchema = z.object({
  // Tier 0: Required
  id: z.string().uuid(),
  exam: z.string().min(1),
  section: z.enum(["math", "rw"]),
  bucket: z.string().min(1),
  pdf_path: z.string().min(1),
  page_number: z.number().int().min(1),
  image_path: z.string().min(1),
  dpi: z.number().int().min(72).max(300),
  rendered_at: z.string().datetime().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  
  // Tier 1: Recommended (optional)
  domain: MathDomainSchema.nullable().optional(),
  difficulty: DifficultyLevelSchema.nullable().optional(),
  
  // Tier 2: Optional
  skill: z.string().nullable().optional(),
  diagram_present: z.boolean().nullable().optional(),
  tag_confidence: z.number().min(0).max(1).nullable().optional(),
  
  // Usage tracking
  teacher_used_count: z.number().int().min(0).default(0),
  qa_used_count: z.number().int().min(0).default(0),
  last_teacher_used_at: z.string().datetime().nullable().optional(),
  last_qa_used_at: z.string().datetime().nullable().optional(),
});

export type StylePage = z.infer<typeof StylePageSchema>;

// Style pack provenance for drafts (style_page_ids stored as UUID[] in DB)
export const StylePackProvenanceSchema = z.object({
  style_page_ids: z.array(z.string().uuid()),
  style_domain_mix_score: z.number().int().min(0),
  style_tag_confidence_avg: z.number().min(0).max(1).nullable(),
});

// Database-aligned provenance (uses snake_case matching DB columns)
export const DbStylePackProvenanceSchema = z.object({
  style_page_ids: z.array(z.string().uuid()).nullable(),
  style_domain_mix_score: z.number().int().min(0),
  style_tag_confidence_avg: z.number().min(0).max(1).nullable(),
});

export type DbStylePackProvenance = z.infer<typeof DbStylePackProvenanceSchema>;

export type StylePackProvenance = z.infer<typeof StylePackProvenanceSchema>;

export const StyleRefSchema = z.object({
  bucket: z.string().min(1),
  path: z.string().min(1),
  pageHint: z.number().int().positive().optional(),
});

export const CreateJobRequestSchema = z.object({
  testCode: z.string().min(1).default("SAT"),
  targetCount: z.number().int().min(1).max(5000),
  styleRefs: z.array(StyleRefSchema).default([]),
  section: z.enum(["math", "rw"]).optional(),
});

export const CreateStyleLibraryEntrySchema = z.object({
  label: z.string().min(1),
  bucket: z.string().min(1),
  path: z.string().min(1),
  pageHint: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export type StyleRef = z.infer<typeof StyleRefSchema>;
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;
export type CreateStyleLibraryEntry = z.infer<typeof CreateStyleLibraryEntrySchema>;

export const GeneratedQuestionDraftSchema = z.object({
  draftId: z.string().min(1),
  section: z.enum(["Math", "Reading", "Writing"]),
  skill: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  stem: z.string().min(10),
  options: z
    .array(
      z.object({
        key: OptionKeySchema,
        text: z.string().min(1),
      })
    )
    .length(4)
    .superRefine((opts, ctx) => {
      const keys = opts.map((o) => o.key);
      const uniq = new Set(keys);
      if (uniq.size !== 4) ctx.addIssue({ code: "custom", message: "options must have unique keys A-D" });
    }),
  correctAnswer: OptionKeySchema,
  explanation: z.string().min(10),
  inspiration: z
    .object({
      questionIds: z.array(z.string().min(1)).optional(),
      notes: z.string().min(1).optional(),
    })
    .nullable(),
  assets: z.array(
    z.object({
      type: z.enum(["diagram", "table"]),
      latex: z.string().min(1).optional(),
      svg: z.string().min(1).optional(),
      imagePrompt: z.string().min(1).optional(),
    })
  ),
});

export const QaResultSchema = z.object({
  ok: z.boolean(),
  foundCorrectAnswer: OptionKeySchema,
  issues: z.array(z.string().min(1)),
  correctedExplanation: z.string().min(10).nullable().optional(),
  correctedDifficulty: z.enum(["easy", "medium", "hard"]).nullable().optional(),
  // Milestone E: QA policy fields
  copyRisk: CopyRiskSchema.default("low"),
  styleMatch: StyleMatchSchema.default("good"),
  difficultyMatch: DifficultyMatchSchema.default("unknown"),
});

const V4_BATCH_MAX = parseInt(process.env.V4_BATCH_MAX || "25", 10) || 25;
const V4_SLEEP_MS_DEFAULT = parseInt(process.env.V4_SLEEP_MS_DEFAULT || "1200", 10) || 1200;
const V4_QA_FAIL_DEFAULT = parseInt(process.env.V4_QA_FAIL_DEFAULT || "3", 10) || 3;

export const BatchRunRequestSchema = z.object({
  count: z.number().int().min(1).max(V4_BATCH_MAX).default(1),
  sleepMs: z.number().int().min(0).max(10000).default(V4_SLEEP_MS_DEFAULT),
  stopOnQaFail: z.boolean().default(false),
  maxQaFails: z.number().int().min(1).max(10).default(V4_QA_FAIL_DEFAULT),
  section: z.enum(["math", "rw"]).default("math"),
});

export type BatchRunRequest = z.infer<typeof BatchRunRequestSchema>;

export const QueueBatchRequestSchema = z.object({
  count: z.number().int().min(1).max(V4_BATCH_MAX).default(1),
  sleepMs: z.number().int().min(0).max(10000).default(V4_SLEEP_MS_DEFAULT),
  stopOnQaFail: z.boolean().default(false),
  maxQaFails: z.number().int().min(1).max(10).default(V4_QA_FAIL_DEFAULT),
  enqueueIfLocked: z.boolean().default(true),
  deferSecondsOnLock: z.number().int().min(5).max(600).default(30),
  section: z.enum(["math", "rw"]).default("math"),
});

export type QueueBatchRequest = z.infer<typeof QueueBatchRequestSchema>;

export const PageModeSchema = z.enum(["first", "all", "range"]).default("first");

export const QueueRenderPagesRequestSchema = z.object({
  type: z.literal("render_pages"),
  bucket: z.literal("lyceon-style-bank"),
  pdfPath: z.string().min(1),
  exam: z.literal("sat").default("sat"),
  section: z.enum(["math", "rw"]),
  dpi: z.number().int().min(72).max(300).default(150),
  maxPages: z.number().int().min(1).max(200).default(60),
  overwrite: z.boolean().default(false),
  pageMode: PageModeSchema,
  pageStart: z.number().int().min(1).optional(),
  pageEnd: z.number().int().min(1).optional(),
});

export type QueueRenderPagesRequest = z.infer<typeof QueueRenderPagesRequestSchema>;

export const QueueBatchClusterRequestSchema = z.object({
  type: z.literal("batch_cluster"),
  section: z.enum(["math", "rw"]),
  limit: z.number().int().min(1).max(100).default(20),
  pass: z.number().int().min(1).default(1),
});

export type QueueBatchClusterRequest = z.infer<typeof QueueBatchClusterRequestSchema>;

export const QueueItemPayloadSchema = z.discriminatedUnion("type", [
  QueueBatchRequestSchema.extend({ type: z.literal("batch_generate").default("batch_generate") }),
  QueueRenderPagesRequestSchema,
  QueueBatchClusterRequestSchema,
]);

export type QueueItemPayload = z.infer<typeof QueueItemPayloadSchema>;

export const ExtendedBatchRunRequestSchema = BatchRunRequestSchema.extend({
  domain: z.string().optional(),
  skill: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

export type ExtendedBatchRunRequest = z.infer<typeof ExtendedBatchRunRequestSchema>;
