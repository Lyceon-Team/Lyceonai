/**
 * @spec [CC Brief "LISA Session Lifecycle" §5.1, §5.2, §5.3, §5.4]
 * @implemented 2026-09-22
 *
 * plain English: Zod-first schemas and inferred types for the LISA session
 * lifecycle — conversation status, message status, create/end/resume
 * request shapes, and crisis review event shapes. Single source of truth
 * for both server and client.
 */
import { z } from "zod";

// ── Conversation Status ──────────────────────────────────────────────

export const conversationStatusSchema = z.enum(["active", "ended"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

// ── Conversation Surface ─────────────────────────────────────────────

export const conversationSurfaceSchema = z.enum([
  "standalone",
  "practice",
  "review",
]);
export type ConversationSurface = z.infer<typeof conversationSurfaceSchema>;

// ── Message Status ───────────────────────────────────────────────────

export const messageStatusSchema = z.enum(["pending", "completed", "failed"]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

// ── Create Conversation Request ──────────────────────────────────────

export const createConversationRequestSchema = z.object({
  entry_mode: z.enum(["scoped_question", "scoped_session", "general"]),
  source_surface: z.enum(["practice", "review", "test_review", "dashboard"]),
  source_session_id: z.string().uuid().nullable().optional(),
  source_session_item_id: z.string().uuid().nullable().optional(),
  source_question_row_id: z.string().min(1).nullable().optional(),
  source_question_canonical_id: z.string().min(1).nullable().optional(),
  idempotency_key: z.string().uuid().optional(),
});
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;

// ── End Conversation Request ─────────────────────────────────────────

export const endConversationRequestSchema = z.object({
  idempotency_key: z.string().uuid().optional(),
});
export type EndConversationRequest = z.infer<
  typeof endConversationRequestSchema
>;

// ── Resume Conversation Request ──────────────────────────────────────

export const resumeConversationRequestSchema = z.object({
  idempotency_key: z.string().uuid().optional(),
});
export type ResumeConversationRequest = z.infer<
  typeof resumeConversationRequestSchema
>;

// ── List Conversations Query ─────────────────────────────────────────

export const listConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional(),
  source_surface: z
    .enum(["practice", "review", "test_review", "dashboard"])
    .optional(),
  surface: conversationSurfaceSchema.optional(),
  status: conversationStatusSchema.optional(),
  // W4-4: find the item's existing thread WITHOUT creating one — the review
  // panel is always open, and a conversation is created only on the first
  // real message. Read-only; still scoped to the authenticated student.
  source_session_item_id: z.string().uuid().optional(),
});
export type ListConversationsQuery = z.infer<
  typeof listConversationsQuerySchema
>;

// ── Crisis Review Event ──────────────────────────────────────────────

export const crisisReviewEventTypeSchema = z.enum([
  "case_opened",
  "signal_received",
  "notification_sent",
  "assigned",
  "resolved",
]);
export type CrisisReviewEventType = z.infer<typeof crisisReviewEventTypeSchema>;

// ── Conversation Detail (GET /api/tutor/conversations/:id) ───────────

/**
 * @spec [Doc-03B_V4.1 §7.5 + fields beyond it: title, crisis_paused_at, surface come from CC Brief "LISA Session Lifecycle" and CC Brief "Close the LISA Vertical" PR 1.1 — not in §7.5; spec gap reported to owner]
 * @implemented 2026-09-23
 *
 * plain English: the replay response the chat page renders from. The client
 * derives the paused state from `conversation.crisis_paused_at` and the header
 * from `conversation.title`, so both are REQUIRED (nullable) fields here — a
 * server that omits them fails this schema instead of silently rendering a
 * paused conversation as live. `status` reuses `conversationStatusSchema`
 * (active | ended): the DB CHECK still admits legacy closed/abandoned, but no
 * code path writes them and production holds none (2026-09-23).
 */
export const conversationDetailMessageSchema = z.object({
  message_id: z.string().uuid(),
  role: z.enum(["student", "tutor", "system"]),
  content_kind: z.string(),
  message: z.string(),
  created_at: z.string(),
  // W2-10: the key the chat page reconciles its optimistic student bubble
  // against. Null for rows written without one (tutor/system replies carry
  // the turn's id too; legacy rows may not).
  client_turn_id: z.string().nullable(),
});
export type ConversationDetailMessage = z.infer<
  typeof conversationDetailMessageSchema
>;

export const conversationDetailSchema = z.object({
  conversation: z.object({
    conversation_id: z.string().uuid(),
    entry_mode: z.enum(["scoped_question", "scoped_session", "general"]),
    source_surface: z.enum(["practice", "review", "test_review", "dashboard"]),
    surface: conversationSurfaceSchema.nullable(),
    status: conversationStatusSchema,
    title: z.string().nullable(),
    crisis_paused_at: z.string().nullable(),
    resolved_scope: z.object({
      source_session_id: z.string().uuid().nullable(),
      source_session_item_id: z.string().uuid().nullable(),
      source_question_row_id: z.string().nullable(),
      source_question_canonical_id: z.string().nullable(),
    }),
    created_at: z.string(),
    updated_at: z.string(),
    closed_at: z.string().nullable(),
  }),
  messages: z.array(conversationDetailMessageSchema),
  pagination: z.object({
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

// ── Conversation Summary (list response item) ────────────────────────

export const conversationSummarySchema = z.object({
  conversation_id: z.string().uuid(),
  entry_mode: z.enum(["scoped_question", "scoped_session", "general"]),
  source_surface: z.enum(["practice", "review", "test_review", "dashboard"]),
  surface: conversationSurfaceSchema.nullable(),
  status: conversationStatusSchema,
  title: z.string().nullable(),
  crisis_flagged: z.boolean(),
  crisis_paused_at: z.string().nullable(),
  resolved_scope: z.object({
    source_session_id: z.string().uuid().nullable(),
    source_session_item_id: z.string().uuid().nullable(),
    source_question_row_id: z.string().nullable(),
    source_question_canonical_id: z.string().nullable(),
  }),
  last_message_preview: z.string().nullable(),
  message_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

// ── Conversation list page (GET /api/tutor/conversations) ────────────

/**
 * @spec [Doc-03B_V4.1 §8.3, §8.5; cursor format §7.3 (CR-03B-28)]
 * | @implemented [2026-09-29]
 *
 * plain English: the decoded form of the list's opaque `cursor`. The server
 * encodes it as base64url(JSON) and the client never reads it. It anchors the
 * next page on the LAST row of the previous one by (updated_at, id), so two
 * conversations with the same updated_at are still ordered, and a page never
 * repeats or skips a row the way an offset would.
 *
 * edge cases: `v` is the format version (§7.3) — a cursor with any other
 * version, sort, or a malformed anchor fails this schema and the route answers
 * 400 invalid_input rather than guessing.
 */
export const conversationListCursorSchema = z.object({
  v: z.literal(1),
  sort: z.literal("updated_at_desc"),
  anchor_ts: z.string().datetime({ offset: true }),
  anchor_id: z.string().uuid(),
});
export type ConversationListCursor = z.infer<
  typeof conversationListCursorSchema
>;

/**
 * @spec [Doc-03B_V4.1 §8.5] | @implemented [2026-09-29]
 *
 * plain English: the list response body under `data`. `has_more` is true only
 * when a further row exists (the server reads limit+1), and `next_cursor` is
 * null exactly when `has_more` is false.
 */
export const listConversationsResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  pagination: z.object({
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
});
export type ListConversationsResponse = z.infer<
  typeof listConversationsResponseSchema
>;
