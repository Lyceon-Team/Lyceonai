/**
 * @spec [student-UI register OQ-21 (owner ruling, Karl, 2026-10-02: a read-only
 *        `GET /api/practice/quota`, the 402's own dry run), OQ-43 / F-61 (America/Chicago
 *        day), OQ-50 (Karl, 2026-10-05: answers and skips count, the diagnostic does not);
 *        DESIGN.md §3 "Ruler progress" (free daily quota), §4 Home]
 *        | @implemented [2026-10-03; OQ-50 2026-10-05]
 *
 * plain English: today's practice quota, parsed with the shared `practiceQuotaSchema`. A free
 * student gets `{unlimited: false, limit, remaining, resetAt}`; a paid student
 * `{unlimited: true, ...nulls}`, which the quota ruler hides. A display hint only: the serving
 * routes decide on every request.
 *
 * edge cases: a body the schema rejects throws (a contract mismatch, not "no quota"), so the
 * ruler never draws a number it could not read. The route answers 503 when the ledger is down;
 * that is an error state, never a substituted figure.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  practiceQuotaSchema,
  type PracticeQuota,
} from "@lyceon/shared/practice-quota";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import { apiRequest } from "@/lib/queryClient";

const PRACTICE_QUOTA_PATH = "/api/practice/quota";

async function fetchPracticeQuota(): Promise<PracticeQuota> {
  const response = await apiRequest(PRACTICE_QUOTA_PATH);
  return practiceQuotaSchema.parse(await response.json());
}

export function usePracticeQuota(options?: {
  enabled?: boolean;
}): UseQueryResult<PracticeQuota, Error> {
  const { user, authLoading } = useSupabaseAuth();
  return useQuery<PracticeQuota, Error>({
    queryKey: [PRACTICE_QUOTA_PATH],
    queryFn: fetchPracticeQuota,
    enabled: (options?.enabled ?? true) && !!user && !authLoading,
    ...QUERY_FRESHNESS.practiceQuota,
  });
}
