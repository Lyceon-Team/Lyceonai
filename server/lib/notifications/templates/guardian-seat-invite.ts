/**
 * @spec [owner brief "Parent paid seat + teen invite" (Karl, 2026-11-19) §2.1;
 *        contracts/notifications.contract.md §0.4 (direct send to an address with no profile
 *        yet), §12.3; Doc 01 V8 §38.1 (what a guardian can see)] | @implemented [2026-11-19]
 *
 * plain English: the invite a parent sends a teen to claim the Lyceon Pro seat the parent
 * bought. It says who it is from in the parent's own words (their display name), what the
 * parent will see once the teen joins (areas and scores, not answers), carries the /join link
 * and when it stops working, and how to ignore it. Transactional: no tracking, no marketing.
 * Every interpolated value is HTML-escaped.
 */
import { emailRender, escapeHtml, type EmailRender } from "./shared";

type GuardianSeatInviteInput = {
  guardianDisplayName: string;
  joinUrl: string;
  /** ISO timestamp; rendered as a UTC date-time. */
  expiresAt: string;
};

function parentName(input: GuardianSeatInviteInput): string {
  const trimmed = input.guardianDisplayName.trim();
  return trimmed.length > 0 ? trimmed : "Your parent";
}

export function guardianSeatInviteEmail(
  input: GuardianSeatInviteInput,
): EmailRender {
  const name = parentName(input);
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(input.joinUrl);
  const expires = new Date(input.expiresAt);
  const expiresText = Number.isNaN(expires.getTime())
    ? "in 7 days"
    : expires.toUTCString();

  const subject = `${name} got you Lyceon Pro for SAT prep`;
  const what =
    "Lyceon Pro gives you full SAT practice, full-length tests and a study plan.";
  const visibility =
    "Once you join, your parent will see your progress: your areas and scores, not your answers.";
  const how =
    "Open the link to sign up as a student, or sign in if you already use Lyceon:";
  const ignore =
    "If you weren't expecting this, you can ignore this email. Nothing happens unless you open the link and join.";

  const text = [
    `${name} got you Lyceon Pro for SAT prep.`,
    "",
    what,
    visibility,
    "",
    how,
    input.joinUrl,
    "",
    `This link works once and stops working ${expiresText}.`,
    "",
    ignore,
  ].join("\n");

  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p><strong>${safeName}</strong> got you Lyceon Pro for SAT prep.</p>`,
    `<p>${what}<br>${visibility}</p>`,
    `<p>${how}</p>`,
    `<p><a href="${safeUrl}">Join Lyceon</a></p>`,
    `<p>This link works once and stops working ${escapeHtml(expiresText)}.</p>`,
    `<p style="color:#555;font-size:0.9em">${ignore}</p>`,
    "</body></html>",
  ].join("");

  return emailRender({
    subject,
    preview: "Your parent got you Lyceon Pro. Join to start practising.",
    fromCategory: "general",
    html,
    text,
  });
}
