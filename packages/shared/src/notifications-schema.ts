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
 * Launch scope is one event type (owner rulings R7/R8, 2026-09-03). The consent request and
 * the deletion-scheduled email are direct sends, not events — see
 * server/lib/notifications/direct-sends.ts.
 */
export const NOTIFICATION_EVENT_TYPES = ["guardian_linked"] as const;
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
});
export type NotificationFeedRow = z.infer<typeof notificationFeedRowSchema>;

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

export const notificationFeedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATION_FEED_MAX_LIMIT)
    .default(NOTIFICATION_FEED_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
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

/** Contract §7.2 — Svix signature freshness window, in seconds. */
export const RESEND_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
