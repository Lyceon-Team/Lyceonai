/**
 * Notifications contract — the shapes the database, the dispatcher, the feed API, the
 * webhook receiver and the client all agree on.
 *
 * @spec [contracts/notifications.contract.md §1, §2.3, §3, §4, §7.4, §8.1, §9.4;
 *        lyceon-coding-standards §7.2 (schema first, types inferred)] | @implemented [2026-09-03]
 *
 * plain English: Zod first, types inferred. Every boundary that carries a notification —
 * a DB row read through the service client, a request body, a webhook payload — is parsed
 * against a schema here before business logic touches it. The event-type and channel
 * literals mirror the CHECK constraints in 20260903000000_notifications_rebuild.sql; a
 * change to one without the other is caught by the PG suite, not by review.
 */
import { z } from "zod";

// ── Event types, channels, statuses (mirror the SQL CHECKs) ─────────────────

/**
 * Launch scope was one event type (owner rulings R7/R8, 2026-09-03); `guardian_unlinked`
 * joined on 2026-09-15 (Doc 01 §36.3 — the party who did not revoke is told). The consent
 * request, the deletion-scheduled email and the guardian INVITE are direct sends, not events —
 * see server/lib/notifications/direct-sends.ts.
 *
 * `full_length_week` and `full_length_tomorrow` joined on 2026-09-27 (Brief 14 Step 5; Doc 05F
 * §8.1). TWO TYPES, NOT ONE WITH A KIND IN THE PAYLOAD — the owner's ruling of 2026-09-26, and
 * not a stylistic one: `notification_event_id(event_type, source_id)` hashes the TYPE, so two
 * types are what let one exam block carry two independently-idempotent notifications. A single
 * type with `{"kind": ...}` in its payload would derive one id per block and the second notice
 * would be swallowed by the ON CONFLICT that makes the first a safe replay.
 *
 * `exam_score_report_requested` and `renewal_decision_requested` joined on 2026-09-30 (SCL-191;
 * post-exam score report and renewal decision). Two types for the same reason, and one more
 * besides: they ask two different questions of two different people. The score prompt goes to
 * the student, who has the score; the renewal decision goes to the payer, who is being charged
 * (Doc 01 §36.4). On a self-paid subscription those are one person and only the first is sent.
 */
export const NOTIFICATION_EVENT_TYPES = [
  "guardian_linked",
  "guardian_unlinked",
  "full_length_week",
  "full_length_tomorrow",
  "exam_score_report_requested",
  "renewal_decision_requested",
] as const;
export const notificationEventTypeSchema = z.enum(NOTIFICATION_EVENT_TYPES);
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const NOTIFICATION_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
] as const;
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/**
 * Contract §4: a failed email send stays `queued` with `attempts` incremented until this
 * many attempts have failed, then becomes `failed`. Passed to
 * `record_notification_send_attempt` by the dispatcher so the cap has one definition.
 */
export const NOTIFICATION_EMAIL_MAX_ATTEMPTS = 5;

// ── Payloads (contract §8.1 — identifiers and rendering parameters only) ────

export const guardianLinkedPayloadSchema = z
  .object({
    link_id: z.string().uuid(),
    student_display_name: z.string(),
  })
  .strict();
export type GuardianLinkedPayload = z.infer<typeof guardianLinkedPayloadSchema>;

/**
 * @spec [contracts/notifications.contract.md §8.1; Doc-01_V8 §36.3, §38.1] | @implemented [2026-09-15]
 * Identity only: the link id and the two display names. `revocation_reason` is NEVER a
 * payload key — `.strict()` makes a payload carrying it fail to render rather than leak.
 */
export const guardianUnlinkedPayloadSchema = z
  .object({
    link_id: z.string().uuid(),
    student_display_name: z.string(),
    guardian_display_name: z.string(),
  })
  .strict();
export type GuardianUnlinkedPayload = z.infer<
  typeof guardianUnlinkedPayloadSchema
>;

/**
 * @spec [Doc-05F_V1.0 §8.1; contracts/notifications.contract.md §8.1; Brief 14 Step 5]
 * @implemented [2026-09-27]
 *
 * The two practice-test notices share one payload shape: the block the notice is about and
 * the local date the template renders ("Saturday the 17th"). Identifiers and rendering
 * parameters only.
 *
 * NO `form_id`, deliberately. It names a specific exam paper, which is content about the
 * assessment sitting in a persisted, recipient-readable row — and the notice does not need it
 * to say a practice test is coming. `.strict()` refuses it, and every other addition, at
 * render time as well as at write time.
 */
