import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { csrfFetch } from "@/lib/csrf";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActiveSession = {
  id: string;
  section: string;
  mode: string;
  status: string;
  /**
   * The server emits `created_at` (practice-canonical.ts:2209), never `started_at`.
   * This type said `started_at` and `practice.tsx:360` read it, so every open-session
   * row rendered "Invalid DateTime" from `DateTime.fromISO(undefined)`. Fixed in R4
   * while mirroring this hook for review, which returns the same field
   * (review-schema.ts:274).
   */
  created_at: string;
  target_question_count: number;
  total_items: number;
  answered_items: number;
};

type OpenSessionsResponse = {
  sessions: ActiveSession[];
  maxConcurrentSessions?: number;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActiveSessions() {
  const { user, authLoading } = useSupabaseAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } =
    useQuery<OpenSessionsResponse>({
      queryKey: ["/api/practice/sessions/open"],
      enabled: !!user && !authLoading,
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
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/practice/sessions/open"],
      });
    },
  });

  const sessions = data?.sessions ?? [];
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
