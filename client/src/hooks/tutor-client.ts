/**
 * @spec [Doc-03B_V2 §4–§5]
 * @implemented 2026-08-09
 *
 * plain English: TanStack Query hooks for the LISA tutor API endpoints.
 * All server communication flows through these hooks — no ad-hoc fetch calls.
 *
 * expected outcome: components use useCreateConversation, useSendMessage,
 * useConversation, useConversations to interact with the tutor API.
 *
 * trade-offs: optimistic updates are NOT used for tutor messages because
 * the server response includes the tutor's reply and anti-leak scanning
 * must happen server-side. Messages are appended only after server confirmation.
 *
 * edge cases: `useConversation` is disabled (no request fired) when
 * `conversationId` is null/undefined, so pages can render before a
 * conversation is selected without triggering a 404. `useSendMessage`
 * invalidates the affected conversation's query on success so the newly
 * persisted student + tutor turn is refetched from the server rather than
 * spliced in locally.
 *
 * wire contract note: the append-turn idempotency field is named
 * `client_turn_id` on the wire (Doc 03B §6.3, matching the live
 * `appendTurnSchema` in server/routes/tutor-runtime.ts) — NOT
 * `idempotency_key`. Verified directly against that route file.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { type HttpApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TutorEntryMode = "scoped_question" | "scoped_session" | "general";

export type TutorSourceSurface =
  | "practice"
  | "review"
  | "test_review"
  | "dashboard";

export type TutorConversationStatus = "active" | "closed" | "abandoned";

export type TutorMessageRole = "student" | "tutor" | "system";

export type TutorResolvedScope = {
  source_session_id: string | null;
  source_session_item_id: string | null;
  source_question_row_id: string | null;
  source_question_canonical_id: string | null;
};

export type CreateConversationInput = {
  entry_mode: TutorEntryMode;
  source_surface: TutorSourceSurface;
  source_session_id?: string | null;
  source_session_item_id?: string | null;
  source_question_row_id?: string | null;
  source_question_canonical_id?: string | null;
};

export type TutorConversation = {
  conversation_id: string;
  reused: boolean;
  entry_mode: TutorEntryMode;
  source_surface: TutorSourceSurface;
  status: TutorConversationStatus;
  crisis_flagged: boolean;
  resolved_scope: TutorResolvedScope;
  created_at: string;
  updated_at: string;
};

export type SendMessageInput = {
  conversation_id: string;
  message: string;
  client_turn_id: string;
};

export type TutorSuggestedActionType =
  | "none"
  | "offer_similar_question"
  | "offer_broader_coaching"
  | "offer_stay_focused";

export type TutorSuggestedAction = {
  type: TutorSuggestedActionType;
  label: string | null;
};

export type TutorUiHints = {
  show_accept_decline: boolean;
  allow_freeform_reply: boolean;
  suggested_chip: string | null;
};

export type SendMessageResponse = {
  conversation_id: string;
  message_id: string;
  client_turn_id: string;
  response: {
    content: string;
    content_kind: string;
    suggested_action: TutorSuggestedAction;
    ui_hints: TutorUiHints;
  };
  conversation_updated_at: string;
};

export type TutorMessage = {
  message_id: string;
  role: TutorMessageRole;
  content_kind: string;
  message: string;
  created_at: string;
};

export type TutorConversationDetail = {
  conversation: {
    conversation_id: string;
    entry_mode: TutorEntryMode;
    source_surface: TutorSourceSurface;
    status: TutorConversationStatus;
    resolved_scope: TutorResolvedScope;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
  };
  messages: TutorMessage[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
  };
};

export type TutorConversationSummary = {
  conversation_id: string;
  entry_mode: TutorEntryMode;
  source_surface: TutorSourceSurface;
  status: TutorConversationStatus;
  resolved_scope: TutorResolvedScope;
  last_message_preview: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export type TutorConversationsList = {
  conversations: TutorConversationSummary[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
  };
};

// ---------------------------------------------------------------------------
// Fetch helper — thin wrapper over the canonical `apiRequest` (queryClient.ts).
// `apiRequest` already attaches credentials, CSRF token, and Content-Type;
// this helper only adds the `/api/tutor` prefix and unwraps the `{ data }`
// envelope every endpoint in Doc 03B §5–§8 uses.
// ---------------------------------------------------------------------------

const TUTOR_API_BASE = "/api/tutor";

async function tutorRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await apiRequest(`${TUTOR_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const payload = (await res.json()) as { data: T };
  return payload.data;
}

// ---------------------------------------------------------------------------
// Query keys — single source of truth so mutations can invalidate the exact
// key a query hook subscribes to.
// ---------------------------------------------------------------------------

export function tutorConversationQueryKey(
  conversationId: string,
): readonly unknown[] {
  return ["tutor", "conversation", conversationId] as const;
}

export const tutorConversationsQueryKey = ["tutor", "conversations"] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Creates a new tutor conversation, or resolves/reuses an eligible active one
 * per the server's reuse rule (Doc 03B §5.6). Callers should read
 * `data.conversation_id` and navigate to the chat surface with it.
 */
export function useCreateConversation(): UseMutationResult<
  TutorConversation,
  HttpApiError,
  CreateConversationInput
> {
  return useMutation({
    mutationFn: (input: CreateConversationInput) =>
      tutorRequest<TutorConversation>("/conversations", {
        method: "POST",
        body: input,
      }),
  });
}

/**
 * Sends a student turn on an existing conversation. On success, invalidates
 * that conversation's query so the persisted student message and the
 * server-generated tutor reply are loaded from the server — never appended
 * client-side (anti-leak scanning happens server-side, post-generation).
 */
export function useSendMessage(): UseMutationResult<
  SendMessageResponse,
  HttpApiError,
  SendMessageInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      tutorRequest<SendMessageResponse>("/messages", {
        method: "POST",
        body: input,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: tutorConversationQueryKey(variables.conversation_id),
      });
    },
  });
}

/**
 * Fetches a single conversation with its message history. Disabled (no
 * network request) while `conversationId` is null/undefined so pages can
 * render a "select a conversation" state without a spurious request.
 */
export function useConversation(
  conversationId: string | null | undefined,
): UseQueryResult<TutorConversationDetail, HttpApiError> {
  return useQuery({
    queryKey: tutorConversationQueryKey(conversationId ?? ""),
    queryFn: () =>
      tutorRequest<TutorConversationDetail>(
        `/conversations/${encodeURIComponent(conversationId as string)}`,
      ),
    enabled: !!conversationId,
  });
}

/**
 * Lists the authenticated student's recent conversations, most recent first.
 */
export function useConversations(): UseQueryResult<
  TutorConversationsList,
  HttpApiError
> {
  return useQuery({
    queryKey: tutorConversationsQueryKey,
    queryFn: () => tutorRequest<TutorConversationsList>("/conversations"),
  });
}
