/**
 * @spec [owner rulings 2026-11-21 (counsel-approved) 3 (the new direct sends "Your teen joined.
 *        Pro is on." and "Payment didn't go through", which links to today's checkout for that
 *        student; the already-funded case: no charge, the guardian is emailed); SCL-286;
 *        contracts/notifications.contract.md §0.4 (direct sends), §12.3; Billing Terms v4 §2.1]
 *        | @implemented [2026-11-22]
 *
 * plain English: the three emails a guardian may get when the teen they invited joins and a card
 * was saved on the invite. Each states one fact and, where something is left to do, one link.
 * Transactional: no tracking and no marketing. Nothing about the teen is interpolated (no name,
 * no address); the only interpolated value is the checkout link, which is escaped.
 */
import { emailRender, escapeHtml, type EmailRender } from "./shared";

const OPEN =
  '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">';
const CLOSE = "</body></html>";

/** The card was charged and the subscription started. */
export function guardianInviteChargedEmail(): EmailRender {
  const subject = "Your teen joined. Pro is on.";
  const lines = [
    "Your teen joined Lyceon through your invite, and you're now connected.",
    "",
    "We charged the card you saved, and Pro is on for your teen. Your subscription renews until you cancel, counted from today's charge. Stripe sends the receipt.",
    "",
    "You can see your teen's progress, and manage or cancel the subscription, from your Lyceon account.",
  ];
  return emailRender({
    subject,
    preview: "We charged the card you saved, and Pro is on for your teen.",
    fromCategory: "general",
    html: [
      OPEN,
      "<p>Your teen joined Lyceon through your invite, and you&rsquo;re now connected.</p>",
      "<p>We charged the card you saved, and <strong>Pro is on</strong> for your teen. Your subscription renews until you cancel, counted from today&rsquo;s charge. Stripe sends the receipt.</p>",
      '<p style="color:#555;font-size:0.9em">You can see your teen&rsquo;s progress, and manage or cancel the subscription, from your Lyceon account.</p>',
      CLOSE,
    ].join(""),
    text: lines.join("\n"),
  });
}

/**
 * The card was not charged: declined, the bank asked to confirm, or we could not charge it.
 * Nothing was charged and no subscription started; the connection stands. One link: today's
 * checkout for this student.
 */
export function guardianInviteChargeFailedEmail(input: {
  readonly checkoutUrl: string;
}): EmailRender {
  const subject = "Payment didn't go through";
  const safeUrl = escapeHtml(input.checkoutUrl);
  const lines = [
    "Your teen joined Lyceon through your invite, and you're now connected.",
    "",
    "We couldn't charge the card you saved, so nothing was charged and Pro has not started. This can happen when a card is declined or the bank asks you to confirm the payment.",
    "",
    "To turn Pro on for your teen, choose a plan and pay here:",
    input.checkoutUrl,
  ];
  return emailRender({
    subject,
    preview: "Nothing was charged. Choose a plan to turn Pro on for your teen.",
    fromCategory: "general",
    html: [
      OPEN,
      "<p>Your teen joined Lyceon through your invite, and you&rsquo;re now connected.</p>",
      "<p>We couldn&rsquo;t charge the card you saved, so nothing was charged and Pro has not started. This can happen when a card is declined or the bank asks you to confirm the payment.</p>",
      `<p><a href="${safeUrl}">Choose a plan and pay</a></p>`,
      CLOSE,
    ].join(""),
    text: lines.join("\n"),
  });
}

/** The teen was already covered by a subscription, so the saved card was not charged. */
export function guardianInviteAlreadyFundedEmail(): EmailRender {
  const subject = "Your teen joined. No charge was needed.";
  const lines = [
    "Your teen joined Lyceon through your invite, and you're now connected.",
    "",
    "Your teen already has Pro through an existing subscription, so we did not charge the card you saved. Nothing else is needed.",
  ];
  return emailRender({
    subject,
    preview:
      "Your teen already has Pro, so the card you saved was not charged.",
    fromCategory: "general",
    html: [
      OPEN,
      "<p>Your teen joined Lyceon through your invite, and you&rsquo;re now connected.</p>",
      "<p>Your teen already has Pro through an existing subscription, so we did not charge the card you saved. Nothing else is needed.</p>",
      CLOSE,
    ].join(""),
    text: lines.join("\n"),
  });
}
