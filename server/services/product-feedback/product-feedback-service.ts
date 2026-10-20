/**
 * Reviews, private feedback and the review ask — the domain service.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28, R29 (anonymous, bucketed), R30 (cadence,
 *       as amended 2026-10-20), row Q6; owner Step 0 answers 3, 4, 6, 8 (2026-10-05); owner brief
 *       "Review ask" and Karl's Step 0 decisions 3, 4, 7 (2026-10-20)]
 *       | @implemented [2026-10-05; review ask 2026-10-20]
 *
 * plain English: four operations.
 *   - `reviewPromptFor`: may this person be asked NOW, from THIS moment? It applies the one
 *     cadence rule (`decideReviewPrompt`, packages/shared) first, then verifies the moment
 *     against data that already exists (the usage trigger; for a student, that the Getting
 *     started checklist is not active), and if the answer is yes, claims the ask with a
 *     compare-and-set so a second tab cannot ask again. The email's return link shows the same
 *     card without claiming (it is not an ask). The answer is only show / don't, plus whether
 *     the Trustpilot option applies — never why, and never anything about a student.
 *   - `respondToPrompt`, `markTrustpilot`: record what the person did with the ask.
 *   - `submitReview`, `submitFeedback`: store them. The audience bucket (student / guardian) is
 *     derived from the account, never taken from the client.
 *
 * Every database call goes through an injected `RpcClient`, and every moment check is an
 * injected function, so the decisions are tested without a database
 * (tests/ci/product-feedback.contract.test.ts); the SQL itself is proved on Postgres by
 * tests/ci/marketing-consent-reviews.pg.ci.test.ts.
 *
 * Privacy: review and feedback text is never logged. Logs carry outcomes and the request id.
 */
import { z } from "zod";
import type { RpcClient } from "../../lib/rpc-client";
import {
  decideReviewPrompt,
  feedbackAudienceFor,
  REVIEW_ASK_LAST_RESPONSES,
  reviewAudienceFor,
  reviewMomentFitsRole,
  type FeedbackSubmit,
  type ReviewPromptRespond,
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
  isUnder13: boolean;
};

/**
 * The moment checks (moments.ts). A check that cannot tell fails toward no ask: usageMet
 * answers false and checklistActive answers true.
 */
export type MomentChecks = {
  usageMet: (profileId: string) => Promise<boolean>;
  checklistActive: (caller: FeedbackCaller) => Promise<boolean>;
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
    ask_count: z.number().int().min(0),
    snoozed_until: z.string().nullable(),
    last_response: z.enum(REVIEW_ASK_LAST_RESPONSES).nullable(),
    reviewed_at: z.string().nullable(),
    email_queued_at: z.string().nullable(),
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

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toState(raw: z.infer<typeof stateSchema>): ReviewPromptState | null {
  if (raw === null) return null;
  return {
    last_shown_at: toDate(raw.last_shown_at),
    ask_count: raw.ask_count,
    snoozed_until: toDate(raw.snoozed_until),
    last_response: raw.last_response,
    reviewed_at: toDate(raw.reviewed_at),
    email_queued_at: toDate(raw.email_queued_at),
  };
}

/** The usage trigger, and for a student's Home the checklist; the email return needs neither. */
async function momentHappened(
  moments: MomentChecks,
  caller: FeedbackCaller,
  query: ReviewPromptQuery,
): Promise<boolean> {
  switch (query.moment) {
    case "home":
      return (
        (await moments.usageMet(caller.profileId)) &&
        !(await moments.checklistActive(caller))
      );
    case "guardian_home":
      return moments.usageMet(caller.profileId);
    case "email_return":
      return true;
  }
}

const NO: ReviewPromptResponse = { show: false };

/** What `reviewPromptFor` answers, plus whether this showing was a counted ask (for analytics). */
export type ReviewPromptOutcome = {
  response: ReviewPromptResponse;
  askNumber: number | null;
};

export async function reviewPromptFor(
  deps: FeedbackDeps,
  caller: FeedbackCaller,
  query: ReviewPromptQuery,
): Promise<ReviewPromptOutcome> {
  const none: ReviewPromptOutcome = { response: NO, askNumber: null };
  if (!reviewMomentFitsRole(query.moment, caller.role)) return none;

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
    moment: query.moment,
    now,
  });
  if (!decision.show) return none;

  if (!(await momentHappened(deps.moments, caller, query))) return none;

  const shown: ReviewPromptResponse = {
    show: true,
    trustpilot_eligible: decision.trustpilotEligible,
  };
  // The email's return link is not an ask: nothing is claimed or counted.
  if (!decision.counts) return { response: shown, askNumber: null };

  const claimed = await call(deps.client, "product_review_prompt_claim", {
    p_profile_id: caller.profileId,
    // The stored text, NOT a Date round-trip: Postgres keeps microseconds and a JS Date does
    // not, so a re-serialised value would never equal the row and no claim would ever land.
    p_expected: raw?.last_shown_at ?? null,
  });
  if (claimed !== true) return none;
  return { response: shown, askNumber: (state?.ask_count ?? 0) + 1 };
}

/** "Not now" (snoozed) or the close button (dismissed): once per ask; true when recorded. */
export async function respondToPrompt(
  deps: FeedbackDeps,
  caller: FeedbackCaller,
  respond: ReviewPromptRespond,
): Promise<boolean> {
  const recorded = await call(deps.client, "product_review_prompt_respond", {
    p_profile_id: caller.profileId,
    p_response: respond.response,
  });
  return recorded === true;
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
