/**
 * The calendar's guardian line: "Your guardian is notified when you change your study plan."
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Transparency
 *        (student-facing)"; DESIGN.md §5 ("Every new screen is checked against this list in its
 *        PR description … with screenshots attached (light and dark, 1440 and 390)")]
 *        | @implemented [2026-10-13]
 *
 * plain English: the paid persona is the exam harness's student, who has an ACTIVE guardian
 * link (personas.ts), so the line shows wherever the student can clear a day or remove or move a
 * block: the day ⋯ menu (where "Block out this day" clears it), the block panel (Remove,
 * Move to…) and, since SCL-230 was approved (Karl, 2026-10-13), the schedule sheet. The seed is UI-55's ("calendar-goal"): the plan is the one the real generator builds
 * on first open, and today holds a review block that is not started. UI-55's own shots are the
 * control for a student whose surfaces draw nothing new.
 */
import type { PageGroup } from "./types";

const PAID_WEEK = {
  desktop: '[data-testid="calendar-week-grid"]',
  mobile: '[data-testid="calendar-week-grid"]',
} as const;

/** The first day ⋯ menu trigger on a day the student can still change. */
const DAY_MENU = "button.dmenu";
/** Today's review block (QA2-G: the first `rev` card). */
const REVIEW_BLOCK = "button.block.rev";

export const GUARDIAN_NOTICE: PageGroup = {
  id: "GUARDIAN-NOTICE",
  title:
    "Guardian accountability: the calendar's guardian line in the day menu and the block panel (active link); light and dark, 1440 and 390",
  seed: "calendar-goal",
  shots: [
    {
      id: "day-menu",
      title:
        'The day ⋯ menu open: Block out this day, Regenerate day, then a rule and the one muted line "Your guardian is notified when you change your study plan." (14px, the menu\'s note style)',
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [{ click: { desktop: DAY_MENU, mobile: DAY_MENU } }],
      expectVisible: '[data-testid^="day-menu-guardian-notice-"]',
      prototype: {
        kind: "none",
        reason:
          "The line is new (owner brief 2026-10-13); the prototype's day menu has no guardian line.",
      },
    },
    {
      id: "block-sheet",
      title:
        "The block panel of a block the student can change: Move to…, then the guardian line under it (field-note style), then Start and Remove in the footer",
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [{ click: { desktop: REVIEW_BLOCK, mobile: REVIEW_BLOCK } }],
      expectVisible: '[data-testid="calendar-block-guardian-notice"]',
      prototype: {
        kind: "none",
        reason:
          "The line is new (owner brief 2026-10-13); the prototype's block sheet has no guardian line.",
      },
    },
    {
      id: "settings-sheet",
      title:
        "Edit schedule (SCL-230, approved by Karl 2026-10-13): the schedule sheet with the guardian line under the live readout, above Cancel / Save changes (at 390 the sheet is opened from the '⋯' menu)",
      persona: "paid",
      route: "/calendar",
      waitFor: {
        desktop: '[data-testid="topbar-edit-schedule"]',
        mobile: '[data-testid="calendar-more-actions"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="topbar-edit-schedule"]',
            mobile: '[data-testid="calendar-more-actions"]',
          },
        },
        {
          click: {
            desktop: null,
            mobile: '[data-testid="calendar-more-edit-schedule"]',
          },
        },
      ],
      expectVisible: '[data-testid="settings-guardian-notice"]',
      prototype: {
        kind: "none",
        reason:
          "The line is new (SCL-230, approved 2026-10-13); the prototype's schedule sheet has no guardian line.",
      },
    },
  ],
};
