/**
 * Reviews, private feedback and the review prompt — the domain service.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28, R29 (anonymous, bucketed), R30 (cadence),
 *       row Q6; owner Step 0 answers 3, 4, 6, 8 (2026-10-05)] | @implemented [2026-10-05]
 *
 * plain English: four operations.
 *   - `reviewPromptFor`: may this person see the prompt NOW, at THIS moment? It verifies the
 *     moment against data that already exists (no new tracking), applies the one cadence rule
 *     (`decideReviewPrompt`, packages/shared), and if the answer is yes, claims the showing with
 *     a compare-and-set so a second tab cannot show it again. The answer is only show / don't,
 *     plus whether the Trustpilot option applies — never why, and never anything about the
 *     student the moment was checked against.
 *   - `dismissPrompt`, `markTrustpilot`: record what the person did with the prompt.
 *   - `submitReview`, `submitFeedback`: store them. The audience bucket (student / guardian) is
 *     derived from the account, never taken from the client.
 *
 * Every database call goes through an injected `RpcClient`, and every moment check is an
 * injected function, so the decisions are tested without a database (tests/ci/
 * product-feedback-routes.contract.test.ts); the SQL itself is proved on Postgres by
 * tests/ci/marketing-consent-reviews.pg.ci.test.ts.
 *
 * Privacy: review and feedback text is never logged. Logs carry outcomes and the request id.
 */
import { z } from "zod";
import type { RpcClient } from "../../lib/rpc-client";
import {
  decideReviewPrompt,
  feedbackAudienceFor,
  reviewAudienceFor,
  type FeedbackSubmit,
  type ReviewAudience,
  type ReviewPromptQuery,
  type ReviewPromptResponse,
  type ReviewPromptState,
  type ReviewSubmit,
} from "../../../packages/shared/src/product-feedback-schema";

/** The caller, as the server knows them (role and date of birth read from their profile). */
export type FeedbackCaller = {
  profileId: string;
  role: string;
  dateOfBirth: string | null;
};

/**
 * The three moment checks. Each answers "did this success moment really happen for this
 * caller", from reads the product already makes. A check that cannot tell answers false: no
 * prompt is the safe failure.
 */
export type MomentChecks = {
  examReportReady: (studentId: string, sessionId: string) => Promise<boolean>;
  studyWeekCompleted: (studentId: string) => Promise<boolean>;
  guardianWeekProgress: (
    guardianId: string,
    studentId: string,
  ) => Promise<boolean>;
};

export type FeedbackDeps = {
  client: RpcClient;
  moments: MomentChecks;
  now: () => Date;
};

export class FeedbackStoreError extends Error {}

const stateSchema = z
  .object({
    last_shown_at: z.string().nullable(),
    dismiss_count: z.number().int().min(0),
    reviewed_at: z.string().nullable(),
  })
  .strict()
  .nullable();

const outcomeSchema = z
  .object({ outcome: z.enum(["created", "replayed", "conflict"]) })
  .strict();

async function call(
  client: RpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new FeedbackStoreError(`${fn} failed: ${error.message}`);
  return data;
}

function toState(raw: z.infer<typeof stateSchema>): ReviewPromptState | null {
  if (raw === null) return null;
  return {
    last_shown_at:
      raw.last_shown_at === null ? null : new Date(raw.last_shown_at),
    dismiss_count: raw.dismiss_count,
    reviewed_at: raw.reviewed_at === null ? null : new Date(raw.reviewed_at),
  };
}

/** Which moments a role may raise. A student's moment never fires for a guardian, and back. */
function momentFitsRole(query: ReviewPromptQuery, role: string): boolean {
  if (query.moment === "guardian_week") return role === "guardian";
  return role === "student";
}

async function momentHappened(
  moments: MomentChecks,
  caller: FeedbackCaller,
  query: ReviewPromptQuery,
): Promise<boolean> {
  switch (query.moment) {
    case "exam_report":
      return moments.examReportReady(caller.profileId, query.session_id);
    case "study_week":
      return moments.studyWeekCompleted(caller.profileId);
    case "guardian_week":
      return moments.guardianWeekProgress(caller.profileId, query.student_id);
  }
}

const NO: ReviewPromptResponse = { show: false };

export async function reviewPromptFor(
  deps: FeedbackDeps,
  caller: FeedbackCaller,
  query: ReviewPromptQuery,
): Promise<ReviewPromptResponse> {
  if (!momentFitsRole(query, caller.role)) return NO;

  const now = deps.now();
  // Eligibility and cadence first: they need no read of anyone's learning data.
  const raw = stateSchema.parse(
    await call(deps.client, "product_review_prompt_state_for", {
      p_profile_id: caller.profileId,
    }),
  );
  const state = toState(raw);
  const decision = decideReviewPrompt({
    role: caller.role,
    dateOfBirth: caller.dateOfBirth,
    state,
    now,
  });
  if (!decision.show) return NO;

  if (!(await momentHappened(deps.moments, caller, query))) return NO;

  const claimed = await call(deps.client, "product_review_prompt_claim", {
    p_profile_id: caller.profileId,
    // The stored text, NOT a Date round-trip: Postgres keeps microseconds and a JS Date does
    // not, so a re-serialised value would never equal the row and no claim would ever land.
    p_expected: raw?.last_shown_at ?? null,
  });
  if (claimed !== true) return NO;
  return { show: true, trustpilot_eligible: decision.trustpilotEligible };
}

export async function dismissPrompt(
  deps: FeedbackDeps,
  caller: FeedbackCaller,
): Promise<void> {
  await call(deps.client, "product_review_prompt_dismiss", {
    p_profile_id: caller.profileId,
  });
}

/** The Trustpilot button counts as reviewed (owner answer 6). Only offered to 18+. */
export async function markTrustpilot(
  deps: FeedbackDeps,
  caller: FeedbackCaller,
): Promise<void> {
  await call(deps.client, "product_review_mark_external", {
    p_profile_id: caller.profileId,
  });
}

export type SubmitResult =
  | { ok: true; outcome: "created" | "replayed" }
  | { ok: false; reason: "not_eligible" | "already_reviewed" };

export async function submitReview(
  deps: FeedbackDeps,
  caller: FeedbackCaller,
  review: ReviewSubmit,
): Promise<SubmitResult> {
  const audience = reviewAudienceFor(
    caller.role,
    caller.dateOfBirth,
    deps.now(),
  );
  if (audience === null) return { ok: false, reason: "not_eligible" };
  const result = outcomeSchema.parse(
    await call(deps.client, "product_review_submit", {
      p_profile_id: caller.profileId,
      p_audience: audience,
      p_rating: review.rating,
      p_body: review.body,
      p_quote_permission: review.quote_permission,
    }),
  );
  if (result.outcome === "conflict") {
    return { ok: false, reason: "already_reviewed" };
  }
  return { ok: true, outcome: result.outcome };
}

export async function submitFeedback(
  deps: FeedbackDeps,
  caller: FeedbackCaller,
  feedback: FeedbackSubmit,
): Promise<SubmitResult> {
  const audience = feedbackAudienceFor(caller.role);
  if (audience === null) return { ok: false, reason: "not_eligible" };
  const result = outcomeSchema.parse(
    await call(deps.client, "product_feedback_submit", {
      p_profile_id: caller.profileId,
      p_audience: audience,
      p_body: feedback.body,
      p_source: feedback.source,
      p_idempotency_key: feedback.idempotency_key,
    }),
  );
  if (result.outcome === "conflict") {
    throw new FeedbackStoreError("product_feedback_submit returned conflict");
  }
  return { ok: true, outcome: result.outcome };
}
