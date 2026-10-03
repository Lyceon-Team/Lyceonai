/**
 * UI-52: Review (/review), free and paid, the past-session list opened, and its click path.
 *
 * @spec [student-UI register §6 Wave 5 UI-52 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); design/DESIGN.md §4 Review;
 *        OQ-4 (390px, light and dark); OQ-24 (no past-session count)] | @implemented [2026-10-03]
 *
 * plain English: Review as each persona sees it, paired with Review.dc.html in the same plan;
 * the page with "Past sessions" opened, paired with the canvas clicked open the same way; and the
 * main click path: Start reviewing, which must land in the review runner (`expectPath`). The
 * group asks for the review-history seed (more practice sessions with misses and an open review
 * session, all through the real routes), so the queue, the domain chips and the past-session
 * list are non-empty and the list runs past five rows.
 */
import type { PageGroup, Step } from "./types";

const REVIEW = {
  desktop: '[data-testid="review-session-picker"]',
  mobile: '[data-testid="review-session-picker"]',
} as const;

function both(selector: string): Step {
  return { click: { desktop: selector, mobile: selector } };
}

const OPEN_PAST: readonly Step[] = [both('[data-testid="review-past-toggle"]')];

export const UI_52: PageGroup = {
  id: "UI-52",
  title:
    "UI-52 Review (/review): free and paid, past sessions opened, light and dark, 1440 and 390",
  seed: "review-history",
  shots: [
    {
      id: "review-free",
      title:
        "Review, free: queue card, pick up where you left off, review by topic, redo a past session (collapsed); panel: what's waiting, locked mastery",
      persona: "free",
      route: "/review",
      waitFor: REVIEW,
      prototype: {
        kind: "screen",
        file: "Review.dc.html",
        plan: "free",
        note: "Review, plan = free",
      },
    },
    {
      id: "review-paid",
      title:
        "Review, paid: queue card, pick up where you left off, review by topic, redo a past session (collapsed); panel: what's waiting, mastery rows",
      persona: "paid",
      route: "/review",
      waitFor: REVIEW,
      prototype: {
        kind: "screen",
        file: "Review.dc.html",
        plan: "paid",
        note: "Review, plan = paid",
      },
    },
    {
      id: "review-paid-full",
      title:
        "Review, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)",
      persona: "paid",
      route: "/review",
      waitFor: REVIEW,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Review.dc.html",
        plan: "paid",
        note: "Review, plan = paid (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "review-free-full",
      title:
        "Review, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)",
      persona: "free",
      route: "/review",
      waitFor: REVIEW,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Review.dc.html",
        plan: "free",
        note: "Review, plan = free (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "review-paid-past-open",
      title:
        "Review, paid, 'Past sessions' opened: grouped by day, five rows, then Load more (no count, OQ-24); full page",
      persona: "paid",
      route: "/review",
      waitFor: REVIEW,
      steps: OPEN_PAST,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Review.dc.html",
        plan: "paid",
        steps: ['button[aria-controls="past-list"]'],
        note: "Review, plan = paid, 'Past sessions' clicked open on the canvas",
      },
    },
    {
      id: "review-free-past-open",
      title:
        "Review, free, 'Past sessions' opened (free has full review, SCL-110); full page",
      persona: "free",
      route: "/review",
      waitFor: REVIEW,
      steps: OPEN_PAST,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Review.dc.html",
        plan: "free",
        steps: ['button[aria-controls="past-list"]'],
        note: "Review, plan = free, 'Past sessions' clicked open on the canvas",
      },
    },
    {
      id: "click-paid-start",
      title: "Click path (paid): Start reviewing lands in the review runner",
      persona: "paid",
      route: "/review",
      waitFor: REVIEW,
      steps: [both('[data-testid="button-start-queue"]')],
      expectPath: "^/review/session/[0-9a-f-]{36}$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (the runner), proven by its pathname.",
      },
    },
  ],
};
