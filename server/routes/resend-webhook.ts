/**
 * @spec [contracts/notifications.contract.md §5.4, §7 (all clauses); lyceon-coding-standards
 *        §7.1 Zod at the boundary, §13 no silent catch] | @implemented [2026-09-03]
 *
 * plain English: the Resend webhook receiver, written fresh against Svix. Order is fixed:
 * raw Buffer check → secret present → signature + timestamp verified → body parsed → event
 * type mapped → ONE SQL function call (`apply_notification_delivery_event`) that records the
 * svix-id and applies the status change in the same transaction. There is no application-side
 * claim step, so "claimed but not applied" cannot exist — the defect the Stripe handler
 * carries (claim row, then effect, two statements) is not copied.
 *
 * Responses: 400 for anything unverifiable or unparseable (the provider must not retry it),
 * 200 for applied / ignored / unmatched / duplicate / acknowledged (open, click, sent and
 * unknown types are acknowledged and never written), 500 when the database call fails so the
 * provider retries. Replays are no-ops by the provider_event_id primary key.
 *
 * Logging carries ids and outcomes only: no addresses, no subject, no body.
 *
 * MARKETING LANE (§14, amended 2026-10-07; owner Step 0 decisions 4 and 6). The body is first
 * read as an envelope, so `contact.updated` (no `email_id`) parses. An unsubscribe
 * (`contact.updated` with `unsubscribed: true`) and a complaint (`email.complained`, in addition
 * to its delivery status) withdraw marketing consent through `apply_marketing_email_optout`:
 * the event id and the opt-out in one transaction, the consent-log row from the same trigger as
 * every other change. Replays are no-ops by that function's ledger.
 */
import type { Request, Response } from "express";
import {
  isResendStatusEvent,
  RESEND_CONTACT_UPDATED,
  RESEND_EMAIL_COMPLAINED,
  resendComplaintRecipientsSchema,
  resendContactUpdatedDataSchema,
  resendWebhookEnvelopeSchema,
  resendWebhookEventSchema,
} from "../../packages/shared/src/notifications-schema";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  verifySvixSignature,
  type SvixHeaders,
} from "../lib/notifications/svix";
import { logger } from "../logger";

/** What the marketing back-sync did with an unsubscribe or a complaint (§14). */
export type MarketingOptOutOutcome =
  | "applied"
  | "unchanged"
  | "unmatched"
  | "duplicate";

export type ResendWebhookOutcome =
  | {
      ok: true;
      status:
        | "applied"
        | "ignored"
        | "unmatched"
        | "duplicate"
        | "acknowledged";
      providerEventId: string;
      /** Set for an unsubscribe or a complaint; null for every other event. */
      marketing: MarketingOptOutOutcome | null;
    }
  | {
      ok: false;
      reason: "not_raw_body" | "bad_signature" | "bad_payload";
      message: string;
    };

type ProcessOptions = {
  env?: NodeJS.ProcessEnv;
  nowSeconds?: number;
};

