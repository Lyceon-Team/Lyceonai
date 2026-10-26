/**
 * LISA-DOCK: the LISA chat dock (floating bubble and panel) on Home, Review and the review runner,
 * the free student's lock, and its absence from phones and the live timed module.
 *
 * @spec [owner brief "LISA chat dock" (Karl, 2026-10-22): "Proof: screenshots light + dark at
 *        1440 and 1024: runner with dock collapsed/expanded; Home and Review with bubble and open
 *        dock; the free lock modal"; DESIGN.md §5 (screenshots light and dark, 1440 and 390)]
 *        | @implemented [2026-10-22]
 *
 * plain English: every shot is taken at 1440 (desktop) and 1024 (`w1024`, the desktop steps), and
 * at 390 (phone), light and dark. On the phone the dock is not drawn (the brief keeps phones
 * unchanged), so the phone steps click nothing and the phone PNGs are the proof of absence. The
 * `lisa-dock` seed gives the paid student review history (Review's queue; a review runner
 * session per capture), a live full-length module and LISA history (the conversation general mode
 * opens on, the newest active standalone one). No tutor turn runs in the harness.
 */
import { SEED_CLIENT_INSTANCE } from "../seed";
import type { FreshSession, PageGroup, Step } from "./types";

const W1024 = {
  name: "w1024",
  width: 1024,
  height: 768,
  selectors: "desktop",
} as const;

const BUBBLE = '[data-testid="chat-dock-bubble"]';
const PANEL = '[data-testid="chat-dock-panel"]';

/** Opens the dock at 1440 and 1024; nothing to click on a phone. */
const OPEN_DOCK: Step = { click: { desktop: BUBBLE, mobile: null } };

const HOME_READY = {
  desktop: BUBBLE,
  mobile: '[data-testid="app-tab-bar"]',
} as const;
const RUNNER = {
  desktop: '[data-testid="runner-choice"]',
  mobile: '[data-testid="runner-choice"]',
} as const;
const CLIENT = { lyceon_client_instance_id: SEED_CLIENT_INSTANCE } as const;
/** The student's own Reading and Writing misses (UI-53's review shots). */
const REVIEW: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["RW"] }, target_count: 10 },
  mcqFirst: true,
};

/** #1300 follow-ups: a practice session (ruling 2: the dock after submit). */
const PRACTICE: FreshSession = {
  engine: "practice",
  body: { sections: ["RW"], target_question_count: 5 },
  mcqFirst: true,
};
/** #1300 follow-ups: Math review (the calculator; ruling 5). */
const REVIEW_MATH: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["M"] }, target_count: 10 },
};
/** The split breakpoint (calculator-layout.ts SPLIT_BREAKPOINT): Desmos beside the question. */
const W1062 = {
  name: "w1062",
  width: 1062,
  height: 800,
  selectors: "desktop",
} as const;
const SUBMIT: Step = {
  click: {
    desktop: '[data-testid="runner-submit"]',
    mobile: '[data-testid="runner-submit"]',
  },
};
const CALC: Step = {
  click: {
    desktop: '[data-testid="practice-calculator-toggle"]',
    mobile: '[data-testid="practice-calculator-toggle"]',
  },
};

const NO_PROTOTYPE =
  'No prototype draws the chat dock: it is the owner brief of 2026-10-22 ("LISA chat dock", floating bubble, no bar); DESIGN.md §3 and §4 describe it.';

