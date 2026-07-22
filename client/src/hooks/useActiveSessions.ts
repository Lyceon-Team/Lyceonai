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
  started_at: string;
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
