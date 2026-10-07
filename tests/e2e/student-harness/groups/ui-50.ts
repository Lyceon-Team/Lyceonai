/**
 * UI-50: Home (`/dashboard`), free and paid, with its two click paths.
 *
 * @spec [student-UI register §6 Wave 5 UI-50 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); design/DESIGN.md §4 Home;
 *        OQ-4 (390px, light and dark); owner ruling (Karl, 2026-10-05) item 4, the "Start a
 *        full-length test" card] | @implemented [2026-10-03; card shots 2026-10-05]
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
        "Home, free (diagnostic not taken): diagnostic card, How Lyceon works; panel: projection empty state, locked mastery, today's quota",
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
      id: "click-paid-full-length-card",
      title:
        "Click path (paid): Home's 'Start a full-length test' card lands on the Full-Length page (owner ruling, Karl, 2026-10-05)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-full-length"]',
        mobile: '[data-testid="home-full-length"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-full-length-start"]',
            mobile: '[data-testid="home-full-length-start"]',
          },
        },
      ],
      expectPath: "^/tests$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (the Full-Length page; on a phone, its notice), proven by its pathname. The card is the owner ruling of 2026-10-05, not in the prototype.",
      },
    },
    {
      id: "home-free-full-length-modal",
      title:
        "Home, free: the locked 'Start a full-length test' card opens the upgrade modal in place (exam_full_length)",
      persona: "free",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-full-length"]',
        mobile: '[data-testid="home-full-length"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-full-length-start"]',
            mobile: '[data-testid="home-full-length-start"]',
          },
        },
      ],
      expectVisible: '[data-testid="upgrade-modal"]',
      expectPath: "^/dashboard$",
      prototype: {
        kind: "none",
        reason:
          "The card is the owner ruling of 2026-10-05 and is not in the prototype; the modal's copy is the prototype's LYC_COPY.full (UI-41 pairs it with the rail click).",
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
