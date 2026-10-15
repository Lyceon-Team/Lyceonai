/**
 * Getting started checklist and its follow-ups: Home (free and Pro), Practice's blind-spots and
 * full-length rows, the upgrade modal from the locked full-length row, Settings' target score and
 * onboarding's score question.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §4–§7; Karl, 2026-10-13 on #1230: "attach the 1440 px and
 *       390 px screenshots"; items 1 (Practice full-length row) and 4 ("Not sure yet" only when
 *       chosen)] | @implemented [2026-10-13]
 *
 * plain English: every shot runs over the real routes and the real SQL in the harness database,
 * light and dark, at 1440 and 390. Nothing here is in the prototype: the checklist and the rows
 * are new, drawn from the approved v2 mocks and DESIGN.md's tokens.
 */
import type { PageGroup } from "./types";

const NO_PROTOTYPE = {
  kind: "none" as const,
  reason:
    "NOT PROTOTYPED: the Getting started checklist, Practice's rows and the score question are new in final brief v2 (Karl, 2026-10-13) and its #1230 follow-ups; built to the approved v2 mocks and DESIGN.md's tokens.",
};

function both(selector: string): { desktop: string; mobile: string } {
  return { desktop: selector, mobile: selector };
}

export const GETTING_STARTED: PageGroup = {
  id: "GETTING-STARTED",
  title:
    "Getting started checklist, Practice rows, target score (light and dark, 1440 and 390)",
  shots: [
    {
      id: "home-free-getting-started",
      title:
        "Home, free: greeting → the Getting started checklist (dots, 'N of M', the current step expanded) → today's question → 'Find your blind spots' → Practice and Review",
      persona: "free",
      route: "/dashboard",
      waitFor: both('[data-testid="getting-started"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-paid-getting-started",
      title:
        "Home, Pro: the checklist's eight steps above today's question; today's plan outlined while it shows",
      persona: "paid",
      route: "/dashboard",
      waitFor: both('[data-testid="getting-started"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "practice-free-rows",
      title:
        "Practice, free: the 'Find your blind spots' row below the filters, then 'Your session', then the locked 'Full-length test' row",
      persona: "free",
      route: "/practice",
      waitFor: both('[data-testid="practice-full-length"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "practice-free-full-length-modal",
      title:
        "Practice, free: the locked full-length Start opens the upgrade modal in place (phone and desktop)",
      persona: "free",
      route: "/practice",
      waitFor: both('[data-testid="practice-full-length"]'),
      steps: [{ click: both('[data-testid="practice-full-length-start"]') }],
      expectVisible: '[data-testid="upgrade-modal"]',
      expectPath: "^/practice$",
      prototype: NO_PROTOTYPE,
    },
    {
      id: "practice-paid-full-length",
      title:
        "Practice, Pro: the 'Full-length test' row, whose Start links to the Full-Length page",
      persona: "paid",
      route: "/practice",
      waitFor: both('[data-testid="practice-full-length"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "settings-profile-free-score",
      title:
        "Settings → Profile, free: SAT test date and target score shown to every student; the score reads 'Choose a score' until one is chosen",
      persona: "free",
      route: "/profile?tab=profile",
      waitFor: both('[data-testid="settings-target-select"]'),
      prototype: NO_PROTOTYPE,
    },
  ],
};

/** Onboarding's score question: the onboarding persona exists only under the bare-pages seed. */
export const GETTING_STARTED_ONBOARDING: PageGroup = {
  id: "GETTING-STARTED-ONBOARDING",
  title:
    "Onboarding: 'When's your SAT?' and 'What score are you aiming for?' (light and dark, 1440 and 390)",
  seed: "bare-pages",
  shots: [
    {
      id: "onboarding-sat-date-and-score",
      title:
        "Onboarding: name, date of birth, 'When's your SAT?', then 'What score are you aiming for?' ('Choose a score' until answered)",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both('[data-testid="onboarding-target-score"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
  ],
};
