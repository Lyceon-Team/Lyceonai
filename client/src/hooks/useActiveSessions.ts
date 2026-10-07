import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { csrfFetch } from "@/lib/csrf";
import {
  invalidateSessionReads,
  PRACTICE_OPEN_SESSIONS_QUERY_KEY,
} from "@/lib/session-reads";
import {
  practiceOpenSessionsResponseSchema,
  type PracticeOpenSession,
  type PracticeOpenSessionsResponse,
} from "@lyceon/shared/practice-response-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @spec [student-UI register OQ-22 (criteria on `/sessions/open`), UI-50] | @implemented
 * [2026-10-03] | plain English: the row type is the shared schema's (the server emits
 * `created_at`, never `started_at`; R4 fixed a hand-written type that said otherwise), and the
 * response is parsed with it, so a field the route stops sending fails here instead of
 * rendering "undefined". The parse also carries `criteria` (OQ-22) to Home's resume rows.
 */
type ActiveSession = PracticeOpenSession;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActiveSessions() {
  const { user, authLoading } = useSupabaseAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [PRACTICE_OPEN_SESSIONS_QUERY_KEY],
    enabled: !!user && !authLoading,
    select: (raw: unknown): PracticeOpenSessionsResponse =>
      practiceOpenSessionsResponseSchema.parse(raw),
  });

  const terminateMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await csrfFetch(
        `/api/practice/sessions/${encodeURIComponent(sessionId)}/terminate`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to terminate session");
      return res.json();
    },
    // QA item 6 (2026-10-07): ending a session changes every list it appears in.
    onSuccess: (_body, sessionId) => {
      invalidateSessionReads(queryClient, { engine: "practice", sessionId });
    },
  });

  const sessions: ActiveSession[] = data?.sessions ?? [];
  const maxConcurrentSessions = data?.maxConcurrentSessions ?? null;

  return {
    sessions,
    maxConcurrentSessions,
    isLoading,
    isError,
    error,
    refetch,
    terminateSession: terminateMutation.mutate,
    isTerminating: terminateMutation.isPending,
  };
}
