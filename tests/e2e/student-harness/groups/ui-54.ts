/**
 * UI-54: Full-Length home (`/tests`), free and paid; the exam report; the timed module; and the
 * Resume click path.
 *
 * @spec [student-UI register §6 Wave 5 UI-54 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); design/DESIGN.md §2 (the
 *        timed module keeps its Bluebook layout, light only), §4 "Full-Length home", "Exam
 *        report"; design/prototype/FullLength.dc.html, Report.dc.html; OQ-4 (390px, light and
 *        dark); owner ruling (Karl, 2026-10-05): on phone widths the Full-Length home shows
 *        the laptop-or-tablet notice with "Continue anyway"] | @implemented [2026-10-03; phone
 *        notice 2026-10-05]
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
 * PHONE NOTICE (2026-10-05). At 390 the home first shows the notice ("tests-phone-notice", its own
 * shot); every other /tests shot taps "Continue anyway" at 390 (a step skipped on desktop, where
 * there is no notice), so its 390 rows are the home after the tap.
 */
import type { PageGroup } from "./types";

const TESTS_PAID = {
  desktop: '[data-testid="tests-history"]',
  mobile: '[data-testid="tests-phone-notice"]',
} as const;

/** 390 only: the Full-Length home's "Continue anyway" (owner ruling, Karl, 2026-10-05). */
const CONTINUE_ANYWAY = {
  click: {
    desktop: null,
    mobile: '[data-testid="tests-phone-notice"] button',
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
        "Full-Length, free: the in-page upgrade card; panel: the locked mastery card. No gated request (390: after Continue anyway)",
      persona: "free",
      route: "/tests",
      waitFor: {
        desktop: '[data-testid="tests-upgrade-card"]',
        mobile: '[data-testid="tests-phone-notice"]',
      },
      steps: [CONTINUE_ANYWAY],
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
        "Full-Length, paid: Practice Test 1 scored (score + disclosure), Practice Test 2 in progress (Resume, the one primary), Practice Test 3 not started; Before you start; panel: score history and mastery (390: after Continue anyway)",
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
      steps: [CONTINUE_ANYWAY],
      expectText: "In progress: Reading & Writing, Module 2",
      prototype: {
        kind: "screen",
        file: "FullLength.dc.html",
        plan: "paid",
        note: "Full-Length, plan = paid",
      },
    },
    {
      id: "tests-paid-full",
      title:
        "Full-Length, paid, full page (on a phone, after Continue anyway, the right panel stacks under the main column; the footer ends the column)",
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
      steps: [CONTINUE_ANYWAY],
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
        'Full-Length on a phone (owner ruling 2026-10-05): the title and "Full-length tests are built for a laptop or tablet, like test day." with Continue anyway. Desktop: no notice (control)',
      persona: "paid",
      route: "/tests",
      waitFor: TESTS_PAID,
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
        "Exam report (Focus shell), the scored Practice Test 1: total out of 1600, sections out of 800, the disclosure; Knowledge and skills, seven segments per domain",
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
        "The timed module (Practice Test 2, Reading and Writing Module 2): Bluebook layout kept, no back arrow, light only; type on the student tokens",
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
        "Click path (paid): Resume, the page's one primary action, lands on the exam session route and on to the active module",
      persona: "paid",
      route: "/tests",
      waitFor: {
        desktop: '[data-testid="tests-resume"]',
        mobile: '[data-testid="tests-phone-notice"]',
      },
      steps: [
        CONTINUE_ANYWAY,
        {
          click: {
            desktop: '[data-testid="tests-resume"]',
            mobile: '[data-testid="tests-resume"]',
          },
        },
      ],
      expectPath: "^/tests/[0-9a-f-]{36}(/RW/[12])?$",
      prototype: {
        kind: "none",
        reason:
          "A click path; its proof is the landing path (the prototype's Resume is not wired).",
      },
    },
  ],
};
