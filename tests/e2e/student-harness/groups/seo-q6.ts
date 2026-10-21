/**
 * SEO Wave 2, plans Q5/Q6: the review prompt, the review form, the private-feedback form and the
 * Settings opt-in toggle, as the paid student sees them. Light only (owner Step 0 answer 7,
 * 2026-10-05), desktop 1440 and phone 390.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26, R28, R30, rows Q5/Q6 ("SHOT of prompt
 *       states"); owner Step 0 answers 2026-10-05] | @implemented [2026-10-05]
 *
 * plain English: nothing is faked. The ask is the REAL server's answer on Home (review ask, Karl
 * 2026-10-20): the real /api/feedback route checks the usage trigger and the Getting started
 * checklist, applies the cadence and claims the ask; `freshReviewPrompt` clears the persona's
 * prompt state and makes the persona meet the trigger in the harness database before every
 * capture, so each viewport is a first ask. Desktop shows the card below today's question; the
 * phone shows the bottom sheet. The paid student is 17 (2009-09-03), so the 13–17 wording and no
 * Trustpilot option, as for every under-18 student.
 *
 * @spec (review ask) [owner brief "Review ask" (Karl, 2026-10-20); Karl's Step 0 decision 7
 *       (placement)] | @implemented [2026-10-20]
 */
import type { PageGroup } from "./types";

const PROMPT = {
  desktop: '[data-testid="review-prompt"]',
  mobile: '[data-testid="review-prompt"]',
};
const HOME = "/dashboard";
const NO_PROTOTYPE = {
  kind: "none" as const,
  reason:
    "New SEO Wave 2 surface; no signed-off prototype. Built with the student tokens (DESIGN.md §1).",
};

export const SEO_Q6: PageGroup = {
  id: "Q6",
  title:
    "SEO Wave 2 Q5/Q6: review prompt, review form, private feedback, Settings opt-in (light, 1440 and 390)",
  seed: "exam-history",
  outRoot: "docs/plans/seo/evidence",
  shots: [
    {
      id: "prompt",
      title:
        "The review ask on Home: \"How's Lyceon working for you?\" with Leave a review, Send private feedback, Not now and a close button — a card below today's question on desktop, a bottom sheet on the phone. 13–17 wording, no Trustpilot (the student is 17).",
      persona: "paid",
      cookieChoiceMade: true,
      route: HOME,
      freshReviewPrompt: true,
      waitFor: PROMPT,
      // Home scrolls inside the App shell, not the document, so a full-page shot stops at the
      // fold; focusing "Not now" (the card's last control) scrolls the whole card into view.
      steps: [
        {
          focus: {
            desktop: '[data-testid="review-prompt-not-now"]',
            mobile: '[data-testid="review-prompt-not-now"]',
          },
        },
      ],
      themes: ["light"],
      prototype: NO_PROTOTYPE,
    },
    {
      id: "review-form",
      title:
        "Leave a review: a 1–5 rating, optional text, and the unticked 'Lyceon may quote this anonymously'",
      persona: "paid",
      cookieChoiceMade: true,
      route: HOME,
      freshReviewPrompt: true,
      waitFor: PROMPT,
      steps: [
        {
          click: {
            desktop: '[data-testid="review-prompt-leave-review"]',
            mobile: '[data-testid="review-prompt-leave-review"]',
          },
        },
        {
          click: {
            desktop: '[data-testid="review-rating-4"]',
            mobile: '[data-testid="review-rating-4"]',
          },
        },
        {
          fill: {
            desktop: '[data-testid="review-text"]',
            mobile: '[data-testid="review-text"]',
          },
          value: "The practice tests feel like the real thing.",
        },
        {
          focus: {
            desktop: '[data-testid="review-submit"]',
            mobile: '[data-testid="review-submit"]',
          },
        },
      ],
      expectVisible: '[data-testid="review-quote-permission"]',
      themes: ["light"],
      prototype: NO_PROTOTYPE,
    },
    {
      id: "feedback-form",
      title: "Private feedback, opened from Help",
      persona: "paid",
      cookieChoiceMade: true,
      route: "/help",
      waitFor: {
        desktop: '[data-testid="help-feedback"]',
        mobile: '[data-testid="help-feedback"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="feedback-open-help"]',
            mobile: '[data-testid="feedback-open-help"]',
          },
        },
        {
          fill: {
            desktop: '[data-testid="feedback-text"]',
            mobile: '[data-testid="feedback-text"]',
          },
          value: "It would help to see my weakest skills on the home page.",
        },
      ],
      expectVisible: '[data-testid="feedback-dialog"]',
      themes: ["light"],
      prototype: NO_PROTOTYPE,
    },
    {
      id: "help-feedback",
      title:
        "Help: the private-feedback box between Contact support and the Policies",
      persona: "paid",
      cookieChoiceMade: true,
      route: "/help",
      waitFor: {
        desktop: '[data-testid="help-feedback"]',
        mobile: '[data-testid="help-feedback"]',
      },
      steps: [
        {
          focus: {
            desktop: '[data-testid="feedback-open-help"]',
            mobile: '[data-testid="feedback-open-help"]',
          },
        },
      ],
      themes: ["light"],
      prototype: NO_PROTOTYPE,
    },
    {
      id: "settings-account",
      title:
        "Settings → Account: Product update emails (the opt-in toggle) and Feedback, above Delete account",
      persona: "paid",
      cookieChoiceMade: true,
      route: "/profile?tab=account",
      waitFor: {
        desktop: '[data-testid="marketing-email-card"]',
        mobile: '[data-testid="marketing-email-card"]',
      },
      // Settings scrolls inside the App shell, not the document, so a full-page shot stops at the
      // fold; focusing the Feedback row's button (below the toggle) scrolls both into view.
      steps: [
        {
          focus: {
            desktop: '[data-testid="feedback-open-settings"]',
            mobile: '[data-testid="feedback-open-settings"]',
          },
        },
      ],
      themes: ["light"],
      prototype: NO_PROTOTYPE,
    },
  ],
};
