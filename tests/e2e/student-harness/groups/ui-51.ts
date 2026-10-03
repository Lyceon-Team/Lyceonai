/**
 * UI-51: Practice (/practice), free and paid, with filters chosen and its click path.
 *
 * @spec [student-UI register §6 Wave 5 UI-51 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); design/DESIGN.md §4
 *        Practice; OQ-4 (390px, light and dark)] | @implemented [2026-10-03]
 *
 * plain English: Practice as each persona sees it, paired with Practice.dc.html in the same
 * plan; the page with a domain, a skill and a difficulty chosen through the filter bar, paired
 * with the canvas clicked to the same choices; and the main click path: choose filters, then
 * Start, which must land in the practice runner (`expectPath`).
 */
import type { PageGroup, Step } from "./types";

const PRACTICE = {
  desktop: '[data-testid="practice"]',
  mobile: '[data-testid="practice"]',
} as const;

function both(selector: string): Step {
  return { click: { desktop: selector, mobile: selector } };
}

/**
 * Domain: Algebra; Skill: the first one the menu offers; Difficulty: Medium, through the bar's
 * menus. The harness bank publishes one fixture skill per domain (`exg-fixture`), so the skill
 * is picked by position, not by a canonical name the harness catalog does not hold.
 */
const CHOOSE_FILTERS: readonly Step[] = [
  both('[data-testid="filter-menu-domain"]'),
  both('[role="menuitemcheckbox"]:text-is("Algebra")'),
  both('[role="menuitem"]:text-is("Done")'),
  both('[data-testid="filter-menu-skill"]'),
  both('[role="menuitemcheckbox"]'),
  both('[role="menuitem"]:text-is("Done")'),
  both('[data-testid="filter-menu-difficulty"]'),
  both('[role="menuitemcheckbox"]:text-is("Medium")'),
  both('[role="menuitem"]:text-is("Done")'),
];

/** The same three choices on the canvas (its menu buttons carry aria-expanded). */
const PROTOTYPE_FILTERS: readonly string[] = [
  'button[aria-expanded]:has-text("Domain")',
  'label:has-text("Algebra")',
  'button:text-is("Done")',
  'button[aria-expanded]:has-text("Skill")',
  'label:has-text("Linear Functions")',
  'button:text-is("Done")',
  'button[aria-expanded]:has-text("Difficulty")',
  'label:has-text("Medium")',
  'button:text-is("Done")',
];

export const UI_51: PageGroup = {
  id: "UI-51",
  title:
    "UI-51 Practice (/practice): free and paid, filters chosen, light and dark, 1440 and 390",
  shots: [
    {
      id: "practice-free",
      title:
        "Practice, free: filter bar, Your session with the quota line, recent practice; panel: locked mastery, How practice counts",
      persona: "free",
      route: "/practice",
      waitFor: {
        desktop: '[data-testid="practice-quota"]',
        mobile: '[data-testid="practice-quota"]',
      },
      prototype: {
        kind: "screen",
        file: "Practice.dc.html",
        plan: "free",
        note: "Practice, plan = free",
      },
    },
    {
      id: "practice-paid",
      title:
        "Practice, paid: filter bar, Your session, pick up, Suggested for you, recent practice; panel: mastery rows, How practice counts",
      persona: "paid",
      route: "/practice",
      waitFor: {
        desktop: '[data-testid="practice-suggested"]',
        mobile: '[data-testid="practice-suggested"]',
      },
      prototype: {
        kind: "screen",
        file: "Practice.dc.html",
        plan: "paid",
        note: "Practice, plan = paid",
      },
    },
    {
      id: "practice-paid-full",
      title:
        "Practice, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)",
      persona: "paid",
      route: "/practice",
      waitFor: {
        desktop: '[data-testid="practice-recent"]',
        mobile: '[data-testid="practice-recent"]',
      },
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Practice.dc.html",
        plan: "paid",
        note: "Practice, plan = paid (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "practice-free-full",
      title:
        "Practice, free, full page (on a phone the right panel stacks under the main column; the footer ends the column)",
      persona: "free",
      route: "/practice",
      waitFor: {
        desktop: '[data-testid="practice-quota"]',
        mobile: '[data-testid="practice-quota"]',
      },
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Practice.dc.html",
        plan: "free",
        note: "Practice, plan = free (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "practice-paid-filtered",
      title:
        "Practice, paid, with Domain: Algebra, a skill (the harness bank's one fixture skill) and Difficulty: Medium chosen through the filter bar's menus (chips and summary follow)",
      persona: "paid",
      route: "/practice",
      waitFor: PRACTICE,
      steps: CHOOSE_FILTERS,
      prototype: {
        kind: "screen",
        file: "Practice.dc.html",
        plan: "paid",
        steps: PROTOTYPE_FILTERS,
        note: "Practice, plan = paid, the same three choices clicked on the canvas",
      },
    },
    {
      id: "click-paid-start",
      title:
        "Click path (paid): choose a domain, a skill and a difficulty, then Start lands in the practice runner",
      persona: "paid",
      route: "/practice",
      waitFor: PRACTICE,
      steps: [...CHOOSE_FILTERS, both('[data-testid="practice-start"]')],
      expectPath: "^/practice/session/[0-9a-f-]{36}$",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where the click landed (the runner), proven by its pathname.",
      },
    },
  ],
};
