import { z } from "zod";

export const TutorEntryModeSchema = z.enum(["scoped_question", "scoped_session", "general"]);
export const TutorSourceSurfaceSchema = z.enum(["practice", "review", "test_review", "dashboard"]);
export const TutorConversationStatusSchema = z.enum(["active", "closed", "abandoned"]);
export const TutorRoleSchema = z.enum(["student", "tutor", "system"]);
export const TutorContentKindSchema = z.enum(["message", "suggestion", "consent_prompt", "system_note"]);

export const TutorScopeSchema = z.object({
  source_session_id: z.string().uuid().nullable().optional(),
  source_session_item_id: z.string().uuid().nullable().optional(),
  source_question_row_id: z.string().uuid().nullable().optional(),
  source_question_canonical_id: z.string().min(1).max(128).nullable().optional(),
});

export const TutorStartConversationRequestSchema = z.object({
  entry_mode: TutorEntryModeSchema,
  source_surface: TutorSourceSurfaceSchema,
  source_session_id: z.string().uuid().nullable().optional(),
  source_session_item_id: z.string().uuid().nullable().optional(),
  source_question_row_id: z.string().uuid().nullable().optional(),
  source_question_canonical_id: z.string().min(1).max(128).nullable().optional(),
});

export const TutorAppendMessageRequestSchema = z.object({
  conversation_id: z.string().uuid(),
  message: z.string().min(1).max(4000),
  content_kind: TutorContentKindSchema.default("message"),
  client_turn_id: z.string().uuid(),
  client_scope: TutorScopeSchema.optional(),
});

export const TutorListConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().datetime().optional(),
  source_surface: TutorSourceSurfaceSchema.optional(),
  status: TutorConversationStatusSchema.optional(),
});

export const TutorCloseConversationRequestSchema = z.object({
  status: z.enum(["closed", "abandoned"]),
});

export const TutorSuggestedActionSchema = z.object({
  type: z.enum(["none", "offer_similar_question", "offer_broader_coaching", "offer_stay_focused"]),
  label: z.string().nullable(),
});

export const TutorUiHintsSchema = z.object({
  show_accept_decline: z.boolean(),
  allow_freeform_reply: z.boolean(),
  suggested_chip: z.string().nullable(),
});

export const TutorStartConversationResponseSchema = z.object({
  data: z.object({
    conversation_id: z.string().uuid(),
    entry_mode: TutorEntryModeSchema,
    source_surface: TutorSourceSurfaceSchema,
    status: TutorConversationStatusSchema,
    resolved_scope: TutorScopeSchema,
  }),
});

export const TutorAppendMessageResponseSchema = z.object({
  data: z.object({
    conversation_id: z.string().uuid(),
    message_id: z.string().uuid(),
    response: z.object({
      content: z.string(),
      content_kind: TutorContentKindSchema,
      suggested_action: TutorSuggestedActionSchema.optional(),
      ui_hints: TutorUiHintsSchema.optional(),
    }),
  }),
});

export const TutorConversationMessageSchema = z.object({
  id: z.string().uuid(),
  role: TutorRoleSchema,
  content_kind: TutorContentKindSchema,
  message: z.string(),
  content_json: z.record(z.string(), z.unknown()),
  client_turn_id: z.string().uuid().nullable(),
  created_at: z.string(),
});

export const TutorFetchConversationResponseSchema = z.object({
  data: z.object({
    conversation: z.object({
      conversation_id: z.string().uuid(),
      entry_mode: TutorEntryModeSchema,
      source_surface: TutorSourceSurfaceSchema,
      status: TutorConversationStatusSchema,
      resolved_scope: TutorScopeSchema,
      created_at: z.string(),
      updated_at: z.string(),
    }),
    messages: z.array(TutorConversationMessageSchema),
  }),
});

export const TutorConversationEnvelopeSchema = z.object({
  conversation_id: z.string().uuid(),
  entry_mode: TutorEntryModeSchema,
  source_surface: TutorSourceSurfaceSchema,
  status: TutorConversationStatusSchema,
  resolved_scope: TutorScopeSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const TutorListConversationsResponseSchema = z.object({
  data: z.object({
    conversations: z.array(TutorConversationEnvelopeSchema),
    next_cursor: z.string().nullable(),
  }),
});

export const TutorCloseConversationResponseSchema = z.object({
  data: z.object({
    conversation_id: z.string().uuid(),
    status: z.enum(["closed", "abandoned"]),
  }),
});

export const TutorErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
  }),
  requestId: z.string().optional(),
});

export const TutorRateLimitResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
  }),
  limitType: z.string(),
  current: z.number().nullable(),
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
  resetAt: z.string().nullable(),
  cooldownUntil: z.string().nullable(),
  requestId: z.string().optional(),
});

export const TutorRecoverableRetryErrorSchema = z.object({
  error: z.object({
    code: z.literal("TUTOR_RECOVERABLE_RETRY_REQUIRED"),
    message: z.literal("The tutor turn could not be completed safely. Please retry."),
    retryable: z.literal(true),
  }),
  requestId: z.string().optional(),
});
