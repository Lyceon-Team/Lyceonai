/**
 * The Question of the Day on the student's Home: the API contract, the streak and the email
 * prompt's rules and copy.
 *
 * @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
 *       (Karl, decisions 2026-10-08/09) Part B "Rules (locked)", "API", "Email prompt rule",
 *       "Home"; SCL-224, SCL-225; Coding Standards §5.2 (no answer or explanation before
 *       submit), §7.2 (schema first)] | @implemented [2026-10-09]
 *
 * plain English: every payload is a STRICT object the server parses before it sends. Before
 * submit the question carries `correct_answer: null` and `explanation: null` and its options as
 * opaque tokens; a student's options are in canonical order, lettered A-D by position, so the
 * explanation's letters always match the screen. The streak is two facts the server computes:
 * the current run of answer days and whether today is one of them.
 */
import { z } from "zod";
import {
  qotdDateSchema,
  qotdOptionKeySchema,
  qotdOptionTokenSchema,
  qotdServedOptionSchema,
} from "./qotd-schema";

/** The wording version a "Yes" to the daily email is given against. Change the copy → bump. */
export const QOTD_EMAIL_CONSENT_VERSION = "1.0.0";

/** The prompt's exact copy (brief, Part B). */
export const QOTD_EMAIL_PROMPT_COPY = {
  title: "Keep your streak alive 🔥",
  body: "We'll email tomorrow's question.",
  yes: "Yes",
  notNow: "Not now",
  never: "Don't ask again",
} as const;

/** "Don't ask again" is offered from this ask onward. */
export const QOTD_EMAIL_NEVER_FROM_ASK = 3;

/** The sunset: this many consecutive unanswered sends, then one pause notice and no more. */
export const QOTD_EMAIL_SUNSET_SENDS = 7;

/** The send hour, America/Chicago (17:00). */
export const QOTD_EMAIL_SEND_HOUR_CHICAGO = 17;

export const streakSchema = z
  .object({
    /** Consecutive Chicago days with an answered question, ending today or yesterday. */
    current: z.number().int().min(0),
    /** Whether today (Chicago) already has an answered question. */
    today_done: z.boolean(),
    /** current is 0 but the student has answered before: a run ended ("Start a new streak today"). */
    broken: z.boolean(),
  })
  .strict();
export type Streak = z.infer<typeof streakSchema>;

const studentQuestionBase = {
  section_code: z.enum(["M", "RW"]),
  domain: z.string().min(1),
  item_type: z.enum(["mcq", "grid_in"]),
  stem: z.string(),
  passage: z.string().nullable(),
  /** MCQ: four options in canonical order, tokenised. Grid-in: empty. */
  options: z.array(qotdServedOptionSchema),
};

/** Before submit: no answer, no explanation. */
export const homeQotdQuestionSchema = z
  .object({
    ...studentQuestionBase,
    correct_answer: z.null(),
    explanation: z.null(),
  })
  .strict();

/** What the student chose and how it went. Present only after an answer. */
export const homeQotdResultSchema = z
  .object({
    is_correct: z.boolean(),
    /** MCQ: the student's choice as its token. Grid-in: null. */
    selected_option_id: qotdOptionTokenSchema.nullable(),
    /** MCQ: the correct option's token. Grid-in: null. */
    correct_option_id: qotdOptionTokenSchema.nullable(),
    /** MCQ: the correct option's on-screen letter (A-D by position). Grid-in: null. */
    correct_display_letter: qotdOptionKeySchema.nullable(),
    /** Grid-in: the keyed answer. MCQ: null. */
    correct_answer: z.string().nullable(),
    explanation: z.string(),
  })
  .strict();
export type HomeQotdResult = z.infer<typeof homeQotdResultSchema>;

const promptShape = {
  show_email_prompt: z.boolean(),
  show_dont_ask_again: z.boolean(),
};

/** GET /api/qotd/today */
export const homeQotdTodayResponseSchema = z.discriminatedUnion("state", [
  // No question scheduled today: the card is hidden; the streak is unaffected.
  z
    .object({ state: z.literal("none"), streak: streakSchema, ...promptShape })
    .strict(),
  z
    .object({
      state: z.literal("unanswered"),
      qotd_date: qotdDateSchema,
      question: homeQotdQuestionSchema,
      streak: streakSchema,
      ...promptShape,
    })
    .strict(),
  z
    .object({
      state: z.literal("answered"),
      qotd_date: qotdDateSchema,
      question: homeQotdQuestionSchema,
      result: homeQotdResultSchema,
      streak: streakSchema,
      ...promptShape,
    })
    .strict(),
]);
export type HomeQotdTodayResponse = z.infer<typeof homeQotdTodayResponseSchema>;

