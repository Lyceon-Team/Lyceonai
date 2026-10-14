/**
 * @spec [contracts/notifications.contract.md §8; Doc-01A_V1.0 §14] | @implemented [2026-09-03]
 *
 * plain English: the render shapes every template returns and the one HTML escaper they
 * share. `recipientIsSubject` is how a template knows which party it is speaking to without
 * a role lookup: the message row names the recipient, the event names the subject.
 */

import type { EmailSenderCategory } from "../../../../packages/shared/src/email-sender";

export type RenderContext = {
  /** true when the message's recipient is the event's subject profile (e.g. the student). */
  recipientIsSubject: boolean;
  /** PUBLIC_SITE_URL without a trailing slash, or "" when unset (links are then omitted). */
  siteUrl: string;
  /**
   * `qotd_daily` email only: what the dispatcher looked up at send time — the day's stem (never
   * stored in the payload) and the recipient's signed unsubscribe / resume links. Absent for
   * every other type and for in-app renders.
   */
  qotdEmail?: {
    stem: string | null;
    /**
     * The day's question metadata for the subject and preview line (Karl, 2026-10-14): section
     * code, domain and difficulty only — never options, answer or explanation. Null when the
     * day has no question (the email does not render then) or on the paused notice.
     */
    meta: { section: string; domain: string; difficulty: number | null } | null;
    unsubscribeUrl: string | null;
    resumeUrl: string | null;
  };
  /**
   * `guardian_daily_digest` email only (Karl's ruling 5 on #1223, 2026-10-13): the recipient's
   * signed one-click unsubscribe link, built by the dispatcher at send time and never stored.
   */
  guardianDigestEmail?: {
    unsubscribeUrl: string | null;
  };
};

export type InAppRender = {
  title: string;
  body: string;
  /** App-relative path the feed item opens, or null. */
  href: string | null;
};

export type EmailRender = {
  subject: string;
  /**
   * The inbox preview line (Karl, 2026-10-14): carried in `html` as its first, hidden text by
   * `withPreheader`, and returned here so a test can read it without parsing HTML.
   */
  preview: string;
  /** Which sender name it goes out under; chosen per email, by recipient (Karl, 2026-10-14). */
  fromCategory: EmailSenderCategory;
  html: string;
  text: string;
  /** Extra headers (List-Unsubscribe on an opt-in email). Absent on transactional emails. */
  headers?: Record<string, string>;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @spec [owner brief "Notification emails — sender name per email type" (Karl, 2026-10-14) §2-3]
 * | @implemented [2026-10-14]
 * plain English: the preview line an inbox shows under the subject. Inserted as the first child
 * of <body>, hidden (the standard preheader: display:none plus zero size, colour and opacity for
 * clients that ignore display:none), followed by a short run of zero-width spacers so the inbox
 * does not run on into the body text after it. Escaped like every other interpolated value.
 * A body with no <body> tag gets the preheader at the very start.
 */
const PREHEADER_SPACER = "&#847;&zwnj;&nbsp;".repeat(30);

export function preheaderHtml(preview: string): string {
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:transparent">${escapeHtml(preview)}${PREHEADER_SPACER}</div>`;
}

export function withPreheader(html: string, preview: string): string {
  const body = /<body[^>]*>/i.exec(html);
  if (body === null) return preheaderHtml(preview) + html;
  const at = body.index + body[0].length;
  return html.slice(0, at) + preheaderHtml(preview) + html.slice(at);
}

/**
 * The one way a template builds its EmailRender: it names the subject, preview line and sender
 * category, and the preview goes into the HTML here, so no template can declare a preview the
 * inbox never shows.
 */
export function emailRender(parts: {
  subject: string;
  preview: string;
  fromCategory: EmailSenderCategory;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): EmailRender {
  return {
    subject: parts.subject,
    preview: parts.preview,
    fromCategory: parts.fromCategory,
    html: withPreheader(parts.html, parts.preview),
    text: parts.text,
    ...(parts.headers === undefined ? {} : { headers: parts.headers }),
  };
}
