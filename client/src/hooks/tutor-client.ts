/**
 * @spec [CC Brief "PR B: Standalone LISA Chat UI" §1–§5]
 * @implemented 2026-09-23
 *
 * plain English: TanStack Query hooks for the LISA tutor API — standalone
 * session lifecycle. Consumes the lifecycle endpoints (create, end, resume,
 * list, detail) and the message endpoint. All server state flows through
 * these hooks — no ad-hoc fetch calls.
 *
 * trade-offs: no optimistic updates for tutor messages — the server must
 * anti-leak scan first. Messages appear only after server confirmation.
 *
 * edge cases: `useConversation` is disabled when `conversationId` is
 * null/undefined. `useSendMessage` invalidates the affected conversation
 * and the list on success (title changes after first message). Crisis
 * responses include `crisis_paused`, `crisis_paused_at`, and
 * `crisis_category` — the UI reads these to enter the paused state.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  ConversationDetail,
  ConversationDetailMessage,
} from "@lyceon/shared/tutor-lifecycle-schema";
import { apiRequest } from "@/lib/queryClient";
import { type HttpApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Types — aligned with server route schemas (tutor-runtime.ts)
// ---------------------------------------------------------------------------

export type TutorEntryMode = "scoped_question" | "scoped_session" | "general";

export type TutorSourceSurface =
  | "practice"
  | "review"
  | "test_review"
  | "dashboard";

export type TutorConversationStatus = "active" | "ended";

export type TutorConversationSurface = "standalone" | "practice" | "review";

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
  idempotency_key?: string;
};

export type TutorConversation = {
  conversation_id: string;
  reused: boolean;
  entry_mode: TutorEntryMode;
  source_surface: TutorSourceSurface;
  surface: TutorConversationSurface | null;
  status: TutorConversationStatus;
  title: string | null;
  crisis_flagged: boolean;
  crisis_paused_at: string | null;
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

export type CrisisCategory = "crisis" | "safeguarding";

export type SendMessageResponse = {
  conversation_id: string;
  message_id: string;
  client_turn_id: string;
  response: {
    content: string;
    content_kind: string;
    crisis_category?: CrisisCategory;
    suggested_action: TutorSuggestedAction;
    ui_hints: TutorUiHints;
  };
  crisis_paused?: boolean;
  crisis_paused_at?: string;
  conversation_updated_at: string;
};

// Detail (replay) response: inferred from the shared Zod schema so the client
// cannot claim a field the server does not send. The hand-written copy of this
// type declared `crisis_paused_at` and `title` for months while the server
// omitted both, which is why a paused conversation rendered as live on reload.
// @spec [Doc-03B_V2 §7; CC Brief "Close the LISA Vertical" PR 1.1]
export type TutorMessage = ConversationDetailMessage;

export type TutorConversationDetail = ConversationDetail;

export type TutorConversationSummary = {
  conversation_id: string;
  entry_mode: TutorEntryMode;
  source_surface: TutorSourceSurface;
  surface: TutorConversationSurface | null;
  status: TutorConversationStatus;
  title: string | null;
  crisis_flagged: boolean;
  crisis_paused_at: string | null;
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

export type EndConversationResponse = {
  conversation_id: string;
  status: "ended";
  ended_at: string;
};

export type ResumeConversationResponse = {
  conversation_id: string;
  status: "active";
  crisis_paused_at: null;
};

// ---------------------------------------------------------------------------
// Fetch helper
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
// Query keys
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

export function useCreateConversation(): UseMutationResult<
  TutorConversation,
  HttpApiError,
  CreateConversationInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateConversationInput) =>
      tutorRequest<TutorConversation>("/conversations", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: tutorConversationsQueryKey,
      });
    },
  });
}

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
      queryClient.invalidateQueries({
        queryKey: tutorConversationsQueryKey,
      });
    },
  });
}

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

export function useConversations(): UseQueryResult<
  TutorConversationsList,
  HttpApiError
> {
  return useQuery({
    queryKey: tutorConversationsQueryKey,
    queryFn: () =>
      tutorRequest<TutorConversationsList>(
        "/conversations?surface=standalone&status=active",
      ),
  });
}

export function useEndConversation(): UseMutationResult<
  EndConversationResponse,
  HttpApiError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: string) =>
      tutorRequest<EndConversationResponse>(
        `/conversations/${encodeURIComponent(conversationId)}/end`,
        { method: "POST", body: {} },
      ),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({
        queryKey: tutorConversationQueryKey(conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: tutorConversationsQueryKey,
      });
    },
  });
}

export function useResumeConversation(): UseMutationResult<
  ResumeConversationResponse,
  HttpApiError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: string) =>
      tutorRequest<ResumeConversationResponse>(
        `/conversations/${encodeURIComponent(conversationId)}/resume`,
        { method: "POST", body: {} },
      ),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({
        queryKey: tutorConversationQueryKey(conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: tutorConversationsQueryKey,
      });
    },
  });
}
