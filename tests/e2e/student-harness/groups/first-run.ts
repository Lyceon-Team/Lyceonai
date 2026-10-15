/**
 * First-run activation fixes: every changed screen, light and dark, 1440 and 390.
 *
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13): P0 items 1, 3 and 4 and the
 *        P1 list; DESIGN.md §5 ("every new screen is checked … with screenshots attached (light
 *        and dark, 1440 and 390)")] | @implemented [2026-10-13]
 *
 * plain English:
 *   - the practice and review session summaries, each session played to its end through the real
 *     routes before the page loads (`playThrough`), so the page opens on the server's summary;
 *   - Home (paid): today's plan rows as text links, "This week" with its ticks, the QOTD card in
 *     place; the review cap's notice with its two actions wrapping at 390;
 *   - the in-shell error screen: a page's code chunk fails twice (the automatic reload, then the
 *     screen inside the App shell with the rail or the tab bar);
 *   - the QOTD: the explanation with Done and no prompt over it; the prompt after Done;
 *   - owner rulings (Karl, 2026-10-15, on #1233): a free student's practice summary with the
 *     muted locked mastery line (item 3), and the email prompt on the next Home visit of a
 *     student who answered today and left before Done (item 2);
 *   - the sign-in card with the logo and the "Password" placeholder.
 * FIRST-RUN-ONBOARDING (the bare-pages seed): the date of birth empty, and the SAT-date picker open
 * with its helper line and Done.
 */
import type { PageGroup, Step } from "./types";

function both(selector: string): { desktop: string; mobile: string } {
  return { desktop: selector, mobile: selector };
}
function click(selector: string): Step {
  return { click: both(selector) };
}

const NEW_SCREEN = {
  kind: "none" as const,
  reason:
    "NOT PROTOTYPED: new in the first-run activation brief (Karl, 2026-10-13), built to DESIGN.md §5; these screenshots go to Karl before merge.",
};

const QOTD_CHOICE = '[data-testid="home-qotd"] [data-testid="runner-choice"]';

