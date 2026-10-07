/**
 * UI-41: the three shells (App shell with rail lock states, Focus shell, Bare card).
 *
 * @spec [student-UI register §6 Wave 4 UI-41; design/DESIGN.md §2 (shells, free plan locks,
 *        mobile; tab bar and avatar menu per the owner ruling, Karl, 2026-10-05, superseding
 *        OQ-4, OQ-48 and the Full-Length part of OQ-62: tabs Home, Review, Practice, Calendar,
 *        LISA; menu Settings, Help, Sign out; Full-Length on a phone from Home's card or a
 *        calendar block; register §8 F-70, the avatar menu follows the page theme)]
 *        | @implemented [2026-10-03; avatar menu shots 2026-10-05]
 *
 * plain English: one shot per shell state UI-41 owns, each paired with the closest signed-off
 * prototype screen. The prototypes have no Bare card screen (DESIGN.md §2 describes it in words
 * only), so login and 404 carry no prototype.
 */
import { SEED_CLIENT_INSTANCE } from "../seed";
import type { PageGroup } from "./types";

const OPEN_LISA_LOCK = {
  click: {
    desktop: '[data-testid="rail-lisa"]',
    mobile: '[data-testid="tab-lisa"]',
  },
} as const;

/**
 * The free student has not taken the diagnostic, so Home opens DiagnosticPromptModal on load;
 * "Maybe later" writes this sessionStorage key. Preset so the shell is not under the modal.
 * Since UI-50 (2026-10-03) Home has no such modal, so the preset is a no-op; it is kept so a
 * re-run of UI-41 renders the same conditions its committed screenshots were taken under.
 */
const DIAGNOSTIC_PROMPT_DISMISSED = {
  "lyceon:diagnostic_modal_dismissed": "1",
} as const;

/** QA 2026-10-07: a Math practice session (Calculator and Reference on the bar). */
const QA_MATH_PRACTICE = {
  engine: "practice",
  body: { sections: ["M"], target_question_count: 10 },
  mcqFirst: true,
} as const;

const QA_RUNNER = {
  desktop: '[data-testid="runner-footer"]',
  mobile: '[data-testid="runner-footer"]',
} as const;

