/**
 * In-app reviews, private feedback and the review ask's cadence.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 ("One neutral review prompt for everyone —
 *       no review gating. Options side by side ..."), R30 (as amended by the review-ask brief);
 *       owner brief "Review ask — in-app prompt + one email, industry standard" (Karl,
 *       2026-10-20) and Karl's Step 0 decisions of 2026-10-20: 1 (no public review site for
 *       13–17s), 2 (the in-app star review stays for everyone), 3 (trigger: 7+ days since signup
 *       and 3+ completed sessions, QOTD excluded; "full week completed" retired), 4 (at most 2
 *       in-app asks ever, a 30-day snooze, one email 3 days after an unanswered first ask), 7
 *       (Home placement; never while the Getting started checklist is active); owner Step 0
 *       answers 3, 4, 6, 8 (2026-10-05)] | @implemented [2026-10-05; review ask 2026-10-20]
 *
 * plain English: the request and response shapes for /api/feedback, and `decideReviewPrompt`,
 * the ONE place the cadence is decided. It is pure: the caller passes the stored state, the
 * person's role and age, the moment and the clock. The database records (the claim is
 * compare-and-set so two tabs cannot both ask) and holds the hard limits as a backstop.
 *
 * The moments are a closed list, each checked on the server against data that already exists.
 * None names a practice, review or test screen, so the ask can never appear during one:
 *   - home:          a student on Home — 7+ days since signup, 3+ completed sessions (QOTD
 *                    excluded), and the Getting started checklist not active;
 *   - guardian_home: a guardian on their dashboard — a link 7+ days old to a student they may
 *                    see who has 3+ completed sessions;
 *   - email_return:  the person followed the one follow-up email back. Shown (not counted as an
 *                    ask) only when that email was queued and the ask is unanswered.
 *
 * NO GATING: nothing here reads a rating, a review or how the person feels. Every eligible
 * person gets the same ask; only age changes which public site is offered (Trustpilot is 18+).
 *
 * Trade-offs: the age used is whole years from the stored date of birth, the same rule as the
 * marketing opt-in. An unknown age is not eligible for anything here (fail closed).
 */
import { z } from "zod";
import { ageInYears } from "./profile-role-choice-schema";

/** At most two in-app asks, ever (Karl, 2026-10-20). Held again by product_review_prompt_claim. */
export const REVIEW_ASK_MAX_ASKS = 2;
/** "Not now" and the close button snooze for 30 days; an ignored ask waits as long. */
export const REVIEW_ASK_SNOOZE_DAYS = 30;
/** The usage trigger (Karl's decision 3). Computed in SQL by review_ask_usage_met. */
export const REVIEW_ASK_MIN_DAYS = 7;
export const REVIEW_ASK_MIN_SESSIONS = 3;
/** The one follow-up email: 3 days after an unanswered first ask (SQL review_ask_email_notify). */
export const REVIEW_ASK_EMAIL_AFTER_DAYS = 3;
/** An older first ask gets no email: a follow-up weeks later is not a follow-up. */
export const REVIEW_ASK_EMAIL_WINDOW_DAYS = 14;
/** Who gets the email: adults only, 18+ students and guardians (Karl's decision 5). */
export const REVIEW_ASK_EMAIL_MIN_AGE = 18;
export const REVIEW_MIN_AGE = 13;
/** Trustpilot requires reviewers to be 18+ (plan R28). */
export const TRUSTPILOT_MIN_AGE = 18;
export const FEEDBACK_MAX_LENGTH = 2000;

export const REVIEW_PROMPT_MOMENTS = [
  "home",
  "guardian_home",
  "email_return",
] as const;
export const reviewPromptMomentSchema = z.enum(REVIEW_PROMPT_MOMENTS);
export type ReviewPromptMoment = z.infer<typeof reviewPromptMomentSchema>;

export const reviewPromptQuerySchema = z
  .object({ moment: reviewPromptMomentSchema })
  .strict();
export type ReviewPromptQuery = z.infer<typeof reviewPromptQuerySchema>;

export const reviewPromptResponseSchema = z.discriminatedUnion("show", [
  z.object({ show: z.literal(false) }).strict(),
  z
    .object({ show: z.literal(true), trustpilot_eligible: z.boolean() })
    .strict(),
]);
export type ReviewPromptResponse = z.infer<typeof reviewPromptResponseSchema>;

/**
 * The Trustpilot review link, from `VITE_TRUSTPILOT_REVIEW_URL` (Karl sets it in Vercel; decision
 * 6, 2026-10-20). Anything but an https URL is "not configured", and the Trustpilot option is
 * then not offered at all — in the app (build time) or in the email (send time).
 */
