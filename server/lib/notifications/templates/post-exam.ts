/**
 * @spec [Doc-01_V8 §36.4 (the payer decides), §12.2 privacy on a minor's surface;
 *        contracts/notifications.contract.md §2.3, §8.1; SCL-191]
 * | @implemented [2026-09-30]
 *
 * plain English: the two post-exam renderings — "how did it go, and are you retaking?" to the
 * student, and "shall we keep charging you?" to whoever is paying. Expected outcome: a student
 * who has their scores knows we want them, and a payer knows what happens if nobody answers.
 *
 * THE SECOND ONE SAYS WHAT SILENCE DOES, and that is the part that matters. A renewal notice
 * that does not state the consequence of ignoring it turns a protection into a trap: the
 * subscription ends at the end of the paid period if nobody replies, so the message says so in
 * its first two sentences. That is also the honest framing of the flow — this exists so nobody
 * is charged months after they stopped studying, not so we can catch people out.
 *
 * NO AMOUNT, NO PRICE, NO RENEWAL DATE BEYOND THE PAYLOAD'S OWN OCCASION. Billing email —
 * receipts, dunning, upcoming-invoice notices — is Stripe's lane, not this one (contract §0). A
 * figure here would be a second source for a number Stripe owns, and one this template could not
 * keep current.
 *
 * NO SCORE IN EITHER TEMPLATE, because none is in the payload and none should be: a reported SAT
 * result is the student's own, and it has no business in a persisted notification row.
 *
 * trade-offs: the date is rendered from the payload's own date string through
 * `renderNoticeDate`, the calendar notices' formatter, reused rather than re-implemented — it
 * parses a plain calendar date with no zone in the way, which is the whole reason it exists. The
 * date is ALREADY the student's local date, computed in their own zone by
 * `exam_score_renewal_candidates`.
 *
 * edge cases: no link when `PUBLIC_SITE_URL` is unset, the same rule every other template
 * follows. Every interpolated value is escaped although both are server-derived.
 */
