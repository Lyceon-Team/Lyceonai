/**
 * UI-55: the calendar (`/calendar`), paid (week and month, the Regenerate plan click path) and
 * free (the inline setup form before and after a save).
 *
 * @spec [student-UI register §6 Wave 5 UI-55 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); DESIGN.md §2 (Calendar's
 *        right panel is 340px, no slim footer), §4 Calendar; design/prototype/Calendar.dc.html
 *        (plan paid and free, its Week/Month toggle and its Regenerate plan); OQ-4 (390px,
 *        light and dark); OQ-25 (free reads the ungated profile)] | @implemented [2026-10-03]
 *
 * plain English: the group asks for the "calendar-goal" seed (seed.ts): through the real
 * `PUT /api/calendar/profile` the paid student's SAT date is this week's Sunday, so the week,
 * the month and the mini month each show the starred test day. The paid plan is the one the
 * real generator builds on first open. The free student has no entitlement row and no profile:
 * the first free shot is the setup state; the click shot types a test date and a target into
 * the inline form and saves it through the real route; the shot after it reloads the page with
 * that profile saved. Shot order matters and is kept: setup, save, saved.
 */
import type { PageGroup } from "./types";

const PAID_WEEK = {
  desktop: '[data-testid="calendar-week-grid"]',
  mobile: '[data-testid="calendar-week-grid"]',
} as const;

const FREE_SETUP = {
  desktop: '[data-testid="calendar-free-setup"]',
  mobile: '[data-testid="calendar-free-setup"]',
} as const;

const MONTH_BUTTON = {
  desktop: '[data-testid="calendar-view-month"]',
  mobile: '[data-testid="calendar-view-month"]',
} as const;

/** The prototype's Week/Month group: its second button is Month. */
const PROTO_MONTH =
  'div[role="group"][aria-label="View"] button:nth-of-type(2)';

export const UI_55: PageGroup = {
  id: "UI-55",
  title:
    "UI-55 Calendar (/calendar): paid week and month, Regenerate plan, free setup before and after a save; light and dark, 1440 and 390",
  seed: "calendar-goal",
  shots: [
    {
      id: "paid-week",
      title:
        "Calendar, paid, week: Week/Month, Today, arrows; the range centred (M/D – M/D); Edit schedule and Regenerate plan; the starred test day; panel: mini month (★), goal card (days until, ★ pill, Target | Projected), Your schedule, Show",
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      prototype: {
        kind: "screen",
        file: "Calendar.dc.html",
        plan: "paid",
        note: "Calendar, plan = paid, week",
      },
    },
    {
      id: "paid-week-full",
      title:
        "Calendar, paid, week, full page (on a phone the right panel stacks under the main column)",
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Calendar.dc.html",
        plan: "paid",
        note: "Calendar, plan = paid (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "paid-month",
      title:
        "Click path (paid): the Month toggle shows the month grid, the test day starred and labelled",
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [{ click: MONTH_BUTTON }],
      prototype: {
        kind: "screen",
        file: "Calendar.dc.html",
        plan: "paid",
        steps: [PROTO_MONTH],
        state: "month",
        note: "Calendar, plan = paid, Month clicked",
      },
    },
    {
      id: "paid-regenerate",
      title:
        'Click path (paid): Regenerate plan posts to POST /api/calendar/plan/regenerate and returns; the button then reads "Plan regenerated"',
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [
        {
          click: {
            desktop: '[data-testid="calendar-regenerate"]',
            mobile: '[data-testid="calendar-regenerate"]',
          },
        },
      ],
      expectText: "Plan regenerated",
      prototype: {
        kind: "screen",
        file: "Calendar.dc.html",
        plan: "paid",
        steps: ['button:has-text("Regenerate plan")'],
        state: "regenerated",
        note: "Calendar, plan = paid, Regenerate plan clicked",
      },
    },
    {
      id: "free-setup",
      title:
        "Calendar, free, no profile: the inline setup form (test date, target score, Save) and the plan upsell card; panel: mini month and the Target-only goal card, all absent",
      persona: "free",
      route: "/calendar",
      waitFor: FREE_SETUP,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Calendar.dc.html",
        plan: "free",
        note: "Calendar, plan = free",
      },
    },
    {
      id: "free-save",
      title:
        "Click path (free): type a test date and a target, Save (PUT /api/calendar/profile through the real route); the goal card then counts down to the saved date",
      persona: "free",
      route: "/calendar",
      waitFor: FREE_SETUP,
      steps: [
        {
          fill: {
            desktop: '[data-testid="calendar-free-test-date"]',
            mobile: '[data-testid="calendar-free-test-date"]',
          },
          value: "2026-12-05",
        },
        {
          fill: {
            desktop: '[data-testid="calendar-free-target"]',
            mobile: '[data-testid="calendar-free-target"]',
          },
          value: "1400",
        },
        {
          click: {
            desktop: '[data-testid="calendar-free-save"]',
            mobile: '[data-testid="calendar-free-save"]',
          },
        },
      ],
      expectText: "days until your SAT",
      fullPage: true,
      prototype: {
        kind: "none",
        reason:
          "A click path; its proof is the saved goal the page then shows (the prototype's Save is not wired).",
      },
    },
    {
      id: "free-saved",
      title:
        "Calendar, free, with the profile saved: the form shows the saved answers (read from GET /api/calendar/profile, no plan read); panel: the ★ test date and Target",
      persona: "free",
      route: "/calendar",
      waitFor: {
        desktop: '[data-testid="calendar-test-date-pill"]',
        mobile: '[data-testid="calendar-test-date-pill"]',
      },
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Calendar.dc.html",
        plan: "free",
        note: "Calendar, plan = free (the canvas shows its own sample date and target)",
      },
    },
  ],
};
