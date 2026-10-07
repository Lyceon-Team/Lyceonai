/**
 * UI-55: the calendar (`/calendar`), paid (week and month, the Regenerate plan click path) and
 * free (the inline setup form before and after a save).
 *
 * @spec [student-UI register §6 Wave 5 UI-55 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); DESIGN.md §2 (Calendar's
 *        right panel is 340px, no slim footer), §4 Calendar; design/prototype/Calendar.dc.html
 *        (plan paid and free, its Week/Month toggle and its Regenerate plan); OQ-4 (390px,
 *        light and dark); OQ-25 (free reads the ungated profile); SCL-211 / OQ-56 (no streak
 *        line, no facts strip; the free form read-only after the first save); owner ruling
 *        (Karl, 2026-10-05, OQ-63): "Phone notice: show it for every full-length start on a
 *        phone, including calendar-launched starts. One shared pre-start check, same \"Continue
 *        anyway\". Test it from a calendar block at 390px."]
 *        | @implemented [2026-10-03; SCL-211 2026-10-05; OQ-63 2026-10-05]
 *
 * plain English: the group asks for the "calendar-goal" seed (seed.ts): through the real
 * `PUT /api/calendar/profile` the paid student's SAT date is this week's Sunday, so the week,
 * the month and the mini month each show the starred test day. The paid plan is the one the
 * real generator builds on first open. The free student has no entitlement row and no profile:
 * the first free shot is the setup state; the click shot types a test date and a target into
 * the inline form and saves it through the real route, after which the card turns read-only
 * (OQ-56 (b)); the shot after it reloads the page with that profile saved. Shot order matters
 * and is kept: setup, save, saved.
 *
 * OQ-63. The seed also puts a scheduled full-length block on today (seed.ts), the day the 390px
 * calendar shows. "paid-full-length-notice" opens it and, at 390, presses Start: the shared
 * pre-start check's notice opens over the block sheet, and nothing is launched. On desktop the
 * same shot stops at the open sheet (a control: at lg and up Start launches at once, so pressing
 * it would leave the page). "paid-full-length-continue" presses Start and, at 390, Continue
 * anyway: the launch runs and the student lands in the sitting (`/tests/<session>`). The first
 * capture to launch creates the session; later captures find the block started and resume it,
 * so the notice is asked for a Resume as for a Start.
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

/** OQ-66 (c): the header's "⋯" menu trigger, drawn below a 1200px viewport. */
const MORE_ACTIONS = '[data-testid="calendar-more-actions"]';

