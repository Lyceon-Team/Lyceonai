/**
 * In-app reviews, private feedback and the review prompt's cadence.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 ("One neutral review prompt for everyone —
 *       no review gating. Options side by side: in-app anonymous review (all users 13+, bucketed
 *       student/guardian), Trustpilot (guardians + 18+ ...), private feedback (always
 *       available)"), R30 ("success moments only, never during practice or exams, max once per
 *       120 days, stop after a review or 2 dismissals, always dismissible"), row Q6; owner Step 0
 *       answers 3, 4, 6, 8 (2026-10-05)] | @implemented [2026-10-05]
 *
 * plain English: the request and response shapes for /api/feedback, and `decideReviewPrompt`,
 * the ONE place the cadence is decided. It is pure: the caller passes the stored state, the
 * person's role and age, and the clock. The database only records (product_review_prompt_claim
 * makes "shown" compare-and-set so two tabs cannot both show it); it never decides.
 *
 * The moments are a closed list, and each is checked on the server against data that already
 * exists — a client cannot ask for the prompt from a practice or exam screen, because no moment
 * names one:
 *   - exam_report:   the caller's own full-length report, scored (or partially scored);
 *   - study_week:    last week's plan (Monday-anchored, the student's time zone) had at least one
 *                    block and every block was completed;
 *   - guardian_week: a linked student the guardian may see has at least one completed block
 *                    this week.
 *
 * Trade-offs: the age used is whole years from the stored date of birth, the same rule as the
 * marketing opt-in. An unknown age is not eligible for anything here (fail closed).
 */
import { z } from "zod";
import { ageInYears } from "./profile-role-choice-schema";

export const REVIEW_PROMPT_COOLDOWN_DAYS = 120;
export const REVIEW_PROMPT_MAX_DISMISSALS = 2;
export const REVIEW_MIN_AGE = 13;
/** Trustpilot requires reviewers to be 18+ (plan R28). */
export const TRUSTPILOT_MIN_AGE = 18;
export const FEEDBACK_MAX_LENGTH = 2000;

export const REVIEW_PROMPT_MOMENTS = [
  "exam_report",
  "study_week",
  "guardian_week",
] as const;
export const reviewPromptMomentSchema = z.enum(REVIEW_PROMPT_MOMENTS);
export type ReviewPromptMoment = z.infer<typeof reviewPromptMomentSchema>;

export const reviewPromptQuerySchema = z.discriminatedUnion("moment", [
  z
    .object({ moment: z.literal("exam_report"), session_id: z.string().uuid() })
    .strict(),
  z.object({ moment: z.literal("study_week") }).strict(),
  z
    .object({
      moment: z.literal("guardian_week"),
      student_id: z.string().uuid(),
    })
    .strict(),
]);
export type ReviewPromptQuery = z.infer<typeof reviewPromptQuerySchema>;

export const reviewPromptResponseSchema = z.discriminatedUnion("show", [
  z.object({ show: z.literal(false) }).strict(),
  z
    .object({ show: z.literal(true), trustpilot_eligible: z.boolean() })
    .strict(),
]);
export type ReviewPromptResponse = z.infer<typeof reviewPromptResponseSchema>;

/** An optional free-text field: trimmed, and empty means absent. */
const optionalText = z
  .string()
  .trim()
  .max(FEEDBACK_MAX_LENGTH)
  .nullable()
  .optional()
  .transform((value) =>
    value === undefined || value === null || value === "" ? null : value,
  );

export const reviewSubmitSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    body: optionalText,
    // Unticked by default; the client must send what the person chose.
    quote_permission: z.boolean(),
  })
  .strict();
export type ReviewSubmit = z.infer<typeof reviewSubmitSchema>;

export const FEEDBACK_SOURCES = ["prompt", "settings", "help", "menu"] as const;
export const feedbackSourceSchema = z.enum(FEEDBACK_SOURCES);
export type FeedbackSource = z.infer<typeof feedbackSourceSchema>;

export const feedbackSubmitSchema = z
  .object({
    body: z.string().trim().min(1).max(FEEDBACK_MAX_LENGTH),
    source: feedbackSourceSchema,
    idempotency_key: z.string().uuid(),
  })
  .strict();
export type FeedbackSubmit = z.infer<typeof feedbackSubmitSchema>;

export const submitAckSchema = z
  .object({ outcome: z.enum(["created", "replayed"]) })
  .strict();
export type SubmitAck = z.infer<typeof submitAckSchema>;

/** The stored cadence facts (public.product_review_prompt_state); null = never shown. */
export type ReviewPromptState = {
  last_shown_at: Date | null;
  dismiss_count: number;
  reviewed_at: Date | null;
};

export type ReviewAudience = "student" | "guardian";

/** Who may review, as a bucket; null = nobody here (an admin, an unknown age, under 13). */
export function reviewAudienceFor(
  role: string,
  dateOfBirth: string | null,
  today: Date,
): ReviewAudience | null {
  if (role !== "student" && role !== "guardian") return null;
  if (dateOfBirth === null) return null;
  const age = ageInYears(dateOfBirth, today);
  if (age === null || age < REVIEW_MIN_AGE) return null;
  return role;
}

/**
 * Private feedback: every student and guardian, at any age (R28: "private feedback (always
 * available)"). Only reviews, the prompt and Trustpilot carry age rules. An admin has no bucket.
 */
export function feedbackAudienceFor(role: string): ReviewAudience | null {
  return role === "student" || role === "guardian" ? role : null;
}

export function trustpilotEligible(
  role: string,
  dateOfBirth: string | null,
  today: Date,
): boolean {
  if (reviewAudienceFor(role, dateOfBirth, today) === null) return false;
  const age = dateOfBirth === null ? null : ageInYears(dateOfBirth, today);
  return age !== null && age >= TRUSTPILOT_MIN_AGE;
}

export type ReviewPromptDecision =
  | { show: true; trustpilotEligible: boolean }
  | {
      show: false;
      reason: "not_eligible" | "reviewed" | "dismissed_limit" | "cooldown";
    };

const DAY_MS = 86_400_000;

/**
 * R30, in order: eligibility (13+, a student or guardian), a review already left (in-app or the
 * Trustpilot button) stops it for good, two dismissals stop it for good, and otherwise at most
 * one showing per 120 days. The moment itself is verified by the caller before this runs.
 */
export function decideReviewPrompt(input: {
  role: string;
  dateOfBirth: string | null;
  state: ReviewPromptState | null;
  now: Date;
}): ReviewPromptDecision {
  const { role, dateOfBirth, state, now } = input;
  if (reviewAudienceFor(role, dateOfBirth, now) === null) {
    return { show: false, reason: "not_eligible" };
  }
  if (state !== null) {
    if (state.reviewed_at !== null) return { show: false, reason: "reviewed" };
    if (state.dismiss_count >= REVIEW_PROMPT_MAX_DISMISSALS) {
      return { show: false, reason: "dismissed_limit" };
    }
    if (
      state.last_shown_at !== null &&
      now.getTime() - state.last_shown_at.getTime() <
        REVIEW_PROMPT_COOLDOWN_DAYS * DAY_MS
    ) {
      return { show: false, reason: "cooldown" };
    }
  }
  return {
    show: true,
    trustpilotEligible: trustpilotEligible(role, dateOfBirth, now),
  };
}
