/**
 * @spec [Doc-01_V8 §37.2 Consent request flow (steps 1–3: request created, email sent with
 *        unique token); owner ruling R7 2026-09-03 — the consent request is a direct send, not
 *        a notification event; contracts/notifications.contract.md §0.4] | @implemented [2026-09-03]
 *
 * plain English: the email a guardian receives when a student under 13 names them. The
 * recipient has no account by definition, so this never goes through notification_events
 * (which addresses profiles); it is sent directly through the one Resend transport at the
 * request site, keyed by the guardian_consent_requests row id. The link carries the request
 * id, which is the durable record a resend replays from. Every interpolated value is escaped.
 */
import { escapeHtml, type EmailRender } from "./shared";

export function guardianConsentRequestEmail(input: {
  studentDisplayName: string;
  verificationUrl: string;
}): EmailRender {
  const name = input.studentDisplayName.trim() || "A student";
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(input.verificationUrl);

  const subject = `Guardian consent required for ${name} on Lyceon`;
  const text = [
    `${name} has entered profile details on Lyceon and named you as their guardian.`,
    "",
    "Lyceon needs verified guardian consent before a student under 13 can continue.",
    `Review and give consent here: ${input.verificationUrl}`,
    "",
    "This link expires in 14 days. If you did not expect this, you can ignore this email.",
  ].join("\n");
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p><strong>${safeName}</strong> has entered profile details on Lyceon and named you as their guardian.</p>`,
    "<p>Lyceon needs verified guardian consent before a student under 13 can continue.</p>",
    `<p><a href="${safeUrl}">Review and give consent</a></p>`,
    '<p style="color:#555;font-size:0.9em">This link expires in 14 days. If you did not expect this, you can ignore this email.</p>',
    "</body></html>",
  ].join("");

  return { subject, html, text };
}
