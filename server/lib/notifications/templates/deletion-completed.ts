/**
 * @spec [Doc-01_V8 §40.5 Hard delete at T+7 (the deletion the user was told would happen on this
 *        date has happened); SCL-083 (PROPOSED — no locked document names a completion notice;
 *        this is the user-facing evidence that deletion executed); Doc-01A_V1.0 §14;
 *        contracts/notifications.contract.md §0.4 direct sends] | @implemented [2026-09-15]
 *
 * plain English: the email a person receives once their account and its data have been deleted.
 * Minimal by design — it states that the deletion happened and when. No account details, no
 * student name, no progress data, and no recovery link: recovery is not possible at this point
 * and offering it would be false. Nothing is interpolated except the date, and that is escaped.
 */
import { escapeHtml, type EmailRender } from "./shared";

export function deletionCompletedEmail(input: {
  /**
   * ISO timestamp taken by the executor when the atomic RPC returned 'completed'. Not the row's
   * own `completion_at`: that column is unreadable afterwards (the cascade deletes the row).
   */
  completedAt: string;
}): EmailRender {
  const when = new Date(input.completedAt);
  const whenLabel = Number.isNaN(when.getTime())
    ? input.completedAt
    : when.toUTCString();
  const safeWhen = escapeHtml(whenLabel);

  const subject = "Your Lyceon account has been deleted";
  const text = [
    `Your Lyceon account and the data associated with it were deleted on ${whenLabel}.`,
    "",
    "This completes the deletion you requested. The account can no longer be restored.",
    "",
    "If you want to use Lyceon again in the future, you are welcome to create a new account.",
  ].join("\n");
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
    `<p>Your Lyceon account and the data associated with it were deleted on <strong>${safeWhen}</strong>.</p>`,
    "<p>This completes the deletion you requested. The account can no longer be restored.</p>",
    '<p style="color:#555;font-size:0.9em">If you want to use Lyceon again in the future, you are welcome to create a new account.</p>',
    "</body></html>",
  ].join("");

  return { subject, html, text };
}
