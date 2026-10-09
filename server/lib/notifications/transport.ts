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
 * the recipient named only by profile id (digested by the logger) and the message id; no
 * address in any form, masked or not (owner ruling OQ-17, 2026-09-30); the subject, body and
 * API key are never logged. The deleted email.ts printed whole messages to the console when the key was
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
import { z } from "zod";
import { notificationEnvSchema } from "../../../packages/shared/src/env";
import { err, ok, type Result } from "../../../packages/shared/src/result";
import { SUPPORT_EMAIL } from "../../../packages/shared/src/support-contact";
import { logger } from "../../logger";

export const RESEND_API_BASE_URL = "https://api.resend.com";

export type EmailSendInput = {
  /** Resend Idempotency-Key. The dispatcher passes the message_id; direct sends pass a key derived from their request row id. */
  idempotencyKey: string;
  to: string;
  /**
   * @spec [owner ruling OQ-17, 2026-09-30; Doc 01A §14; register F-29] | @implemented [2026-09-30]
   * plain English: who the email is for, as a profile id. Logs carry this (the logger digests
   * `*ProfileId` keys) and the idempotency key, never the address in any form, masked or not.
   * `null` when the recipient has no profile yet (a guardian invited by address).
   */
  recipientProfileId: string | null;
  subject: string;
  html: string;
  text: string;
  /**
   * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "Daily email":
   *       "a List-Unsubscribe header"; RFC 2369, RFC 8058] | @implemented [2026-10-09]
   * plain English: extra message headers, passed through to Resend's `headers`. Only the
   * `qotd_daily` notification email sets it (List-Unsubscribe / List-Unsubscribe-Post), through
   * the dispatcher (owner ruling on #1166, 2026-10-09). Never logged.
   */
  headers?: Record<string, string>;
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
        if (
          errorBody &&
          typeof errorBody === "object" &&
          "message" in errorBody
        ) {
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
        ...(input.headers ? { headers: input.headers } : {}),
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
            recipientProfileId: input.recipientProfileId,
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
            recipientProfileId: input.recipientProfileId,
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
      recipientProfileId: input.recipientProfileId,
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

// @spec [lyceon-coding-standards §7.1 parse at every boundary (third-party payloads), §7.2
// schema first and infer the type from it] — the same shape as the Stripe boundary schemas in
// server/lib/stripe/*: the vendor payload is parsed where that vendor boundary lives, and the
// TypeScript type is inferred rather than declared beside it.
//
// `origin` is load-bearing, not decoration: the account surface may lift a `manual` entry and
// must refuse a `bounce` or a `complaint`. A hand-narrowed string would let an unrecognised
// value through as "not manual" or, worse, be widened later by someone who did not know why the
// enum was closed. `.passthrough()` because Resend may add fields and a new field is not a
// reason to fail a read.
export const resendSuppressionSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
    origin: z.enum(["bounce", "complaint", "manual"]),
  })
  .passthrough();

export type SuppressionEntry = z.infer<typeof resendSuppressionSchema>;

/** `POST /suppressions` → `{ object, id }`. */
const resendSuppressionAddSchema = z
  .object({ id: z.string().min(1) })
  .passthrough();

/** `DELETE /suppressions/{idOrEmail}` → `{ object, id, deleted }`. */
const resendSuppressionRemoveSchema = z
  .object({ deleted: z.boolean() })
  .passthrough();
/** Why an address is suppressed. Only `manual` entries are ours to lift — see §11A.6. */
export type SuppressionOrigin = SuppressionEntry["origin"];

/** Same failure shape as a send, so one caller can record either without branching on kind. */
export type SuppressionFailure = EmailSendFailure;

/**
 * Who a suppression change is for. Logged instead of the address (owner ruling OQ-17,
 * 2026-09-30); the logger digests `*ProfileId` keys. `null` where the caller deliberately has
 * no profile link, as on the deletion evidence side, which is keyed by log id alone.
 */
export type SuppressionLogContext = { recipientProfileId: string | null };

