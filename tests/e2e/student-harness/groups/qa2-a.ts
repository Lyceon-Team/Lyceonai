/**
 * QA2-A: the review cap (five open review sessions) on Home and on Review.
 *
 * @spec [owner re-test of production, Karl, 2026-10-08, item A: "Review cap (5 open sessions):
 *        show the error at the clicked button (inline or toast), never below the fold, with
 *        'Continue your open session' and 'End a session' actions. Same on Home and Review.";
 *        DESIGN.md §1 (tokens, 14px floor, one primary action, light and dark)]
 *        | @implemented [2026-10-08]
 *
 * plain English: the paid student is put at the server's own concurrent review-session cap before
 * every capture (`reviewCap`: real creates until the real route refuses one), then a review start
 * is clicked: Home's first "Review this session" row, Review's "Start reviewing", and a Redo in
 * Review's past sessions. The refusal is the server's; the shot is what the page does with it, at
 * 1440, 1024 and 390, light and dark. `expectInViewport` fails the capture unless the cap message
 * lies wholly inside the window after the click.
 */
import type { ExtraViewport, PageGroup, Step } from "./types";

const W1024: readonly ExtraViewport[] = [
  { name: "w1024", width: 1024, height: 768, selectors: "desktop" },
];

function both(selector: string): Step {
  return { click: { desktop: selector, mobile: selector } };
}

const CAP = '[data-testid="review-cap"]';

export const QA2_A: PageGroup = {
  id: "QA2-A",
  title:
    "QA2-A The review cap on Home and Review: the refusal at the clicked button, with its two actions (1440, 1024, 390; light and dark)",
  seed: "review-history",
  shots: [
    {
      id: "home-cap-recent",
      title:
        "Home, paid, at the review cap: 'Review this session' (the first recent session) pressed; the server refuses",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-recent-review"]',
        mobile: '[data-testid="home-recent-review"]',
      },
      reviewCap: true,
      steps: [both('[data-testid="home-recent-review"]')],
      expectInViewport: CAP,
      extraViewports: W1024,
      prototype: {
        kind: "none",
        reason:
          "A refusal state the prototype does not draw (owner re-test, 2026-10-08, item A).",
      },
    },
    {
      id: "review-cap-start",
      title:
        "Review, paid, at the review cap: 'Start reviewing' pressed; the server refuses",
      persona: "paid",
      route: "/review",
      waitFor: {
        desktop: '[data-testid="button-start-queue"]',
        mobile: '[data-testid="button-start-queue"]',
      },
      reviewCap: true,
      steps: [both('[data-testid="button-start-queue"]')],
      expectInViewport: CAP,
      extraViewports: W1024,
      prototype: {
        kind: "none",
        reason:
          "A refusal state the prototype does not draw (owner re-test, 2026-10-08, item A).",
      },
    },
    {
      id: "review-cap-redo",
      title:
        "Review, paid, at the review cap: 'Past sessions' opened and the first Redo pressed; the server refuses",
      persona: "paid",
      route: "/review",
      waitFor: {
        desktop: '[data-testid="review-past-toggle"]',
        mobile: '[data-testid="review-past-toggle"]',
      },
      reviewCap: true,
      steps: [
        both('[data-testid="review-past-toggle"]'),
        both('[data-testid="review-past-redo"]'),
      ],
      expectInViewport: CAP,
      extraViewports: W1024,
      prototype: {
        kind: "none",
        reason:
          "A refusal state the prototype does not draw (owner re-test, 2026-10-08, item A).",
      },
    },
  ],
};
