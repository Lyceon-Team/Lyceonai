/**
 * @spec [SCL-271 (cancellation at every status; `past_due` ends billing now and
 *        holds access to the grace deadline); SCL-272 (payer-only self-service);
 *        contracts/notifications.contract.md §0.4 direct sends; Notice §6.3 and
 *        billing-terms §6 (billing correspondence goes to the PAYER's address);
 *        owner ruling Karl 2026-11-03] | @implemented [2026-11-03]
 *
 * plain English: the email the payer receives once a cancellation is recorded. It
 * states one fact they need — when premium access ends — and does not try to sell
 * anything back. Expected outcome: the date in this email is the same number the
 * confirmation screen showed, because both read the one value the server computed.
 *
 * WHY THERE ARE THREE SHAPES AND NOT ONE. The three cancellation branches end
 * access at genuinely different moments, and a single "your access ends on X"
 * would be false for two of them:
 *   - good standing: access runs to the end of the period already paid for;
 *   - `past_due`: billing has stopped now, and access runs to the grace deadline
 *     that was already fixed — so the email says both halves, because a customer
 *     told only "access continues" would wonder whether they still owe the money;
 *   - no access to lose (`unpaid`, `incomplete`): there is no future date, and
 *     inventing one would be the only dishonest thing this email could do.
 *
 * Nothing is interpolated but the date, and it is escaped.
 */
import { emailRender, escapeHtml, type EmailRender } from "./shared";

export type SubscriptionCanceledKind =
  | "at_period_end"
  | "past_due_scheduled"
  | "immediate";

function dateLabel(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? iso : when.toUTCString();
}

export function subscriptionCanceledEmail(input: {
  readonly kind: SubscriptionCanceledKind;
  /** The one computed moment. Null only for the no-access-to-lose branch. */
  readonly accessEndsAt: string | null;
}): EmailRender {
  const subject = "Your Lyceon subscription is cancelled";

  const lines: string[] = [];
  const htmlLines: string[] = [];

  if (input.accessEndsAt !== null && input.kind === "at_period_end") {
    const label = dateLabel(input.accessEndsAt);
    lines.push(
      "Your Lyceon subscription is cancelled. You will not be charged again.",
      "",
      `You keep full access until ${label}, the end of the period you have already paid for. After that your account moves to the free plan.`,
    );
    htmlLines.push(
      "<p>Your Lyceon subscription is cancelled. You will not be charged again.</p>",
      `<p>You keep full access until <strong>${escapeHtml(label)}</strong>, the end of the period you have already paid for. After that your account moves to the free plan.</p>`,
    );
  } else if (
    input.accessEndsAt !== null &&
    input.kind === "past_due_scheduled"
  ) {
    const label = dateLabel(input.accessEndsAt);
    lines.push(
      "Your Lyceon subscription is cancelled. Billing has stopped, nothing further will be charged, and the outstanding balance has been cleared — you do not owe anything.",
      "",
      `You keep full access until ${label}. After that your account moves to the free plan.`,
    );
    htmlLines.push(
      "<p>Your Lyceon subscription is cancelled. Billing has stopped, nothing further will be charged, and the outstanding balance has been cleared &mdash; you do not owe anything.</p>",
      `<p>You keep full access until <strong>${escapeHtml(label)}</strong>. After that your account moves to the free plan.</p>`,
    );
  } else {
    lines.push(
      "Your Lyceon subscription is cancelled. Billing has stopped, nothing further will be charged, and any outstanding balance has been cleared — you do not owe anything.",
      "",
      "Your account is on the free plan.",
    );
    htmlLines.push(
      "<p>Your Lyceon subscription is cancelled. Billing has stopped, nothing further will be charged, and any outstanding balance has been cleared &mdash; you do not owe anything.</p>",
      "<p>Your account is on the free plan.</p>",
    );
  }

  lines.push(
    "",
    "You can subscribe again at any time from your account settings.",
  );
  htmlLines.push(
    '<p style="color:#555;font-size:0.9em">You can subscribe again at any time from your account settings.</p>',
  );

  const preview =
    input.accessEndsAt === null
      ? "Your subscription is cancelled and nothing further will be charged."
      : `Your subscription is cancelled. Access continues until ${dateLabel(input.accessEndsAt)}.`;

  return emailRender({
    subject,
    preview,
    fromCategory: "general",
    html: [
      '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">',
      ...htmlLines,
      "</body></html>",
    ].join(""),
    text: lines.join("\n"),
  });
}
