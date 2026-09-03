/**
 * @spec [contracts/notifications.contract.md §0.4 direct sends; Doc-01_V8 §37.2 (consent
 *        request email), §40.2.1 Phase 4 (deletion-scheduled email); owner rulings R7/R8/R9
 *        2026-09-03; Doc-01A_V1.0 §14 PII redaction] | @implemented [2026-09-03]
 *
 * plain English: the two transactional emails that are NOT notification events and never
 * will be — one addresses a person with no account (the guardian named in a consent request),
 * the other carries a credential (the recovery token). Both go through the one Resend
 * transport with an idempotency key derived from the durable request row's id, so a retried
 * request cannot produce a second email and nothing about either message is persisted here.
 * Both are best-effort at their call sites: the request row / the deletion are already
 * committed, so a mail failure is logged (ids and a redacted address only) and returned as a
 * Result, never thrown and never surfaced as a failed request.
 */
import { err, type Result } from "../../../packages/shared/src/result";
import { logger } from "../../logger";
import { deletionScheduledEmail } from "./templates/deletion-scheduled";
import { guardianConsentRequestEmail } from "./templates/guardian-consent-request";
import { siteUrlFromEnv } from "./templates";
import {
  defaultEmailTransport,
  redactEmail,
  type EmailSendFailure,
  type EmailTransport,
} from "./transport";

export const GUARDIAN_CONSENT_REQUEST_IDEMPOTENCY_PREFIX =
  "guardian-consent-request";
export const ACCOUNT_DELETION_SCHEDULED_IDEMPOTENCY_PREFIX =
  "account-deletion-scheduled";

type DirectSendDeps = {
  transport?: EmailTransport;
  /** PUBLIC_SITE_URL without trailing slash; defaults to the environment. */
  siteUrl?: string;
};

export type DirectSendResult = Result<
  { providerMessageId: string },
  EmailSendFailure
>;

function resolveSiteUrl(deps: DirectSendDeps): string {
  return deps.siteUrl ?? siteUrlFromEnv();
}

/** Doc 01 §37.2 steps 1–3: the consent request row exists; this is the email with the link. */
export async function sendGuardianConsentRequestEmail(
  input: {
    consentRequestId: string;
    guardianEmail: string;
    studentDisplayName: string;
    requestId?: string;
  },
  deps: DirectSendDeps = {},
): Promise<DirectSendResult> {
  const siteUrl = resolveSiteUrl(deps);
  if (!siteUrl) {
    logger.error(
      "NOTIFICATIONS",
      "consent_request_email_unconfigured",
      "PUBLIC_SITE_URL is not set; cannot build the consent link",
      { consentRequestId: input.consentRequestId, requestId: input.requestId },
    );
    return err({
      kind: "config_missing",
      message: "PUBLIC_SITE_URL is not configured",
    });
  }
  const verificationUrl = `${siteUrl}/guardian/verify-consent?requestId=${encodeURIComponent(input.consentRequestId)}`;
  const rendered = guardianConsentRequestEmail({
    studentDisplayName: input.studentDisplayName,
    verificationUrl,
  });
  const transport = deps.transport ?? defaultEmailTransport();
  const sent = await transport({
    idempotencyKey: `${GUARDIAN_CONSENT_REQUEST_IDEMPOTENCY_PREFIX}:${input.consentRequestId}`,
    to: input.guardianEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (sent.ok) {
    logger.info(
      "NOTIFICATIONS",
      "consent_request_email_sent",
      "Guardian consent request email accepted",
      {
        consentRequestId: input.consentRequestId,
        providerMessageId: sent.value.providerMessageId,
        recipient: redactEmail(input.guardianEmail),
        requestId: input.requestId,
      },
    );
  } else {
    logger.warn(
      "NOTIFICATIONS",
      "consent_request_email_failed",
      "Guardian consent request email not sent",
      {
        consentRequestId: input.consentRequestId,
        recipient: redactEmail(input.guardianEmail),
        kind: sent.error.kind,
        requestId: input.requestId,
      },
    );
  }
  return sent;
}

/** Doc 01 §40.2.1 Phase 4: the deletion is committed; this carries the 7-day recovery link. */
export async function sendAccountDeletionScheduledEmail(
  input: {
    deletionRequestId: string;
    email: string;
    rawToken: string;
    scheduledHardDeleteAt: string;
    requestId?: string;
  },
  deps: DirectSendDeps = {},
): Promise<DirectSendResult> {
  const siteUrl = resolveSiteUrl(deps);
  if (!siteUrl) {
    logger.error(
      "NOTIFICATIONS",
      "deletion_scheduled_email_unconfigured",
      "PUBLIC_SITE_URL is not set; cannot build the recovery link",
      {
        deletionRequestId: input.deletionRequestId,
        requestId: input.requestId,
      },
    );
    return err({
      kind: "config_missing",
      message: "PUBLIC_SITE_URL is not configured",
    });
  }
  const recoverUrl = `${siteUrl}/account/recover?token=${encodeURIComponent(input.rawToken)}`;
  const rendered = deletionScheduledEmail({
    recoverUrl,
    scheduledHardDeleteAt: input.scheduledHardDeleteAt,
  });
  const transport = deps.transport ?? defaultEmailTransport();
  const sent = await transport({
    idempotencyKey: `${ACCOUNT_DELETION_SCHEDULED_IDEMPOTENCY_PREFIX}:${input.deletionRequestId}`,
    to: input.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (sent.ok) {
    logger.info(
      "NOTIFICATIONS",
      "deletion_scheduled_email_sent",
      "Deletion-scheduled email accepted",
      {
        deletionRequestId: input.deletionRequestId,
        providerMessageId: sent.value.providerMessageId,
        recipient: redactEmail(input.email),
        requestId: input.requestId,
      },
    );
  } else {
    logger.warn(
      "NOTIFICATIONS",
      "deletion_scheduled_email_failed",
      "Deletion-scheduled email not sent",
      {
        deletionRequestId: input.deletionRequestId,
        recipient: redactEmail(input.email),
        kind: sent.error.kind,
        requestId: input.requestId,
      },
    );
  }
  return sent;
}
