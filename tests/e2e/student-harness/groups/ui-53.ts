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
  ],
};
