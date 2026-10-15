/**
 * Signed, single-purpose links for the daily-question email: unsubscribe and resume.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "API": "A one-click
 *       unsubscribe link (signed, single-purpose, no sign-in) plus a List-Unsubscribe header";
 *       "Daily email": the pause email's "resume link"; acceptance 7 ("a tampered link is
 *       refused")] | @implemented [2026-10-09]
 *
 * plain English: a link token is `<student id>.<signature>`, where the signature is
 * base64url(HMAC-SHA256(K, "<action>:<student id>")) truncated to 16 bytes and
 * K = HMAC-SHA256(PUBLIC_RATE_LIMIT_HMAC_SECRET, "lyceon:qotd-email:link:v1") — a sub-key with its
 * own label, the same pattern as the QOTD option tokens, so it can never collide with another
 * use of that secret. The action is inside the signature, so an unsubscribe token cannot be
 * used to resume and vice versa. Verification is constant-time. Nothing is stored.
 *
 * GUARDIAN DIGEST (Karl's ruling 5 on #1223, 2026-10-13: "a signed link + List-Unsubscribe …
 * follow the existing QOTD-email one-click unsubscribe pattern exactly; reuse its signing/
 * verification primitive, do not fork"): the action `guardian_digest_unsubscribe` signs the
 * GUARDIAN's id with the same sub-key. Because the action is inside the signature, a digest token
 * cannot unsubscribe anyone from the daily question, nor a QOTD token a guardian from the digest.
 * Served by its own route (`/api/public/guardian-digest-email/unsubscribe`), which writes through
 * the guardian switch's one writer.
 *
 * trade-offs: the token does not expire. An unsubscribe link must keep working for as long as the
 * email exists (industry practice and CAN-SPAM's 30-day minimum), and both actions are safe to
 * repeat. The token names a student id, which is opaque and is not personal data on its own.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requirePublicHmacSecret } from "../../lib/client-ip";

const LINK_LABEL = "lyceon:qotd-email:link:v1";
const SIGNATURE_BYTES = 16;

export const QOTD_EMAIL_LINK_ACTIONS = [
  "unsubscribe",
  "resume",
  "guardian_digest_unsubscribe",
] as const;
export type QotdEmailLinkAction = (typeof QOTD_EMAIL_LINK_ACTIONS)[number];

function linkKey(): Buffer {
  return createHmac("sha256", requirePublicHmacSecret())
    .update(LINK_LABEL)
    .digest();
}

function signature(action: QotdEmailLinkAction, studentId: string): Buffer {
  return createHmac("sha256", linkKey())
    .update(`${action}:${studentId}`)
    .digest()
    .subarray(0, SIGNATURE_BYTES);
}

export function qotdEmailLinkToken(
  action: QotdEmailLinkAction,
  studentId: string,
): string {
  return `${studentId}.${signature(action, studentId).toString("base64url")}`;
}

const tokenShape = z
  .string()
  .max(128)
  .regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);

/** The student id a valid token names, or null for anything malformed or tampered. */
export function verifyQotdEmailLinkToken(
  action: QotdEmailLinkAction,
  token: unknown,
): string | null {
  const parsed = tokenShape.safeParse(token);
  if (!parsed.success) return null;
  const [studentId, sig] = parsed.data.split(".");
  if (studentId === undefined || sig === undefined) return null;
  if (!z.string().uuid().safeParse(studentId).success) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = signature(action, studentId);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? studentId : null;
}

/** The guardian digest's one-click unsubscribe URL, or null when the site URL is not configured. */
export function guardianDigestUnsubscribeUrl(
  siteUrl: string,
  guardianId: string,
): string | null {
  if (!siteUrl) return null;
  const t = encodeURIComponent(
    qotdEmailLinkToken("guardian_digest_unsubscribe", guardianId),
  );
  return `${siteUrl}/api/public/guardian-digest-email/unsubscribe?t=${t}`;
}

/** The public URL for a link action, or null when the site URL is not configured. */
export function qotdEmailLinkUrl(
  siteUrl: string,
  action: "unsubscribe" | "resume",
  studentId: string,
): string | null {
  if (!siteUrl) return null;
  const t = encodeURIComponent(qotdEmailLinkToken(action, studentId));
  return `${siteUrl}/api/public/qotd-email/${action}?t=${t}`;
}