/** POST /api/qotd/answer */
export const homeQotdAnswerRequestSchema = z
  .object({
    qotd_date: qotdDateSchema,
    /** MCQ: the chosen option's token. */
    option_token: qotdOptionTokenSchema.optional(),
    /** Grid-in days only: the entered value. */
    grid_answer: z.string().trim().min(1).max(32).optional(),
    idempotency_key: z.string().uuid(),
  })
  .strict()
  .refine(
    (b) => (b.option_token === undefined) !== (b.grid_answer === undefined),
    "send exactly one of option_token or grid_answer",
  );
export type HomeQotdAnswerRequest = z.infer<typeof homeQotdAnswerRequestSchema>;

export const homeQotdAnswerResponseSchema = z
  .object({
    qotd_date: qotdDateSchema,
    result: homeQotdResultSchema,
    streak: streakSchema,
    /** True when this answer was the first answered question of the day (the streak grew). */
    streak_extended: z.boolean(),
    ...promptShape,
  })
  .strict();
export type HomeQotdAnswerResponse = z.infer<
  typeof homeQotdAnswerResponseSchema
>;

export const QOTD_EMAIL_DECISIONS = ["grant", "not_now", "never"] as const;

/** POST /api/qotd/email-consent */
export const homeQotdEmailConsentRequestSchema = z
  .object({
    decision: z.enum(QOTD_EMAIL_DECISIONS),
    consent_version: z.literal(QOTD_EMAIL_CONSENT_VERSION),
  })
  .strict();
export type HomeQotdEmailConsentRequest = z.infer<
  typeof homeQotdEmailConsentRequestSchema
>;

export const homeQotdEmailConsentResponseSchema = z
  .object({ consented: z.boolean(), show_email_prompt: z.literal(false) })
  .strict();

/**
 * Settings → Notifications: the one toggle, "Daily question email" (owner ruling on #1166,
 * item 2). It reads and writes the SAME preference the Home prompt's "Yes" and the email's
 * unsubscribe link change: the email channel of the `qotd_daily` notification.
 */
export const QOTD_EMAIL_SETTING_LABEL = "Daily question email";

/** GET /api/qotd/email-preference */
export const qotdEmailPreferenceSchema = z
  .object({
    /** 13+ student: only then can the email be turned on. */
    eligible: z.boolean(),
    enabled: z.boolean(),
    /** On, but paused by the 7-send sunset until turned on again. */
    paused: z.boolean(),
  })
  .strict();
export type QotdEmailPreference = z.infer<typeof qotdEmailPreferenceSchema>;

/**
 * PUT /api/qotd/email-preference. Turning it on is a consent given against the same wording
 * version as the prompt's "Yes".
 */
export const qotdEmailPreferenceUpdateSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      consent_version: z.literal(QOTD_EMAIL_CONSENT_VERSION),
    })
    .strict(),
  z.object({ enabled: z.literal(false) }).strict(),
]);
export type QotdEmailPreferenceUpdate = z.infer<
  typeof qotdEmailPreferenceUpdateSchema
>;

/** The streak chip's words (brief, Part B "Home" 2). Pure, so the UI and tests share it. */
export function streakChipText(streak: Streak): string {
  if (streak.current === 0) {
    return streak.broken ? "Start a new streak today" : "Start your streak";
  }
  return streak.today_done
    ? `🔥 ${streak.current} · Today ✓`
    : `🔥 ${streak.current} · keep it going today`;
}

/**
 * @spec [owner brief "Notification emails — sender name per email type" (Karl, 2026-10-14) §2;
 *       Karl's Step 0 ruling 1 (no time estimate: the subject ends at "one <Domain> question")]
 *       | @implemented [2026-10-14] (replaces the 2026-10-09 "Day N 🔥 Your question is ready")
 *
 * plain English: the daily email's subject always starts with "SAT Question of the Day", so
 * "Lyceon" in the sender and "SAT" at the start of the subject together mark it out from junk.
 * A streak of 2+ days asks the student to keep it; otherwise the subject names the domain. No
 * emoji, no "Day N:", no urgency. Inputs are the streak and the domain only — nothing that could
 * carry the answer reaches this function.
 *
 * edge cases: a blank domain reads "one question"; a negative or fractional streak is treated as
 * no streak.
 */
export const QOTD_EMAIL_SUBJECT_PREFIX = "SAT Question of the Day";
export const QOTD_EMAIL_STREAK_THRESHOLD = 2;

export function qotdEmailSubject(input: {
  currentStreak: number;
  domain: string;
}): string {
  const streak = Number.isInteger(input.currentStreak)
    ? input.currentStreak
    : 0;
  if (streak >= QOTD_EMAIL_STREAK_THRESHOLD) {
    return `${QOTD_EMAIL_SUBJECT_PREFIX}: keep your ${streak}-day streak`;
  }
  const domain = input.domain.replace(/\s+/g, " ").trim();
  return domain.length > 0
    ? `${QOTD_EMAIL_SUBJECT_PREFIX}: one ${domain} question`
    : `${QOTD_EMAIL_SUBJECT_PREFIX}: one question`;
}
