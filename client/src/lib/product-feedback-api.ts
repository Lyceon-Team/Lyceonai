/**
 * Client calls for the marketing opt-in toggle, the review prompt, reviews and private feedback.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26, R28, R30, rows Q5/Q6; Coding Standards
 *       §11.2 (server state through TanStack Query)] | @implemented [2026-10-05]
 *
 * plain English: one module for the network side of Q5/Q6, so the components (MarketingEmailCard,
 * FeedbackDialog, ReviewPrompt) stay self-contained and the student-UI rebuild can mount them
 * as they are. Every response is parsed with the shared schema before a component sees it.
 *
 * The prompt query is deliberately never refetched: a "show" answer is also the server's record
 * that the prompt was shown, so a refetch would come back "no" and pull the prompt out from under
 * the person reading it.
 *
 * Eligibility on the client (`useFeedbackAudience`) only decides what to SHOW; every write is
 * re-checked on the server from the profile, never from anything this module sends.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PROFILE_QUERY_KEY, useProfileQuery } from "@/hooks/useProfileQuery";
import {
  marketingConsentResponseSchema,
  marketingOptInEligible,
} from "../../../packages/shared/src/marketing-consent-schema";
import {
  feedbackAudienceFor,
  reviewPromptResponseSchema,
  submitAckSchema,
  type FeedbackSource,
  type ReviewAudience,
  type ReviewPromptQuery,
  type ReviewPromptResponse,
  type ReviewSubmit,
  type SubmitAck,
} from "../../../packages/shared/src/product-feedback-schema";

export const FEEDBACK_API = "/api/feedback" as const;
export const MARKETING_CONSENT_PATH = "/api/profile/marketing-consent" as const;

/** The Trustpilot review link (Wave 4). Absent → the Trustpilot option is not rendered at all. */
export function trustpilotReviewUrl(): string | null {
  const configured: unknown = import.meta.env.VITE_TRUSTPILOT_REVIEW_URL;
  if (typeof configured !== "string" || !configured.startsWith("https://")) {
    return null;
  }
  return configured;
}

// ── Who may see what (display only; the server re-checks) ──────────────────

/** Private feedback is open to every student and guardian (R28 "always available"). */
export function useFeedbackAudience(): ReviewAudience | null {
  const { data } = useProfileQuery();
  const user = data?.authenticated ? data.user : null;
  if (!user) return null;
  return feedbackAudienceFor(user.role);
}

export type MarketingToggleState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "ready"; optedIn: boolean };

export function useMarketingToggleState(): MarketingToggleState {
  const { data, isLoading } = useProfileQuery();
  if (isLoading) return { kind: "loading" };
  const user = data?.authenticated ? data.user : null;
  if (!user || (user.role !== "student" && user.role !== "guardian")) {
    return { kind: "hidden" };
  }
  const optedIn = user.marketingOptIn === true;
  // Under 13 (or no date of birth) cannot opt in. If such a row were somehow on, it is still
  // shown so it can be turned off — revocation always works.
  if (!optedIn && !marketingOptInEligible(user.dateOfBirth, new Date())) {
    return { kind: "hidden" };
  }
  return { kind: "ready", optedIn };
}

// ── Marketing opt-in ───────────────────────────────────────────────────────

export function useSetMarketingConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (granted: boolean): Promise<boolean> => {
      const res = await apiRequest(MARKETING_CONSENT_PATH, {
        method: "PUT",
        body: JSON.stringify({ granted }),
      });
      return marketingConsentResponseSchema.parse(await res.json())
        .marketingOptIn;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}

// ── The review prompt ──────────────────────────────────────────────────────

function promptUrl(query: ReviewPromptQuery): string {
  const params = new URLSearchParams({ moment: query.moment });
  if (query.moment === "exam_report")
    params.set("session_id", query.session_id);
  if (query.moment === "guardian_week")
    params.set("student_id", query.student_id);
  return `${FEEDBACK_API}/prompt?${params.toString()}`;
}

export function useReviewPrompt(
  query: ReviewPromptQuery,
  enabled: boolean,
): UseQueryResult<ReviewPromptResponse, Error> {
  return useQuery({
    queryKey: [FEEDBACK_API, "prompt", query],
    queryFn: async () => {
      const res = await apiRequest(promptUrl(query));
      const body = (await res.json()) as { data?: unknown };
      return reviewPromptResponseSchema.parse(body.data);
    },
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export async function dismissReviewPrompt(): Promise<void> {
  await apiRequest(`${FEEDBACK_API}/prompt/dismiss`, { method: "POST" });
}

export async function recordTrustpilotClick(): Promise<void> {
  await apiRequest(`${FEEDBACK_API}/prompt/trustpilot`, { method: "POST" });
}

export async function submitReview(review: ReviewSubmit): Promise<SubmitAck> {
  const res = await apiRequest(`${FEEDBACK_API}/reviews`, {
    method: "POST",
    body: JSON.stringify(review),
  });
  const body = (await res.json()) as { data?: unknown };
  return submitAckSchema.parse(body.data);
}

export async function submitFeedback(input: {
  body: string;
  source: FeedbackSource;
  idempotencyKey: string;
}): Promise<SubmitAck> {
  const res = await apiRequest(`${FEEDBACK_API}/feedback`, {
    method: "POST",
    body: JSON.stringify({
      body: input.body,
      source: input.source,
      idempotency_key: input.idempotencyKey,
    }),
  });
  const body = (await res.json()) as { data?: unknown };
  return submitAckSchema.parse(body.data);
}
