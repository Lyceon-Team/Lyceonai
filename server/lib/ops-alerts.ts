/**
 * Ops alerts to the owner: Slack (incoming webhook) and email, once per condition per day.
 *
 * @spec [owner brief "QOTD resilience (no-question state, error logging, alerting)" (Karl,
 *       2026-10-09) §3 and "Alert delivery": every alert and recovery message goes to BOTH Slack
 *       (SLACK_ALERTS_WEBHOOK_URL, Production only) and email to Karl from notifications@lyceon.ai;
 *       each channel is independent (one failing never stops the other; the failure is logged at
 *       ERROR); idempotent per condition per day across both channels; webhook unset → skip
 *       Slack, send the email, WARN once per day; Coding Standards §12.1, §13]
 *       | @implemented [2026-10-09]
 *
 * plain English: `sendOpsAlert` claims (condition, today in America/Chicago, channel) in
 * `ops_alert_deliveries` BEFORE sending on that channel; a claim that already exists means this
 * condition already went out today on that channel, and nothing is sent. Each channel is tried
 * on its own, inside its own guard: a Slack failure is recorded and logged, and the email still
 * goes, and the other way round. Nothing here throws.
 *
 * Reuse, not a second system: the email goes through the notification lane's one Resend
 * transport (sender NOTIFICATION_FROM_EMAIL, Reply-To support, no tracking), with
 * Idempotency-Key = the delivery row id; Slack is a plain incoming-webhook POST, the same channel
 * kind as the crisis alerts (server/services/crisis-notification.ts), but a direct POST rather
 * than a Cloud Tasks hop: an ops alert is already deduplicated by the ledger, and a channel whose
 * send failed is re-claimed (and so retried) by the next check — the same day included, since
 * `ops_alert_claim` releases a `failed` claim — so a queue would add nothing. The recipient address (OPS_ALERT_EMAIL) and the
 * webhook URL are configuration, never logged. Every alert is also an ERROR log line at its call
 * site, which the error-monitor webhook (server/logger.ts) forwards on its own.
 */
import { z } from "zod";
import { logger } from "../logger";
import { escapeHtml } from "./notifications/templates/shared";
import type { EmailTransport } from "./notifications/transport";
import type { RpcClient } from "./rpc-client";

const COMPONENT = "OPS_ALERT";

export const OPS_ALERT_CONDITIONS = [
  "qotd_schedule_failed",
  "qotd_horizon_low",
  "qotd_no_question_today",
  "qotd_recovered",
  "ops_test",
] as const;
export type OpsAlertCondition = (typeof OPS_ALERT_CONDITIONS)[number];

export type OpsAlert = {
  condition: OpsAlertCondition;
  /** One line: what is wrong (or that it recovered). No content, no student data. */
  title: string;
  /** Detail lines: the current horizon, the date questions run out, what to do. */
  lines: readonly string[];
};

export type OpsChannelOutcome =
  | "sent"
  | "failed"
  | "already_sent"
  | "skipped_unconfigured";

export type OpsAlertOutcome = {
  slack: OpsChannelOutcome;
  email: OpsChannelOutcome;
};

export type OpsAlertDeps = {
  db: RpcClient;
  now: Date;
  slackWebhookUrl: string | undefined;
  emailTo: string | undefined;
  transport: EmailTransport;
  fetchImpl: typeof fetch;
};

const SLACK_TIMEOUT_MS = 10_000;

