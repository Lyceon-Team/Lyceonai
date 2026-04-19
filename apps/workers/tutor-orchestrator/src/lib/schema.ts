import { z } from "zod";

export const resolvedScopeSchema = z.object({
  source_session_id: z.string().uuid().nullable(),
  source_session_item_id: z.string().uuid().nullable(),
  source_question_row_id: z.string().uuid().nullable(),
  source_question_canonical_id: z.string().nullable(),
});

export const recentMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["student", "tutor", "system"]),
  content_kind: z.enum(["message", "suggestion", "consent_prompt", "system_note"]),
  message: z.string(),
  created_at: z.string(),
});

export const memorySummarySchema = z.object({
  summary_type: z.enum([
    "teaching_profile",
    "chat_compaction",
    "recent_learning_pattern",
    "study_context",
  ]),
  summary_version: z.string(),
  content_json: z.record(z.string(), z.unknown()),
  source_window_start: z.string().nullable(),
  source_window_end: z.string().nullable(),
});

export const policyAssignmentSchema = z.object({
  policy_family: z.string(),
  policy_variant: z.string(),
  policy_version: z.string(),
  prompt_version: z.string().nullable(),
  assignment_mode: z.enum(["deterministic", "explore", "manual_override"]),
  assignment_key: z.string(),
  reason_snapshot: z.record(z.string(), z.unknown()),
});

export const orchestrateRequestSchema = z.object({
  conversation_id: z.string().uuid(),
  student_id: z.string().uuid(),
  entry_mode: z.enum(["scoped_question", "scoped_session", "general"]),
  source_surface: z.enum(["practice", "review", "test_review", "dashboard"]),
  resolved_scope: resolvedScopeSchema,
  recent_messages: z.array(recentMessageSchema),
  memory_summaries: z.array(memorySummarySchema),
  student_context: z.record(z.string(), z.unknown()),
  policy_assignment: policyAssignmentSchema,
  runtime_limits: z.object({
    max_output_tokens: z.number().int().positive(),
    timeout_ms: z.number().int().positive(),
  }),
});

export const questionLinkSchema = z.object({
  source_question_row_id: z.string().uuid().nullable(),
  source_question_canonical_id: z.string(),
  related_question_row_id: z.string().uuid().nullable(),
  related_question_canonical_id: z.string(),
  relationship_type: z.enum([
    "current",
    "similar_retry",
    "simpler_variant",
    "harder_variant",
    "concept_extension",
  ]),
  difficulty_delta: z.number().int().nullable(),
  reason_code: z.string(),
  link_snapshot: z.record(z.string(), z.unknown()),
});

export const instructionExposureSchema = z.object({
  exposure_type: z.enum([
    "hint",
    "explanation",
    "strategy",
    "similar_question_offer",
    "broader_coaching_offer",
    "consent_prompt",
  ]),
  content_variant_key: z.string().nullable(),
  content_version: z.string().nullable(),
  rendered_difficulty: z.number().int().nullable(),
  hint_depth: z.number().int().nullable(),
  tone_style: z.string().nullable(),
  sequence_ordinal: z.number().int().nonnegative(),
});

export const orchestrateResponseSchema = z.object({
  response: z.object({
    content: z.string(),
    content_kind: z.literal("message"),
    suggested_action: z.object({
      type: z.enum([
        "none",
        "offer_similar_question",
        "offer_broader_coaching",
        "offer_stay_focused",
      ]),
      label: z.string().nullable(),
    }),
    ui_hints: z.object({
      show_accept_decline: z.boolean(),
      allow_freeform_reply: z.boolean(),
      suggested_chip: z.string().nullable(),
    }),
  }),
  question_links: z.array(questionLinkSchema),
  instruction_exposures: z.array(instructionExposureSchema),
  orchestration_meta: z.object({
    model_name: z.string(),
    cache_used: z.boolean(),
    compaction_recommended: z.boolean(),
  }),
});

export const compactRequestSchema = z.object({
  conversation_id: z.string().uuid(),
  student_id: z.string().uuid(),
});

export const compactResponseSchema = z.object({
  ok: z.boolean(),
});

export type OrchestrateRequest = z.infer<typeof orchestrateRequestSchema>;
export type OrchestrateResponse = z.infer<typeof orchestrateResponseSchema>;
export type CompactRequest = z.infer<typeof compactRequestSchema>;
export type CompactResponse = z.infer<typeof compactResponseSchema>;