export const LISA_DOCK: PageGroup = {
  id: "LISA-DOCK",
  title:
    "LISA chat dock: Home, Review and the review runner, bubble and open dock; the free lock modal; absent on phones and the timed module; the practice runner before and after submit, Send as the outline icon, the calculator clear of the bubble; light and dark, 1440, 1062, 1024 and 390",
  seed: "lisa-dock",
  shots: [
    {
      id: "home-paid-bubble",
      title:
        "Home (paid): the LISA bubble bottom-right, collapsed (it never opens by itself). Phone: no bubble, the LISA tab as before",
      persona: "paid",
      route: "/dashboard",
      waitFor: HOME_READY,
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "home-paid-open",
      title:
        "Home (paid): the bubble clicked, the dock open in general mode on the student's latest LISA conversation (the one heading the LISA page's history), Open in LISA, Minimize and Close",
      persona: "paid",
      route: "/dashboard",
      waitFor: HOME_READY,
      steps: [OPEN_DOCK],
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "home-free-lock-modal",
      title:
        "Home (free): the bubble carries the rail's lock; clicked, it opens the existing upgrade modal for LISA (no tutor request)",
      persona: "free",
      route: "/dashboard",
      waitFor: HOME_READY,
      steps: [OPEN_DOCK],
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "home-paid-cookie-banner",
      title:
        "Home (paid), the cookie banner not yet answered: the bubble sits above the banner (measured through lib/bottom-chrome.ts), never under it",
      persona: "paid",
      route: "/dashboard",
      cookieBannerShown: true,
      waitFor: HOME_READY,
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: { a: '[data-testid="cookie-banner"]', b: BUBBLE },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "review-paid-bubble",
      title: "Review (paid): the LISA bubble, collapsed",
      persona: "paid",
      route: "/review",
      waitFor: HOME_READY,
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "review-paid-open",
      title: "Review (paid): the dock open in general mode",
      persona: "paid",
      route: "/review",
      waitFor: HOME_READY,
      steps: [OPEN_DOCK],
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "runner-collapsed",
      title:
        "Review runner (paid), before submitting: no side panel; the bubble above the Submit footer and clear of the choices. Phone: unchanged (Show LISA in the bar, LISA closed)",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: { a: '[data-testid="runner-footer"]', b: BUBBLE },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "runner-open",
      title:
        "Review runner (paid): the dock open in the current question's scope (the 'Question N of M' chip, the opener), above the footer; the question stays usable",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [OPEN_DOCK],
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: { a: '[data-testid="runner-footer"]', b: PANEL },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "timed-module",
      title:
        "The live timed module (Full-Length, Reading and Writing Module 2): no bubble and no dock (LISA never appears in a live test)",
      persona: "paid",
      route: "/tests/{paid.inProgressExamSessionId}/RW/2",
      waitFor: {
        desktop: '[data-testid="exam-module"] [data-testid="exam-choice"]',
        mobile: '[data-testid="exam-module"] [data-testid="exam-choice"]',
      },
      themes: ["light"],
      expectGone: BUBBLE,
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    // #1300 follow-ups (rulings 2, 4 and 5; Karl, 2026-10-23): the practice runner's dock after
    // submit, Send as the outline icon, the calculator kept clear of the bubble at 1024, 1062 and
    // 1440. Shot as their own group (LISA-DOCK-2) only to stay under the harness's old request
    // limit; merged back here on 2026-10-24, when the harness's ceiling was raised (owner ruling,
    // Karl, 2026-10-24; rate-limit.ts).
    {
      id: "practice-before-submit",
      title:
        "Practice runner (paid), before submitting: no bubble (owner ruling 2 on #1300: the dock comes only after submit)",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "first" }],
      expectGone: BUBBLE,
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "practice-after-submit-open",
      title:
        "Practice runner (paid), after submitting: the bubble appears above the footer; opened, the dock is scoped to the answered question, with Send as the outline paper-plane icon button (rulings 2 and 4 on #1300). Phone: unchanged, no LISA in practice",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "first" }, SUBMIT, OPEN_DOCK],
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "runner-calculator",
      title:
        "Math review runner with the calculator open (ruling 5 on #1300): beside the question (1062, 1440) Desmos keeps the bubble's footprint clear at its bottom; stacked (1024) the column already clears it",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_MATH,
      localStorage: CLIENT,
      waitFor: {
        desktop: '[data-testid="runner-submit"]',
        mobile: '[data-testid="runner-submit"]',
      },
      steps: [CALC],
      extraViewports: [W1024, W1062],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
  ],
};
