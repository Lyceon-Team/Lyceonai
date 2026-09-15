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
import { createHash } from "node:crypto";
import { err, type Result } from "../../../packages/shared/src/result";
import { logger } from "../../logger";
import { deletionScheduledEmail } from "./templates/deletion-scheduled";
import { guardianConsentRequestEmail } from "./templates/guardian-consent-request";
import { guardianLinkInviteEmail } from "./templates/guardian-link-invite";
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
export const GUARDIAN_LINK_INVITE_IDEMPOTENCY_PREFIX = "guardian-link-invite";

/**
 * @spec [contracts/notifications.contract.md §5.3 (every send carries a durable idempotency
 *        key); SCL-080 (the code is the credential)] | @implemented [2026-09-15]
 *
 * plain English: the invite has no row of its own and no `guardian_links` row exists before
 * redemption, so the key is derived from the durable state the email carries: the student,
 * the ISSUE TIME of the code being sent, and a hash of the normalised address. A repeated
 * submit for the same live code and the same address is one email at Resend; a regenerated
 * code or a different address is a new key. The address itself is hashed, never part of the
 * key — the key is logged as a provider header and must not carry PII.
 */
export function guardianLinkInviteIdempotencyKey(input: {
  studentProfileId: string;
  codeIssuedAt: string;
  guardianEmail: string;
}): string {
  const address = createHash("sha256")
    .update(input.guardianEmail.trim().toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${GUARDIAN_LINK_INVITE_IDEMPOTENCY_PREFIX}:${input.studentProfileId}:${input.codeIssuedAt}:${address}`;
}

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

/**
 * @spec [Doc-01_V8 §36.2, §38.1; contracts/notifications.contract.md §0.4 (direct send: the
 *        recipient has no profile row), §5.3, §12.3; SCL-080] | @implemented [2026-09-15]
 *
 * plain English: the student's CURRENT link code, sent to an address they typed, with a deep
 * link to the redeem page that prefills the code. It is not a magic link: the recipient must
 * still sign in (or create an account) and submit the code, exactly as when the code is read
 * aloud — a forwarded email or a prefetching scanner cannot link anyone. The body names the
 * student and states what a guardian can see; it carries no progress data (§38.1 applies
 * before the link exists) and tells an uninvited recipient how to ignore it. Best-effort at
 * the call site: a mail failure is logged (ids and a redacted address only) and returned as a
 * Result. Nothing about the message — not the address, not the code — is persisted here.
 */
export async function sendGuardianLinkInviteEmail(
  input: {
    studentProfileId: string;
    studentDisplayName: string;
    code: string;
    /** ISO issue time of `code` — part of the idempotency key. */
    codeIssuedAt: string;
    /** ISO expiry of `code`, computed by the caller from the configured TTL. */
    expiresAt: string;
    guardianEmail: string;
    requestId?: string;
  },
  deps: DirectSendDeps = {},
): Promise<DirectSendResult> {
  const siteUrl = resolveSiteUrl(deps);
  if (!siteUrl) {
    logger.error(
      "NOTIFICATIONS",
      "link_invite_email_unconfigured",
      "PUBLIC_SITE_URL is not set; cannot build the redeem link",
      { studentProfileId: input.studentProfileId, requestId: input.requestId },
    );
    return err({
      kind: "config_missing",
      message: "PUBLIC_SITE_URL is not configured",
    });
  }
  const redeemUrl = `${siteUrl}/guardian?code=${encodeURIComponent(input.code)}`;
  const rendered = guardianLinkInviteEmail({
    studentDisplayName: input.studentDisplayName,
    code: input.code,
    redeemUrl,
    expiresAt: input.expiresAt,
  });
  const transport = deps.transport ?? defaultEmailTransport();
  const sent = await transport({
    idempotencyKey: guardianLinkInviteIdempotencyKey({
      studentProfileId: input.studentProfileId,
      codeIssuedAt: input.codeIssuedAt,
      guardianEmail: input.guardianEmail,
    }),
    to: input.guardianEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (sent.ok) {
    logger.info(
      "NOTIFICATIONS",
      "link_invite_email_sent",
      "Guardian link invite email accepted",
      {
        studentProfileId: input.studentProfileId,
        providerMessageId: sent.value.providerMessageId,
        recipient: redactEmail(input.guardianEmail),
        requestId: input.requestId,
      },
    );
  } else {
    logger.warn(
      "NOTIFICATIONS",
      "link_invite_email_failed",
      "Guardian link invite email not sent",
      {
        studentProfileId: input.studentProfileId,
        recipient: redactEmail(input.guardianEmail),
        kind: sent.error.kind,
        requestId: input.requestId,
      },
    );
  }
  return sent;
}
