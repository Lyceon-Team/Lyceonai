/**
 * The email send gate's shared vocabulary: what kind of email each kind is, and the gate's
 * verdict shape.
 *
 * @spec [owner brief "Email send gate" (Karl, 2026-10-30); owner rulings 2026-11-02 rounds 1 and
 *       2; contracts/notifications.contract.md C15] | @implemented [2026-11-02]
 *
 * plain English: every email kind belongs to exactly one category. `always` is never blocked
 * (account, billing and guardian-link mail, the welcome and entitled emails). `governed` is
 * decided by the recipient's state (active, cooling, paused). `milestone` (the three SAT-date
 * emails) is allowed in every state, once per test date. `notice` is the gate's own two pause
 * emails. The same map is written in SQL as `public.email_category`;
 * tests/ci/email-gate.pg.ci.test.ts holds the two equal for every kind.
 *
 * Senders: governed and milestone emails go out from the tracked sender on lyceon.ai (clicks
 * feed the unengaged count); always and notice emails stay on the untracked send.lyceon.ai
 * (owner ruling 2026-11-02, round 2 (1)).
 */
import { z } from "zod";
import type { NotificationEventType } from "./notifications-schema.js";

export const EMAIL_CATEGORIES = [
  "always",
  "governed",
  "milestone",
  "notice",
] as const;
export const emailCategorySchema = z.enum(EMAIL_CATEGORIES);
export type EmailCategory = z.infer<typeof emailCategorySchema>;

/** Every kind the gate knows. Notification event types, plus non-pipeline senders. */
export const EMAIL_KIND_CATEGORY = {
  guardian_linked: "always",
  guardian_unlinked: "always",
  exam_score_report_requested: "always",
  renewal_decision_requested: "always",
  welcome: "always",
  entitled: "always",
  qotd_daily: "governed",
  study_plan_changed: "governed",
  missed_plan_alert: "governed",
  back_on_track: "governed",
  full_length_week: "governed",
  full_length_tomorrow: "governed",
  guardian_daily_digest: "governed",
  review_ask: "governed",
  lifecycle_reminder_due: "governed",
  lifecycle_diagnostic_unfinished: "governed",
  lifecycle_pro_no_plan: "governed",
  lifecycle_practising_free: "governed",
  manual_campaign: "governed",
  sat_week_before: "milestone",
  sat_day_after: "milestone",
  sat_scores_released: "milestone",
  email_gate_paused_notice: "notice",
  email_gate_guardian_paused: "notice",
} as const satisfies Record<string, EmailCategory>;

export type EmailKind = keyof typeof EMAIL_KIND_CATEGORY;

/** Compile-time: every notification event type has a category (a new type must add one). */
export const NOTIFICATION_TYPE_CATEGORIES: Readonly<
  Record<NotificationEventType, EmailCategory>
> = EMAIL_KIND_CATEGORY;
export const EMAIL_KINDS = Object.keys(EMAIL_KIND_CATEGORY) as EmailKind[];

export function emailCategoryOf(kind: EmailKind): EmailCategory {
  return EMAIL_KIND_CATEGORY[kind];
}

/** A kind the gate must be asked about before sending. */
export function isGatedEmailKind(kind: EmailKind): boolean {
  const category = emailCategoryOf(kind);
  return category === "governed" || category === "milestone";
}

/** Which Resend sender a kind goes out from (ruling 2026-11-02, round 2 (1)). */
export type EmailSenderTracking = "tracked" | "untracked";
export function emailSenderTrackingOf(kind: EmailKind): EmailSenderTracking {
  return isGatedEmailKind(kind) ? "tracked" : "untracked";
}

export const EMAIL_GATE_STATES = ["active", "cooling", "paused"] as const;
export const emailGateStateSchema = z.enum(EMAIL_GATE_STATES);
export type EmailGateState = z.infer<typeof emailGateStateSchema>;

/** `email_gate_decide`'s answer. */
export const emailGateDecisionSchema = z.object({
  allow: z.boolean(),
  reason: z.string().min(1),
  state: emailGateStateSchema.nullable(),
});
export type EmailGateDecision = z.infer<typeof emailGateDecisionSchema>;

/** The Resend contact property the state is mirrored to. */
export const EMAIL_GATE_RESEND_PROPERTY = "email_state";

export const emailGateOutboxRowSchema = z.object({
  profile_id: z.string().uuid(),
  email: z.string().min(1),
  email_state: emailGateStateSchema,
  attempts: z.number().int().min(0),
});
export type EmailGateOutboxRow = z.infer<typeof emailGateOutboxRowSchema>;

export const emailGateSweepResultSchema = z.object({
  processed: z.number().int().min(0),
  changed: z.number().int().min(0),
  last_id: z.string().uuid().nullable(),
});

export const emailMilestonesResultSchema = z.object({
  week_before: z.number().int().min(0),
  day_after: z.number().int().min(0),
  scores_released: z.number().int().min(0),
});

export const emailGuardianRefreshResultSchema = z.object({
  opened: z.number().int().min(0),
  closed: z.number().int().min(0),
});

export const emailGateKeepPostedResultSchema = z.object({
  ok: z.literal(true),
  changed: z.boolean(),
  state: emailGateStateSchema.nullable(),
});
