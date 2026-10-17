/**
 * UI-50: Home (`/dashboard`), free and paid, with its two click paths.
 *
 * @spec [student-UI register §6 Wave 5 UI-50 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); design/DESIGN.md §4 Home;
 *        OQ-4 (390px, light and dark); owner ruling (Karl, 2026-10-05) item 4, the "Start a
 *        full-length test" card; final brief v2 §4–§5 (Karl, 2026-10-13: the card is removed; the
 *        Getting started checklist and the Practice/Review buttons)] | @implemented [2026-10-03;
 *        card shots 2026-10-05; replaced 2026-10-13]
 *
 * plain English: Home as each persona sees it, paired with Main.dc.html in the same plan; the
 * free locked mastery card's upgrade modal, paired with the canvas's own; and the two primary
 * actions clicked through to where they land: "Start today's plan" (paid) launches today's
 * first open block, "Start diagnostic" (free) starts the diagnostic. Production is held, so the
 * click paths are proven here, over the real routes, by the landing pathname (`expectPath`).
 */
import type { PageGroup } from "./types";

const HOME = {
  desktop: '[data-testid="home"]',
  mobile: '[data-testid="home"]',
} as const;

export const UI_50: PageGroup = {
  id: "UI-50",
  title: "UI-50 Home (/dashboard): free and paid, light and dark, 1440 and 390",
  shots: [
    {
      id: "home-free",
      title:
        "Home, free (diagnostic not taken): the Getting started checklist, today's question, the 'Find your blind spots' card, Practice and Review (How Lyceon works returns after the checklist is dismissed, final brief v2 §4); panel: projection empty state, locked mastery, today's quota",
      persona: "free",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-diagnostic"]',
        mobile: '[data-testid="home-diagnostic"]',
      },
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "free",
        note: "Home, plan = free",
      },
    },
    {
      id: "home-paid",
      title:
        "Home, paid (diagnostic taken, calendar set up): today's plan, mastery, pick up; panel: projection, this week, recent sessions",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-plan"]',
        mobile: '[data-testid="home-plan"]',
      },
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "paid",
        note: "Home, plan = paid",
      },
    },
    {
      id: "home-paid-full",
      title:
        "Home, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-recent"]',
        mobile: '[data-testid="home-recent"]',
      },
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "paid",
        note: "Home, plan = paid (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "home-free-full",
      title:
        "Home, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)",
      persona: "free",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-quota"]',
        mobile: '[data-testid="home-quota"]',
      },
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "free",
        note: "Home, plan = free (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "home-free-mastery-modal",
      title:
        "Home, free: 'See what's included' on the locked mastery card opens the upgrade modal (mastery_detail)",
      persona: "free",
      route: "/dashboard",
      waitFor: HOME,
      steps: [
        {
          click: {
            desktop: '[data-testid="locked-mastery-see-included"]',
            mobile: '[data-testid="locked-mastery-see-included"]',
          },
        },
      ],
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "free",
        steps: ["text=See what's included"],
        note: "Home, plan = free, 'See what's included' clicked",
      },
    },
    {
      id: "click-paid-start-plan",
      title:
        "Click path (paid): 'Start today's plan' launches today's first open block and lands in its runner",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-start-plan"]',
        mobile: '[data-testid="home-start-plan"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-start-plan"]',
            mobile: '[data-testid="home-start-plan"]',
          },
        },
      ],
      expectPath:
        "^/(practice|review)/session/[0-9a-f-]{36}$|^/tests/[0-9a-f-]{36}$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (the runner), proven by its pathname.",
      },
    },
    {
      id: "click-paid-plan-row-start",
      title:
        "Click path (paid, QA item 4): a Today's plan row's own Start launches that block and lands in its session (the harness's open block today is the review block)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-plan-start"]:not([disabled])',
        mobile: '[data-testid="home-plan-start"]:not([disabled])',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-plan-start"]:not([disabled])',
            mobile: '[data-testid="home-plan-start"]:not([disabled])',
          },
        },
      ],
      expectPath:
        "^/(practice|review)/session/[0-9a-f-]{36}$|^/tests/[0-9a-f-]{36}$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (the session the launch named), proven by its pathname.",
      },
    },
    {
      id: "click-paid-pickup-continue",
      title:
        "Click path (paid, QA item 4): 'Pick up where you left off' → Continue opens exactly the open practice session the seed left (its id is in the path)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-resume-row"]',
        mobile: '[data-testid="home-resume-row"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-resume-row"] a',
            mobile: '[data-testid="home-resume-row"] a',
          },
        },
      ],
      expectPath: "^/practice/session/{paid.openPracticeSessionId}$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is the resumed session (Question 4 of 10 after the seed's three answers), proven by its exact id in the pathname.",
      },
    },
    {
      id: "click-paid-start-plan-pending",
      title:
        "QA item 5: 'Start today's plan' pressed, the launch held in flight: the pressed control reads 'Starting…' with a spinner, and every Start is disabled",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-start-plan"]',
        mobile: '[data-testid="home-start-plan"]',
      },
      holdRequest: {
        method: "POST",
        path: "/api/calendar/blocks/*/launch",
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-start-plan"]',
            mobile: '[data-testid="home-start-plan"]',
          },
        },
      ],
      expectVisible: '[data-testid="home-start-plan"][aria-busy="true"]',
      prototype: {
        kind: "none",
        reason:
          "A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).",
      },
    },
    {
      id: "click-paid-recent-review-pending",
      title:
        "OQ-66 (h): a recent-session row's 'Review this session' pressed, the review create held in flight: that row reads 'Starting…' and the other rows' actions wait (full page: on a phone the panel stacks under the main column)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-recent-review"]',
        mobile: '[data-testid="home-recent-review"]',
      },
      holdRequest: {
        method: "POST",
        path: "/api/review/sessions",
        match: "exact",
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-recent-review"]',
            mobile: '[data-testid="home-recent-review"]',
          },
        },
      ],
      expectVisible: '[data-testid="home-recent-review"][aria-busy="true"]',
      fullPage: true,
      prototype: {
        kind: "none",
        reason:
          "The row's explicit action and its pending state are not drawn in the prototype (owner ruling OQ-66 (h), Karl, 2026-10-07).",
      },
    },
    {
      id: "click-paid-go-practice",
      title:
        "Click path (paid): Home's 'Work on new questions' row's Start lands on Practice (owner ruling, Karl, 2026-10-15, on #1233: three equal entry points, replacing final brief v2 §4's outline buttons)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-entry-points"]',
        mobile: '[data-testid="home-entry-points"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-entry-practice-action"]',
            mobile: '[data-testid="home-entry-practice-action"]',
          },
        },
      ],
      expectPath: "^/practice$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (Practice), proven by its pathname. The entry rows are the 2026-10-15 ruling on #1233, not in the prototype.",
      },
    },
    {
      id: "home-free-getting-started",
      title:
        "Home, free: the Getting started checklist above today's question (dots, 'N of M', the current step expanded), in place of 'How Lyceon works' (final brief v2 §4–§5)",
      persona: "free",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="getting-started"]',
        mobile: '[data-testid="getting-started"]',
      },
      fullPage: true,
      prototype: {
        kind: "none",
        reason:
          "The checklist is final brief v2 (Karl, 2026-10-13), drawn from the approved v2 mocks, not the prototype.",
      },
    },
    {
      id: "click-free-start-diagnostic",
      title:
        "Click path (free): 'Start diagnostic' starts the diagnostic and lands in its runner",
      persona: "free",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-start-diagnostic"]',
        mobile: '[data-testid="home-start-diagnostic"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-start-diagnostic"]',
            mobile: '[data-testid="home-start-diagnostic"]',
          },
        },
      ],
      expectPath: "^/practice/session/[0-9a-f-]{36}$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (the diagnostic runner), proven by its pathname.",
      },
    },
  ],
};