export async function processResendWebhook(
  rawBody: unknown,
  headers: SvixHeaders,
  requestId: string | undefined,
  options: ProcessOptions = {},
): Promise<ResendWebhookOutcome> {
  if (!Buffer.isBuffer(rawBody)) {
    logger.error(
      "NOTIFICATIONS",
      "webhook_not_raw_body",
      "Resend webhook body was parsed before the handler",
      {
        requestId,
      },
    );
    return {
      ok: false,
      reason: "not_raw_body",
      message:
        "Webhook body must be a raw Buffer; register the route before the JSON parser.",
    };
  }

  const env = options.env ?? process.env;
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logger.error(
      "NOTIFICATIONS",
      "webhook_secret_missing",
      "RESEND_WEBHOOK_SECRET is not configured",
      {
        requestId,
      },
    );
    return {
      ok: false,
      reason: "bad_signature",
      message: "Webhook secret is not configured.",
    };
  }

  const verified = verifySvixSignature({
    headers,
    rawBody,
    secret,
    ...(options.nowSeconds !== undefined
      ? { nowSeconds: options.nowSeconds }
      : {}),
  });
  if (!verified.ok) {
    logger.warn(
      "NOTIFICATIONS",
      "webhook_bad_signature",
      "Resend webhook signature rejected",
      {
        requestId,
        reason: verified.error,
      },
    );
    return {
      ok: false,
      reason: "bad_signature",
      message: `Signature rejected: ${verified.error}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch (parseErr) {
    logger.warn(
      "NOTIFICATIONS",
      "webhook_bad_json",
      "Resend webhook body was not JSON",
      {
        requestId,
        providerEventId: verified.value.id,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      },
    );
    return { ok: false, reason: "bad_payload", message: "Body is not JSON." };
  }
  const envelope = resendWebhookEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    logger.warn(
      "NOTIFICATIONS",
      "webhook_bad_shape",
      "Resend webhook body did not match the schema",
      {
        requestId,
        providerEventId: verified.value.id,
        issues: envelope.error.issues.length,
      },
    );
    return {
      ok: false,
      reason: "bad_payload",
      message: "Body does not match the expected shape.",
    };
  }
  const providerEventId = verified.value.id;
  const eventType = envelope.data.type;

  // ── Marketing lane: an unsubscribe in Resend withdraws consent in Lyceon (§14). ─────────
  if (eventType === RESEND_CONTACT_UPDATED) {
    const contact = resendContactUpdatedDataSchema.safeParse(
      envelope.data.data,
    );
    if (!contact.success) {
      logger.warn(
        "MARKETING_EMAIL",
        "webhook_bad_shape",
        "Resend contact event did not match the schema",
        { requestId, providerEventId, issues: contact.error.issues.length },
      );
      return {
        ok: false,
        reason: "bad_payload",
        message: "Body does not match the expected shape.",
      };
    }
    if (!contact.data.unsubscribed) {
      // Our own create, or any other update: nothing to bring back.
      logger.info(
        "MARKETING_EMAIL",
        "webhook_acknowledged",
        "Resend contact update without an unsubscribe",
        { requestId, providerEventId, contactId: contact.data.id },
      );
      return {
        ok: true,
        status: "acknowledged",
        providerEventId,
        marketing: null,
      };
    }
    const marketing = await applyMarketingOptOut(
      providerEventId,
      RESEND_CONTACT_UPDATED,
      contact.data.id,
      contact.data.email,
      requestId,
    );
    return {
      ok: true,
      status:
        marketing === "duplicate" || marketing === "unmatched"
          ? marketing
          : "applied",
      providerEventId,
      marketing,
    };
  }

  if (!isResendStatusEvent(eventType)) {
    // email.sent / email.opened / email.clicked / email.delivery_delayed / other contact events /
    // unknown: acknowledged, never written.
    logger.info(
      "NOTIFICATIONS",
      "webhook_acknowledged",
      "Resend event type not tracked",
      {
        requestId,
        providerEventId,
        eventType,
      },
    );
    return {
      ok: true,
      status: "acknowledged",
      providerEventId,
      marketing: null,
    };
  }

  const event = resendWebhookEventSchema.safeParse(json);
  if (!event.success) {
    logger.warn(
      "NOTIFICATIONS",
      "webhook_bad_shape",
      "Resend webhook body did not match the schema",
      {
        requestId,
        providerEventId,
        issues: event.error.issues.length,
      },
    );
    return {
      ok: false,
      reason: "bad_payload",
      message: "Body does not match the expected shape.",
    };
  }

  // A complaint also withdraws marketing consent (owner decision 4, 2026-10-07). Done BEFORE
  // the status call: both are idempotent by the svix-id, so whichever fails, the provider's
  // retry completes the other without repeating either.
  let marketing: MarketingOptOutOutcome | null = null;
  if (eventType === RESEND_EMAIL_COMPLAINED) {
    const recipients = resendComplaintRecipientsSchema.safeParse(
      event.data.data,
    );
    if (!recipients.success) {
      logger.warn(
        "MARKETING_EMAIL",
        "webhook_complaint_no_recipient",
        "Resend complaint carried no recipient; delivery status still applied",
        { requestId, providerEventId },
      );
    } else {
      const to = Array.isArray(recipients.data.to)
        ? recipients.data.to
        : [recipients.data.to];
      const outcomes: MarketingOptOutOutcome[] = [];
      for (const [index, address] of to.entries()) {
        outcomes.push(
          await applyMarketingOptOut(
            index === 0 ? providerEventId : `${providerEventId}:${index}`,
            RESEND_EMAIL_COMPLAINED,
            null,
            address,
            requestId,
          ),
        );
      }
      // One outcome for the event: applied if any recipient was opted out, else the first
      // recipient's (every recipient shares the event, so a replay is duplicate for all).
      marketing = outcomes.includes("applied")
        ? "applied"
        : (outcomes[0] ?? null);
    }
  }

  const { data, error } = await supabaseServer.rpc(
    "apply_notification_delivery_event",
    {
      p_provider_event_id: providerEventId,
      p_provider_message_id: event.data.data.email_id,
      p_event_type: event.data.type,
      p_occurred_at: event.data.created_at,
    },
  );
  if (error) {
    // Handler failure: the route answers 500 so Resend retries. Nothing was written (the
    // function is one transaction), so the retry starts clean.
    throw new Error(
      `apply_notification_delivery_event failed: ${error.code ?? "unknown"} ${error.message}`,
    );
  }
  const outcome =
    data === "applied" ||
    data === "ignored" ||
    data === "unmatched" ||
    data === "duplicate"
      ? data
      : null;
  if (!outcome) {
    throw new Error(
      `apply_notification_delivery_event returned an unexpected value: ${String(data)}`,
    );
  }

  logger.info(
    "NOTIFICATIONS",
    "webhook_processed",
    "Resend delivery event processed",
    {
      requestId,
      providerEventId,
      eventType: event.data.type,
      outcome,
    },
  );
  return { ok: true, status: outcome, providerEventId, marketing };
}

/**
 * The marketing back-sync, one SQL call: the provider event id and the opt-out land in one
 * transaction (`apply_marketing_email_optout`, the C7.5 shape). The address is a parameter for
 * the SQL comparison only; it is not logged. Throws on a database failure, so the route answers
 * 500 and Resend retries.
 */
async function applyMarketingOptOut(
  providerEventId: string,
  eventType: typeof RESEND_CONTACT_UPDATED | typeof RESEND_EMAIL_COMPLAINED,
  contactId: string | null,
  address: string,
  requestId: string | undefined,
): Promise<MarketingOptOutOutcome> {
  const { data, error } = await supabaseServer.rpc(
    "apply_marketing_email_optout",
    {
      p_provider_event_id: providerEventId,
      p_event_type: eventType,
      p_resend_contact_id: contactId,
      p_email: address,
    },
  );
  if (error) {
    throw new Error(
      `apply_marketing_email_optout failed: ${error.code ?? "unknown"} ${error.message}`,
    );
  }
  const outcome =
    data === "applied" ||
    data === "unchanged" ||
    data === "unmatched" ||
    data === "duplicate"
      ? data
      : null;
  if (!outcome) {
    throw new Error(
      `apply_marketing_email_optout returned an unexpected value: ${String(data)}`,
    );
  }
  logger.info(
    "MARKETING_EMAIL",
    "webhook_optout_processed",
    "Resend unsubscribe or complaint processed",
    { requestId, providerEventId, eventType, contactId, outcome },
  );
  return outcome;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Express handler. Mount with `express.raw({ type: "application/json" })` BEFORE express.json(). */
export async function resendWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const requestId = req.requestId;
  const headers: SvixHeaders = {
    id: headerValue(req.headers["svix-id"]),
    timestamp: headerValue(req.headers["svix-timestamp"]),
    signature: headerValue(req.headers["svix-signature"]),
  };

  try {
    const outcome = await processResendWebhook(req.body, headers, requestId);
    if (!outcome.ok) {
      if (outcome.reason === "not_raw_body") {
        // A wiring defect on our side, not a bad request from the provider.
        res.status(500).json({
          error: "Webhook misconfigured",
          reason: outcome.reason,
          requestId,
        });
        return;
      }
      res
        .status(400)
        .json({ error: "Webhook rejected", reason: outcome.reason, requestId });
      return;
    }
    res.status(200).json({ received: true, status: outcome.status, requestId });
  } catch (err: unknown) {
    logger.error(
      "NOTIFICATIONS",
      "webhook_unhandled",
      "Resend webhook processing threw",
      {
        requestId,
        message: err instanceof Error ? err.message : "unknown",
      },
    );
    res.status(500).json({ error: "Webhook processing failed", requestId });
  }
}
