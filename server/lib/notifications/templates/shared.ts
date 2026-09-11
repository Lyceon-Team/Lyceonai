/**
 * @spec [contracts/notifications.contract.md §8; Doc-01A_V1.0 §14] | @implemented [2026-09-03]
 *
 * plain English: the render shapes every template returns and the one HTML escaper they
 * share. `recipientIsSubject` is how a template knows which party it is speaking to without
 * a role lookup: the message row names the recipient, the event names the subject.
 */

export type RenderContext = {
  /** true when the message's recipient is the event's subject profile (e.g. the student). */
  recipientIsSubject: boolean;
  /** PUBLIC_SITE_URL without a trailing slash, or "" when unset (links are then omitted). */
  siteUrl: string;
};

export type InAppRender = {
  title: string;
  body: string;
  /** App-relative path the feed item opens, or null. */
  href: string | null;
};

export type EmailRender = {
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
