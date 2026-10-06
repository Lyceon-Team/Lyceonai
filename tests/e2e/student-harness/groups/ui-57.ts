/**
 * UI-57: Mastery (/mastery), paid (the domains, and a domain opened to its skills) and free (the
 * locked card), and the click paths into it.
 *
 * @spec [student-UI register §6 Wave 5 UI-57; DESIGN.md §4 "Not prototyped" ("the Mastery page
 *        (domain grid with mastery rows, then the skills list per domain)" — build to the shell
 *        spec and send Karl screenshots before merge), §3 (Mastery row, Locked mastery card);
 *        OQ-4 (390px, light and dark)] | @implemented [2026-10-03]
 *
 * plain English: there is no Mastery prototype, so no shot has a prototype pair of its own. For
 * visual reference the paid shots sit beside the Home prototype (its wide mastery rows are the
 * same component) and the free shots beside the Practice prototype (its right panel holds the
 * locked mastery card). The group asks for the "mastery-skills" seed: the harness bank carries
 * each domain's canonical skill names (db.ts `useCanonicalSkills`) instead of the CI fixture's one
 * placeholder skill. The paid student's levels are whatever the base seed's answers produced
 * through the real answer path (attempts → mastery events → the rollups); nothing is written to
 * the mastery tables directly. Click paths: Home's "See every skill" lands on /mastery, and a
 * domain row opens its skills list in place.
 */
import type { PageGroup, Step } from "./types";

const DOMAINS = {
  desktop: '[data-testid="mastery-domain"]',
  mobile: '[data-testid="mastery-domain"]',
} as const;

const LOCKED = {
  desktop: '[data-testid="locked-mastery-card"]',
  mobile: '[data-testid="locked-mastery-card"]',
} as const;

function both(selector: string): Step {
  return { click: { desktop: selector, mobile: selector } };
}

/** Algebra: the base seed's Math answers measure some of its skills and leave others unmeasured. */
const OPEN_ALGEBRA: readonly Step[] = [
  both('[data-testid="mastery-domain"][data-domain="Algebra"] > button'),
];

const HOME_REFERENCE = {
  kind: "screen",
  file: "Main.dc.html",
  plan: "paid",
  note: "NOT PROTOTYPED. Visual reference only: Home, plan = paid (its Mastery block uses the same wide rows)",
} as const;

const PRACTICE_FREE_REFERENCE = {
  kind: "screen",
  file: "Practice.dc.html",
  plan: "free",
  note: "NOT PROTOTYPED. Visual reference only: Practice, plan = free (the locked mastery card in its right panel)",
} as const;

export const UI_57: PageGroup = {
  id: "UI-57",
  title:
    "UI-57 Mastery (/mastery, not prototyped): paid domains and an opened skills list, free locked card; light and dark, 1440 and 390",
  seed: "mastery-skills",
  shots: [
    {
      id: "mastery-paid",
      title:
        "Mastery, paid: the eight domains as wide mastery rows, Math then Reading & Writing (no right panel, no footer)",
      persona: "paid",
      route: "/mastery",
      waitFor: DOMAINS,
      fullPage: true,
      prototype: HOME_REFERENCE,
    },
    {
      id: "mastery-paid-skills",
      title:
        "Mastery, paid, Algebra opened: its skills listed beneath it, measured and unmeasured, with one outline 'Practice Algebra'",
      persona: "paid",
      route: "/mastery",
      waitFor: DOMAINS,
      steps: OPEN_ALGEBRA,
      expectVisible: '[data-testid="skill-list"]',
      fullPage: true,
      prototype: HOME_REFERENCE,
    },
    {
      id: "mastery-free",
      title:
        "Mastery, free: the locked mastery card, no mastery request (the feature-access map locks mastery_detail)",
      persona: "free",
      route: "/mastery",
      waitFor: LOCKED,
      prototype: PRACTICE_FREE_REFERENCE,
    },
    {
      id: "mastery-free-modal",
      title:
        "Mastery, free: 'See what's included' opens the upgrade modal for mastery_detail",
      persona: "free",
      route: "/mastery",
      waitFor: LOCKED,
      steps: [both('[data-testid="locked-mastery-see-included"]')],
      expectVisible: '[data-testid="upgrade-modal"]',
      prototype: {
        kind: "screen",
        file: "Practice.dc.html",
        plan: "free",
        note: "NOT PROTOTYPED. Visual reference only: Practice, plan = free (the canvas is not clicked; its modal copy is the same mastery_detail copy)",
      },
    },
    {
      id: "click-home-see-every-skill",
      title: "Click path (paid): Home's 'See every skill' lands on /mastery",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-mastery"]',
        mobile: '[data-testid="home-mastery"]',
      },
      steps: [both('[data-testid="home-mastery"] a[href="/mastery"]')],
      expectPath: "^/mastery$",
      expectVisible: '[data-testid="mastery-domain"]',
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (/mastery), proven by its pathname.",
      },
    },
  ],
};
