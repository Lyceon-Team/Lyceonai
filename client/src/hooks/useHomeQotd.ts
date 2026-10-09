/**
 * The Question of the Day on Home: today's state, the answer, and the daily-email decision.
 *
 * @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
 *       (Karl, decisions 2026-10-08/09) Part B "API"; Coding Standards §11.2 (server state via
 *       TanStack Query), §7.1 (parse at the boundary), §4.2 (one idempotency key per press)]
 *       | @implemented [2026-10-09]
 *
 * plain English: one query (GET /api/qotd/today) and two mutations. Every response is parsed
 * with the shared schema, so a contract mismatch is an error, never a half-drawn card. The answer
 * mutation carries an idempotency key minted ONCE per Submit press by the caller, so a retry of
 * the same press replays rather than answering twice; on success the result is written into the
 * cached "today" (answered state) so the card changes without a second read.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  homeQotdAnswerResponseSchema,
  homeQotdEmailConsentResponseSchema,
  homeQotdTodayResponseSchema,
  QOTD_EMAIL_CONSENT_VERSION,
  qotdEmailPreferenceSchema,
  type HomeQotdAnswerRequest,
  type HomeQotdAnswerResponse,
  type HomeQotdTodayResponse,
  type QotdEmailPreference,
} from "@lyceon/shared/home-qotd-schema";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import { apiRequest } from "@/lib/queryClient";

export const HOME_QOTD_TODAY_PATH = "/api/qotd/today";
const ANSWER_PATH = "/api/qotd/answer";
const CONSENT_PATH = "/api/qotd/email-consent";
export const QOTD_EMAIL_PREFERENCE_PATH = "/api/qotd/email-preference";

async function fetchHomeQotd(): Promise<HomeQotdTodayResponse> {
  const response = await apiRequest(HOME_QOTD_TODAY_PATH);
  const body: unknown = await response.json();
  const data =
    body !== null && typeof body === "object" && "data" in body
      ? body.data
      : undefined;
  return homeQotdTodayResponseSchema.parse(data);
}

export function useHomeQotd(): UseQueryResult<HomeQotdTodayResponse, Error> {
  const { user, authLoading } = useSupabaseAuth();
  return useQuery<HomeQotdTodayResponse, Error>({
    queryKey: [HOME_QOTD_TODAY_PATH],
    queryFn: fetchHomeQotd,
    enabled: !!user && !authLoading,
    ...QUERY_FRESHNESS.homeQotd,
  });
}

function dataOf(body: unknown): unknown {
  return body !== null && typeof body === "object" && "data" in body
    ? body.data
    : undefined;
}

export function useAnswerHomeQotd(): UseMutationResult<
  HomeQotdAnswerResponse,
  Error,
  HomeQotdAnswerRequest
> {
  const queryClient = useQueryClient();
  return useMutation<HomeQotdAnswerResponse, Error, HomeQotdAnswerRequest>({
    mutationFn: async (body) => {
      const response = await apiRequest(ANSWER_PATH, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return homeQotdAnswerResponseSchema.parse(dataOf(await response.json()));
    },
    onSuccess: (answer) => {
      queryClient.setQueryData<HomeQotdTodayResponse>(
        [HOME_QOTD_TODAY_PATH],
        (current) =>
          current === undefined || current.state === "none"
            ? current
            : {
                state: "answered",
                qotd_date: current.qotd_date,
                question: current.question,
                result: answer.result,
                streak: answer.streak,
                show_email_prompt: answer.show_email_prompt,
                show_dont_ask_again: answer.show_dont_ask_again,
              },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: [HOME_QOTD_TODAY_PATH],
        refetchType: "none",
      });
    },
  });
}

export type QotdEmailDecision = "grant" | "not_now" | "never";

export function useQotdEmailDecision(): UseMutationResult<
  { consented: boolean },
  Error,
  QotdEmailDecision
> {
  const queryClient = useQueryClient();
  return useMutation<{ consented: boolean }, Error, QotdEmailDecision>({
    mutationFn: async (decision) => {
      const response = await apiRequest(CONSENT_PATH, {
        method: "POST",
        body: JSON.stringify({
          decision,
          consent_version: QOTD_EMAIL_CONSENT_VERSION,
        }),
      });
      return homeQotdEmailConsentResponseSchema.parse(
        dataOf(await response.json()),
      );
    },
    onSuccess: () => {
      queryClient.setQueryData<HomeQotdTodayResponse>(
        [HOME_QOTD_TODAY_PATH],
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                show_email_prompt: false,
                show_dont_ask_again: false,
              },
      );
      // "Yes" turned on the same preference Settings shows.
      void queryClient.invalidateQueries({
        queryKey: [QOTD_EMAIL_PREFERENCE_PATH],
      });
    },
  });
}

/**
 * Settings → Notifications, "Daily question email" (owner ruling on #1166, 2026-10-09, item 2):
 * the read and the write of the one preference the Home prompt and the unsubscribe link also
 * change. The switch shows the server's answer, never an optimistic guess.
 */
export function useQotdEmailPreference(): UseQueryResult<
  QotdEmailPreference,
  Error
> {
  const { user, authLoading } = useSupabaseAuth();
  return useQuery<QotdEmailPreference, Error>({
    queryKey: [QOTD_EMAIL_PREFERENCE_PATH],
    queryFn: async () => {
      const response = await apiRequest(QOTD_EMAIL_PREFERENCE_PATH);
      return qotdEmailPreferenceSchema.parse(dataOf(await response.json()));
    },
    enabled: !!user && !authLoading,
    ...QUERY_FRESHNESS.homeQotd,
  });
}

export function useSetQotdEmailPreference(): UseMutationResult<
  QotdEmailPreference,
  Error,
  boolean
> {
  const queryClient = useQueryClient();
  return useMutation<QotdEmailPreference, Error, boolean>({
    mutationFn: async (enabled) => {
      const response = await apiRequest(QOTD_EMAIL_PREFERENCE_PATH, {
        method: "PUT",
        body: JSON.stringify(
          enabled
            ? { enabled: true, consent_version: QOTD_EMAIL_CONSENT_VERSION }
            : { enabled: false },
        ),
      });
      return qotdEmailPreferenceSchema.parse(dataOf(await response.json()));
    },
    onSuccess: (preference) => {
      queryClient.setQueryData([QOTD_EMAIL_PREFERENCE_PATH], preference);
      // Turning it on or off also settles the Home prompt.
      void queryClient.invalidateQueries({ queryKey: [HOME_QOTD_TODAY_PATH] });
    },
  });
}
