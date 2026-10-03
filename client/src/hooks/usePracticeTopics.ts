/**
 * @spec [evidence/wiring-table.md §4 Practice ("Section switch; domain and skill dropdowns":
 *        `GET /api/practice/topics`); register §2 "Filters" (no bank counts); UI-14 (taxonomy
 *        freshness)] | @implemented [2026-10-03]
 *
 * plain English: the one read of the practice taxonomy (sections, their domains, each domain's
 * skills; names only, no counts), parsed with the strict shared `practiceTopicsResponseSchema`.
 * Practice and Review each had an inline `useQuery` for this key; both read it here now (UI-51),
 * so the key, the freshness and the parse live in one place.
 *
 * edge cases: a body the schema rejects throws (a contract mismatch, not an empty taxonomy), so
 * the filter bar never draws options it could not read. A 500 from the route (catalog read
 * failure) is an error state, never an empty list.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  practiceTopicsResponseSchema,
  type PracticeTopicsResponse,
} from "@lyceon/shared/practice-reference-schema";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import { apiRequest } from "@/lib/queryClient";

async function fetchPracticeTopics(): Promise<PracticeTopicsResponse> {
  const response = await apiRequest("/api/practice/topics");
  return practiceTopicsResponseSchema.parse(await response.json());
}

export function usePracticeTopics(): UseQueryResult<
  PracticeTopicsResponse,
  Error
> {
  const { user, authLoading } = useSupabaseAuth();
  return useQuery<PracticeTopicsResponse, Error>({
    // The literal key: `query-freshness.contract.test.ts` finds every taxonomy read by it.
    queryKey: ["/api/practice/topics"],
    queryFn: fetchPracticeTopics,
    enabled: !!user && !authLoading,
    // UI-14: reference data — long, explicit, finite.
    staleTime: QUERY_FRESHNESS.taxonomy.staleTime,
  });
}
