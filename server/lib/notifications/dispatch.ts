/**
 * @spec [contracts/notifications.contract.md §4.1, §4.2, §6; lyceon-coding-standards §7.1
 *        parse at every boundary, §13 no silent catch] | @implemented [2026-09-03]
 *
 * plain English: moves queued email rows to Resend. Selects `channel='email' AND
 * status='queued' AND attempts < NOTIFICATION_EMAIL_MAX_ATTEMPTS` (optionally for one
 * event), resolves the recipient's address from `profiles.email`, renders the event's
 * template, calls the transport, and records the outcome through
 * `record_notification_send_attempt` — the SQL function that owns the queued→sent /
 * queued→queued(+attempt) / queued→failed transitions and reconciles any webhook that
 * arrived early. A failed send therefore leaves the row `queued` with `attempts`
 * incremented and `last_error` set; it never becomes `sent` and never becomes `failed`
 * before the cap.
 *
 * WHEN IT RUNS. Inline, awaited, after the mutation's transaction has committed (the redeem
 * route calls it for that event's id) — timeliness does not depend on cron. The daily
 * `notification-dispatch-sweep` cron calls it without an event id as a backstop for rows a
 * frozen function left behind.
 *
 * NEVER THROWS FOR ONE ROW. A per-row failure is logged and counted (`deferred`); the loop continues,
 * because one bad recipient must not hold every other message. A failure to even SELECT
 * the queue is logged at error and reported in the summary as `selectFailed`.
 *
 * trade-offs: the inline path and the sweep can overlap on the same row for the seconds
 * between select and record; `Idempotency-Key = message_id` makes the second send a no-op at
 * Resend, and the second record call raises (LYN02) and is logged, not applied.
 *
 * EXPIRY AND QUIET HOURS (owner ruling, Karl 2026-10-09, schedule audit Step 2 items 2 and
 * 3(1); contract §6.6, §6.7) | @implemented [2026-10-09]. Before anything else is read for a row:
 *   1. EXPIRED → dropped. An event whose `expires_at` (set by its emitter: the exam reminder at the
 *      start of the test day in the student's zone, `qotd_daily` at the end of its Chicago day)
 *      is at or before `now` is failed at once — `record_notification_send_attempt` with a cap of
 *      one, so it is never retried — and logged at WARN with ids only. This is the ONE staleness
 *      mechanism; the QOTD-only "its day has passed" check it replaces is gone.
 *   2. QUIET HOURS → postponed. Every email this dispatcher sends goes to a student, a guardian
 *      or a payer, so 21:00–08:00 America/Chicago applies to all of it. The row stays `queued`
 *      with `not_before` = the next 08:00 Chicago (`defer_notification_send`); `attempts` and
 *      `last_error` are untouched, because a deferral is not a failed send. The queue
 *      (`notification_dispatch_queue`) does not select it before then; the 14:00 UTC sweep, or
 *      any later send path, picks it up. A deferral that would land at or after the event's
 *      expiry is an expiry: dropped, not postponed.
 * The row is deferred here rather than handed to Resend's scheduler (which the transport uses for
 * direct sends) so that at 08:00 the expiry, the recipient's address and a `qotd_daily`
 * recipient's preference are all read again.
 *
 * `eventType` narrows the queue to one event type: the 17:00 QOTD run sends `qotd_daily` only
 * (ruling item 3(3)); the daily sweep is the one retry path for every other type.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  notificationEventRowSchema,
  notificationMessageRowSchema,
  notificationRecipientRowSchema,
  type NotificationEventType,
  type NotificationMessageRow,
} from "../../../packages/shared/src/notifications-schema";
import { logger } from "../../logger";
import { qotdDailySendContext } from "./qotd-daily-send-context";
import { quietHoursDeferral } from "./quiet-hours";
import { renderEmail, siteUrlFromEnv, type RenderContext } from "./templates";
import { defaultEmailTransport, type EmailTransport } from "./transport";

export type DispatchSummary = {
  selected: number;
  sent: number;
  failed: number;
  /** A transient read failure: the row was not touched and is retried as it stands. */
  deferred: number;
  /** Quiet hours: the row stays queued with `not_before` = the next 08:00 America/Chicago. */
  postponed: number;
  /** Past its event's `expires_at` (or would be by 08:00): failed, never sent. */
  expired: number;
  selectFailed: boolean;
};

export type DispatchOptions = {
  /** Scope to one event's messages (the inline path). Omit for the sweep. */
  eventId?: string;
  /** Scope to one event type (the 17:00 QOTD run: `qotd_daily` only). Omit for the sweep. */
  eventType?: NotificationEventType;
  limit?: number;
  transport?: EmailTransport;
  /** The dispatcher's clock: expiry and quiet hours are read against it. Default: now. */
  now?: Date;
};

const DISPATCH_DEFAULT_LIMIT = 100;

