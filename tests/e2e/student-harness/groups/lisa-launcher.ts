/**
 * LISA-LAUNCHER: the "Ask LISA" speech-bubble launcher and where it sits.
 *
 * @spec [owner brief "LISA launcher redesign + placement" (Karl, 2026-10-23, option D): "Proof:
 *        screenshots light/dark at 1440 and 1024: Home and Review (collapsed and expanded), a
 *        runner after a wrong answer (link + open panel), the free lock. New evidence group
 *        folder."; "Mind the harness rate limit (batch captures)"; DESIGN.md §5 (light and dark,
 *        1440 and 390)] | @implemented [2026-10-23]
 *
 * plain English: one group (LISA-LAUNCHER-2 was split off for the harness's old request limit and
 * merged back on 2026-10-24, rate-limit.ts). Every shot is taken at 1440 (desktop), 1024 (`w1024`)
 * and 390 (phone), light and dark. On the phone the launcher is not drawn (phones unchanged), so
 * the phone steps click nothing and the phone PNGs are the proof of absence. The `lisa-dock` seed
 * gives the paid student review history, LISA history (the conversation general mode opens on)
 * and practice. The wrong answer is picked by the harness from its own database (`pick:
 * "incorrect"`); the client never knows which choice is correct.
 */
import { SEED_CLIENT_INSTANCE } from "../seed";
import type { FreshSession, PageGroup, Step } from "./types";

const W1024 = {
  name: "w1024",
  width: 1024,
  height: 768,
  selectors: "desktop",
} as const;

const LAUNCHER = '[data-testid="chat-dock-bubble"]';
const ASK_AFTER_MISS = '[data-testid="runner-ask-lisa"]';

const OPEN: Step = { click: { desktop: LAUNCHER, mobile: null } };
const READY = {
  desktop: LAUNCHER,
  mobile: '[data-testid="app-tab-bar"]',
} as const;
const RUNNER = {
  desktop: '[data-testid="runner-choice"]',
  mobile: '[data-testid="runner-choice"]',
} as const;
const SUBMIT: Step = {
  click: {
    desktop: '[data-testid="runner-submit"]',
    mobile: '[data-testid="runner-submit"]',
  },
};
const CLIENT = { lyceon_client_instance_id: SEED_CLIENT_INSTANCE } as const;
const PRACTICE: FreshSession = {
  engine: "practice",
  body: { sections: ["RW"], target_question_count: 5 },
  mcqFirst: true,
};

const NO_PROTOTYPE =
  'No prototype draws the launcher: it is the owner brief of 2026-10-23 ("LISA launcher redesign + placement", option D); DESIGN.md §3 and §4 describe it.';

export const LISA_LAUNCHER: PageGroup = {
  id: "LISA-LAUNCHER",
  title:
    "LISA launcher: Home and Review, collapsed and expanded, in the middle column (never over the rail or the right panel); the free lock; the practice runner after a wrong answer ('Still confused? Ask LISA' and the panel it opens); light and dark, 1440, 1024 and 390",
  seed: "lisa-dock",
  shots: [
    {
      id: "home-collapsed",
      title:
        "Home (paid): the 'Ask LISA' launcher at the bottom-right of the middle column, left of the right panel. Phone: no launcher, the LISA tab as before",
      persona: "paid",
      route: "/dashboard",
      waitFor: READY,
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: { a: '[data-testid="app-shell-panel"]', b: LAUNCHER },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "home-expanded",
      title:
        "Home (paid): the launcher clicked; the panel (the sparkle and LISA in its header) opens upward inside the middle column, min(380px, column - 24px) wide",
      persona: "paid",
      route: "/dashboard",
      waitFor: READY,
      steps: [OPEN],
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: {
          a: '[data-testid="app-shell-panel"]',
          b: '[data-testid="chat-dock-panel"]',
        },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "review-collapsed",
      title:
        "Review (paid): the launcher at the bottom-right of the middle column",
      persona: "paid",
      route: "/review",
      waitFor: READY,
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: { a: '[data-testid="app-shell-panel"]', b: LAUNCHER },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "review-expanded",
      title: "Review (paid): the panel open in the middle column",
      persona: "paid",
      route: "/review",
      waitFor: READY,
      steps: [OPEN],
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: {
          a: '[data-testid="app-shell-panel"]',
          b: '[data-testid="chat-dock-panel"]',
        },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "home-free-lock",
      title:
        "Home (free): the same launcher with the lock in the sparkle's place ('Ask LISA, included with a paid plan')",
      persona: "free",
      route: "/dashboard",
      waitFor: READY,
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    // The practice runner after a wrong answer: shot as its own group (LISA-LAUNCHER-2) only to
    // stay under the harness's old request limit; merged back here on 2026-10-24 (owner ruling,
    // Karl, 2026-10-24; rate-limit.ts).
    {
      id: "runner-wrong-link",
      title:
        "Practice runner (paid), a wrong answer submitted: the muted 'Still confused? Ask LISA' link under the explanation, and the launcher above the footer. Phone: unchanged (no LISA in practice)",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      // Focusing the link brings it into view (it sits under the explanation, below the fold).
      steps: [
        { pick: "incorrect" },
        SUBMIT,
        { focus: { desktop: ASK_AFTER_MISS, mobile: null } },
      ],
      extraViewports: [W1024],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "runner-wrong-open",
      title:
        "Practice runner (paid): the link clicked; the panel opens scoped to the answered question ('Question N of M'), with the after-submit line 'Want to walk through this one? Ask me about any step.'",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [
        { pick: "incorrect" },
        SUBMIT,
        { click: { desktop: ASK_AFTER_MISS, mobile: null } },
      ],
      extraViewports: [W1024],
      expectNoOverlap: {
        desktop: {
          a: '[data-testid="runner-footer"]',
          b: '[data-testid="chat-dock-panel"]',
        },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
  ],
};
