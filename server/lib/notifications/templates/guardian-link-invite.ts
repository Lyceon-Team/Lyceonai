/**
 * @spec [Doc-01_V8 §38.1 aggregate-only guardian visibility (applies before the link exists),
 *        §36.1/SCL-080 (the code is the credential); contracts/notifications.contract.md
 *        §0.4, §8.2, §12.3] | @implemented [2026-09-15]
 *
 * plain English: the guardian INVITE email. Addressed to someone who may have no relationship
 * with Lyceon yet, so it (a) names the student by display name, (b) states plainly what a
 * guardian can and cannot see, (c) carries the code and a link to the redeem page with the
 * code prefilled — and nothing else: no scores, no activity, no session detail — and (d) says
 * how to ignore it. Redeeming still requires signing in; the email never says otherwise.
 * Every interpolated value is HTML-escaped. No tracking pixel, no per-message tracking option.
 */
import { escapeHtml, type EmailRender } from "./shared";

export type GuardianLinkInviteInput = {
  studentDisplayName: string;
  code: string;
  redeemUrl: string;
  /** ISO timestamp; rendered as a UTC date-time so the reader knows the code is time-limited. */
  expiresAt: string;
};

function studentName(input: GuardianLinkInviteInput): string {
  const trimmed = input.studentDisplayName.trim();
  return trimmed.length > 0 ? trimmed : "A Lyceon student";
}

export function guardianLinkInviteEmail(
  input: GuardianLinkInviteInput,
): EmailRender {
  const name = studentName(input);
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(input.code);
  const safeUrl = escapeHtml(input.redeemUrl);
  const expires = new Date(input.expiresAt);
  const expiresText = Number.isNaN(expires.getTime())
    ? "soon"
    : expires.toUTCString();

  const subject = `${name} invited you to follow their SAT prep on Lyceon`;

  const canSee =
    "As a guardian you can see their progress summary: overall and skill-level mastery and activity trends.";
  const cannotSee =
    "You cannot see individual questions, their answers, their tutor conversations, or session details.";
  const howTo =
    "To connect, sign in to Lyceon (or create a guardian account) and enter this code on your guardian dashboard:";
  const ignore =
    "If you weren't expecting this, you can ignore this email. Nothing happens unless you sign in to Lyceon and enter the code, and the code stops working on its own.";

  const text = [
    `${name} invited you to follow their SAT prep on Lyceon.`,
    "",
    canSee,
    cannotSee,
    "",
    howTo,
    "",
    `    ${input.code}`,
    "",
    `Or open this link, which fills the code in for you (you will still be asked to sign in): ${input.redeemUrl}`,
    "",
    `This code expires ${expiresText}.`,
    "",
    ignore,
  ].join("\n");

  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p><strong>${safeName}</strong> invited you to follow their SAT prep on Lyceon.</p>`,
    `<p>${canSee}<br>${cannotSee}</p>`,
    `<p>${howTo}</p>`,
    `<p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.6em;letter-spacing:0.3em">${safeCode}</p>`,
    `<p><a href="${safeUrl}">Open Lyceon with the code filled in</a> (you will still be asked to sign in).</p>`,
    `<p>This code expires ${escapeHtml(expiresText)}.</p>`,
    `<p style="color:#555;font-size:0.9em">${ignore}</p>`,
    "</body></html>",
  ].join("");

  return { subject, html, text };
}