async function claim(
  db: RpcClient,
  condition: string,
  channel: "slack" | "email" | "log",
  now: Date,
): Promise<string | null> {
  const { data, error } = await db.rpc("ops_alert_claim", {
    p_condition: condition,
    p_channel: channel,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`ops_alert_claim failed: ${error.message}`);
  return z.string().uuid().nullable().parse(data);
}

async function record(
  db: RpcClient,
  id: string,
  status: "sent" | "failed" | "skipped",
  now: Date,
): Promise<void> {
  const { error } = await db.rpc("ops_alert_record", {
    p_id: id,
    p_status: status,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`ops_alert_record failed: ${error.message}`);
}

/** A configuration gap is reported once a day, on the `log` channel of its own condition. */
async function warnUnconfiguredOnce(
  deps: OpsAlertDeps,
  condition: "ops_slack_unconfigured" | "ops_email_unconfigured",
): Promise<void> {
  if ((await claim(deps.db, condition, "log", deps.now)) !== null) {
    logger.warn(
      COMPONENT,
      condition,
      condition === "ops_slack_unconfigured"
        ? "SLACK_ALERTS_WEBHOOK_URL is not set: ops alerts go by email only"
        : "OPS_ALERT_EMAIL is not set: ops alerts go to Slack only",
      {},
    );
  }
}

function plainText(alert: OpsAlert): string {
  return [`Lyceon ops: ${alert.title}`, ...alert.lines].join("\n");
}

async function sendSlack(
  alert: OpsAlert,
  deps: OpsAlertDeps,
): Promise<OpsChannelOutcome> {
  const id = await claim(deps.db, alert.condition, "slack", deps.now);
  if (id === null) return "already_sent";
  if (!deps.slackWebhookUrl) {
    await record(deps.db, id, "skipped", deps.now);
    await warnUnconfiguredOnce(deps, "ops_slack_unconfigured");
    return "skipped_unconfigured";
  }
  try {
    const res = await deps.fetchImpl(deps.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: plainText(alert) }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    if (!res.ok) {
      await record(deps.db, id, "failed", deps.now);
      logger.error(
        COMPONENT,
        "slack_failed",
        "Ops alert Slack post failed",
        undefined,
        {
          condition: alert.condition,
          status: res.status,
        },
      );
      return "failed";
    }
  } catch (err: unknown) {
    await record(deps.db, id, "failed", deps.now);
    // The webhook URL is a credential: log only the error class, never the URL.
    logger.error(
      COMPONENT,
      "slack_failed",
      "Ops alert Slack post failed",
      undefined,
      {
        condition: alert.condition,
        reason: err instanceof Error ? err.name : "unknown",
      },
    );
    return "failed";
  }
  await record(deps.db, id, "sent", deps.now);
  return "sent";
}

async function sendEmail(
  alert: OpsAlert,
  deps: OpsAlertDeps,
): Promise<OpsChannelOutcome> {
  const id = await claim(deps.db, alert.condition, "email", deps.now);
  if (id === null) return "already_sent";
  if (!deps.emailTo) {
    await record(deps.db, id, "skipped", deps.now);
    await warnUnconfiguredOnce(deps, "ops_email_unconfigured");
    return "skipped_unconfigured";
  }
  const text = plainText(alert);
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5"><p><strong>${escapeHtml(alert.title)}</strong></p>${alert.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}</body></html>`;
  const sent = await deps.transport({
    idempotencyKey: `ops-alert:${id}`,
    to: deps.emailTo,
    recipientProfileId: null,
    subject: `Lyceon ops: ${alert.title}`,
    html,
    text,
    // To the owner, not a student or guardian: outside quiet hours (owner ruling, Karl
    // 2026-10-09, schedule audit Step 2 item 2). This field is how the sender tells them apart.
    audience: "ops",
  });
  if (!sent.ok) {
    await record(deps.db, id, "failed", deps.now);
    logger.error(
      COMPONENT,
      "email_failed",
      "Ops alert email failed",
      undefined,
      {
        condition: alert.condition,
        kind: sent.error.kind,
      },
    );
    return "failed";
  }
  await record(deps.db, id, "sent", deps.now);
  return "sent";
}

/** One channel, fenced: any throw becomes a logged `failed`, never an exception. */
async function guarded(
  channel: "slack" | "email",
  alert: OpsAlert,
  send: () => Promise<OpsChannelOutcome>,
): Promise<OpsChannelOutcome> {
  try {
    return await send();
  } catch (err: unknown) {
    logger.error(
      COMPONENT,
      `${channel}_failed`,
      "Ops alert channel failed",
      undefined,
      {
        condition: alert.condition,
        reason: err instanceof Error ? err.message : "unknown",
      },
    );
    return "failed";
  }
}

export async function sendOpsAlert(
  alert: OpsAlert,
  deps: OpsAlertDeps,
): Promise<OpsAlertOutcome> {
  const slack = await guarded("slack", alert, () => sendSlack(alert, deps));
  const mailOutcome = await guarded("email", alert, () =>
    sendEmail(alert, deps),
  );
  logger.info(COMPONENT, "ops_alert_dispatched", "Ops alert dispatched", {
    condition: alert.condition,
    slack,
    mailOutcome,
  });
  return { slack, email: mailOutcome };
}
