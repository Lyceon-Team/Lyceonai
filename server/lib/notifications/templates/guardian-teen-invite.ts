/**
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 2, 7; SCL-281;
 *        contracts/notifications.contract.md §0.4 (a direct send: the teen may have no profile
 *        yet), §12.3; Privacy Policy v6 §5.1 (what a linked guardian can see)]
 *        | @implemented [2026-11-22]
 *
 * plain English: the invite a guardian sends their teen. It says who it is from (the
 * guardian's first name), what that guardian will see once the teen joins and what they will
 * not (the same words as the /join page, from Privacy Policy v6 §5.1), carries the /join link
 * and when it stops working, and how to ignore it. Transactional: no tracking, no marketing,
 * no price. Every interpolated value is HTML-escaped.
 */
import { joinConsentLine } from "../../../../packages/shared/src/guardian-invite-schema";
import { emailRender, escapeHtml, type EmailRender } from "./shared";

type GuardianTeenInviteInput = {
  guardianFirstName: string;
  joinUrl: string;
  /** ISO timestamp; rendered as a UTC date-time. */
  expiresAt: string;
};

function inviterName(input: GuardianTeenInviteInput): string {
  const trimmed = input.guardianFirstName.trim();
  return trimmed.length > 0 ? trimmed : "Your parent";
}

export function guardianTeenInviteEmail(
  input: GuardianTeenInviteInput,
): EmailRender {
  const name = inviterName(input);
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(input.joinUrl);
  const expires = new Date(input.expiresAt);
  const expiresText = Number.isNaN(expires.getTime())
    ? "in 14 days"
    : expires.toUTCString();

  const subject = `${name} invited you to Lyceon for SAT prep`;
  const what = `${name} would like to connect with your SAT prep on Lyceon.`;
  const visibility = joinConsentLine(name);
  const how =
    "Open the link to sign up as a student, or sign in if you already use Lyceon:";
  const ignore =
    "If you weren't expecting this, you can ignore this email. Nothing happens unless you open the link and choose to join.";

  const text = [
    what,
    "",
    visibility,
    "",
    how,
    input.joinUrl,
    "",
    `This link stops working ${expiresText}.`,
    "",
    ignore,
  ].join("\n");

  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p><strong>${safeName}</strong> would like to connect with your SAT prep on Lyceon.</p>`,
    `<p>${escapeHtml(visibility)}</p>`,
    `<p>${how}</p>`,
    `<p><a href="${safeUrl}">Join Lyceon</a></p>`,
    `<p>This link stops working ${escapeHtml(expiresText)}.</p>`,
    `<p style="color:#555;font-size:0.9em">${ignore}</p>`,
    "</body></html>",
  ].join("");

  return emailRender({
    subject,
    preview: `${name} invited you to Lyceon. Open the link to join.`,
    fromCategory: "general",
    html,
    text,
  });
}