/** OQ-63: today's scheduled full-length block (BlockCard's `exam` tone class). */
const FULL_LENGTH_BLOCK = 'button[data-testid^="calendar-block-"].exam';
const FULL_LENGTH_BLOCK_AT = {
  desktop: FULL_LENGTH_BLOCK,
  mobile: FULL_LENGTH_BLOCK,
} as const;
/** The block sheet's Start (or Resume, once started): its one primary button. */
const SHEET_START =
  '[data-testid="calendar-block-sheet"] footer button.primary';

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
        'Calendar, paid, week: Week/Month, Today, arrows; the range centred (M/D – M/D), no streak line; Edit schedule and Regenerate plan (at 390 in the "⋯" menu right of the range title: OQ-66 (c)); the starred test day; no facts strip (SCL-211); panel: mini month (★), goal card (days until, ★ pill, Target | Projected), Show (no "Your schedule": QA 2026-10-07 item 11(e))',
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
      id: "paid-week-mid",
      title:
        'Calendar, paid, week between the phone and desktop layouts (production QA 2026-10-07 items 11(c), 11(d); OQ-66 (c)): at 700 the range title over Week/Month, Today, arrows (left) and the "⋯" menu (right); at 1024, beside the right panel, two rows: the range title with "⋯" at its right end, then the view controls; at 1280 the range title over the controls and Edit schedule, Regenerate plan; block cards whose titles, chips and tags stay inside them',
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      extraViewports: [
        { name: "w700", width: 700, height: 900, selectors: "mobile" },
        { name: "w1024", width: 1024, height: 768, selectors: "desktop" },
        { name: "w1280", width: 1280, height: 800, selectors: "desktop" },
      ],
      prototype: {
        kind: "none",
        reason:
          "The prototype is a fixed 1440x900 canvas; these widths are the production QA's (2026-10-07 item 11).",
      },
    },
    {
      id: "paid-more-menu",
      title: `OQ-66 (c), owner ruling (Karl, 2026-10-07): below a 1200px viewport Edit schedule and Regenerate plan are in the header's "⋯" menu ("More actions"), opened here: at 1024 and 390 the menu over the page, in the page's theme. Desktop (1440, control): no "⋯"; the two buttons, as before`,
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [{ click: { desktop: null, mobile: MORE_ACTIONS } }],
      extraViewports: [
        { name: "w1024", width: 1024, height: 768, selectors: "mobile" },
      ],
      prototype: {
        kind: "none",
        reason:
          "The prototype is a fixed 1440x900 canvas with the two buttons; the menu is the owner ruling on OQ-66 (c).",
      },
    },
    {
      id: "paid-block-sheet",
      title:
        "Calendar, paid, a block's detail sheet open (production QA 2026-10-07 item 11(b)): a modal dialog named by the block's title, with Close (top right); focus on Close",
      persona: "paid",
      route: "/calendar",
      waitFor: {
        desktop: "button.block.rev",
        mobile: "button.block.rev",
      },
      steps: [
        {
          click: { desktop: "button.block.rev", mobile: "button.block.rev" },
          ariaDisabledOk: true,
        },
      ],
      expectVisible:
        '[data-testid="calendar-block-sheet"][role="dialog"] [data-testid="calendar-block-sheet-close"]',
      prototype: {
        kind: "none",
        reason:
          "The prototype's blocks open no sheet; the dialog is the production QA's item 11(b).",
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
        'Click path (paid): Regenerate plan posts to POST /api/calendar/plan/regenerate and returns; the button then reads "Plan regenerated". At 390 (OQ-66 (c)) it is chosen from the "⋯" menu, which is then reopened to show the item reading "Plan regenerated"',
      persona: "paid",
      route: "/calendar",
      waitFor: PAID_WEEK,
      steps: [
        { click: { desktop: null, mobile: MORE_ACTIONS } },
        {
          click: {
            desktop: '[data-testid="calendar-regenerate"]',
            mobile: '[data-testid="calendar-more-regenerate"]',
          },
        },
        { click: { desktop: null, mobile: MORE_ACTIONS } },
      ],
      // The drawn one of the two entry points (OQ-66 (c)): the button at 1440, the reopened
      // menu's item at 390 (the hidden button carries the same words, so not by text alone).
      expectVisible:
        '[data-testid="calendar-regenerate"]:visible:text-is("Plan regenerated"), [data-testid="calendar-more-regenerate"]:text-is("Plan regenerated")',
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
      id: "paid-full-length-notice",
      title:
        "Phone pre-start check (OQ-63), 390: today's scheduled full-length block, Start: \"Full-length tests are built for a laptop or tablet, like test day.\" over the block sheet, with the outline Continue anyway and Close; nothing launched. Desktop (control): the block's sheet, whose Start launches at once",
      persona: "paid",
      route: "/calendar",
      waitFor: FULL_LENGTH_BLOCK_AT,
      steps: [
        // Once a capture has launched it the block is started, and dnd-kit marks a block it
        // will not drag aria-disabled; it still opens its sheet on a tap.
        { click: FULL_LENGTH_BLOCK_AT, ariaDisabledOk: true },
        { click: { desktop: null, mobile: SHEET_START } },
      ],
      expectVisible: '[data-testid="calendar-block-sheet"]',
      prototype: {
        kind: "none",
        reason:
          "The prototypes have no phone layout and no pre-start check; the notice is the owner rulings of 2026-10-05 (OQ-63; DESIGN.md §2 Mobile).",
      },
    },
    {
      id: "paid-full-length-continue",
      title:
        "Click path (OQ-63): today's full-length block, Start, and at 390 Continue anyway: the calendar launch runs (POST /api/calendar/blocks/:id/launch) and the student lands in the sitting. Desktop: Start lands there directly",
      persona: "paid",
      route: "/calendar",
      waitFor: FULL_LENGTH_BLOCK_AT,
      steps: [
        // Once a capture has launched it the block is started, and dnd-kit marks a block it
        // will not drag aria-disabled; it still opens its sheet on a tap.
        { click: FULL_LENGTH_BLOCK_AT, ariaDisabledOk: true },
        { click: { desktop: SHEET_START, mobile: SHEET_START } },
        {
          click: {
            desktop: null,
            mobile: '[data-testid="full-length-phone-continue"]',
          },
        },
      ],
      expectPath: "^/tests/[0-9a-f-]{36}(/.*)?$",
      prototype: {
        kind: "none",
        reason:
          "A click path; its proof is the landing path (the prototype's blocks are not wired).",
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
        "Click path (free): type a test date and a target, Save (PUT /api/calendar/profile through the real route); the card then shows them read-only with Edit goals in Settings (OQ-56 (b)), and the goal card counts down to the saved date",
      persona: "free",
      route: "/calendar",
      waitFor: FREE_SETUP,
      freshCalendarProfile: true,
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
      expectText: "Edit goals in Settings",
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
        "Calendar, free, with the profile saved: the card shows the saved answers read-only with Edit goals in Settings (read from GET /api/calendar/profile, no plan read; OQ-56 (b)); panel: the ★ test date and Target",
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
