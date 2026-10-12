/**
 * The one SAT-date picker, closed and open, and the two-line recent-session titles.
 *
 * @spec [owner brief "SAT date picker and UI control standards" (Karl, 2026-10-11) §1
 *       ("Screenshots: closed and open, light and dark, 1440 and 390") and the fold-in (Home's
 *       "Recent sessions" titles capped at two lines)] | @implemented [2026-10-11]
 *
 * plain English: over the real routes and the real client build. Onboarding (the incomplete-
 * profile persona, so the seed is the bare-pages one): the picker closed on "Not sure yet", open
 * ("Not sure yet" pinned, the future dates scrolling inside the menu), and two dates chosen then
 * "Done" (the closed trigger reads "Sat, Nov 7, 2026 + 1 more"). Settings and the calendar's
 * schedule sheet: the same picker open, so the shot shows it is one component everywhere. Home:
 * the recent-session rows, whose titles now stop at two lines.
 */
import { reviewPoolSummaryResponseSchema } from "../../../../packages/shared/src/review-schema";
import type { PageGroup } from "./types";

/**
 * Recent-session rows with the long titles production shows (several skills chosen: the title is
 * the skills joined), built through the shared response schema. Skill and domain names are the
 * canonical taxonomy's; the counts and times are illustrative.
 */
const LONG_TITLE_POOL = reviewPoolSummaryResponseSchema.parse({
  total: 14,
  timezone: "America/Chicago",
  timezoneFallback: false,
  bySection: [],
  byDomain: [],
  bySkill: [],
  sessions: [
    {
      source_engine: "practice",
      source_session_id: "11111111-1111-4111-8111-111111111111",
      created_at: "2026-10-11T14:58:00.000Z",
      local_date: "2026-10-11",
      local_time: "9:58 AM",
      mode: "practice",
      filters: {
        sections: ["M"],
        domains: ["Algebra"],
        skills: [
          "Linear equations in one variable",
          "Linear functions",
          "Linear equations in two variables",
          "Systems of two linear equations in two variables",
          "Linear inequalities in one or two variables",
        ],
        difficulties: [],
      },
      open_count: 6,
    },
    {
      source_engine: "practice",
      source_session_id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-10-10T19:12:00.000Z",
      local_date: "2026-10-10",
      local_time: "2:12 PM",
      mode: "practice",
      filters: {
        sections: ["RW"],
        domains: [
          "Information and Ideas",
          "Craft and Structure",
          "Expression of Ideas",
          "Standard English Conventions",
        ],
        skills: [],
        difficulties: [],
      },
      open_count: 3,
    },
    {
      source_engine: "practice",
      source_session_id: "33333333-3333-4333-8333-333333333333",
      created_at: "2026-10-09T15:00:00.000Z",
      local_date: "2026-10-09",
      local_time: "10:00 AM",
      mode: "practice",
      filters: {
        sections: ["M"],
        domains: [],
        skills: [],
        difficulties: [],
      },
      open_count: 5,
    },
  ],
  sessions_next_cursor: null,
});

const NO_PROTOTYPE = {
  kind: "none" as const,
  reason:
    "NOT PROTOTYPED: the dropdown SAT-date picker and the two-line title rule are the owner brief of 2026-10-11 (DESIGN.md §5 UI standards); built to DESIGN.md's tokens.",
};

function both(selector: string): { desktop: string; mobile: string } {
  return { desktop: selector, mobile: selector };
}

const ONBOARDING = "onboarding-sat-dates";

export const SAT_DATES: PageGroup = {
  id: "SAT-DATES",
  title:
    "The SAT-date picker (dropdown multi-select) closed and open, and two-line recent-session titles; light and dark, 1440 and 390",
  seed: "bare-pages",
  shots: [
    {
      id: "onboarding-closed",
      title:
        "Onboarding, 'When's your SAT?': the picker closed on 'Not sure yet' (no list on the page)",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both(`[data-testid="${ONBOARDING}-trigger"]`),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "onboarding-open",
      title:
        "Onboarding: the picker open: 'Not sure yet' pinned at the top, then the future official dates with checkboxes, scrolling inside the menu",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both(`[data-testid="${ONBOARDING}-trigger"]`),
      steps: [{ click: both(`[data-testid="${ONBOARDING}-trigger"]`) }],
      expectVisible: `[data-testid="${ONBOARDING}-menu"]`,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "onboarding-two-dates",
      title:
        "Onboarding: two dates chosen, then Done: the closed picker reads 'Sat, Nov 7, 2026 + 1 more'",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both(`[data-testid="${ONBOARDING}-trigger"]`),
      steps: [
        { click: both(`[data-testid="${ONBOARDING}-trigger"]`) },
        { click: both(`[data-testid="${ONBOARDING}-date-2026-11-07"]`) },
        { click: both(`[data-testid="${ONBOARDING}-date-2026-12-05"]`) },
        { click: both(`[data-testid="${ONBOARDING}-done"]`) },
      ],
      expectText: "Sat, Nov 7, 2026 + 1 more",
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "onboarding-dates-error",
      title:
        "Onboarding: the bound read failed: the picker offers no date, says so, and offers Try again ('Not sure yet' stays available)",
      persona: "onboarding",
      route: "/profile/complete",
      waitFor: both(`[data-testid="${ONBOARDING}-trigger"]`),
      fulfillRequest: {
        method: "GET",
        path: "/api/calendar/profile",
        status: 500,
        body: { error: "Internal server error", requestId: "harness" },
        reason:
          "Owner ruling 2026-10-11 (Karl, on #1204): the picker fails closed when the served bound (latest_test_date) cannot load. The route does not fail in the harness, so the browser answers it with a 500.",
      },
      steps: [{ click: both(`[data-testid="${ONBOARDING}-trigger"]`) }],
      expectVisible: `[data-testid="${ONBOARDING}-dates-error"]`,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "settings-open",
      title: "Settings → Profile: the same picker, open",
      persona: "paid",
      route: "/profile",
      waitFor: both('[data-testid="settings-test-dates-trigger"]'),
      steps: [{ click: both('[data-testid="settings-test-dates-trigger"]') }],
      expectVisible: '[data-testid="settings-test-dates-menu"]',
      prototype: NO_PROTOTYPE,
    },
    {
      id: "calendar-sheet-open",
      title:
        "Calendar → Edit schedule: the same picker in the schedule sheet, open (at 390 the sheet is opened from the '⋯' menu)",
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
        { click: both('[data-testid="settings-exam-dates-trigger"]') },
      ],
      expectVisible: '[data-testid="settings-exam-dates-menu"]',
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-recent-long-titles",
      title:
        "Home, paid: recent sessions with long titles (several skills or domains chosen): two lines and an ellipsis, never five; the third row's short title is untouched",
      persona: "paid",
      route: "/dashboard",
      waitFor: both('[data-testid="home-recent-row"]'),
      fulfillRequest: {
        method: "GET",
        path: "/api/review/pool",
        body: LONG_TITLE_POOL,
        reason:
          "The seeded sessions all have short titles; production's long ones come from several skills chosen. The body is built by the shared `reviewPoolSummaryResponseSchema` with canonical skill and domain names.",
      },
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
    {
      id: "home-recent-sessions",
      title:
        "Home, paid: 'Recent sessions', each title at most two lines with an ellipsis (full text on hover and focus)",
      persona: "paid",
      route: "/dashboard",
      waitFor: both('[data-testid="home-recent-row"]'),
      fullPage: true,
      prototype: NO_PROTOTYPE,
    },
  ],
};
