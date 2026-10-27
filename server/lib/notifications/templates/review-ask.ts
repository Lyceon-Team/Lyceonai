/**
 * The one follow-up review email (`review_ask`).
 *
 * @spec [owner brief "Review ask — in-app prompt + one email, industry standard" (Karl,
 *        2026-10-20) Behaviour 3 ("one email, a few days after an unanswered in-app prompt;
 *        notification transport as 'Lyceon'; unsubscribe"); Karl's Step 0 decisions 5 (adults
 *        only; footer "You're getting this because you have a Lyceon account."; the signed
 *        one-click "Stop review requests" link), 6 (the Trustpilot link only once
 *        VITE_TRUSTPILOT_REVIEW_URL is set) and 7 (the wording approved as drafted, Doctrine rule
 *        5); FTC 16 CFR 465.7 and Trustpilot's invitation rules (one neutral invitation, no
 *        incentive, no sentiment filter); contracts/notifications.contract.md §8.1]
 *        | @implemented [2026-10-20]
 *
 * plain English: the approved draft, word for word. The same email for everyone who gets it:
 * nothing in it depends on how the person feels, and no option is held back. The Trustpilot
 * button appears when the review URL is configured (every recipient is 18+); the second button
 * opens the same ask in the app (`?review=email`), where the in-app review and private feedback
 * are. The footer carries the reason, the "Stop review requests" link (also sent as RFC 8058
 * List-Unsubscribe one-click) and the postal address. Sent as "Lyceon".
 *
 * Links are built by the dispatcher at send time (review-ask-send-context.ts), never stored.
 * No open or click tracking (contract C12.3): the links are plain.
 */
import type { ReviewAskPayload } from "../../../../packages/shared/src/notifications-schema";
import { LYCEON_POSTAL_ADDRESS } from "../../../../packages/shared/src/support-contact";
import {
  emailRender,
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

export const REVIEW_ASK_SUBJECT = "How's Lyceon working for you?";
export const REVIEW_ASK_PREVIEW = "Good or bad, we'd like to hear it.";
export const REVIEW_ASK_FOOTER =
  "You're getting this because you have a Lyceon account.";
export const REVIEW_ASK_ADDRESS = LYCEON_POSTAL_ADDRESS;

/** Where the app link lands: the person's own home, which opens the ask without counting it. */
export function reviewAskAppPath(
  audience: ReviewAskPayload["audience"],
): string {
  return audience === "guardian"
    ? "/guardian?review=email"
    : "/dashboard?review=email";
}

function greeting(firstName: string): string {
  const name = firstName.trim();
  return name.length > 0 ? `Hi ${name},` : "Hi,";
}

const BODY =
  "you've been using Lyceon for a little while. Good or bad, we'd like to hear how it's going.";

const BUTTON =
  "display:inline-block;padding:10px 18px;margin:4px 8px 4px 0;border-radius:8px;text-decoration:none;font-weight:600";

export function reviewAskInApp(payload: ReviewAskPayload): InAppRender {
  // Email only (the emitter names no in_app channel); rendered for completeness of the switch.
  return {
    title: REVIEW_ASK_SUBJECT,
    body: REVIEW_ASK_PREVIEW,
    href: reviewAskAppPath(payload.audience),
  };
}

export function reviewAskEmail(
  payload: ReviewAskPayload,
  ctx: RenderContext,
): EmailRender {
  const trustpilotUrl = ctx.reviewAskEmail?.trustpilotUrl ?? null;
  const stopUrl = ctx.reviewAskEmail?.stopUrl ?? null;
  const appUrl = ctx.siteUrl
    ? ctx.siteUrl + reviewAskAppPath(payload.audience)
    : null;

  const text = [
    `${greeting(payload.first_name)} ${BODY}`,
    "",
    ...(trustpilotUrl === null
      ? []
      : [`Leave a review on Trustpilot: ${trustpilotUrl}`]),
    ...(appUrl === null ? [] : [`Send private feedback: ${appUrl}`]),
    "",
    REVIEW_ASK_FOOTER,
    ...(stopUrl === null ? [] : [`Stop review requests: ${stopUrl}`]),
    REVIEW_ASK_ADDRESS,
  ].join("\n");

  const buttons = [
    trustpilotUrl === null
      ? ""
      : `<a href="${escapeHtml(trustpilotUrl)}" style="${BUTTON};background:#111;color:#fff">Leave a review on Trustpilot</a>`,
    appUrl === null
      ? ""
      : `<a href="${escapeHtml(appUrl)}" style="${BUTTON};border:1px solid #111;color:#111">Send private feedback</a>`,
  ].join("");
  const stop =
    stopUrl === null
      ? ""
      : ` <a href="${escapeHtml(stopUrl)}">Stop review requests</a>`;
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p>${escapeHtml(greeting(payload.first_name))} ${escapeHtml(BODY)}</p>`,
    buttons === "" ? "" : `<p>${buttons}</p>`,
    `<p style="color:#555;font-size:13px">${escapeHtml(REVIEW_ASK_FOOTER)}${stop}<br>${escapeHtml(REVIEW_ASK_ADDRESS)}</p>`,
    "</body></html>",
  ].join("");

  return emailRender({
    subject: REVIEW_ASK_SUBJECT,
    preview: REVIEW_ASK_PREVIEW,
    fromCategory: "general",
    html,
    text,
    ...(stopUrl === null
      ? {}
      : {
          headers: {
            "List-Unsubscribe": `<${stopUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
  });
}
