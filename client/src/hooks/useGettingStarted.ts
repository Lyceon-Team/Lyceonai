/**
 * The "Getting started" checklist on Home: one query and three actions.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §3, §8; Coding Standards §11.2 (server state via TanStack
 *       Query), §7.1 (parse at the boundary)] | @implemented [2026-10-13]
 *
 * plain English: GET /api/home/getting-started, parsed with the shared schema, so a contract
 * mismatch is an error, never a half-drawn card. "Not sure yet", "Not now" and Dismiss each answer
 * with the fresh checklist, which replaces the cached one. Every other action that can tick a
 * step (answering today's question, opting in, saving a score) invalidates this query through
 * `invalidateGettingStarted`; the server decides what is done, never the click.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  gettingStartedResponseSchema,
  type GettingStartedNotSureRequest,
  type GettingStartedResponse,
} from "@lyceon/shared/getting-started-schema";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { apiRequest } from "@/lib/queryClient";

export const GETTING_STARTED_PATH = "/api/home/getting-started";

function parseData(body: unknown): GettingStartedResponse {
  const data =
    body !== null && typeof body === "object" && "data" in body
      ? body.data
      : undefined;
  return gettingStartedResponseSchema.parse(data);
}

async function fetchGettingStarted(): Promise<GettingStartedResponse> {
  const response = await apiRequest(GETTING_STARTED_PATH);
  return parseData(await response.json());
}

/** Refetch the checklist after anything that may have ticked a step. */
export function invalidateGettingStarted(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [GETTING_STARTED_PATH] });
}

export function useGettingStarted({
  enabled = true,
}: { enabled?: boolean } = {}): UseQueryResult<GettingStartedResponse, Error> {
  const { user, authLoading } = useSupabaseAuth();
  return useQuery<GettingStartedResponse, Error>({
    queryKey: [GETTING_STARTED_PATH],
    queryFn: fetchGettingStarted,
    enabled: enabled && !!user && !authLoading,
  });
}

async function post(
  path: string,
  body: Record<string, unknown> = {},
): Promise<GettingStartedResponse> {
  const response = await apiRequest(`${GETTING_STARTED_PATH}/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseData(await response.json());
}

/** "Not sure yet" for the SAT date and/or target score. */
export async function recordGettingStartedNotSure(
  request: GettingStartedNotSureRequest,
): Promise<GettingStartedResponse> {
  return post("not-sure", request);
}

function useGettingStartedAction(
  run: () => Promise<GettingStartedResponse>,
): UseMutationResult<GettingStartedResponse, Error, void> {
  const queryClient = useQueryClient();
  return useMutation<GettingStartedResponse, Error, void>({
    mutationFn: run,
    onSuccess: (fresh) => {
      queryClient.setQueryData([GETTING_STARTED_PATH], fresh);
    },
  });
}

/** "Not now" on the email step. */
export function useSkipEmailStep(): UseMutationResult<
  GettingStartedResponse,
  Error,
  void
> {
  return useGettingStartedAction(() => post("skip-email"));
}

/** Dismiss the finished card. */
export function useDismissGettingStarted(): UseMutationResult<
  GettingStartedResponse,
  Error,
  void
> {
  return useGettingStartedAction(() => post("dismiss"));
}
