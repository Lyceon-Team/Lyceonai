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
 * Reply-To: every send carries `reply_to` = SUPPORT_EMAIL from packages/shared (owner brief
 * 2026-09-16 Part A). The sender is send-only; replies belong with support. There is no
 * per-caller override on purpose — one header, one place, no drift.
 *
 * Tracking: the request body carries no tags and no option that enables open or click
 * tracking (contract §12.3).
 *
 * trade-offs: REST via fetch rather than the Resend SDK — no dependency change. `fetchImpl`
 * and `baseUrl` are injectable so the PG suite can capture requests without network.
 */
import { notificationEnvSchema } from "../../../packages/shared/src/env";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import { SUPPORT_EMAIL } from "../../../packages/shared/src/support-contact";
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

/**
 * The one authenticated call into Resend. Credential resolution, the non-2xx mapping and the
 * network catch live here so the email send and the suppression list cannot drift apart into two
 * clients with two error shapes (contract §0.2). It does not log: the event names differ per
 * caller, so the caller decides what to say. `status` is carried on the failure because the
 * suppression reads need to tell a 404 ("not suppressed") from a real rejection.
 */
type ResendRequest = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
) => Promise<Result<unknown, EmailSendFailure>>;

function createResendRequest(options: TransportOptions): ResendRequest {
  const baseUrl = (options.baseUrl ?? RESEND_API_BASE_URL).replace(/\/$/, "");
  const envSource = options.env ?? process.env;

  return async (method, path, body, extraHeaders) => {
    // Resolved per call, not captured at creation: the process-wide transports are lazy
    // singletons, so a transport built before a suite replaces globalThis.fetch would otherwise
    // hold the real one forever and reach the network from a test.
    const fetchImpl = options.fetchImpl ?? fetch;
    const envParsed = notificationEnvSchema.safeParse(envSource);
    const apiKey = envParsed.success
      ? envParsed.data.RESEND_API_KEY
      : undefined;
    if (!apiKey) {
      return err({
        kind: "config_missing",
        message: "RESEND_API_KEY is not configured",
      });
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(extraHeaders ?? {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return err({ kind: "network", message });
    }

    if (!response.ok) {
      let providerMessage = `HTTP ${response.status}`;
      try {
        const errorBody: unknown = await response.json();
        if (errorBody && typeof errorBody === "object" && "message" in errorBody) {
          const m = (errorBody as { message?: unknown }).message;
          if (typeof m === "string") {
            providerMessage = `HTTP ${response.status}: ${m}`;
          }
        }
      } catch (parseErr) {
        // The provider's error body is optional context; the status is the fact.
        logger.debug(
          "NOTIFICATIONS",
          "resend_error_body_unparsed",
          "Resend error body was not JSON",
          {
            status: response.status,
            error:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
          },
        );
      }
      return err({
        kind: "provider_rejected",
        message: providerMessage,
        status: response.status,
      });
    }

    try {
      const payload: unknown = await response.json();
      return ok(payload);
    } catch (parseErr) {
      const message =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      return err({
        kind: "malformed_response",
        message: `2xx without JSON body: ${message}`,
      });
    }
  };
}

export function createResendTransport(
  options: TransportOptions = {},
): EmailTransport {
  const request = createResendRequest(options);
  const envSource = options.env ?? process.env;

  return async (input) => {
    const envParsed = notificationEnvSchema.safeParse(envSource);
    const from = envParsed.success
      ? envParsed.data.NOTIFICATION_FROM_EMAIL
      : undefined;
    if (!from) {
      logger.warn(
        "NOTIFICATIONS",
        "email_transport_unconfigured",
        "NOTIFICATION_FROM_EMAIL is not set; email not sent",
        { idempotencyKey: input.idempotencyKey },
      );
      return err({
        kind: "config_missing",
        message: "NOTIFICATION_FROM_EMAIL is not configured",
      });
    }

    const response = await request(
      "POST",
      "/emails",
      {
        from,
        to: [input.to],
        // @spec [owner brief 2026-09-16 Part A; contracts/notifications.contract.md §12]
        // | @implemented [2026-09-16] — NOTIFICATION_FROM_EMAIL is a send-only address with
        // no inbox; a reply must land with a person. Every send inherits Reply-To here, from
        // the ONE shared constant, so no caller can drift and none needs to override it.
        reply_to: SUPPORT_EMAIL,
        subject: input.subject,
        html: input.html,
        text: input.text,
      },
      // One REST call per message, keyed so a retried send of the same row cannot become a
      // second email.
      { "Idempotency-Key": input.idempotencyKey },
    );

    if (!response.ok) {
      const failure = response.error;
      if (failure.kind === "config_missing") {
        logger.warn(
          "NOTIFICATIONS",
          "email_transport_unconfigured",
          "RESEND_API_KEY is not set; email not sent",
          { idempotencyKey: input.idempotencyKey },
        );
      } else if (failure.kind === "network") {
        logger.warn(
          "NOTIFICATIONS",
          "email_send_network_error",
          "Resend request failed",
          {
            idempotencyKey: input.idempotencyKey,
            recipient: redactEmail(input.to),
            error: failure.message,
          },
        );
      } else {
        logger.warn(
          "NOTIFICATIONS",
          "email_send_rejected",
          "Resend rejected the send",
          {
            idempotencyKey: input.idempotencyKey,
            recipient: redactEmail(input.to),
            status: failure.status,
          },
        );
      }
      return err(failure);
    }

    const payload = response.value;
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

// ── Suppression list ────────────────────────────────────────────────────────────────────────
//
// @spec [contracts/notifications.contract.md §0.2 (this is the only module that talks to
//        Resend), §11A; owner follow-up 2026-09-17 "Replace Bespoke Suppression With Resend's"]
// | @implemented [2026-09-17]
//
// plain English: the do-not-contact list is Resend's, not ours. An address added here is skipped
// on every send the team makes, across every domain and subdomain, whether the send arrives by
// API or by SMTP — which is why nothing in this codebase re-checks it before sending, and why
// Supabase Auth's own mail (password reset, confirmation) is covered too.
//
// WHY IT LIVES IN THIS FILE. §0.2 of the contract says one module talks to Resend. A second
// module holding a second API key, a second base URL and a second error shape would be a forked
// client, and the two would drift. The credential resolution, the non-2xx mapping and the network
// catch below are the SAME helper the email send uses.
//
// Verified against the official SDK (resend@6.28.1, dist/index.mjs Suppressions class):
//   add     POST   /suppressions            { email }        → { object, id }
//   get     GET    /suppressions/{idOrEmail}                 → { object, id, email, origin, source_id, created_at }
//   remove  DELETE /suppressions/{idOrEmail}                 → { object, id, deleted }
// `origin` is 'bounce' | 'complaint' | 'manual'; ours are always 'manual'.

/** Why an address is suppressed. Only `manual` entries are ours to lift — see §11A.5. */
export type SuppressionOrigin = "bounce" | "complaint" | "manual";

export type SuppressionEntry = {
  id: string;
  email: string;
  origin: SuppressionOrigin;
};

/** Same failure shape as a send, so one caller can record either without branching on kind. */
export type SuppressionFailure = EmailSendFailure;

export type SuppressionTransport = {
  /** Add the address to the team suppression list. Idempotent at the provider. */
  add: (
    address: string,
  ) => Promise<Result<{ id: string }, SuppressionFailure>>;
  /** The entry for this address, or `ok(null)` when it is not suppressed. */
  get: (
    address: string,
  ) => Promise<Result<SuppressionEntry | null, SuppressionFailure>>;
  /** Remove the entry, letting the address receive mail again. */
  remove: (
    address: string,
  ) => Promise<Result<{ deleted: boolean }, SuppressionFailure>>;
};

/** Lowercased and trimmed, so `A@Example.com ` and `a@example.com` are one address. */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

const SUPPRESSION_ORIGINS: readonly SuppressionOrigin[] = [
  "bounce",
  "complaint",
  "manual",
];

function parseSuppressionEntry(payload: unknown): SuppressionEntry | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const id = row.id;
  const email = row.email;
  const origin = row.origin;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof email !== "string" || email.length === 0) return null;
  if (
    typeof origin !== "string" ||
    !SUPPRESSION_ORIGINS.includes(origin as SuppressionOrigin)
  ) {
    return null;
  }
  return { id, email, origin: origin as SuppressionOrigin };
}

export function createResendSuppressionTransport(
  options: TransportOptions = {},
): SuppressionTransport {
  const request = createResendRequest(options);

  return {
    async add(address) {
      const normalised = normaliseAddress(address);
      const response = await request("POST", "/suppressions", {
        email: normalised,
      });
      if (!response.ok) {
        logger.warn(
          "NOTIFICATIONS",
          "suppression_add_failed",
          "Resend did not accept the suppression",
          {
            recipient: redactEmail(normalised),
            kind: response.error.kind,
            status: response.error.status,
          },
        );
        return response;
      }
      const body = response.value;
      const id =
        body && typeof body === "object" && "id" in body
          ? (body as { id?: unknown }).id
          : undefined;
      if (typeof id !== "string" || id.length === 0) {
        return err({
          kind: "malformed_response",
          message: "2xx without a suppression id",
        });
      }
      logger.info(
        "NOTIFICATIONS",
        "suppression_added",
        "Address added to the Resend suppression list",
        { recipient: redactEmail(normalised) },
      );
      return ok({ id });
    },

    async get(address) {
      const normalised = normaliseAddress(address);
      const response = await request(
        "GET",
        `/suppressions/${encodeURIComponent(normalised)}`,
      );
      if (!response.ok) {
        // 404 is the ordinary "not suppressed" answer, not a failure. Anything else is.
        if (response.error.status === 404) return ok(null);
        return response;
      }
      const entry = parseSuppressionEntry(response.value);
      if (entry === null) {
        return err({
          kind: "malformed_response",
          message: "2xx without a well-formed suppression entry",
        });
      }
      return ok(entry);
    },

    async remove(address) {
      const normalised = normaliseAddress(address);
      const response = await request(
        "DELETE",
        `/suppressions/${encodeURIComponent(normalised)}`,
      );
      if (!response.ok) {
        if (response.error.status === 404) return ok({ deleted: false });
        logger.warn(
          "NOTIFICATIONS",
          "suppression_remove_failed",
          "Resend did not accept the suppression removal",
          {
            recipient: redactEmail(normalised),
            kind: response.error.kind,
            status: response.error.status,
          },
        );
        return response;
      }
      const body = response.value;
      const deleted =
        body && typeof body === "object" && "deleted" in body
          ? (body as { deleted?: unknown }).deleted
          : undefined;
      logger.info(
        "NOTIFICATIONS",
        "suppression_removed",
        "Address removed from the Resend suppression list",
        { recipient: redactEmail(normalised) },
      );
      return ok({ deleted: deleted === true });
    },
  };
}

let defaultSuppression: SuppressionTransport | null = null;

/** The process-wide suppression client, built from the environment on first use. */
export function defaultSuppressionTransport(): SuppressionTransport {
  if (!defaultSuppression) {
    defaultSuppression = createResendSuppressionTransport();
  }
  return defaultSuppression;
}