export const FIRST_RUN: PageGroup = {
  id: "FIRST-RUN",
  title:
    "First-run activation fixes: session summaries, Home, in-shell error screen, QOTD prompt, sign-in (light and dark, 1440 and 390)",
  seed: "review-history",
  shots: [
    {
      id: "summary-practice",
      title:
        "Practice session summary: score with skips, streak kept, sent to review, the recorded mastery change if any; Review misses (primary) and Another 5",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: {
        engine: "practice",
        body: { sections: ["M"], target_question_count: 5 },
        playThrough: ["correct", "incorrect", "skip", "correct", "correct"],
      },
      waitFor: both('[data-testid="session-summary-score"]'),
      fullPage: true,
      prototype: NEW_SCREEN,
    },
    {
      id: "summary-practice-free",
      title:
        "Practice session summary, free: the muted locked line 'Track how this moves your mastery — included with paid plans' (a link to the plans page) in place of a mastery change",
      persona: "free",
      route: "/practice/session/{session}",
      freshQuota: true,
      freshSession: {
        engine: "practice",
        body: { sections: ["M"], target_question_count: 5 },
        playThrough: ["correct", "incorrect", "skip", "correct", "correct"],
      },
      waitFor: both('[data-testid="session-summary-mastery-locked"]'),
      fullPage: true,
      prototype: {
        kind: "none",
        reason:
          "NOT PROTOTYPED: owner ruling (Karl, 2026-10-15, on #1233, item 3), built to DESIGN.md §5; these screenshots go to Karl before merge.",
      },
    },
    {
      id: "summary-review",
      title:
        "Review session summary: the same pattern ('back in your review queue')",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: {
        engine: "review",
        body: {
          mode: "filter",
          filters: { sections: ["RW"] },
          target_count: 3,
        },
        playThrough: ["correct", "incorrect", "correct"],
      },
      waitFor: both('[data-testid="session-summary-score"]'),
      fullPage: true,
      prototype: NEW_SCREEN,
    },
    {
      id: "home-paid",
      title:
        "Home, paid: the QOTD card in place, today's plan rows as text links ('Start today's plan' the one filled button), 'This week' ticks",
      persona: "paid",
      route: "/dashboard",
      freshQotd: {},
      waitFor: both('[data-testid="home-plan"]'),
      fullPage: true,
      prototype: NEW_SCREEN,
    },
    {
      id: "home-paid-plan",
      title:
        "Home, paid, scrolled to today's plan (the first row's link focused): each row acts through a text link, 'Start today's plan' the one filled button",
      persona: "paid",
      route: "/dashboard",
      waitFor: both('[data-testid="home-plan-start"]'),
      steps: [{ focus: both('[data-testid="home-plan-start"]') }],
      expectVisible: '[data-testid="home-start-plan"]',
      prototype: NEW_SCREEN,
    },
    {
      id: "home-review-cap",
      title:
        "Home, paid, at the review cap: the notice's 'Continue your open session' wraps inside the panel",
      persona: "paid",
      route: "/dashboard",
      waitFor: both('[data-testid="home-recent-review"]'),
      reviewCap: true,
      steps: [click('[data-testid="home-recent-review"]')],
      expectInViewport: '[data-testid="review-cap"]',
      prototype: NEW_SCREEN,
    },
    {
      id: "route-error-in-shell",
      title:
        "A page's code chunk fails twice: one automatic reload, then the error screen inside the App shell (rail; tab bar on a phone)",
      persona: "paid",
      route: "/mastery",
      failRequest: {
        pathPattern: "^/assets/mastery-[^/]+\\.js$",
        reason:
          "The Mastery page's lazy chunk fails to load, as after a deploy replaces it; the first failure reloads once, the second shows the in-shell error screen.",
      },
      waitFor: both('[data-testid="route-error"]'),
      prototype: NEW_SCREEN,
    },
    {
      id: "qotd-explanation-first",
      title:
        "QOTD answered: the explanation with Done, and no email prompt over it",
      persona: "paid",
      route: "/dashboard",
      freshQotd: {},
      waitFor: both('[data-testid="home-qotd"][data-state="unanswered"]'),
      steps: [click(QOTD_CHOICE), click('[data-testid="home-qotd-submit"]')],
      expectVisible: '[data-testid="home-qotd-done"]',
      expectGone: '[data-testid="qotd-email-prompt"]',
      prototype: NEW_SCREEN,
    },
    {
      id: "qotd-prompt-after-done",
      title: "QOTD: Done closes the explanation, then the email prompt opens",
      persona: "paid",
      route: "/dashboard",
      freshQotd: {},
      waitFor: both('[data-testid="home-qotd"][data-state="unanswered"]'),
      steps: [
        click(QOTD_CHOICE),
        click('[data-testid="home-qotd-submit"]'),
        click('[data-testid="home-qotd-done"]'),
      ],
      expectText: "Keep your streak alive 🔥",
      prototype: NEW_SCREEN,
    },
    {
      id: "qotd-prompt-next-visit",
      title:
        "QOTD answered earlier today and left before Done: the next Home visit opens the email prompt once, over the collapsed card",
      persona: "paid",
      route: "/dashboard",
      freshQotd: { answeredEarlier: true },
      waitFor: both('[data-testid="qotd-email-prompt"]'),
      expectText: "Keep your streak alive 🔥",
      prototype: {
        kind: "none",
        reason:
          "NOT PROTOTYPED: owner ruling (Karl, 2026-10-15, on #1233, item 2), built to DESIGN.md §5; these screenshots go to Karl before merge.",
      },
    },
    {
      id: "sign-in",
      title:
        "Sign in: the Lyceon logo (a link to /) and the 'Password' placeholder",
      persona: "signed-out",
      route: "/login",
      cookieChoiceMade: true,
      waitFor: both('[data-testid="auth-home-logo"]'),
      prototype: NEW_SCREEN,
    },
  ],
};

/** Onboarding needs the bare-pages seed's incomplete-profile student (UI-59). */
export const FIRST_RUN_ONBOARDING: PageGroup = {
  id: "FIRST-RUN-ONBOARDING",
  title:
    "First-run activation fixes: onboarding's empty date of birth, and the SAT-date picker's helper line and Done (light and dark, 1440 and 390)",
  seed: "bare-pages",
  shots: [
    {
      id: "onboarding-dob-empty",
      title:
        "Onboarding: the date of birth starts empty; no SAT question until a date is entered",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both('[data-testid="input-date-of-birth"]'),
      expectGone: '[data-testid="onboarding-sat-dates"]',
      fullPage: true,
      prototype: NEW_SCREEN,
    },
    {
      id: "onboarding-sat-picker-open",
      title:
        "Onboarding, a 13+ date entered: 'When's your SAT?' with 'Pick every date you might take', the menu open, Done on screen",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both('[data-testid="input-date-of-birth"]'),
      steps: [
        {
          fill: both('[data-testid="input-date-of-birth"]'),
          value: "2009-05-01",
        },
        click('[data-testid="onboarding-sat-dates-trigger"]'),
      ],
      expectInViewport: '[data-testid="onboarding-sat-dates-done"]',
      prototype: NEW_SCREEN,
    },
  ],
};
