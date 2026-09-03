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
 * NEVER THROWS FOR ONE ROW. A per-row failure is logged and counted; the loop continues,
 * because one bad recipient must not hold every other message. A failure to even SELECT
 * the queue is logged at error and reported in the summary as `selectFailed`.
 *
 * trade-offs: the inline path and the sweep can overlap on the same row for the seconds
 * between select and record; `Idempotency-Key = message_id` makes the second send a no-op at
 * Resend, and the second record call raises (LYN02) and is logged, not applied.
 */
import { z } from "zod";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  notificationEventRowSchema,
  notificationMessageRowSchema,
  notificationRecipientRowSchema,
  type NotificationMessageRow,
} from "../../../packages/shared/src/notifications-schema";
import { logger } from "../../logger";
import { renderEmail, siteUrlFromEnv } from "./templates";
import { createResendTransport, type EmailTransport } from "./transport";

export type DispatchSummary = {
  selected: number;
  sent: number;
  failed: number;
  skipped: number;
  selectFailed: boolean;
};

export type DispatchOptions = {
  /** Scope to one event's messages (the inline path). Omit for the sweep. */
  eventId?: string;
  limit?: number;
  transport?: EmailTransport;
};

const DISPATCH_DEFAULT_LIMIT = 100;

let defaultTransport: EmailTransport | null = null;
function transportFromEnv(): EmailTransport {
  if (!defaultTransport) defaultTransport = createResendTransport();
  return defaultTransport;
}

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

async function dispatchOne(
  row: NotificationMessageRow,
  transport: EmailTransport,
): Promise<"sent" | "failed" | "skipped"> {
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
    return "skipped";
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
  if (!eventRow) return "skipped";

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
    return "skipped";
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

  const rendered = renderEmail(eventRow.event_type, eventRow.payload, {
    recipientIsSubject:
      row.recipient_profile_id === eventRow.subject_profile_id,
    siteUrl: siteUrlFromEnv(),
  });
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
    messageId: row.message_id,
    to: address,
    subject: rendered.value.subject,
    html: rendered.value.html,
    text: rendered.value.text,
  });

  if (sent.ok) {
    const recorded = await recordAttempt({
      p_message_id: row.message_id,
      p_ok: true,
      p_provider_message_id: sent.value.providerMessageId,
      p_error: null,
      p_max_attempts: NOTIFICATION_EMAIL_MAX_ATTEMPTS,
    });
    return recorded ? "sent" : "skipped";
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
    skipped: 0,
    selectFailed: false,
  };
  const transport = options.transport ?? transportFromEnv();
  const limit = options.limit ?? DISPATCH_DEFAULT_LIMIT;

  let query = supabaseServer
    .from("notification_messages")
    .select("*")
    .eq("channel", "email")
    .eq("status", "queued")
    .lt("attempts", NOTIFICATION_EMAIL_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (options.eventId) query = query.eq("event_id", options.eventId);

  const { data, error } = await query;
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
    const outcome = await dispatchOne(row, transport);
    summary[outcome] += 1;
  }

  logger.info(
    "NOTIFICATIONS",
    "dispatch_completed",
    "Queued email dispatch finished",
    {
      eventId: options.eventId ?? null,
      ...summary,
    },
  );
  return summary;
}
