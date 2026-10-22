/**
 * The calendar's guardian confirmation: "Your guardian will be notified".
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A ("When the student has an active
 *        guardian link and active entitlement, any action the accountability loop records shows
 *        a confirmation dialog BEFORE the write"; "screenshots for UI changes (light/dark,
 *        1440/390)"); SCL-238; DESIGN.md §5] | @implemented [2026-10-13; rewritten 2026-10-21]
 *
 * plain English: the paid persona is the exam harness's student, who has an ACTIVE guardian
 * link and an active entitlement (personas.ts), so `guardian_notified` is true. Each shot
 * performs a recorded action — Block out this day (clears a day), Remove a block, and a schedule
 * save that changes the minutes per day (60 → 30) — and is shot with the dialog open, before
 * anything is written. The static line these surfaces drew until 2026-10-21 is gone. The seed is
 * UI-55's ("calendar-goal"): the plan the real generator builds on first open, with today's
 * review block not started.
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
const DIALOG = '[data-testid="guardian-notify-confirm"]';
const NO_PROTOTYPE = {
  kind: "none",
  reason:
    "The confirmation is new (owner brief 2026-10-21, SCL-238); no prototype screen has it. It is the shared student Modal (UI-46).",
} as const;

export const GUARDIAN_NOTICE: PageGroup = {
  id: "GUARDIAN-NOTICE",
  title:
    "Guardian confirmation (SCL-238): 'Your guardian will be notified' before a recorded calendar change (block out a day, remove a block, save fewer minutes); light and dark, 1440 and 390",
  seed: "calendar-goal",
  shots: [
    {
      id: "block-out-day",
      title:
        "Day ⋯ menu → Block out this day: the dialog asks first (title, body, filled 'Make change', outline 'Cancel'); nothing is written until 'Make change'",
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [
        { click: { desktop: DAY_MENU, mobile: DAY_MENU } },
        {
          click: {
            desktop: '[data-testid^="day-block-"]',
            mobile: '[data-testid^="day-block-"]',
          },
        },
      ],
      expectVisible: DIALOG,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "remove-block",
      title:
        "Block panel → Remove: the dialog over the sheet; the panel no longer carries a guardian line",
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [
        { click: { desktop: REVIEW_BLOCK, mobile: REVIEW_BLOCK } },
        {
          click: {
            desktop:
              '[data-testid="calendar-block-sheet"] button:has-text("Remove")',
            mobile:
              '[data-testid="calendar-block-sheet"] button:has-text("Remove")',
          },
        },
      ],
      expectVisible: DIALOG,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "save-schedule",
      title:
        "Edit schedule → 30 min → Save changes: the dialog over the schedule sheet (at 390 the sheet is opened from the '⋯' menu)",
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
        {
          click: {
            desktop:
              '[data-testid="settings-minutes"] button:has-text("30 min")',
            mobile:
              '[data-testid="settings-minutes"] button:has-text("30 min")',
          },
        },
        {
          click: {
            desktop: '[data-testid="settings-save"]',
            mobile: '[data-testid="settings-save"]',
          },
        },
      ],
      expectVisible: DIALOG,
      prototype: NO_PROTOTYPE,
    },
  ],
};