export function trustpilotReviewUrlFrom(configured: unknown): string | null {
  if (typeof configured !== "string" || !configured.startsWith("https://")) {
    return null;
  }
  return configured;
}

/** Lyceon's public Trustpilot profile ("See reviews"; final brief, Karl 2026-10-20 §1). */
export const TRUSTPILOT_PROFILE_URL =
  "https://www.trustpilot.com/review/lyceon.ai";

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

// ── Feedback context (final brief "Trustpilot card + Feedback", Karl 2026-10-20, §3–§5) ──────

/** Bug · Idea · Something else. */
export const FEEDBACK_TYPES = ["bug", "idea", "other"] as const;
export const feedbackTypeSchema = z.enum(FEEDBACK_TYPES);
export type FeedbackType = z.infer<typeof feedbackTypeSchema>;
export const FEEDBACK_TYPE_LABELS: Readonly<Record<FeedbackType, string>> = {
  bug: "Bug",
  idea: "Idea",
  other: "Something else",
};

/**
 * A route PATTERN, never a URL: lowercase path words and `:name` placeholders only, so a real id
 * (it has digits), a query string or a fragment cannot pass. The same rule is the table's CHECK
 * (20261108000000_feedback_context.sql).
 */
export const ROUTE_PATTERN_MAX_LENGTH = 120;
export const ROUTE_PATTERN_RE = /^(\/|(\/([a-z][a-z-]*|:[a-zA-Z]+))+)$/;
export const routePatternSchema = z
  .string()
  .max(ROUTE_PATTERN_MAX_LENGTH)
  .regex(ROUTE_PATTERN_RE);

/** The deploy's short commit (VERCEL_GIT_COMMIT_SHA), or `dev` for a local build. */
export const APP_VERSION_RE = /^([0-9a-f]{7}|dev)$/;
export const appVersionSchema = z.string().regex(APP_VERSION_RE);

function segmentsMatch(pattern: string[], path: string[]): boolean {
  return (
    pattern.length === path.length &&
    pattern.every((seg, i) => seg.startsWith(":") || seg === path[i])
  );
}

/**
 * The route pattern for a location. The query string and fragment are dropped; a known pattern
 * (`/practice/session/:sessionId`) wins; otherwise every segment that is not a plain lowercase
 * word (an id, a date, anything with a digit or capital) becomes `:id`. Null when nothing safe
 * can be said (too long). Pure; the server re-checks the result against ROUTE_PATTERN_RE.
 */
export function toRoutePattern(
  location: string,
  knownPatterns: readonly string[],
): string | null {
  const path = (location.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "");
  if (path === "") return "/";
  const parts = path.split("/").slice(1);
  for (const known of knownPatterns) {
    if (segmentsMatch(known.split("/").slice(1), parts)) return known;
  }
  const generic =
    "/" +
    parts.map((seg) => (/^[a-z][a-z-]*$/.test(seg) ? seg : ":id")).join("/");
  return routePatternSchema.safeParse(generic).success ? generic : null;
}

/** The Slack line's age band (§5). Unknown (no date of birth) never earns the message text. */
export type FeedbackAgeBand = "18+" | "13–17" | "under 13" | "unknown";

export function feedbackAgeBand(
  dateOfBirth: string | null,
  today: Date,
): FeedbackAgeBand {
  const age = dateOfBirth === null ? null : ageInYears(dateOfBirth, today);
  if (age === null) return "unknown";
  if (age >= TRUSTPILOT_MIN_AGE) return "18+";
  if (age >= REVIEW_MIN_AGE) return "13–17";
  return "under 13";
}

/** "May we reply by email?" is hidden for, and refused to, a student not known to be 13+. */
export function feedbackReplyAllowed(
  role: string,
  dateOfBirth: string | null,
  today: Date,
): boolean {
  if (role !== "student") return true;
  const age = dateOfBirth === null ? null : ageInYears(dateOfBirth, today);
  return age !== null && age >= REVIEW_MIN_AGE;
}

export const feedbackSubmitSchema = z
  .object({
    body: z.string().trim().min(1).max(FEEDBACK_MAX_LENGTH),
    source: feedbackSourceSchema,
    idempotency_key: z.string().uuid(),
    // Defaults keep a browser still holding the previous bundle working during a deploy.
    type: feedbackTypeSchema.default("other"),
    reply_ok: z.boolean().default(false),
    route_pattern: routePatternSchema.nullable().default(null),
    app_version: appVersionSchema.nullable().default(null),
  })
  .strict();
export type FeedbackSubmit = z.infer<typeof feedbackSubmitSchema>;

