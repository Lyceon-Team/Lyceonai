/**
 * @spec [Doc-01_V8 §40.2.1 Phase 4 (confirmation email carrying the 7-day recovery link);
 *        owner ruling R8 2026-09-03 — carries a credential, so it is a direct send at token
 *        generation and never an event payload; contracts/notifications.contract.md §0.4]
 *        | @implemented [2026-09-03]
 *
 * plain English: the email a user receives when they schedule account deletion. It carries the
 * raw recovery token inside the restore link, which is why it cannot be a notification event:
 * event payloads persist and become recipient-readable. The token exists only in this render,
 * in the request that produced it, and in the recipient's inbox. Every value is escaped.
 */
import { escapeHtml, type EmailRender } from "./shared";

export function deletionScheduledEmail(input: {
  recoverUrl: string;
  scheduledHardDeleteAt: string;
}): EmailRender {
  const when = new Date(input.scheduledHardDeleteAt);
  const whenLabel = Number.isNaN(when.getTime())
    ? input.scheduledHardDeleteAt
    : when.toUTCString();
  const safeWhen = escapeHtml(whenLabel);
  const safeUrl = escapeHtml(input.recoverUrl);

  const subject = "Your Lyceon account is scheduled for deletion";
  const text = [
    `Your Lyceon account is scheduled for permanent deletion on ${whenLabel} (7 days from your request).`,
    "",
    "Lyceon tracks your learning progress over time. Once your account is deleted, that history is gone permanently, and returning means starting over with a new account.",
    `If you have a paid subscription, your paid access ends and you will not be charged again after ${whenLabel}.`,
    "",
    `If you didn't request this or change your mind, restore your account before ${whenLabel}:`,
    input.recoverUrl,
    "",
    "This link stops working once deletion completes.",
  ].join("\n");
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p>Your Lyceon account is scheduled for permanent deletion on <strong>${safeWhen}</strong> (7 days from your request).</p>`,
    "<p>Lyceon tracks your learning progress over time. Once your account is deleted, that history is gone permanently, and returning means starting over with a new account.</p>",
    `<p>If you have a paid subscription, your paid access ends and you will not be charged again after <strong>${safeWhen}</strong>.</p>`,
    `<p>If you didn't request this or change your mind, restore your account before <strong>${safeWhen}</strong>:</p>`,
    `<p><a href="${safeUrl}">Restore my account</a></p>`,
    '<p style="color:#555;font-size:0.9em">This link stops working once deletion completes.</p>',
    "</body></html>",
  ].join("");

  return { subject, html, text };
}