type RecordArgs = {
  p_message_id: string;
  p_ok: boolean;
  p_provider_message_id: string | null;
  p_error: string | null;
  p_max_attempts: number;
};

async function recordAttempt(args: RecordArgs): Promise<boolean> {
  const { error } = await supabaseServer.rpc(
    "record_notification_send_attempt",
    args,
  );
  if (error) {
    logger.error(
      "NOTIFICATIONS",
      "record_attempt_failed",
      "record_notification_send_attempt failed",
      {
        messageId: args.p_message_id,
        code: error.code,
        message: error.message,
      },
    );
    return false;
  }
  return true;
}

async function deferRow(messageId: string, notBefore: Date): Promise<boolean> {
  const { error } = await supabaseServer.rpc("defer_notification_send", {
    p_message_id: messageId,
    p_not_before: notBefore.toISOString(),
  });
  if (error) {
    logger.error(
      "NOTIFICATIONS",
      "defer_send_failed",
      "defer_notification_send failed",
      { messageId, code: error.code, message: error.message },
    );
    return false;
  }
  return true;
}

/** Drop an expired email: failed at once (cap of one), never retried, logged with ids only. */
async function expireRow(
  row: NotificationMessageRow,
  eventType: NotificationEventType,
  reason: "expired" | "expires_before_quiet_hours_end",
): Promise<"expired"> {
  logger.warn(
    "NOTIFICATIONS",
    "dispatch_expired",
    "A time-sensitive email expired before it could be sent; dropped",
    { messageId: row.message_id, eventId: row.event_id, eventType, reason },
  );
  await recordAttempt({
    p_message_id: row.message_id,
    p_ok: false,
    p_provider_message_id: null,
    p_error: `${reason}: not sent`,
    p_max_attempts: 1,
  });
  return "expired";
}

async function dispatchOne(
  row: NotificationMessageRow,
  transport: EmailTransport,
  now: Date,
): Promise<"sent" | "failed" | "deferred" | "postponed" | "expired"> {
  const { data: eventRows, error: eventError } = await supabaseServer
    .from("notification_events")
    .select("*")
    .eq("event_id", row.event_id)
    .limit(1);
  if (eventError) {
    logger.error(
      "NOTIFICATIONS",
      "dispatch_event_read_failed",
      "Could not read the event for a queued message",
      {
        messageId: row.message_id,
        eventId: row.event_id,
        code: eventError.code,
        message: eventError.message,
      },
    );
    return "deferred";
  }
  const event = z.array(notificationEventRowSchema).safeParse(eventRows);
  if (!event.success || event.data.length !== 1) {
    await recordAttempt({
      p_message_id: row.message_id,
      p_ok: false,
      p_provider_message_id: null,
      p_error: "event row missing or malformed",
      p_max_attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
    });
    return "failed";
  }
  const eventRow = event.data[0];
  if (!eventRow) return "deferred";

  // Owner ruling 2026-10-09 item 3(1): an expired email is dropped, never sent late.
  const expiresAt =
    eventRow.expires_at === null ? null : new Date(eventRow.expires_at);
  if (expiresAt !== null && now.getTime() >= expiresAt.getTime()) {
    return expireRow(row, eventRow.event_type, "expired");
  }
  // Owner ruling 2026-10-09 item 2: no student- or guardian-facing email 21:00–08:00 Chicago.
  const notBefore = quietHoursDeferral(now);
  if (notBefore !== null) {
    if (expiresAt !== null && notBefore.getTime() >= expiresAt.getTime()) {
      return expireRow(
        row,
        eventRow.event_type,
        "expires_before_quiet_hours_end",
      );
    }
    const deferred = await deferRow(row.message_id, notBefore);
    if (!deferred) return "deferred";
    logger.info(
      "NOTIFICATIONS",
      "dispatch_postponed_quiet_hours",
      "Email postponed to the end of quiet hours",
      {
        messageId: row.message_id,
        eventType: eventRow.event_type,
        notBefore: notBefore.toISOString(),
      },
    );
    return "postponed";
  }

  const { data: recipientRows, error: recipientError } = await supabaseServer
    .from("profiles")
    .select("id, email")
    .eq("id", row.recipient_profile_id)
    .limit(1);
  if (recipientError) {
    logger.error(
      "NOTIFICATIONS",
      "dispatch_recipient_read_failed",
      "Could not read the recipient profile",
      {
        messageId: row.message_id,
        code: recipientError.code,
        message: recipientError.message,
      },
    );
    return "deferred";
  }
  const recipient = z
    .array(notificationRecipientRowSchema)
    .safeParse(recipientRows);
  const address = recipient.success ? (recipient.data[0]?.email ?? null) : null;
  if (!address) {
    await recordAttempt({
      p_message_id: row.message_id,
      p_ok: false,
      p_provider_message_id: null,
      p_error: "recipient has no email address",
      p_max_attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
    });
    return "failed";
  }

  // @spec [contracts/notifications.contract.md §11A; owner follow-up 2026-09-17 "Replace Bespoke
  // Suppression With Resend's"] | @implemented [2026-09-17]
  // NO DO-NOT-CONTACT CHECK HERE, AND THAT IS THE DESIGN. Resend enforces the team's suppression
  // list itself, on every send, whether it arrives by API or by SMTP — so a suppressed address is
  // skipped one layer below this one. A second check here would be a copy of the vendor's
  // enforcement that can only disagree with it.
  const siteUrl = siteUrlFromEnv();
  const ctx: RenderContext = {
    recipientIsSubject:
      row.recipient_profile_id === eventRow.subject_profile_id,
    siteUrl,
  };
  // owner ruling on #1166 item 1 (2026-10-09): the daily-question email's stem and its signed
  // unsubscribe/resume links are looked up at send time; the payload carries neither.
  if (eventRow.event_type === "qotd_daily") {
    const extras = await qotdDailySendContext(
      eventRow.payload,
      row.recipient_profile_id,
      siteUrl,
    );
    if (!extras.ok) {
      logger.error(
        "NOTIFICATIONS",
        "dispatch_qotd_context_failed",
        "Could not prepare a daily-question email",
        { messageId: row.message_id, reason: extras.error.reason },
      );
      await recordAttempt({
        p_message_id: row.message_id,
        p_ok: false,
        p_provider_message_id: null,
        p_error: extras.error.reason,
        // A withdrawn email is never sent: fail it now, no retry. (A past day's question is
        // caught above, by the event's expiry.)
        p_max_attempts: extras.error.final
          ? 1
          : NOTIFICATION_EMAIL_MAX_ATTEMPTS,
      });
      return "failed";
    }
    ctx.qotdEmail = extras.value;
  }
  const rendered = renderEmail(eventRow.event_type, eventRow.payload, ctx);
  if (!rendered.ok) {
    await recordAttempt({
      p_message_id: row.message_id,
      p_ok: false,
      p_provider_message_id: null,
      p_error: rendered.error,
      p_max_attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
    });
    return "failed";
  }

  const sent = await transport({
    idempotencyKey: row.message_id,
    to: address,
    recipientProfileId: row.recipient_profile_id,
    subject: rendered.value.subject,
    html: rendered.value.html,
    text: rendered.value.text,
    ...(rendered.value.headers ? { headers: rendered.value.headers } : {}),
    // Every notification email goes to a student, a guardian or a payer.
    audience: "student_or_guardian",
    now,
  });

  if (sent.ok) {
    const recorded = await recordAttempt({
      p_message_id: row.message_id,
      p_ok: true,
      p_provider_message_id: sent.value.providerMessageId,
      p_error: null,
      p_max_attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
    });
    return recorded ? "sent" : "deferred";
  }

  await recordAttempt({
    p_message_id: row.message_id,
    p_ok: false,
    p_provider_message_id: null,
    p_error: `${sent.error.kind}: ${sent.error.message}`,
    p_max_attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  });
  return "failed";
}

