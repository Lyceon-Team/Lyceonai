/**
 * The cookie banner on signed-in student pages, unanswered (F-72).
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part E: "On phone widths it must not
 *        cover the bottom tab bar or the calendar sheet's buttons. On signed-in pages it sits
 *        above the tab bar (safe area). Verify at 390px on /dashboard and /calendar."; student-UI
 *        register F-72; owner brief 2026-10-05 (the banner's offset rule)] | @implemented [2026-10-21]
 *
 * plain English: every other group answers the banner before the page loads; these shots leave it
 * unanswered, as a first visit does. At 390 each capture fails unless the banner and the phone tab
 * bar are both on screen and do not overlap. The calendar-sheet shot records a block's sheet open
 * over the page with the banner unanswered: the banner steps aside while a sheet is open
 * (client/src/index.css `body:has(.lyceon-calendar .sheet.on) .consent-bottom-bar`), so the sheet's
 * Start and Remove are uncovered — read from the screenshot; no assertion is made on it here.
 * 1440 is shot for the record (no tab bar there).
 */
import type { PageGroup } from "./types";

const BANNER = '[data-testid="cookie-banner"]';
const TAB_BAR = '[data-testid="app-tab-bar"]';
const NO_PROTOTYPE = {
  kind: "none",
  reason:
    "The cookie banner is the SEO vertical's site-wide surface (Doc 10 §9.11); no student prototype draws it.",
} as const;

export const COOKIE_BANNER: PageGroup = {
  id: "COOKIE-BANNER",
  title:
    "F-72: the unanswered cookie banner on /dashboard and /calendar — above the phone tab bar at 390, and clear of the calendar sheet's buttons; light and dark, 1440 and 390",
  seed: "calendar-goal",
  shots: [
    {
      id: "dashboard",
      title:
        "/dashboard, banner unanswered: at 390 it sits above the tab bar (no overlap)",
      persona: "paid",
      route: "/dashboard",
      cookieBannerShown: true,
      waitFor: { desktop: BANNER, mobile: BANNER },
      expectVisible: BANNER,
      expectNoOverlap: { desktop: null, mobile: { a: BANNER, b: TAB_BAR } },
      prototype: NO_PROTOTYPE,
    },
    {
      id: "calendar",
      title:
        "/calendar, banner unanswered: at 390 it sits above the tab bar (no overlap)",
      persona: "paid",
      route: "/calendar",
      cookieBannerShown: true,
      waitFor: { desktop: BANNER, mobile: BANNER },
      expectVisible: BANNER,
      expectNoOverlap: { desktop: null, mobile: { a: BANNER, b: TAB_BAR } },
      prototype: NO_PROTOTYPE,
    },
    {
      id: "calendar-sheet",
      title:
        "/calendar with a block's sheet open, banner unanswered: the sheet's Remove button is not covered (the banner steps aside while a sheet is open)",
      persona: "paid",
      route: "/calendar",
      cookieBannerShown: true,
      waitFor: {
        desktop: '[data-testid="calendar-week-grid"]',
        mobile: '[data-testid="calendar-week-grid"]',
      },
      steps: [
        {
          click: {
            desktop: "button.block.rev",
            mobile: "button.block.rev",
          },
        },
      ],
      expectVisible: '[data-testid="calendar-block-sheet"]',
      prototype: NO_PROTOTYPE,
    },
  ],
};