export type SuppressionTransport = {
  /** Add the address to the team suppression list. Idempotent at the provider. */
  add: (
    address: string,
    context: SuppressionLogContext,
  ) => Promise<Result<{ id: string }, SuppressionFailure>>;
  /** The entry for this address, or `ok(null)` when it is not suppressed. */
  get: (
    address: string,
  ) => Promise<Result<SuppressionEntry | null, SuppressionFailure>>;
  /** Remove the entry, letting the address receive mail again. */
  remove: (
    address: string,
    context: SuppressionLogContext,
  ) => Promise<Result<{ deleted: boolean }, SuppressionFailure>>;
};

/** Lowercased and trimmed, so `A@Example.com ` and `a@example.com` are one address. */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function createResendSuppressionTransport(
  options: TransportOptions = {},
): SuppressionTransport {
  const request = createResendRequest(options);

  return {
    async add(address, context) {
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
            recipientProfileId: context.recipientProfileId,
            kind: response.error.kind,
            status: response.error.status,
          },
        );
        return response;
      }
      const added = resendSuppressionAddSchema.safeParse(response.value);
      if (!added.success) {
        return err({
          kind: "malformed_response",
          message: "2xx without a suppression id",
        });
      }
      logger.info(
        "NOTIFICATIONS",
        "suppression_added",
        "Address added to the Resend suppression list",
        {
          recipientProfileId: context.recipientProfileId,
          suppressionId: added.data.id,
        },
      );
      return ok({ id: added.data.id });
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
      const entry = resendSuppressionSchema.safeParse(response.value);
      if (!entry.success) {
        return err({
          kind: "malformed_response",
          message: `2xx without a well-formed suppression entry: ${entry.error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; ")}`,
        });
      }
      return ok(entry.data);
    },

    async remove(address, context) {
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
            recipientProfileId: context.recipientProfileId,
            kind: response.error.kind,
            status: response.error.status,
          },
        );
        return response;
      }
      const removed = resendSuppressionRemoveSchema.safeParse(response.value);
      logger.info(
        "NOTIFICATIONS",
        "suppression_removed",
        "Address removed from the Resend suppression list",
        { recipientProfileId: context.recipientProfileId },
      );
      // A 2xx whose body we cannot read still means the provider accepted the removal; the
      // flag only reports whether an entry was actually there to remove.
      return ok({ deleted: removed.success && removed.data.deleted });
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

// ── Marketing contacts and segments ─────────────────────────────────────────────────────────
//
// @spec [contracts/notifications.contract.md §0.2 (this is the only module that talks to
//        Resend), §0 marketing lane and C14 (amended 2026-10-07); owner brief "SEO vertical —
//        email lane" 2026-10-07] | @implemented [2026-10-07]
//
// plain English: the four calls the daily marketing reconcile needs, on the same request helper
// as the email send and the suppression list. Contacts are created straight into their segment
// (`segments: [{ id }]`) and are never moved: a contact in the wrong segment is deleted and
// created again, so there is no add/remove-membership call to keep correct. `unsubscribed` is
// always written `false` on create: a create only ever follows a logged opt-in in Lyceon.
//
// Endpoints (Resend API reference, 2026-10-07):
//   list    GET    /contacts?limit=100[&after=<id>][&segment_id=<id>] → { object, has_more, data[] }
//   create  POST   /contacts { email, unsubscribed, segments:[{id}] } → { object, id }
//   delete  DELETE /contacts/{id|email}                              → { object, contact, deleted }
//   list    GET    /segments?limit=100[&after=<id>]                   → { object, has_more, data[] }
//
// Logging: the contact id and the profile id, never the address. The address is an argument and
// a parsed field, held in memory for the length of one call.

export const resendContactSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
    unsubscribed: z.boolean(),
  })
  .passthrough();
export type ResendContact = z.infer<typeof resendContactSchema>;

export const resendSegmentSchema = z
  .object({ id: z.string().min(1), name: z.string() })
  .passthrough();
export type ResendSegment = z.infer<typeof resendSegmentSchema>;

const resendListSchema = z
  .object({ has_more: z.boolean().optional(), data: z.array(z.unknown()) })
  .passthrough();
const resendContactCreateSchema = z
  .object({ id: z.string().min(1) })
  .passthrough();

/** Upper bound on pages per list, so a provider that always answers `has_more` cannot spin. */
const RESEND_LIST_MAX_PAGES = 1000;
const RESEND_LIST_PAGE_SIZE = 100;

