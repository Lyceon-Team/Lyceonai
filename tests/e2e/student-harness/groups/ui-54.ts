/**
 * UI-54: Full-Length home (`/tests`), free and paid; the exam report; the timed module; and the
 * Resume click path.
 *
 * @spec [student-UI register §6 Wave 5 UI-54 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); design/DESIGN.md §2 (the
 *        timed module keeps its Bluebook layout, light only), §4 "Full-Length home", "Exam
 *        report"; design/prototype/FullLength.dc.html, Report.dc.html; OQ-4 (390px, light and
 *        dark); owner ruling (Karl, 2026-10-05): on phone widths the laptop-or-tablet notice
 *        with "Continue anyway"; owner ruling (Karl, 2026-10-05, OQ-63): shown for every
 *        full-length start on a phone, one shared pre-start check] | @implemented [2026-10-03;
 *        phone notice 2026-10-05; OQ-63 2026-10-05]
 *
 * plain English: the group asks for the "exam-history" seed (seed.ts, db.ts): through the real
 * exam routes the paid student has Practice Test 1 scored, Practice Test 2 left in Reading and
 * Writing Module 2, and Practice Test 3 never taken, the three states FullLength.dc.html shows.
 * The free student has no entitlement row, so `/tests` shows the in-page upgrade card. The
 * report is the scored test's real report. The timed module is shot light only (it is pinned
 * light) and has no prototype (none was drawn; DESIGN.md §2 keeps the shipped Bluebook layout).
 * The click path: Resume on `/tests` lands on the exam session route, which sends the student
 * on to the module the server says is active.
 *
 * PHONE NOTICE (OQ-63). The home is never held: at 390 it draws as on desktop. Start and Resume
 * go through the shared pre-start check, so "tests-phone-notice" taps Resume at 390 and shoots
 * the notice (desktop: the home, no tap, as a control), and the Resume click path taps Continue
 * anyway after Resume at 390 (a step skipped on desktop, where there is no notice).
 */
import type { PageGroup } from "./types";

const TESTS_PAID = {
  desktop: '[data-testid="tests-history"]',
  mobile: '[data-testid="tests-history"]',
} as const;

/** QA2 (2026-10-08): the 1024 width, with the desktop steps and selectors. */
const W1024 = {
  name: "w1024",
  width: 1024,
  height: 768,
  selectors: "desktop",
} as const;

/** 390 only: the shared pre-start check's "Continue anyway" (OQ-63). */
const CONTINUE_ANYWAY = {
  click: {
    desktop: null,
    mobile: '[data-testid="full-length-phone-continue"]',
  },
} as const;

const REPORT = {
  desktop: '[data-testid="exam-total-score"]',
  mobile: '[data-testid="exam-total-score"]',
} as const;

