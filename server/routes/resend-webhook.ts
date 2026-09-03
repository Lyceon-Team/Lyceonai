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
 */
import type { Request, Response } from "express";
import {
  isResendStatusEvent,
  resendWebhookEventSchema,
} from "../../packages/shared/src/notifications-schema";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  verifySvixSignature,
  type SvixHeaders,
} from "../lib/notifications/svix";
import { logger } from "../logger";

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
  const event = resendWebhookEventSchema.safeParse(json);
  if (!event.success) {
    logger.warn(
      "NOTIFICATIONS",
      "webhook_bad_shape",
      "Resend webhook body did not match the schema",
      {
        requestId,
        providerEventId: verified.value.id,
        issues: event.error.issues.length,
      },
    );
    return {
      ok: false,
      reason: "bad_payload",
      message: "Body does not match the expected shape.",
    };
  }

  if (!isResendStatusEvent(event.data.type)) {
    // email.sent / email.opened / email.clicked / email.delivery_delayed / unknown: acknowledged, never written.
    logger.info(
      "NOTIFICATIONS",
      "webhook_acknowledged",
      "Resend event type not tracked",
      {
        requestId,
        providerEventId: verified.value.id,
        eventType: event.data.type,
      },
    );
    return {
      ok: true,
      status: "acknowledged",
      providerEventId: verified.value.id,
    };
  }

  const { data, error } = await supabaseServer.rpc(
    "apply_notification_delivery_event",
    {
      p_provider_event_id: verified.value.id,
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
      providerEventId: verified.value.id,
      eventType: event.data.type,
      outcome,
    },
  );
  return { ok: true, status: outcome, providerEventId: verified.value.id };
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
        res
          .status(500)
          .json({
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
