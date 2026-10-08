/**
 * UI-53: the practice and review runners (Focus shell), selected, answered right and answered
 * wrong, and the click path to the next question.
 *
 * @spec [student-UI register §6 Wave 5 UI-53 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); design/DESIGN.md §4 Question
 *        runner; design/prototype/Runner.dc.html; OQ-4 (390px, light and dark); OQ-35]
 *        | @implemented [2026-10-03]
 *
 * plain English: every capture starts its own session through the real create route (paid
 * persona, so the free quota does not run out across 4 captures per shot) and ends it after,
 * so each viewport x theme shows question 1. Choices are picked by what they are ("correct",
 * "incorrect", "first"), resolved by capture.ts from the served item's stored order in the
 * harness database: the page itself never knows which choice is right. The prototype is
 * clicked into the same state: Runner.dc.html's correct choice is its second (LYC_CORRECT = 1).
 *
 * OQ-54 (a) / OQ-57 (f), owner ruling 2026-10-05: the review runner's LISA panel is on the
 * student tokens and the runner follows the device theme. Two shots show the panel itself (on a
 * phone it stacks under the question, and the steps scroll it into view): in use (a first message sent, LISA's typing
 * dots, the turn request held in the browser as UI-56 does) and, for the free student, the LISA
 * card that replaces the composer when the server refuses the panel's on-load lookup.
 */
import { SEED_CLIENT_INSTANCE } from "../seed";
import type { FreshSession, PageGroup, Step } from "./types";

const RUNNER = {
  desktop: '[data-testid="runner-choice"]',
  mobile: '[data-testid="runner-choice"]',
} as const;

function both(selector: string): Step {
  return { click: { desktop: selector, mobile: selector } };
}

/** QA2 (2026-10-08): the 1024 width, with the desktop steps and selectors. */
const W1024 = {
  name: "w1024",
  width: 1024,
  height: 768,
  selectors: "desktop",
} as const;

const SUBMIT = both('[data-testid="runner-footer"] button:has-text("Submit")');
const NEXT = both(
  '[data-testid="runner-footer"] button:has-text("Next question")',
);

/** Math, so the bar shows Calculator and Reference as Runner.dc.html does. */
const PRACTICE: FreshSession = {
  engine: "practice",
  body: { sections: ["M"], target_question_count: 10 },
  mcqFirst: true,
};
/**
 * The student's own misses, Reading and Writing only (the paid seed leaves misses in both
 * sections). Queue mode serves the queue's head first, and once the Math multiple-choice misses
 * at its head graduate (a right answer in an earlier capture), the head is a grid-in every time.
 */
const REVIEW: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["RW"] }, target_count: 10 },
  mcqFirst: true,
};
/** OQ-35: more questions asked for than the harness bank has in one Math domain. */
const SHORTENED: FreshSession = {
  engine: "practice",
  body: {
    sections: ["M"],
    domains: ["Geometry and Trigonometry"],
    target_question_count: 30,
  },
  mcqFirst: true,
};

const CLIENT = { lyceon_client_instance_id: SEED_CLIENT_INSTANCE } as const;
/**
 * QA2-D (2026-10-08): on a phone LISA starts closed, so a shot that needs the panel there first
 * taps the bar's LISA icon (desktop: LISA is already open beside the question).
 */
const OPEN_LISA_ON_PHONE: Step = {
  click: { desktop: null, mobile: '[data-testid="practice-tutor-toggle"]' },
};
/** QA2-D: wait for the composer on desktop; on a phone, for the runner (LISA starts closed). */
const LISA_OR_RUNNER = {
  desktop: '[data-testid="scoped-tutor-panel"] textarea[aria-label="Message"]',
  mobile: '[data-testid="runner-choice"]',
} as const;
/** The review runner's LISA composer (ScopedTutorPanel). */
const LISA_COMPOSER = {
  desktop: '[data-testid="scoped-tutor-panel"] textarea[aria-label="Message"]',
  mobile: '[data-testid="scoped-tutor-panel"] textarea[aria-label="Message"]',
} as const;
/**
 * F-69 (owner ruling 2026-10-05): the Focus shell is `100dvh` and scrolls only inside `<main>`,
 * so the document must fit the viewport with the shell's top bar in view, and the runner scrolls
 * inside itself, so `<main>` has nothing to scroll (no band below the footer). capture.ts fails
 * the capture otherwise. Asserted on both runners and on the LISA panel focused and in use.
 */
const FITS = {
  topBar: '[data-testid="focus-shell-header"]',
  unscrolled: "main#main",
} as const;
const PROTO_CHOICE = (n: number): string => `[role="radio"] >> nth=${n}`;
const PROTO_SUBMIT = 'button:has-text("Submit")';