export const UI_54: PageGroup = {
  id: "UI-54",
  title:
    "UI-54 Full-Length home (/tests), the exam report and the timed module: free and paid, light and dark, 1440 and 390",
  seed: "exam-history",
  shots: [
    {
      id: "tests-free",
      title:
        "Full-Length, free: the in-page upgrade card; panel: the locked mastery card. No gated request",
      persona: "free",
      route: "/tests",
      waitFor: {
        desktop: '[data-testid="tests-upgrade-card"]',
        mobile: '[data-testid="tests-upgrade-card"]',
      },
      expectVisible: '[data-testid="tests-upgrade-card"]',
      prototype: {
        kind: "screen",
        file: "FullLength.dc.html",
        plan: "free",
        note: "Full-Length, plan = free",
      },
    },
    {
      id: "tests-paid",
      title:
        "Full-Length, paid: Full-Length Test 1 scored (score + disclosure), Full-Length Test 2 in progress (Resume, the one primary), Full-Length Test 3 not started; Before you start; panel: score history and mastery",
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
      expectText: "In progress: Reading & Writing, Module 2",
      prototype: {
        kind: "screen",
        file: "FullLength.dc.html",
        plan: "paid",
        note: "Full-Length, plan = paid",
      },
    },
    {
      id: "tests-paid-loading",
      title:
        'QA2-F (Karl, 2026-10-08: "Full-Length cards: no layout shift on load"): Full-Length, paid, while the tests list loads (`GET /api/tests/forms` held in the browser). The loading rows hold the loaded rows\' size, so nothing moves when they land',
      persona: "paid",
      route: "/tests",
      waitFor: {
        desktop: '[data-testid="tests-list"]',
        mobile: '[data-testid="tests-list"]',
      },
      holdRequest: { method: "GET", path: "/api/tests/forms" },
      extraViewports: [W1024],
      prototype: {
        kind: "none",
        reason: "A loading state the prototype does not draw.",
      },
    },
    {
      id: "tests-paid-load-shift",
      title:
        "QA2-F: Full-Length, paid, loaded over a slow network (every `/api/` answer 600ms late): the page's layout shift during load must stay under 0.01 (the run fails otherwise); the measured sum and its largest shifts are under each shot",
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
      expectText: "In progress: Reading & Writing, Module 2",
      layoutShift: { max: 0.01, apiDelayMs: 600 },
      extraViewports: [W1024],
      prototype: {
        kind: "none",
        reason:
          "A measurement of the load; the loaded page is the tests-paid shot.",
      },
    },
    {
      id: "home-full-length-load-shift",
      title:
        "QA2-F: Home's Full-Length card (paid), loaded over a slow network (every `/api/` answer 600ms late): the page's layout shift during load must stay under 0.01 (the run fails otherwise); the measured sum and its largest shifts are under each shot",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-full-length"]',
        mobile: '[data-testid="home-full-length"]',
      },
      layoutShift: { max: 0.01, apiDelayMs: 600 },
      extraViewports: [W1024],
      prototype: {
        kind: "none",
        reason: "A measurement of the load; Home itself is UI-50's.",
      },
    },
    {
      id: "home-full-length-load-shift-free",
      title:
        "QA2-F: Home's Full-Length card (free: the locked action), loaded over a slow network: layout shift during load under 0.01",
      persona: "free",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-full-length"]',
        mobile: '[data-testid="home-full-length"]',
      },
      layoutShift: { max: 0.01, apiDelayMs: 600 },
      extraViewports: [W1024],
      prototype: {
        kind: "none",
        reason: "A measurement of the load; Home itself is UI-50's.",
      },
    },
    {
      id: "tests-paid-full",
      title:
        "Full-Length, paid, full page (on a phone the right panel stacks under the main column; the footer ends the column)",
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
      expectText: "In progress: Reading & Writing, Module 2",
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "FullLength.dc.html",
        plan: "paid",
        note: "Full-Length, plan = paid (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "tests-phone-notice",
      title:
        'Full-Length on a phone (OQ-63): Resume asks the shared pre-start check, "Full-length tests are built for a laptop or tablet, like test day." with Continue anyway and Close; nothing opened yet. Desktop: no tap, no notice (control)',
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
      steps: [
        {
          click: { desktop: null, mobile: '[data-testid="tests-resume"]' },
        },
      ],
      expectVisible: '[data-testid="tests-home"]',
      prototype: {
        kind: "none",
        reason:
          "The prototypes have no phone layout; the notice is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).",
      },
    },
    {
      id: "report-scored",
      title:
        "Exam report (Focus shell), the scored Full-Length Test 1: total out of 1600, sections out of 800, the disclosure; Knowledge and skills, seven segments per domain",
      persona: "paid",
      route: "/tests/{paid.scoredExamSessionId}/report",
      waitFor: REPORT,
      prototype: {
        kind: "screen",
        file: "Report.dc.html",
        note: "Report",
      },
    },
    {
      id: "report-scored-full",
      title:
        "Exam report, full page (on a phone the score card stacks above Knowledge and skills)",
      persona: "paid",
      route: "/tests/{paid.scoredExamSessionId}/report",
      waitFor: REPORT,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Report.dc.html",
        note: "Report (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "timed-module",
      title:
        "The timed module (Full-Length Test 2, Reading and Writing Module 2): Bluebook layout kept, no back arrow, light only; type on the student tokens",
      persona: "paid",
      route: "/tests/{paid.inProgressExamSessionId}/RW/2",
      waitFor: {
        desktop: '[data-testid="exam-module"] [data-testid="exam-choice"]',
        mobile: '[data-testid="exam-module"] [data-testid="exam-choice"]',
      },
      themes: ["light"],
      // F-69 (owner ruling 2026-10-05): the module shares the Focus shell, so it is also shot at
      // tablet width and must fit the viewport with the bar in view at every size.
      extraViewports: [
        { name: "tablet", width: 820, height: 1180, selectors: "mobile" },
      ],
      expectFitsViewport: {
        topBar: '[data-testid="focus-shell-header"]',
        unscrolled: "main#main",
      },
      prototype: {
        kind: "none",
        reason:
          "No prototype draws the timed module: DESIGN.md §2 keeps its shipped Bluebook layout (E7b), light only.",
      },
    },
    {
      id: "click-paid-resume",
      title:
        "Click path (paid): Resume, the page's one primary action (at 390 through the shared pre-start check's Continue anyway), lands on the exam session route and on to the active module",
      persona: "paid",
      route: "/tests",
      waitFor: {
        desktop: '[data-testid="tests-resume"]',
        mobile: '[data-testid="tests-resume"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="tests-resume"]',
            mobile: '[data-testid="tests-resume"]',
          },
        },
        CONTINUE_ANYWAY,
      ],
      expectPath: "^/tests/[0-9a-f-]{36}(/RW/[12])?$",
      prototype: {
        kind: "none",
        reason:
          "A click path; its proof is the landing path (the prototype's Resume is not wired).",
      },
    },
    {
      id: "click-paid-start-pending",
      title:
        "QA item 5: a test's Start pressed (at 390 after Continue anyway), the create held in flight: 'Starting…' with a spinner, disabled",
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
      holdRequest: { method: "POST", path: "/api/tests/sessions" },
      steps: [
        {
          click: {
            desktop: '[data-testid="tests-start"]',
            mobile: '[data-testid="tests-start"]',
          },
        },
        CONTINUE_ANYWAY,
      ],
      expectVisible: '[data-testid="tests-start"][aria-busy="true"]',
      prototype: {
        kind: "none",
        reason:
          "A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).",
      },
    },
  ],
};
