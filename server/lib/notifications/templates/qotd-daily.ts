/**
 * The daily-question email and the one "paused" email.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09), "Daily email": subject
 *       "Day N 🔥 Your question is ready" (or "Your question is ready" at 0); body the question's
 *       first line, an "Answer now" button to /dashboard#qotd, an unsubscribe link and the Lyceon
 *       footer; no choices or answers; the sunset's "We've paused your daily question" email with
 *       a resume link; contracts/notifications.contract.md §12 (no tracking)] | @implemented [2026-10-09]
 *
 * plain English: plain functions returning strings, like every other template here. Every
 * interpolated value is HTML-escaped. The question's first line is the stem's first line only
 * (never the passage, never an option), cut at 160 characters. No tracking pixel, no tags.
 */
import { qotdEmailSubject } from "../../../../packages/shared/src/home-qotd-schema";
import type { QotdDailyPayload } from "../../../../packages/shared/src/notifications-schema";
import { err, ok, type Result } from "../../../../packages/shared/src/result";
import {
  escapeHtml,
  type EmailRender,
  type InAppRender,
  type RenderContext,
} from "./shared";

export const QOTD_PAUSED_SUBJECT = "We've paused your daily question";

const FIRST_LINE_MAX = 160;

/** The stem's first non-empty line, plain text, at most 160 characters. */
export function qotdFirstLine(stem: string): string {
  const line =
    stem
      .replace(/<[^>]*>/g, " ")
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => l.length > 0) ?? "";
  return line.length > FIRST_LINE_MAX
    ? `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…`
    : line;
}

const BODY_OPEN =
  '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">';

function footerHtml(unsubscribeUrl: string | null): string {
  const unsub = unsubscribeUrl
    ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#555">Unsubscribe from daily questions</a><br>`
    : "";
  return `<p style="color:#555;font-size:0.85em;margin-top:32px">${unsub}You're getting this because you asked for a daily question on Lyceon.<br>Lyceon · SAT practice</p>`;
}

function footerText(unsubscribeUrl: string | null): string[] {
  return [
    "",
    "—",
    unsubscribeUrl ? `Unsubscribe from daily questions: ${unsubscribeUrl}` : "",
    "You're getting this because you asked for a daily question on Lyceon.",
    "Lyceon · SAT practice",
  ].filter((l, i) => i < 2 || l.length > 0);
}

export function qotdDailyEmail(input: {
  currentStreak: number;
  stem: string;
  siteUrl: string;
  unsubscribeUrl: string | null;
}): EmailRender {
  const subject = qotdEmailSubject(input.currentStreak);
  const firstLine = qotdFirstLine(input.stem);
  const answerUrl = input.siteUrl ? `${input.siteUrl}/dashboard#qotd` : null;
  const text = [
    "Today's question:",
    firstLine,
    "",
    answerUrl ? `Answer now: ${answerUrl}` : "Open Lyceon to answer it.",
    ...footerText(input.unsubscribeUrl),
  ].join("\n");
  const html = [
    BODY_OPEN,
    '<p style="margin:0 0 8px;color:#555">Today\'s question</p>',
    `<p style="font-size:1.1em;margin:0 0 24px">${escapeHtml(firstLine)}</p>`,
    answerUrl
      ? `<p><a href="${escapeHtml(answerUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Answer now</a></p>`
      : "<p>Open Lyceon to answer it.</p>",
    footerHtml(input.unsubscribeUrl),
    "</body></html>",
  ].join("");
  return { subject, html, text };
}

export function qotdPausedEmail(input: {
  resumeUrl: string | null;
  unsubscribeUrl: string | null;
}): EmailRender {
  const body =
    "You haven't opened the daily question in a while, so we've stopped sending it.";
  const text = [
    body,
    "",
    input.resumeUrl
      ? `Want it back? Resume: ${input.resumeUrl}`
      : "Want it back? You can turn it on again in Lyceon.",
    ...footerText(input.unsubscribeUrl),
  ].join("\n");
  const html = [
    BODY_OPEN,
    `<p>${escapeHtml(body)}</p>`,
    input.resumeUrl
      ? `<p><a href="${escapeHtml(input.resumeUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Resume daily questions</a></p>`
      : "<p>Want it back? You can turn it on again in Lyceon.</p>",
    footerHtml(input.unsubscribeUrl),
    "</body></html>",
  ].join("");
  return { subject: QOTD_PAUSED_SUBJECT, html, text };
}

/**
 * The `qotd_daily` notification (owner ruling on #1166, item 1).
 *
 * In-app: a short nudge to Home, with no question content. Email: the daily question email, or on
 * the sunset day the one "paused" email, plus RFC 8058 one-click List-Unsubscribe headers when a
 * signed unsubscribe link exists. A daily email whose stem the dispatcher could not read does not
 * render (the send is recorded as failed and retried by the dispatcher's own rules).
 */
export function qotdDailyInApp(payload: QotdDailyPayload): InAppRender {
  return {
    title: "Your question is ready",
    body:
      payload.current_streak > 0
        ? `Day ${payload.current_streak} 🔥 Answer today's question on Home.`
        : "Today's question is waiting on Home.",
    href: "/dashboard#qotd",
  };
}

export function qotdDailyNotificationEmail(
  payload: QotdDailyPayload,
  ctx: RenderContext,
): Result<EmailRender, string> {
  const extras = ctx.qotdEmail;
  if (!extras)
    return err("qotd_daily email rendered without its send-time lookup");
  const unsubscribeUrl = extras.unsubscribeUrl;
  const headers: Record<string, string> | undefined = unsubscribeUrl
    ? {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : undefined;
  if (payload.email_variant === "paused_notice") {
    const rendered = qotdPausedEmail({
      resumeUrl: extras.resumeUrl,
      unsubscribeUrl,
    });
    return ok(headers ? { ...rendered, headers } : rendered);
  }
  if (extras.stem === null) {
    return err("qotd_daily: no question is scheduled for the payload's day");
  }
  const rendered = qotdDailyEmail({
    currentStreak: payload.current_streak,
    stem: extras.stem,
    siteUrl: ctx.siteUrl,
    unsubscribeUrl,
  });
  return ok(headers ? { ...rendered, headers } : rendered);
}
