/**
 * Who an email says it is from: one display name per kind of email, one address for all.
 *
 * @spec [owner brief "Notification emails — sender name per email type" (Karl, 2026-10-14) §1;
 *       Karl's Step 0 rulings 2026-10-14 (the category is chosen per email, by recipient);
 *       contracts/notifications.contract.md §0.2 (transport.ts is the only Resend caller)]
 *       | @implemented [2026-10-14]
 *
 * plain English: every system email used to go out as the bare NOTIFICATION_FROM_EMAIL, so
 * inboxes showed "notifications". Each email now names a category and the transport writes
 * `<name> <NOTIFICATION_FROM_EMAIL>`. The address is the same for every category, so sending
 * reputation stays in one place; only the display name differs.
 *
 * trade-offs: the names are fixed constants, not configuration — they are part of how a student
 * recognises us, and changing one is a product decision. They are still passed through
 * `sanitizeSenderName`, so an edit that slips in a header-breaking character cannot reach a
 * `From:` line.
 *
 * edge cases: an unknown or missing category falls back to "Lyceon" rather than failing the
 * send — the wrong sub-brand on an email is a cosmetic slip, a dropped email is not.
 */
import { z } from "zod";

export const EMAIL_SENDER_CATEGORIES = [
  "qotd",
  "study_plan",
  "guardian",
  "general",
] as const;
export const emailSenderCategorySchema = z.enum(EMAIL_SENDER_CATEGORIES);
export type EmailSenderCategory = z.infer<typeof emailSenderCategorySchema>;

export const DEFAULT_EMAIL_SENDER_NAME = "Lyceon";

/** The one map of category -> display name (Karl, 2026-10-14). */
export const EMAIL_SENDER_NAMES: Readonly<Record<EmailSenderCategory, string>> =
  {
    qotd: "Lyceon Question of the Day",
    study_plan: "Lyceon Study Plan",
    guardian: "Lyceon for Parents",
    general: DEFAULT_EMAIL_SENDER_NAME,
  };

/**
 * A display name safe to put in a `From:` header unquoted: no `<`, `>`, `"`, line breaks or
 * other control characters, whitespace collapsed. Empty after cleaning -> "Lyceon".
 */
export function sanitizeSenderName(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[<>"\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : DEFAULT_EMAIL_SENDER_NAME;
}

/**
 * The display name for a category; anything unrecognised gets "Lyceon". `names` defaults to the
 * one map and exists so a test can prove a bad entry is cleaned on the way out.
 */
export function emailSenderName(
  category: unknown,
  names: Readonly<Record<EmailSenderCategory, string>> = EMAIL_SENDER_NAMES,
): string {
  const parsed = emailSenderCategorySchema.safeParse(category);
  return sanitizeSenderName(
    parsed.success ? names[parsed.data] : DEFAULT_EMAIL_SENDER_NAME,
  );
}

/** `Lyceon Study Plan <notifications@example.com>`. The address is validated upstream. */
export function formatFromHeader(category: unknown, address: string): string {
  return `${emailSenderName(category)} <${address}>`;
}
