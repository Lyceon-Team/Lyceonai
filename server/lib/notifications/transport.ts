/**
 * @spec [contracts/notifications.contract.md §0.2, §5.3, §10, §12; Doc-01A_V1.0 §14 PII
 *        redaction; lyceon-coding-standards §3.6 Result, §12.1 never log content, §13 no
 *        silent catch] | @implemented [2026-09-03]
 *
 * plain English: the ONLY module in the codebase that talks to Resend — for notification
 * messages (dispatch.ts) and for the two direct sends (direct-sends.ts). One REST call per
 * message, `Idempotency-Key: <message_id>` so a retried send of the same row cannot become
 * a second email, sender from NOTIFICATION_FROM_EMAIL. Expected provider failures (missing
 * config, non-2xx, network) come back as a Result — the dispatcher records them against
 * the row; nothing here throws for those. Logging goes through the structured logger with
 * the recipient reduced to first letter + domain; the subject, body and API key are never
 * logged. The deleted email.ts printed whole messages to the console when the key was
 * absent — that path does not exist here: no key means a `config_missing` failure and a
 * warn line carrying only the message id.
 *
 * Tracking: the request body carries no tags and no option that enables open or click
 * tracking (contract §12.3).
 *
 * trade-offs: REST via fetch rather than the Resend SDK — no dependency change. `fetchImpl`
 * and `baseUrl` are injectable so the PG suite can capture requests without network.
 */
import { notificationEnvSchema } from "../../../packages/shared/src/env";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import { logger } from "../../logger";

export const RESEND_API_BASE_URL = "https://api.resend.com";

export type EmailSendInput = {
  /** Resend Idempotency-Key. The dispatcher passes the message_id; direct sends pass a key derived from their request row id. */
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailSendFailure = {
  kind:
    | "config_missing"
    | "provider_rejected"
    | "network"
    | "malformed_response";
  message: string;
  status?: number;
};

export type EmailTransport = (
  input: EmailSendInput,
) => Promise<Result<{ providerMessageId: string }, EmailSendFailure>>;

/** Doc 01A §14: first letter + domain. Anything unparseable becomes a fixed marker. */
export function redactEmail(address: string): string {
  const at = address.indexOf("@");
  if (at <= 0 || at === address.length - 1) return "<redacted>";
  return `${address[0]}****@${address.slice(at + 1)}`;
}

type TransportOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
};

export function createResendTransport(
  options: TransportOptions = {},
): EmailTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? RESEND_API_BASE_URL).replace(/\/$/, "");
  const envSource = options.env ?? process.env;

  return async (input) => {
    const envParsed = notificationEnvSchema.safeParse(envSource);
    const apiKey = envParsed.success
      ? envParsed.data.RESEND_API_KEY
      : undefined;
    const from = envParsed.success
      ? envParsed.data.NOTIFICATION_FROM_EMAIL
      : undefined;
    if (!apiKey || !from) {
      logger.warn(
        "NOTIFICATIONS",
        "email_transport_unconfigured",
        "RESEND_API_KEY or NOTIFICATION_FROM_EMAIL is not set; email not sent",
        { idempotencyKey: input.idempotencyKey },
      );
      return err({
        kind: "config_missing",
        message: "RESEND_API_KEY or NOTIFICATION_FROM_EMAIL is not configured",
      });
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      logger.warn(
        "NOTIFICATIONS",
        "email_send_network_error",
        "Resend request failed",
        {
          idempotencyKey: input.idempotencyKey,
          recipient: redactEmail(input.to),
          error: message,
        },
      );
      return err({ kind: "network", message });
    }

    if (!response.ok) {
      let providerMessage = `HTTP ${response.status}`;
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "message" in body) {
          const m = (body as { message?: unknown }).message;
          if (typeof m === "string")
            providerMessage = `HTTP ${response.status}: ${m}`;
        }
      } catch (parseErr) {
        // The provider's error body is optional context; the status is the fact. Logged, not fatal.
        logger.debug(
          "NOTIFICATIONS",
          "email_send_error_body_unparsed",
          "Resend error body was not JSON",
          {
            idempotencyKey: input.idempotencyKey,
            status: response.status,
            error:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
          },
        );
      }
      logger.warn(
        "NOTIFICATIONS",
        "email_send_rejected",
        "Resend rejected the send",
        {
          idempotencyKey: input.idempotencyKey,
          recipient: redactEmail(input.to),
          status: response.status,
        },
      );
      return err({
        kind: "provider_rejected",
        message: providerMessage,
        status: response.status,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (parseErr) {
      const message =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      return err({
        kind: "malformed_response",
        message: `2xx without JSON body: ${message}`,
      });
    }
    const id =
      payload && typeof payload === "object" && "id" in payload
        ? (payload as { id?: unknown }).id
        : undefined;
    if (typeof id !== "string" || id.length === 0) {
      return err({
        kind: "malformed_response",
        message: "2xx without an email id",
      });
    }

    logger.info("NOTIFICATIONS", "email_sent", "Email accepted by Resend", {
      idempotencyKey: input.idempotencyKey,
      providerMessageId: id,
      recipient: redactEmail(input.to),
    });
    return ok({ providerMessageId: id });
  };
}

let defaultTransport: EmailTransport | null = null;

/** The process-wide transport built from the environment; created on first use. */
export function defaultEmailTransport(): EmailTransport {
  if (!defaultTransport) defaultTransport = createResendTransport();
  return defaultTransport;
}