import type { PostExamNoticePayload } from "../../../../packages/shared/src/notifications-schema";
import { renderNoticeDate } from "./full-length";
import {
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

const SCORE_REPORT_HREF = "/score-report";

function shell(lines: readonly string[]): string {
  return [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    ...lines,
    '<p style="color:#555;font-size:0.9em">You are getting this because you have a Lyceon subscription.</p>',
    "</body></html>",
  ].join("");
}

function joinText(lines: readonly string[]): string {
  return lines
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

// ── exam_score_report_requested — to the student ────────────────────────────

export function examScoreReportRequestedInApp(
  payload: PostExamNoticePayload,
  _ctx: RenderContext,
): InAppRender {
  return {
    title: "How did your SAT go?",
    body: `Your scores from ${renderNoticeDate(payload.occasion_key)} should be out. Tell us what you got, and whether you're taking it again.`,
    href: SCORE_REPORT_HREF,
  };
}

export function examScoreReportRequestedEmail(
  payload: PostExamNoticePayload,
  ctx: RenderContext,
): EmailRender {
  const when = renderNoticeDate(payload.occasion_key);
  const safeWhen = escapeHtml(when);
  const siteUrl = ctx.siteUrl ? escapeHtml(ctx.siteUrl) : null;
  return {
    subject: "How did your SAT go?",
    text: joinText([
      `Your scores from your SAT on ${when} should be out by now.`,
      "",
      "Two things, and they take a minute:",
      "1. What did you score? It lets us check our projection against what actually happened.",
      "2. Are you taking the SAT again?",
      "",
      "If you're not taking it again, we'll stop your subscription at the end of the period you've already paid for. If we don't hear from you in two weeks, we'll do the same — we would rather stop charging you than keep going after you've finished.",
      ctx.siteUrl ? `Answer here: ${ctx.siteUrl}${SCORE_REPORT_HREF}` : "",
      "",
      "You are getting this because you have a Lyceon subscription.",
    ]),
    html: shell([
      `<p>Your scores from your SAT on <strong>${safeWhen}</strong> should be out by now.</p>`,
      "<p>Two things, and they take a minute:</p>",
      "<ol><li>What did you score? It lets us check our projection against what actually happened.</li><li>Are you taking the SAT again?</li></ol>",
      "<p>If you're not taking it again, we'll stop your subscription at the end of the period you've already paid for. If we don't hear from you in two weeks, we'll do the same — we would rather stop charging you than keep going after you've finished.</p>",
      siteUrl
        ? `<p><a href="${siteUrl}${SCORE_REPORT_HREF}">Answer here</a></p>`
        : "",
    ]),
  };
}

// ── renewal_decision_requested — to the payer ───────────────────────────────

/**
 * `recipientIsSubject` is false whenever a guardian is paying — the subject is the student and
 * the recipient is the guardian — so this is the one template in this pair that branches on it.
 * The guardian's copy names no score and no progress: Doc 01 §38.1 gives a guardian aggregates,
 * and this message is about their subscription, not about the student's results.
 */
export function renewalDecisionRequestedInApp(
  payload: PostExamNoticePayload,
  ctx: RenderContext,
): InAppRender {
  const when = renderNoticeDate(payload.occasion_key);
  return {
    title: ctx.recipientIsSubject
      ? "Are you still preparing?"
      : "Is your student still preparing?",
    body:
      payload.anchor === "exam_date"
        ? `The exam on ${when} has passed. Let us know whether to keep the subscription going — if we don't hear back, it ends at the end of the period you've paid for.`
        : `Your subscription renews on ${when}. Let us know whether to keep it going — if we don't hear back, it ends at the end of the period you've paid for.`,
    href: SCORE_REPORT_HREF,
  };
}

export function renewalDecisionRequestedEmail(
  payload: PostExamNoticePayload,
  ctx: RenderContext,
): EmailRender {
  const when = renderNoticeDate(payload.occasion_key);
  const siteUrl = ctx.siteUrl ? escapeHtml(ctx.siteUrl) : null;
  const who = ctx.recipientIsSubject ? "you" : "your student";
  const opening =
    payload.anchor === "exam_date"
      ? `The SAT on ${when} has passed.`
      : `Your Lyceon subscription renews on ${when}.`;
  const safeOpening = escapeHtml(opening);
  return {
    subject: ctx.recipientIsSubject
      ? "Keep your Lyceon subscription?"
      : "Keep your student's Lyceon subscription?",
    text: joinText([
      opening,
      "",
      `We only want to keep charging you while ${who} ${ctx.recipientIsSubject ? "are" : "is"} still preparing. So: carry on, or stop?`,
      "",
      "If you tell us to stop, the subscription ends at the end of the period you have already paid for — nothing is cut off early and nothing is refunded, because that period is yours. If we don't hear from you within two weeks, we'll do the same.",
      "",
      "You can also manage the subscription yourself in the billing portal at any time.",
      ctx.siteUrl ? `Answer here: ${ctx.siteUrl}${SCORE_REPORT_HREF}` : "",
      "",
      "You are getting this because you have a Lyceon subscription.",
    ]),
    html: shell([
      `<p>${safeOpening}</p>`,
      `<p>We only want to keep charging you while ${escapeHtml(who)} ${ctx.recipientIsSubject ? "are" : "is"} still preparing. So: carry on, or stop?</p>`,
      "<p>If you tell us to stop, the subscription ends at the end of the period you have already paid for — nothing is cut off early and nothing is refunded, because that period is yours. If we don't hear from you within two weeks, we'll do the same.</p>",
      "<p>You can also manage the subscription yourself in the billing portal at any time.</p>",
      siteUrl
        ? `<p><a href="${siteUrl}${SCORE_REPORT_HREF}">Answer here</a></p>`
        : "",
    ]),
  };
}
