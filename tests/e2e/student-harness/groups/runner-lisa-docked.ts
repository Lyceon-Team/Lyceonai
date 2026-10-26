/**
 * RUNNER-LISA-DOCKED: the practice and review runners with LISA docked as their right column.
 *
 * @spec [owner brief "restore the pre-#1300 runner layout" (Karl, 2026-10-26): "Proof:
 *        screenshots light/dark at 1440x900 and 1366x650: LISA docked alone; calculator + LISA
 *        side by side; LISA minimized to the launcher. Plus the Chromebook 1280x650 / 1366x650
 *        shots for the report."; DESIGN.md §5 (light and dark, 1440 and 390)]
 *        | @implemented [2026-10-26]
 *
 * plain English: a review runner session per capture (the `lisa-dock` seed's review history).
 * Each shot at 1440x900 (desktop), 1366x650 (`w1366`, a Chromebook) and 1280x650 (`w1280`, the
 * other Chromebook size), and 390 (phone: LISA closed under the question, unchanged), light and
 * dark. One group: the harness's raised ceiling (rate-limit.ts) holds all of it in one run.
 */
import { SEED_CLIENT_INSTANCE } from "../seed";
import type { FreshSession, PageGroup, Step } from "./types";

const W1366 = {
  name: "w1366",
  width: 1366,
  height: 650,
  selectors: "desktop",
} as const;
const W1280 = {
  name: "w1280",
  width: 1280,
  height: 650,
  selectors: "desktop",
} as const;

/** Just below W3 (1278px, owner ruling on #1322): the calculator and LISA take turns. */
const W1277 = {
  name: "w1277",
  width: 1277,
  height: 650,
  selectors: "desktop",
} as const;

const PANEL = '[data-testid="chat-dock-panel"]';
// Below W3 LISA's launcher; at 1440 (where both stay open) the step lands on LISA's own header
// chip, a no-op, so the same shot runs at every size.
const LAUNCHER: Step = {
  click: {
    desktop:
      '[data-testid="chat-dock-bubble"]:visible, [data-testid="tutor-question-chip"]:visible',
    mobile: null,
  },
};
const RUNNER = {
  desktop: PANEL,
  mobile: '[data-testid="runner-submit"]',
} as const;
const CLIENT = { lyceon_client_instance_id: SEED_CLIENT_INSTANCE } as const;
const REVIEW_RW: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["RW"] }, target_count: 10 },
  mcqFirst: true,
};
// No mcqFirst: the calculator shots do not need choices, and the Math pool can lead with a
// grid-in for several starts in a row.
const REVIEW_MATH: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["M"] }, target_count: 10 },
};
const CALC: Step = {
  click: {
    desktop: '[data-testid="practice-calculator-toggle"]',
    mobile: '[data-testid="practice-calculator-toggle"]',
  },
};
const MINIMIZE: Step = {
  click: { desktop: '[data-testid="chat-dock-minimize"]', mobile: null },
};

const NO_PROTOTYPE =
  'The runner prototype (Runner.dc.html) has no LISA column; this is the pre-#1300 layout restored by the owner brief of 2026-10-26 ("restore the pre-#1300 runner layout"); DESIGN.md §4 Question runner describes it.';

export const RUNNER_LISA_DOCKED: PageGroup = {
  id: "RUNNER-LISA-DOCKED",
  title:
    "Runner with LISA docked as the right column: LISA alone, the calculator between the question and LISA (360px and 300px tiers), the below-W3 turn-taking, LISA minimized to the launcher; light and dark, 1440x900, 1366x650, 1280x650, 1277x650 and 390",
  seed: "lisa-dock",
  shots: [
    {
      id: "docked-alone",
      title:
        "Review runner (paid), on entry: LISA open as the docked right column, full height of the runner body, inset from the top-right corner. Phone: unchanged",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_RW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      extraViewports: [W1366, W1280],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "calculator-and-lisa",
      title:
        "Math review runner (paid), the calculator opened: between the question and LISA, its right edge LISA's left edge; LISA 360px from 1338px, 300px from W3 (1278px) to 1337px, so 1280x650 keeps all three side by side (owner ruling on #1322, Karl, 2026-10-26)",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_MATH,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [CALC],
      extraViewports: [W1366, W1280],
      expectNoOverlap: {
        desktop: {
          a: '[data-testid="desmos-calculator-shell"]',
          b: PANEL,
        },
        mobile: null,
      },
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "below-w3-calculator",
      title:
        "Below W3 (1277x650): the calculator opened takes LISA's place; LISA shows as its launcher (the last tool opened wins). At 1440 and on the phone the same steps show the wide and phone layouts",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_MATH,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [CALC],
      extraViewports: [W1277],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "below-w3-lisa",
      title:
        "Below W3 (1277x650): LISA reopened from its launcher; the calculator closes (its state kept) and LISA's column is back",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_MATH,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [CALC, LAUNCHER],
      extraViewports: [W1277],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "minimized",
      title:
        "Review runner (paid), LISA minimized: the column goes, the question takes the width back, and LISA is the 'Ask LISA' launcher above the footer",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_RW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [MINIMIZE],
      extraViewports: [W1366, W1280],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
  ],
};
