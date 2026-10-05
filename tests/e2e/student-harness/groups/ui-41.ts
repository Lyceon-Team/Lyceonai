/**
 * UI-41: the three shells (App shell with rail lock states, Focus shell, Bare card).
 *
 * @spec [student-UI register §6 Wave 4 UI-41; design/DESIGN.md §2 (shells, free plan locks,
 *        mobile OQ-4; tab bar and avatar menu per the owner ruling, Karl, 2026-10-05: tabs Home,
 *        Practice, Review, Calendar, LISA; menu Full-Length, Settings, Help, Sign out)]
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

export const UI_41: PageGroup = {
  id: "UI-41",
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
        "App shell, /dashboard, paid: the avatar menu opened (390: Full-Length, Settings, Help, Sign out; desktop: the rail, unchanged)",
      persona: "paid",
      route: "/dashboard",
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [
        {
          click: { desktop: null, mobile: '[data-testid="button-user-menu"]' },
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
        "App shell, /dashboard, free: the avatar menu opened (390: Full-Length first, with its lock; desktop: the rail, unchanged)",
      persona: "free",
      route: "/dashboard",
      sessionStorage: DIAGNOSTIC_PROMPT_DISMISSED,
      waitFor: {
        desktop: '[data-testid="app-rail"]',
        mobile: '[data-testid="app-tab-bar"]',
      },
      steps: [
        {
          click: { desktop: null, mobile: '[data-testid="button-user-menu"]' },
        },
      ],
      prototype: {
        kind: "none",
        reason:
          "The prototypes have no phone layout (fixed 1440x900 canvas); the avatar menu is the owner ruling of 2026-10-05 (DESIGN.md §2 Mobile).",
      },
    },
    {
      id: "app-upgrade-modal-fulllength-free",
      title:
        "Upgrade modal opened from the locked Full-Length entry (390: in the avatar menu; desktop: on the rail), free, on /dashboard",
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
            mobile: '[data-testid="button-user-menu"]',
          },
        },
        {
          click: { desktop: null, mobile: '[data-testid="menu-full-length"]' },
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
  ],
};