export async function dispatchQueuedMessages(
  options: DispatchOptions = {},
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    selected: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    postponed: 0,
    expired: 0,
    selectFailed: false,
  };
  const transport = options.transport ?? defaultEmailTransport();
  const limit = options.limit ?? DISPATCH_DEFAULT_LIMIT;
  const now = options.now ?? new Date();

  // The predicate is SQL's (contract C6.3 as amended 2026-10-09): email, queued, under the cap,
  // `not_before` passed, optionally one event / one event type.
  const { data, error } = await supabaseServer.rpc(
    "notification_dispatch_queue",
    {
      p_now: now.toISOString(),
      p_limit: limit,
      p_max_attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
      ...(options.eventId ? { p_event_id: options.eventId } : {}),
      ...(options.eventType ? { p_event_type: options.eventType } : {}),
    },
  );
  if (error) {
    logger.error(
      "NOTIFICATIONS",
      "dispatch_select_failed",
      "Could not select queued email messages",
      {
        eventId: options.eventId ?? null,
        code: error.code,
        message: error.message,
      },
    );
    summary.selectFailed = true;
    return summary;
  }
  const rows = z.array(notificationMessageRowSchema).safeParse(data);
  if (!rows.success) {
    logger.error(
      "NOTIFICATIONS",
      "dispatch_rows_malformed",
      "Queued message rows did not match the schema",
      {
        eventId: options.eventId ?? null,
        issues: rows.error.issues.length,
      },
    );
    summary.selectFailed = true;
    return summary;
  }

  summary.selected = rows.data.length;
  for (const row of rows.data) {
    const outcome = await dispatchOne(row, transport, now);
    summary[outcome] += 1;
  }

  logger.info(
    "NOTIFICATIONS",
    "dispatch_completed",
    "Queued email dispatch finished",
    {
      eventId: options.eventId ?? null,
      eventType: options.eventType ?? null,
      ...summary,
    },
  );
  return summary;
}
