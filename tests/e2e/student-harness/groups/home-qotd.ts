/**
 * Home QOTD: the card's states, the streak chip, the email prompt, the SAT-date card, the
 * calendar goal card's streak and the onboarding date picker.
 *
 * @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
 *       (Karl, 2026-10-08/09) acceptance 10: "Home order and states, collapse, chip states, the
 *       prompt's focus and keyboard behavior, the onboarding date picker; screenshots light/dark
 *       at 1440 and 390"] | @implemented [2026-10-09]
 *
 * plain English: every shot runs over the real routes and the real SQL in the harness database.
 * `freshQotd` puts today's question back to unanswered before each capture, so the click path
 * (pick a choice, Submit) answers it in every viewport and theme. The collapsed shot runs right
 * after an answered one on the same persona, so it sees the answer that capture made.
 */
import type { PageGroup } from "./types";

const NO_PROTOTYPE = {
  kind: "none" as const,
  reason:
    "NOT PROTOTYPED: the Home QOTD card, streak chip, email prompt and SAT-date card are new in the owner brief of 2026-10-08/09 and built to DESIGN.md's tokens; these screenshots go to Karl before merge.",
};

function both(selector: string): { desktop: string; mobile: string } {
  return { desktop: selector, mobile: selector };
}

const FIRST_CHOICE = '[data-testid="home-qotd"] [data-testid="runner-choice"]';

export const HOME_QOTD: PageGroup = {
  id: "HOME-QOTD",
  title:
    "Home QOTD, streak, email prompt, SAT dates (light and dark, 1440 and 390)",
  shots: [
    {
      id: "home-free-qotd-unanswered",
      title:
        "Home, free: greeting, streak chip 'Start your streak', today's question unanswered, then the diagnostic",
      persona: "free",
      route: "/dashboard",
      freshQotd: {},
      waitFor: both('[data-testid="home-qotd"][data-state="unanswered"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-free-qotd-answered-prompt",
      title:
        "Answered (first ask): result and explanation, chip '🔥 1 · Today ✓', the email prompt with Yes focused, no 'Don't ask again'",
      persona: "free",
      route: "/dashboard",
      freshQotd: {},
      waitFor: both('[data-testid="home-qotd"][data-state="unanswered"]'),
      steps: [
        { click: both(FIRST_CHOICE) },
        { click: both('[data-testid="home-qotd-submit"]') },
      ],
      expectText: "Keep your streak alive 🔥",
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-free-qotd-collapsed",
      title:
        "Later visit the same day: collapsed '✓ Today's question done · 🔥 1-day streak · New question tomorrow', then the SAT-date card",
      persona: "free",
      route: "/dashboard",
      waitFor: both('[data-testid="home-qotd-collapsed"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-free-qotd-third-ask",
      title: "The 3rd ask: the prompt adds the text link 'Don't ask again'",
      persona: "free",
      route: "/dashboard",
      freshQotd: { priorAsks: 2 },
      waitFor: both('[data-testid="home-qotd"][data-state="unanswered"]'),
      steps: [
        { click: both(FIRST_CHOICE) },
        { click: both('[data-testid="home-qotd-submit"]') },
      ],
      expectText: "Don't ask again",
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-free-sat-date-card-open",
      title:
        "The SAT-date card opened: 'Not sure yet', then the future official dates",
      persona: "free",
      route: "/dashboard",
      waitFor: both('[data-testid="home-sat-date-card"]'),
      steps: [{ click: both('[data-testid="home-sat-date-open"]') }],
      expectText: "Not sure yet",
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-paid-qotd",
      title: "Home, paid: chip, today's question, then today's plan",
      persona: "paid",
      route: "/dashboard",
      freshQotd: {},
      waitFor: both('[data-testid="home-plan"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "calendar-goal-streak",
      title:
        "Calendar (paid): the goal card's '🔥 N-day streak' (after today's answer)",
      persona: "paid",
      route: "/calendar",
      freshQotd: {},
      waitFor: both('[data-testid="calendar-goal-card"]'),
      prototype: NO_PROTOTYPE,
    },
    {
      id: "onboarding-sat-dates",
      title:
        "Onboarding: Name, date of birth, then 'When's your SAT?' ('Not sure yet' first, future official dates, multi-select)",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both('[data-testid="onboarding-sat-dates"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
  ],
};