export type ContactsFailure = EmailSendFailure;

export type ContactsTransport = {
  /** Every contact, or every contact in one segment. All pages. */
  listContacts: (filter: {
    segmentId?: string;
  }) => Promise<Result<ResendContact[], ContactsFailure>>;
  listSegments: () => Promise<Result<ResendSegment[], ContactsFailure>>;
  createContact: (
    email: string,
    segmentId: string,
    context: SuppressionLogContext,
  ) => Promise<Result<{ id: string }, ContactsFailure>>;
  /** By id or address. `deleted: false` when there was no such contact (404). */
  deleteContact: (
    idOrEmail: string,
    context: SuppressionLogContext,
  ) => Promise<Result<{ deleted: boolean }, ContactsFailure>>;
};

export function createResendContactsTransport(
  options: TransportOptions = {},
): ContactsTransport {
  const request = createResendRequest(options);

  async function listAll<T>(
    basePath: string,
    params: Record<string, string>,
    itemSchema: z.ZodType<T>,
  ): Promise<Result<T[], ContactsFailure>> {
    const items: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < RESEND_LIST_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        ...params,
        limit: String(RESEND_LIST_PAGE_SIZE),
        ...(after !== null ? { after } : {}),
      });
      const response = await request("GET", `${basePath}?${query.toString()}`);
      if (!response.ok) return response;
      const list = resendListSchema.safeParse(response.value);
      if (!list.success) {
        return err({
          kind: "malformed_response",
          message: `2xx without a list from ${basePath}`,
        });
      }
      let lastId: string | null = null;
      for (const raw of list.data.data) {
        const item = itemSchema.safeParse(raw);
        if (!item.success) {
          return err({
            kind: "malformed_response",
            message: `malformed item from ${basePath}: ${item.error.issues
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("; ")}`,
          });
        }
        items.push(item.data);
        const id = (raw as { id?: unknown }).id;
        lastId = typeof id === "string" ? id : lastId;
      }
      if (list.data.has_more !== true || lastId === null) return ok(items);
      after = lastId;
    }
    return err({
      kind: "malformed_response",
      message: `${basePath} still reported more pages after ${RESEND_LIST_MAX_PAGES}`,
    });
  }

  return {
    listContacts(filter) {
      return listAll(
        "/contacts",
        filter.segmentId !== undefined ? { segment_id: filter.segmentId } : {},
        resendContactSchema,
      );
    },

    listSegments() {
      return listAll("/segments", {}, resendSegmentSchema);
    },

    async createContact(email, segmentId, context) {
      const response = await request("POST", "/contacts", {
        email: normaliseAddress(email),
        unsubscribed: false,
        segments: [{ id: segmentId }],
      });
      if (!response.ok) {
        logger.warn(
          "MARKETING_EMAIL",
          "contact_create_failed",
          "Resend did not accept the contact",
          {
            recipientProfileId: context.recipientProfileId,
            kind: response.error.kind,
            status: response.error.status,
          },
        );
        return response;
      }
      const created = resendContactCreateSchema.safeParse(response.value);
      if (!created.success) {
        return err({
          kind: "malformed_response",
          message: "2xx without a contact id",
        });
      }
      return ok({ id: created.data.id });
    },

    async deleteContact(idOrEmail, context) {
      const target = idOrEmail.includes("@")
        ? normaliseAddress(idOrEmail)
        : idOrEmail;
      const response = await request(
        "DELETE",
        `/contacts/${encodeURIComponent(target)}`,
      );
      if (!response.ok) {
        if (response.error.status === 404) return ok({ deleted: false });
        logger.warn(
          "MARKETING_EMAIL",
          "contact_delete_failed",
          "Resend did not accept the contact deletion",
          {
            recipientProfileId: context.recipientProfileId,
            kind: response.error.kind,
            status: response.error.status,
          },
        );
        return response;
      }
      return ok({ deleted: true });
    },
  };
}

let defaultContacts: ContactsTransport | null = null;

/** The process-wide contacts client, built from the environment on first use. */
export function defaultContactsTransport(): ContactsTransport {
  if (!defaultContacts) defaultContacts = createResendContactsTransport();
  return defaultContacts;
}