export const fullLengthNoticePayloadSchema = z
  .object({
    block_id: z.string().uuid(),
    local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type FullLengthNoticePayload = z.infer<
  typeof fullLengthNoticePayloadSchema
>;

/**
 * @spec [contracts/notifications.contract.md §8.1; SCL-191] @implemented [2026-09-30]
 *
 * The two post-exam notices share one payload shape: what the prompt is anchored on, and the
 * occasion it is about — the exam date on the `exam_date` anchor, the billing period-end date on
 * `billing_cycle`. Those are the two rendering parameters a template needs to say "your exam on
 * the 5th" or "your subscription renews on the 12th", and the two facts
 * `exam_renewal_no_answer_candidates` reads back out of the row to find the occasion again.
 *
 * NO SCORE, NO AMOUNT, NO PRICE, and `.strict()` refuses each of them at render time as well as
 * at write time. This row is persisted and readable by its recipient; a reported SAT score in it
 * would be the student's own result sitting in a notification payload, and an amount would be
 * billing content that Stripe owns (contract §0).
 */
export const postExamNoticePayloadSchema = z
  .object({
    anchor: z.enum(["exam_date", "billing_cycle"]),
    occasion_key: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type PostExamNoticePayload = z.infer<typeof postExamNoticePayloadSchema>;

// ── DB rows read through the service client ─────────────────────────────────

/**
 * Timestamps arrive as ISO strings over PostgREST and as `Date` objects over a direct
 * node-pg connection (the CI harness). Both normalise to the ISO string the API emits.
 */
const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((v) => (typeof v === "string" ? v : v.toISOString()));
const nullableTimestampSchema = z
  .union([z.string(), z.date(), z.null()])
  .transform((v) =>
    v === null || typeof v === "string" ? v : v.toISOString(),
  );

export const notificationEventRowSchema = z.object({
  event_id: z.string().uuid(),
  event_type: notificationEventTypeSchema,
  subject_profile_id: z.string().uuid(),
  payload: z.record(z.unknown()),
  created_at: timestampSchema,
});
export type NotificationEventRow = z.infer<typeof notificationEventRowSchema>;

export const notificationMessageRowSchema = z.object({
  message_id: z.string().uuid(),
  event_id: z.string().uuid(),
  recipient_profile_id: z.string().uuid(),
  channel: notificationChannelSchema,
  status: notificationStatusSchema,
  provider_message_id: z.string().nullable(),
  attempts: z.number().int().min(0),
  last_error: z.string().nullable(),
  seen_at: nullableTimestampSchema,
  read_at: nullableTimestampSchema,
  archived_at: nullableTimestampSchema,
  sent_at: nullableTimestampSchema,
  delivered_at: nullableTimestampSchema,
  created_at: timestampSchema,
});
export type NotificationMessageRow = z.infer<
  typeof notificationMessageRowSchema
>;

/** Row shape returned by `public.notification_feed(...)`. */
export const notificationFeedRowSchema = z.object({
  message_id: z.string().uuid(),
  event_id: z.string().uuid(),
  event_type: notificationEventTypeSchema,
  subject_profile_id: z.string().uuid(),
  payload: z.record(z.unknown()),
  created_at: timestampSchema,
  seen_at: nullableTimestampSchema,
  read_at: nullableTimestampSchema,
  archived_at: nullableTimestampSchema,
});
export type NotificationFeedRow = z.infer<typeof notificationFeedRowSchema>;

// ── Retention sweep (contract §11) ───────────────────────────────────────────

/**
 * @spec [contracts/notifications.contract.md C11.2] | @implemented [2026-09-15, amended 2026-09-16]
 * How many rows one sweep call may delete PER BRANCH: at most this many expired events and,
 * independently, at most this many orphaned delivery events. The WINDOW is not here: it has
 * exactly one definition, `public.notification_retention_days()` in SQL, which the sweep
 * reads and the PG suite asserts against C11.1. This is only the per-call bound the cron
 * passes in.
 */
export const NOTIFICATION_RETENTION_SWEEP_BATCH_SIZE = 1000;

/** Row shape returned by `public.sweep_notification_retention(p_batch_size)`. */
export const notificationRetentionSweepRowSchema = z.object({
  deleted_events: z.number().int().min(0),
  deleted_messages: z.number().int().min(0),
  /** Unmatched delivery events (message_id IS NULL) aged out on received_at — C11.2 branch 2. */
  deleted_orphan_delivery_events: z.number().int().min(0),
  cutoff: timestampSchema,
});
export type NotificationRetentionSweepRow = z.infer<
  typeof notificationRetentionSweepRowSchema
>;

/** The dispatcher's recipient lookup: `profiles(id, email)`. */
export const notificationRecipientRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
});

// ── Feed API (contract §3.1, §9.4) ───────────────────────────────────────────

export const NOTIFICATION_API_MOUNT = "/api/notifications";

export const NOTIFICATION_FEED_DEFAULT_LIMIT = 20;
export const NOTIFICATION_FEED_MAX_LIMIT = 50;

/**
 * Opaque cursor content: the last item's message id, base64url-encoded JSON. The server
 * resolves the (created_at, message_id) keyset from the id at full precision.
 */
export const notificationFeedCursorSchema = z.object({
  messageId: z.string().uuid(),
});
export type NotificationFeedCursor = z.infer<
  typeof notificationFeedCursorSchema
>;

/**
 * `archived` selects the view: the inbox (unarchived rows, the default) or the archive.
 * Spelled out as the two literals rather than `z.coerce.boolean()`, which would read the
 * string "false" as true.
 */
export const notificationFeedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATION_FEED_MAX_LIMIT)
    .default(NOTIFICATION_FEED_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const notificationFeedItemSchema = z.object({
  messageId: z.string().uuid(),
  eventId: z.string().uuid(),
  eventType: notificationEventTypeSchema,
  title: z.string(),
  body: z.string(),
  href: z.string().nullable(),
  createdAt: z.string(),
  seenAt: z.string().nullable(),
  readAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type NotificationFeedItem = z.infer<typeof notificationFeedItemSchema>;

export const notificationFeedResponseSchema = z.object({
  items: z.array(notificationFeedItemSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationFeedResponse = z.infer<
  typeof notificationFeedResponseSchema
>;

export const notificationUnreadCountResponseSchema = z.object({
  unread: z.number().int().min(0),
});
export type NotificationUnreadCountResponse = z.infer<
  typeof notificationUnreadCountResponseSchema
>;

export const notificationMessageIdParamSchema = z.object({
  message_id: z.string().uuid(),
});

export const notificationPatchBodySchema = z
  .object({
    seen: z.boolean().optional(),
    read: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => b.seen === true || b.read === true || b.archived === true, {
    message: "at least one of seen, read, archived must be true",
  });
export type NotificationPatchBody = z.infer<typeof notificationPatchBodySchema>;

export const notificationMarkAllSeenResponseSchema = z.object({
  marked: z.number().int().min(0),
});

/** POST /mark-all-read — the read counterpart; read implies seen (contract §3.2). */
export const notificationMarkAllReadResponseSchema = z.object({
  marked: z.number().int().min(0),
});

export const notificationPatchResponseSchema = z.object({
  messageId: z.string().uuid(),
  seenAt: z.string().nullable(),
  readAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type NotificationPatchResponse = z.infer<
  typeof notificationPatchResponseSchema
>;

// ── Resend webhook (contract §7.4) ───────────────────────────────────────────

export const RESEND_WEBHOOK_PATH = "/api/webhooks/resend";

/** Provider event types that change a message's status, and the status they map to. */
export const RESEND_STATUS_EVENTS = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
} as const;
export type ResendStatusEventType = keyof typeof RESEND_STATUS_EVENTS;

export function isResendStatusEvent(
  type: string,
): type is ResendStatusEventType {
  return Object.prototype.hasOwnProperty.call(RESEND_STATUS_EVENTS, type);
}

/**
 * The part of a Resend webhook body this system reads. Everything else is ignored;
 * `passthrough` keeps the parse honest about unknown keys without depending on them.
 */
export const resendWebhookEventSchema = z
  .object({
    type: z.string().min(1),
    created_at: z.string().min(1),
    data: z.object({ email_id: z.string().min(1) }).passthrough(),
  })
  .passthrough();
export type ResendWebhookEvent = z.infer<typeof resendWebhookEventSchema>;

/**
 * @spec [contracts/notifications.contract.md C7.4 and §14 (marketing lane, amended 2026-10-07);
 *       owner Step 0 decision 4, 2026-10-07 ("a complaint turns the opt-in off")]
 *       | @implemented [2026-10-07]
 *
 * plain English: the receiver first reads only the envelope, so a contact event (which has no
 * `email_id`) is not rejected as malformed. Then:
 *   - `contact.updated` with `unsubscribed: true` → the marketing opt-out (source
 *     `email_unsubscribe`). Any other contact update is acknowledged and not recorded.
 *   - `email.complained` → the delivery status as before, AND the marketing opt-out for each
 *     recipient (source `email_complaint`): a complaint about any Lyceon email withdraws
 *     marketing consent, the direction that fails toward not mailing.
 * The address on either event is compared with profiles in SQL and never stored or logged.
 */
export const resendWebhookEnvelopeSchema = z
  .object({
    type: z.string().min(1),
    created_at: z.string().min(1),
    data: z.object({}).passthrough(),
  })
  .passthrough();

export const RESEND_CONTACT_UPDATED = "contact.updated";
export const RESEND_EMAIL_COMPLAINED = "email.complained";

export const resendContactUpdatedDataSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
    unsubscribed: z.boolean(),
  })
  .passthrough();

/** `to` is an array on Resend's email events; a bare string is accepted as one recipient. */
export const resendComplaintRecipientsSchema = z
  .object({
    to: z.union([z.array(z.string().min(1)).min(1), z.string().min(1)]),
  })
  .passthrough();

/** Contract §7.2 — Svix signature freshness window, in seconds. */
export const RESEND_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