export const UI_53: PageGroup = {
  id: "UI-53",
  title:
    "UI-53 Practice and review runners (Focus shell): selected, correct, incorrect, light and dark, 1440 and 390",
  shots: [
    {
      id: "practice-selected",
      title:
        "Practice runner, a choice selected (Submit enabled), before submitting",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "first" }],
      expectFitsViewport: FITS,
      prototype: {
        kind: "screen",
        file: "Runner.dc.html",
        steps: [PROTO_CHOICE(0)],
        state: "selected",
        note: "the first choice clicked",
      },
    },
    {
      id: "practice-correct",
      title:
        "Practice runner, answered right: 'Correct answer' on the pick, the 'Correct' panel with the explanation, Next question",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "correct" }, SUBMIT],
      prototype: {
        kind: "screen",
        file: "Runner.dc.html",
        steps: [PROTO_CHOICE(1), PROTO_SUBMIT],
        state: "correct",
        note: "the correct (second) choice, then Submit",
      },
    },
    {
      id: "practice-incorrect",
      title:
        "Practice runner, answered wrong: 'Your answer' and 'Correct answer' tags, 'Not quite', the explanation, the review-queue note",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "incorrect" }, SUBMIT],
      prototype: {
        kind: "screen",
        file: "Runner.dc.html",
        steps: [PROTO_CHOICE(0), PROTO_SUBMIT],
        state: "incorrect",
        note: "a wrong (first) choice, then Submit",
      },
    },
    {
      id: "review-selected",
      title:
        "Review runner, a choice selected, before submitting (LISA beside the question at 1440)",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "first" }],
      expectFitsViewport: FITS,
      prototype: {
        kind: "screen",
        file: "Runner.dc.html",
        steps: [PROTO_CHOICE(0)],
        state: "selected",
        note: "the first choice clicked (the canvas draws the practice runner; there is no review canvas)",
      },
    },
    {
      id: "review-correct",
      title: "Review runner, answered right",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "correct" }, SUBMIT],
      prototype: {
        kind: "screen",
        file: "Runner.dc.html",
        steps: [PROTO_CHOICE(1), PROTO_SUBMIT],
        state: "correct",
        note: "the correct (second) choice, then Submit",
      },
    },
    {
      id: "review-incorrect",
      title:
        "Review runner, answered wrong (no review-queue note: the question is already in the queue)",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "incorrect" }, SUBMIT],
      prototype: {
        kind: "screen",
        file: "Runner.dc.html",
        steps: [PROTO_CHOICE(0), PROTO_SUBMIT],
        state: "incorrect",
        note: "a wrong (first) choice, then Submit",
      },
    },
    {
      id: "review-lisa-typing",
      title:
        "Review runner, LISA panel in use (OQ-54 (a), ruling 2026-10-05: student tokens, follows the device theme): a first message typed and sent creates the item's conversation (real POST /api/tutor/conversations); the student's bubble and LISA's typing dots show in the panel, and Send reads 'Sending…' (QA 2026-10-07 item 5). The turn request is held in the browser, so no turn runs. On a phone the panel stacks under the question; typing into it scrolls it into view",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: LISA_OR_RUNNER,
      holdRequest: { method: "POST", path: "/api/tutor/messages" },
      steps: [
        OPEN_LISA_ON_PHONE,
        {
          fill: {
            desktop: LISA_COMPOSER.desktop,
            mobile: LISA_COMPOSER.mobile,
          },
          value: "How should I start this one?",
        },
        both(
          '[data-testid="scoped-tutor-panel"] button[aria-label="Send message"]',
        ),
      ],
      expectVisible:
        '[data-testid="scoped-tutor-panel"] button[aria-label="Send message"][data-pending="true"]',
      expectFitsViewport: FITS,
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d), ruling W4-4 keeps LISA in the review runner). The panel reuses the UI-56 thread parts (Lisa.dc.html).",
      },
    },
    {
      id: "review-lisa-focused",
      title:
        "Review runner, the LISA composer focused (F-69, owner ruling 2026-10-05): the Focus shell's top bar stays in view and the document is the viewport's height (no blank band under the footer); on a phone the focus scrolls the panel into view inside the shell, never the window",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: LISA_OR_RUNNER,
      steps: [
        OPEN_LISA_ON_PHONE,
        {
          focus: {
            desktop: LISA_COMPOSER.desktop,
            mobile: LISA_COMPOSER.mobile,
          },
        },
      ],
      expectFitsViewport: FITS,
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). F-69's proof shot: the shell's top bar with the composer focused.",
      },
    },
    {
      id: "review-lisa-show",
      title:
        "QA 2026-10-07 item 8 and QA2-D (2026-10-08): at 1440 LISA hidden with the bar's toggle, then shown again beside the question (nothing scrolls). On a phone LISA starts closed, and one tap on the bar's LISA icon opens it scrolled into view inside the shell, its header at the top of the runner's scroll area",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: LISA_OR_RUNNER,
      steps: [
        {
          click: {
            desktop: '[data-testid="practice-tutor-toggle"]',
            mobile: null,
          },
        },
        both('[data-testid="practice-tutor-toggle"]'),
      ],
      expectVisible: '[data-testid="scoped-tutor-panel"]',
      expectInView: '[data-testid="scoped-tutor-panel"]',
      expectFitsViewport: FITS,
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)). QA item 8's proof shot: Show LISA on a phone brings the panel into view.",
      },
    },
    {
      id: "review-lisa-phone-return",
      title:
        'QA2-D (Karl, 2026-10-08: "tapping the icon always brings it into view"): on a phone LISA opened, then the runner scrolled back up to the question (the first choice focused), then the LISA icon tapped again: the open panel is brought back into view, not closed. Desktop: LISA beside the question, untouched (control)',
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: LISA_OR_RUNNER,
      steps: [
        OPEN_LISA_ON_PHONE,
        { focus: { desktop: null, mobile: '[data-testid="runner-choice"]' } },
        OPEN_LISA_ON_PHONE,
      ],
      expectVisible: '[data-testid="scoped-tutor-panel"]',
      expectInView: '[data-testid="scoped-tutor-panel"]',
      expectFitsViewport: FITS,
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)).",
      },
    },
    {
      id: "review-lisa-locked",
      title:
        "Review runner, free student: the server refuses LISA's on-load lookup, so the panel shows the LISA card (approved copy: LISA's headline and the prototype body, OQ-44) with Unlock LISA in place of the composer. The app's upgrade modal opens on the refusal (UI-44) and is closed with Not now before the shot; a click on the panel's question chip scrolls the panel into view (on a phone it stacks under the question)",
      persona: "free",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: {
        desktop: '[data-testid="lisa-upgrade"]',
        mobile: '[data-testid="runner-choice"]',
      },
      steps: [
        OPEN_LISA_ON_PHONE,
        both('[data-testid="upgrade-modal"] button:has-text("Not now")'),
        both('[data-testid="tutor-question-chip"]'),
      ],
      expectVisible: '[data-testid="lisa-upgrade-unlock"]',
      expectGone: '[data-testid="upgrade-modal"]',
      prototype: {
        kind: "none",
        reason:
          "Not prototyped in the runner: the card is the Lisa.dc.html free card (plan = free) sized for the review runner's LISA panel.",
      },
    },
    {
      id: "practice-calculator",
      title:
        'QA2-B (Karl, 2026-10-08: "Desmos: invertedColors when the app theme is dark"): the practice runner with the Graphing calculator open. Dark: Desmos draws inverted (dark) to match the page; light: Desmos\'s own light look. Desmos itself shows only in a run with STUDENT_HARNESS_DESMOS=1 (see Run facts)',
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [both('[data-testid="practice-calculator-toggle"]')],
      expectVisible: '[data-testid="desmos-calculator"]',
      extraViewports: [W1024],
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Runner.dc.html draws no calculator content; Desmos's own UI is Desmos's.",
      },
    },
    {
      id: "practice-calculator-scientific",
      title:
        "QA2-B: the same runner with the calculator switched to Scientific (our mode switch, then Desmos's scientific calculator, inverted in dark)",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [
        both('[data-testid="practice-calculator-toggle"]'),
        both('[data-testid="desmos-mode-scientific"]'),
      ],
      expectVisible:
        '[data-testid="desmos-mode-scientific"][aria-checked="true"]',
      extraViewports: [W1024],
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Runner.dc.html draws no calculator content; Desmos's own UI is Desmos's.",
      },
    },
    {
      id: "review-lisa-phone-default",
      title:
        'QA2-D (Karl, 2026-10-08: "Phone: the LISA panel defaults closed"): the review runner on load. At 390 (LISA stacks under the question) the panel is closed and the bar\'s LISA icon offers it; at 1024 and 1440 LISA is beside the question, open, as before',
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      extraViewports: [W1024],
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Runner.dc.html does not draw LISA (OQ-54 (d)).",
      },
    },
    {
      id: "practice-shortened",
      title:
        "Practice runner, a session shorter than asked for: OQ-35's sentence, no number",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: SHORTENED,
      localStorage: CLIENT,
      waitFor: {
        desktop: '[data-testid="runner-shorter-note"]',
        mobile: '[data-testid="runner-shorter-note"]',
      },
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: OQ-35's ruled sentence (owner ruling 2026-10-02), shown on the first question of a shortened session.",
      },
    },
    {
      id: "click-practice-next",
      title:
        "Click path (practice): choose, Submit, Next question lands on 'Question 2 of M'",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [{ pick: "first" }, SUBMIT, NEXT],
      expectText: "Question 2 of 10",
      prototype: {
        kind: "none",
        reason:
          "A click path: the screenshot is where Next landed, proven by the 'Question 2 of 10' text the capture waited for.",
      },
    },
    {
      id: "practice-skip-pending",
      title:
        "QA item 5: Skip pressed, the skip held in flight: 'Skipping…' with a spinner, Skip and Submit disabled",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      holdRequest: { method: "POST", path: "/api/practice/sessions/*/skip" },
      steps: [both('[data-testid="runner-skip"]')],
      expectVisible: '[data-testid="runner-skip"][aria-busy="true"]',
      prototype: {
        kind: "none",
        reason:
          "A pending state the prototype does not draw (owner QA list, 2026-10-07, item 5).",
      },
    },
  ],
};
