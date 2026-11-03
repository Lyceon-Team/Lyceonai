/**
 * LISA-QUICK-REPLIES: the walkthrough quick replies in the review runner's LISA.
 *
 * @spec [owner brief "Quick replies in walkthroughs" (Karl, 2026-11-02): "After every LISA reply in
 *        a walkthrough, show two taps: 'Got it, next step' and 'I'm stuck'. They're hidden while
 *        the student is typing, and free text always remains"; SCL-268; DESIGN.md §5 (light and
 *        dark, 1440 and 390)] | @implemented [2026-11-02]
 *
 * plain English: a review runner session per capture (the review history), LISA docked at 1440
 * and the phone's "Need help with this question?" strip at 390. "Walk me through it" is tapped and
 * served by the REAL tutor route against the harness's stub worker (server.ts, seed
 * `lisa-quick-replies`; a fixed LISA reply per intent). Three states: the taps under LISA's
 * walkthrough reply; the taps again under LISA's reply to "I'm stuck"; and the taps hidden while
 * the student types.
 */
import { SEED_CLIENT_INSTANCE } from "../seed";
import type { FreshSession, PageGroup, Step } from "./types";

const PANEL = '[data-testid="chat-dock-panel"]';
const STRIP = '[data-testid="guided-choices-bar"]';
const RUNNER = {
  desktop: PANEL,
  mobile: STRIP,
} as const;
const CLIENT = { lyceon_client_instance_id: SEED_CLIENT_INSTANCE } as const;
const REVIEW_MATH: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["M"] }, target_count: 10 },
  mcqFirst: true,
};

/** "Walk me through it": in the docked LISA at 1440; on the phone, the strip (it opens the panel). */
const WALK: Step = {
  click: {
    desktop: `${PANEL} [data-testid="tutor-choice-walkthrough"]`,
    mobile: `${STRIP} [data-testid="tutor-choice-walkthrough"]`,
  },
};
const STUCK: Step = {
  click: {
    desktop: '[data-testid="tutor-quick-reply-step_stuck"]',
    mobile: '[data-testid="tutor-quick-reply-step_stuck"]',
  },
};
/** Typing waits for the composer to be enabled again, i.e. for LISA's reply. */
const TYPE: Step = {
  fill: {
    desktop: 'textarea[aria-label="Message"]',
    mobile: 'textarea[aria-label="Message"]',
  },
  value: "Why do we",
};

const NO_PROTOTYPE =
  "No prototype draws LISA's walkthrough quick replies; they are specified by the owner brief \"Quick replies in walkthroughs\" (Karl, 2026-11-02) and SCL-268, and drawn with the guided choices' outline buttons (DESIGN.md §5: two actions, no filled primary).";

export const LISA_QUICK_REPLIES: PageGroup = {
  id: "LISA-QUICK-REPLIES",
  title:
    "LISA walkthrough quick replies in the review runner: under LISA's walkthrough reply, again under the reply to 'I'm stuck', and hidden while typing; light and dark, 1440 and 390",
  seed: "lisa-quick-replies",
  shots: [
    {
      id: "after-walkthrough-reply",
      title:
        "'Walk me through it' tapped: LISA's first step, then 'Got it, next step' and 'I'm stuck' under it; the composer is still there",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_MATH,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [WALK],
      expectText: "Got it, next step",
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "after-stuck-reply",
      title:
        "'I'm stuck' tapped: one LISA reply to it, and the two taps again under that reply",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_MATH,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [WALK, STUCK],
      expectText:
        "No problem, let's slow down. Look only at the left side: which number is attached to the variable, and how?",
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "typing-hides",
      title:
        "The student starts typing after LISA's walkthrough reply: the two taps are hidden while there is a draft",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW_MATH,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [WALK, TYPE],
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
  ],
};