export const submitAckSchema = z
  .object({ outcome: z.enum(["created", "replayed"]) })
  .strict();
export type SubmitAck = z.infer<typeof submitAckSchema>;

/** "Not now" snoozes; the close button dismisses. Both snooze for 30 days. */
export const REVIEW_PROMPT_RESPONSES = ["snoozed", "dismissed"] as const;
export const reviewPromptRespondSchema = z
  .object({ response: z.enum(REVIEW_PROMPT_RESPONSES) })
  .strict();
export type ReviewPromptRespond = z.infer<typeof reviewPromptRespondSchema>;

/** What the person did with the latest ask (public.product_review_prompt_state.last_response). */
export const REVIEW_ASK_LAST_RESPONSES = [
  "reviewed",
  "feedback",
  "snoozed",
  "dismissed",
  "stopped",
] as const;
export type ReviewAskLastResponse = (typeof REVIEW_ASK_LAST_RESPONSES)[number];

/** The stored cadence facts (public.product_review_prompt_state); null = never asked. */
export type ReviewPromptState = {
  last_shown_at: Date | null;
  ask_count: number;
  snoozed_until: Date | null;
  last_response: ReviewAskLastResponse | null;
  reviewed_at: Date | null;
  email_queued_at: Date | null;
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

/** The analytics bucket (counts only): never a date of birth or an exact age. */
export type ReviewAskAnalytics = {
  audience: ReviewAudience;
  age_band: "13_17" | "18_plus";
};

export function reviewAskAnalytics(
  role: string,
  dateOfBirth: string | null,
  today: Date,
): ReviewAskAnalytics | null {
  const audience = reviewAudienceFor(role, dateOfBirth, today);
  if (audience === null) return null;
  return {
    audience,
    age_band: trustpilotEligible(role, dateOfBirth, today)
      ? "18_plus"
      : "13_17",
  };
}

export type ReviewPromptDecision =
  | { show: true; trustpilotEligible: boolean; counts: boolean }
  | {
      show: false;
      reason:
        | "not_eligible"
        | "answered"
        | "no_email"
        | "ask_limit"
        | "snoozed"
        | "cooldown";
    };

const DAY_MS = 86_400_000;

/** A review (in-app or Trustpilot), feedback from the prompt, or "Stop review requests". */
function answered(state: ReviewPromptState): boolean {
  return (
    state.reviewed_at !== null ||
    state.last_response === "reviewed" ||
    state.last_response === "feedback" ||
    state.last_response === "stopped"
  );
}

/**
 * The cadence, in order: eligibility (13+, a student or guardian); an answered ask ends it for
 * good; the email's return link shows the same card without counting as an ask, and only after
 * that email was queued; otherwise at most two asks, none while a snooze is live, and none
 * within 30 days of an ask left unanswered. The moment itself (the usage trigger, the
 * checklist) is verified by the caller; `counts` says whether this showing is an ask to claim.
 */
export function decideReviewPrompt(input: {
  role: string;
  dateOfBirth: string | null;
  state: ReviewPromptState | null;
  moment: ReviewPromptMoment;
  now: Date;
}): ReviewPromptDecision {
  const { role, dateOfBirth, state, moment, now } = input;
  if (reviewAudienceFor(role, dateOfBirth, now) === null) {
    return { show: false, reason: "not_eligible" };
  }
  if (state !== null && answered(state)) {
    return { show: false, reason: "answered" };
  }
  const trustpilot = trustpilotEligible(role, dateOfBirth, now);
  if (moment === "email_return") {
    if (state === null || state.email_queued_at === null) {
      return { show: false, reason: "no_email" };
    }
    return { show: true, trustpilotEligible: trustpilot, counts: false };
  }
  if (state !== null) {
    if (state.ask_count >= REVIEW_ASK_MAX_ASKS) {
      return { show: false, reason: "ask_limit" };
    }
    if (
      state.snoozed_until !== null &&
      now.getTime() < state.snoozed_until.getTime()
    ) {
      return { show: false, reason: "snoozed" };
    }
    if (
      state.last_shown_at !== null &&
      now.getTime() - state.last_shown_at.getTime() <
        REVIEW_ASK_SNOOZE_DAYS * DAY_MS
    ) {
      return { show: false, reason: "cooldown" };
    }
  }
  return { show: true, trustpilotEligible: trustpilot, counts: true };
}

/** Which moment a role may ask from (a student's Home, a guardian's dashboard, either by email). */
export function reviewMomentFitsRole(
  moment: ReviewPromptMoment,
  role: string,
): boolean {
  if (moment === "home") return role === "student";
  if (moment === "guardian_home") return role === "guardian";
  return role === "student" || role === "guardian";
}