export const UI_41: PageGroup = {
  id: "UI-41",
  // QA 2026-10-07: three unread notifications for the paid student, for the bell's badge and the
  // popover (db.ts `seedPaidNotifications`). The badge shot runs before any shot opens the
  // popover, because opening it marks every notification seen.
  seed: "notifications",
  title: "UI-41 shells: App shell (rail lock states), Focus shell, Bare card",
  shots: [
    {
      id: "app-dashboard-free",
      title:
        "App shell, /dashboard, free (Full-Length, Calendar and LISA locked)",
      persona: "free",
      route: "/dashboard",
      sessionStorage: DIAGNOSTIC_PROMPT_DISMISSED,
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "free",
        note: "Home, plan = free",
      },
    },
    {
      id: "app-dashboard-paid",
      title: "App shell, /dashboard, paid (no locks)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "paid",
        note: "Home, plan = paid",
      },
    },
    {
      id: "app-calendar-free",
      title:
        "App shell, /calendar, free (rail lock shown, page navigates and upsells)",
      persona: "free",
      route: "/calendar",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      prototype: {
        kind: "screen",
        file: "Calendar.dc.html",
        plan: "free",
        note: "Calendar, plan = free",
      },
    },
    {
      id: "app-chat-free",
      title: "App shell, /chat, free (LISA locked)",
      persona: "free",
      route: "/chat",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      prototype: {
        kind: "screen",
        file: "Lisa.dc.html",
        plan: "free",
        note: "LISA, plan = free",
      },
    },
    {
      id: "app-upgrade-modal-lisa-free",
      title:
        "Upgrade modal opened from the locked LISA rail item (free, on /dashboard)",
      persona: "free",
      route: "/dashboard",
      sessionStorage: DIAGNOSTIC_PROMPT_DISMISSED,
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [OPEN_LISA_LOCK],
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "free",
        steps: ['button[aria-label^="LISA"]'],
        note: "Home, plan = free, LISA rail item clicked",
      },
    },
    {
      id: "app-avatar-menu-paid",
      title:
        "App shell, /dashboard, paid: the avatar menu opened (390: Settings, Help, Sign out, in the page's theme; desktop since QA 2026-10-07 item 3: the same menu, opened beside the rail)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="button-user-menu"]',
            mobile: '[data-testid="button-user-menu"]',
          },
        },
      ],
      prototype: {
        kind: "none",
        reason:
          "The prototypes have no phone layout (fixed 1440x900 canvas); the avatar menu is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).",
      },
    },
    {
      id: "app-avatar-menu-free",
      title:
        "App shell, /dashboard, free: the avatar menu opened (390: Settings, Help, Sign out, no Full-Length; desktop since QA 2026-10-07 item 3: the same menu, beside the rail)",
      persona: "free",
      route: "/dashboard",
      sessionStorage: DIAGNOSTIC_PROMPT_DISMISSED,
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="button-user-menu"]',
            mobile: '[data-testid="button-user-menu"]',
          },
        },
      ],
      prototype: {
        kind: "none",
        reason:
          "The prototypes have no phone layout (fixed 1440x900 canvas); the avatar menu is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).",
      },
    },
    {
      id: "app-avatar-menu-light-locked",
      title:
        "App shell, /practice/topics (a page still pinned light, OQ-49), paid: the avatar menu opened (a light menu in both themes at both widths, F-70; desktop since QA 2026-10-07 item 3)",
      persona: "paid",
      route: "/practice/topics",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="button-user-menu"]',
            mobile: '[data-testid="button-user-menu"]',
          },
        },
      ],
      prototype: {
        kind: "none",
        reason:
          "The prototypes have no phone layout (fixed 1440x900 canvas); the menu's theme is register §8 F-70.",
      },
    },
    {
      id: "app-upgrade-modal-fulllength-free",
      title:
        "Upgrade modal opened from the locked Full-Length entry (390: Home's full-length card; desktop: the rail), free, on /dashboard",
      persona: "free",
      route: "/dashboard",
      sessionStorage: DIAGNOSTIC_PROMPT_DISMISSED,
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="rail-full-length"]',
            mobile: '[data-testid="home-full-length-start"]',
          },
        },
      ],
      expectVisible: '[data-testid="upgrade-modal"]',
      prototype: {
        kind: "screen",
        file: "Main.dc.html",
        plan: "free",
        steps: ['button[aria-label^="Full-Length"]'],
        state: "full-length-clicked",
        note: "Home, plan = free, Full-Length rail item clicked",
      },
    },
    {
      id: "focus-practice-runner",
      title:
        "Focus shell, practice runner (open Reading and Writing session, 3 of 10 answered)",
      persona: "free",
      route: "/practice/session/{free.openPracticeSessionId}",
      localStorage: { lyceon_client_instance_id: SEED_CLIENT_INSTANCE },
      prototype: {
        kind: "screen",
        file: "Runner.dc.html",
        note: "Question runner (no plan prop)",
      },
    },
    {
      id: "bare-login",
      title: "Bare card, /login, signed out",
      persona: "signed-out",
      route: "/login",
      prototype: {
        kind: "none",
        reason:
          "No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).",
      },
    },
    {
      id: "bare-404",
      title: "Bare card, 404 (signed in, paid)",
      persona: "paid",
      route: "/no-such-page",
      prototype: {
        kind: "none",
        reason:
          "No prototype screen for the Bare card; DESIGN.md §2 describes it in words (a centered card on --paper).",
      },
    },
    // ---- Production QA 2026-10-07 (Karl's walkthrough): items 2, 3, 5, 12, 13, 14. ----
    {
      id: "qa-bell-unread-badge-paid",
      title:
        "QA 13: the bell with its unread badge (three unread in-app notifications, seed 'notifications'), paid, /dashboard",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="notification-badge"]',
        mobile: '[data-testid="notification-badge"]',
      },
      prototype: {
        kind: "none",
        reason:
          "The prototypes draw no bell (OQ-47 placed it after sign-off); contracts/notifications.contract.md §3.",
      },
    },
    {
      id: "qa-notifications-popover-loading-paid",
      title:
        "QA 13: the notifications popover while its feed loads (GET /api/notifications held): the skeleton, not 'Loading…'",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      holdRequest: { method: "GET", path: "/api/notifications" },
      steps: [
        {
          click: {
            desktop: '[data-testid="button-notifications"]',
            mobile: '[data-testid="button-notifications"]',
          },
        },
      ],
      prototype: {
        kind: "none",
        reason:
          "The prototypes draw no bell (OQ-47 placed it after sign-off); contracts/notifications.contract.md §3.",
      },
    },
    {
      id: "qa-notifications-popover-paid",
      title:
        "QA 12/13: the notifications popover open with its items, on the student tokens, light and dark",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="button-notifications"]',
            mobile: '[data-testid="button-notifications"]',
          },
        },
      ],
      expectVisible: '[data-testid="notification-feed"] li',
      prototype: {
        kind: "none",
        reason:
          "The prototypes draw no bell (OQ-47 placed it after sign-off); contracts/notifications.contract.md §3.",
      },
    },
    {
      id: "qa-route-skeleton-nav-paid",
      title:
        "QA 5/12: Home → 'See every skill' with the Mastery page's code chunk held: what shows while the route loads",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="home-mastery"]',
        mobile: '[data-testid="home-mastery"]',
      },
      holdRequest: {
        method: "GET",
        path: "^/assets/mastery-[A-Za-z0-9_-]{8}\\.js$",
        match: "pattern",
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-mastery"] a[href="/mastery"]',
            mobile: '[data-testid="home-mastery"] a[href="/mastery"]',
          },
        },
      ],
      prototype: {
        kind: "none",
        reason: "A loading state; the prototypes draw none.",
      },
    },
    {
      id: "qa-route-skeleton-cold-paid",
      title:
        "QA 5/12: /mastery opened cold (a reload) with its code chunk held: the first paint while the route loads",
      persona: "paid",
      route: "/mastery",
      holdRequest: {
        method: "GET",
        path: "^/assets/mastery-[A-Za-z0-9_-]{8}\\.js$",
        match: "pattern",
      },
      prototype: {
        kind: "none",
        reason: "A loading state; the prototypes draw none.",
      },
    },
    {
      id: "qa-reference-sheet",
      title:
        "QA 2: the Math reference sheet opened from the practice runner (30-60-90 and 45-45-90 figures)",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: QA_MATH_PRACTICE,
      localStorage: { lyceon_client_instance_id: SEED_CLIENT_INSTANCE },
      waitFor: QA_RUNNER,
      steps: [
        {
          click: {
            desktop: 'button[aria-label="Reference"]',
            mobile: 'button[aria-label="Reference"]',
          },
        },
      ],
      expectVisible: '[data-testid="math-reference-sheet"]',
      prototype: {
        kind: "none",
        reason:
          "Runner.dc.html has a Reference button but no sheet; the figures follow the College Board SAT reference sheet.",
      },
    },
    {
      id: "qa-calculator-scientific",
      title:
        "QA 12: the calculator panel in the practice runner, Scientific selected (our mode switch around Desmos; Desmos itself is not loaded in the local-only harness)",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: QA_MATH_PRACTICE,
      localStorage: { lyceon_client_instance_id: SEED_CLIENT_INSTANCE },
      waitFor: QA_RUNNER,
      steps: [
        {
          click: {
            desktop: 'button[aria-label="Calculator"]',
            mobile: 'button[aria-label="Calculator"]',
          },
        },
        {
          click: {
            desktop: '[data-testid="desmos-mode-scientific"]',
            mobile: '[data-testid="desmos-mode-scientific"]',
          },
        },
      ],
      prototype: {
        kind: "none",
        reason: "Runner.dc.html draws no calculator panel.",
      },
    },
    {
      id: "qa-grid-in-submitted",
      title:
        "QA 12: a grid-in answered and submitted in the practice runner: the submitted answer's contrast",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: {
        engine: "practice",
        body: { sections: ["M"], target_question_count: 10 },
        gridInFirst: true,
      },
      localStorage: { lyceon_client_instance_id: SEED_CLIENT_INSTANCE },
      waitFor: {
        desktop: 'input[aria-label="Enter your answer"]',
        mobile: 'input[aria-label="Enter your answer"]',
      },
      steps: [
        {
          fill: {
            desktop: 'input[aria-label="Enter your answer"]',
            mobile: 'input[aria-label="Enter your answer"]',
          },
          value: "12",
        },
        {
          click: {
            desktop: '[data-testid="runner-footer"] button:has-text("Submit")',
            mobile: '[data-testid="runner-footer"] button:has-text("Submit")',
          },
        },
      ],
      prototype: {
        kind: "none",
        reason: "Runner.dc.html draws a multiple-choice item only.",
      },
    },
  ],
};
