/**
 * @spec [contracts/notifications.contract.md §2.3, §8; Doc-01_V8 §36.3 Revocation ("either
 *        party"), §38.1/§38.2 aggregate-only guardian visibility, §12.1] | @implemented [2026-09-15]
 *
 * plain English: the `guardian_unlinked` renderings. The recipient is always the party who
 * did NOT revoke (the SQL function's `v_target`), so `recipientIsSubject` decides which side
 * is reading: the student (a guardian removed their link) or the guardian (the student
 * removed them). The payload is `{ link_id, student_display_name, guardian_display_name }`
 * and nothing else — the message says the link was removed and never why. Every interpolated
 * value is HTML-escaped. No tracking pixel, no per-message tracking option.
 */
import type { GuardianUnlinkedPayload } from "../../../../packages/shared/src/notifications-schema";
import {
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

function studentName(payload: GuardianUnlinkedPayload): string {
  const trimmed = payload.student_display_name.trim();
  return trimmed.length > 0 ? trimmed : "your student";
}

function guardianName(payload: GuardianUnlinkedPayload): string {
  const trimmed = payload.guardian_display_name.trim();
  return trimmed.length > 0 ? trimmed : "A guardian";
}

export function guardianUnlinkedInApp(
  payload: GuardianUnlinkedPayload,
  ctx: RenderContext,
): InAppRender {
  if (ctx.recipientIsSubject) {
    // The student: a guardian ended their own link.
    return {
      title: `${guardianName(payload)} is no longer linked to your account`,
      body: "They can no longer see your progress summary. You can share a new link code from your profile settings whenever you want.",
      href: "/profile?tab=settings",
    };
  }
  // The guardian: the student removed them.
  return {
    title: `Your link to ${studentName(payload)} was removed`,
    body: "You no longer have access to their progress summary. If you want to reconnect, ask them for a new link code.",
    href: "/guardian",
  };
}

export function guardianUnlinkedEmail(
  payload: GuardianUnlinkedPayload,
  ctx: RenderContext,
): EmailRender {
  const siteUrl = ctx.siteUrl ? escapeHtml(ctx.siteUrl) : null;
  const footer =
    '<p style="color:#555;font-size:0.9em">This is a notification about a change to a guardian link on Lyceon. No further action is needed.</p>';

  if (ctx.recipientIsSubject) {
    const name = guardianName(payload);
    const safeName = escapeHtml(name);
    const subject = `${name} is no longer linked to your Lyceon account`;
    const text = [
      `${name} is no longer linked to your Lyceon account.`,
      "",
      "They can no longer see your progress summary.",
      "If you want to link a guardian again, share a new link code from your profile settings.",
      ctx.siteUrl ? `Open Lyceon: ${ctx.siteUrl}/profile?tab=settings` : "",
      "",
      "This is a notification about a change to a guardian link on Lyceon. No further action is needed.",
    ]
      .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
      .join("\n");
    const html = [
      '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
      `<p><strong>${safeName}</strong> is no longer linked to your Lyceon account.</p>`,
      "<p>They can no longer see your progress summary. If you want to link a guardian again, share a new link code from your profile settings.</p>",
      siteUrl
        ? `<p><a href="${siteUrl}/profile?tab=settings">Open your profile settings</a></p>`
        : "",
      footer,
      "</body></html>",
    ].join("");
    return { subject, html, text };
  }

  const name = studentName(payload);
  const safeName = escapeHtml(name);
  const subject = `Your link to ${name} on Lyceon was removed`;
  const text = [
    `Your link to ${name} on Lyceon was removed.`,
    "",
    "You no longer have access to their progress summary.",
    "If you want to reconnect, ask them for a new link code and enter it on your guardian dashboard.",
    ctx.siteUrl ? `Open your dashboard: ${ctx.siteUrl}/guardian` : "",
    "",
    "This is a notification about a change to a guardian link on Lyceon. No further action is needed.",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p>Your link to <strong>${safeName}</strong> on Lyceon was removed.</p>`,
    "<p>You no longer have access to their progress summary. If you want to reconnect, ask them for a new link code and enter it on your guardian dashboard.</p>",
    siteUrl
      ? `<p><a href="${siteUrl}/guardian">Open your guardian dashboard</a></p>`
      : "",
    footer,
    "</body></html>",
  ].join("");
  return { subject, html, text };
}
