/**
 * @spec [contracts/notifications.contract.md §2.3, §8; Doc-01_V8 §36.1 step 6 "Both parties
 *        notified", §38.1/§38.2 aggregate-only guardian visibility] | @implemented [2026-09-03]
 *
 * plain English: the `guardian_linked` renderings — one in-app line per party and one email
 * for the guardian. Plain functions returning strings; no template engine. The payload is
 * `{ link_id, student_display_name }` and nothing else, so the most a guardian can learn from
 * this message is the name they already knew when they typed the code. Every interpolated
 * value is HTML-escaped. There is no tracking pixel and no per-message tracking option.
 */
import type { GuardianLinkedPayload } from "../../../../packages/shared/src/notifications-schema";
import {
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

function studentName(payload: GuardianLinkedPayload): string {
  const trimmed = payload.student_display_name.trim();
  return trimmed.length > 0 ? trimmed : "your student";
}

export function guardianLinkedInApp(
  payload: GuardianLinkedPayload,
  ctx: RenderContext,
): InAppRender {
  if (ctx.recipientIsSubject) {
    // The student. They shared the code; this confirms who can now see their summary.
    return {
      title: "A guardian is now linked to your account",
      body: "They can see your progress summary. You can remove a guardian from your profile settings at any time.",
      href: "/profile?tab=settings",
    };
  }
  return {
    title: `You're now linked to ${studentName(payload)}`,
    body: "Their progress summary is available on your guardian dashboard.",
    href: "/guardian",
  };
}

export function guardianLinkedEmail(
  payload: GuardianLinkedPayload,
  ctx: RenderContext,
): EmailRender {
  const name = studentName(payload);
  const safeName = escapeHtml(name);
  const dashboardUrl = ctx.siteUrl ? `${ctx.siteUrl}/guardian` : null;
  const safeUrl = dashboardUrl ? escapeHtml(dashboardUrl) : null;

  const subject = `You're now linked to ${name} on Lyceon`;
  const text = [
    `You're now linked to ${name} on Lyceon.`,
    "",
    "Their progress summary is available on your guardian dashboard.",
    dashboardUrl
      ? `Open your dashboard: ${dashboardUrl}`
      : "Open Lyceon and go to your guardian dashboard.",
    "",
    "If you did not enter a link code, you can remove this link from your dashboard.",
  ].join("\n");
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p>You're now linked to <strong>${safeName}</strong> on Lyceon.</p>`,
    "<p>Their progress summary is available on your guardian dashboard.</p>",
    safeUrl
      ? `<p><a href="${safeUrl}">Open your guardian dashboard</a></p>`
      : "<p>Open Lyceon and go to your guardian dashboard.</p>",
    '<p style="color:#555;font-size:0.9em">If you did not enter a link code, you can remove this link from your dashboard.</p>',
    "</body></html>",
  ].join("");

  return { subject, html, text };
}
