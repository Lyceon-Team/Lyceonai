/**
 * UI-56: LISA (`/chat`), paid (a conversation with turns, the typing state, New session) and
 * free (the locked card, and Unlock LISA opening the upgrade modal).
 *
 * @spec [student-UI register §6 Wave 5 UI-56 ("side-by-side screenshot with the signed-off
 *        prototype ... and the page's main click path exercised"); DESIGN.md §2 (LISA's right
 *        panel is 320px, no slim footer), §3 (Typing indicator), §4 LISA;
 *        design/prototype/Lisa.dc.html (plan paid and free); OQ-4 (390px, light and dark)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the group asks for the "lisa-history" seed (seed.ts `seedLisaHistory`): five
 * conversations for the paid student created through the real create route, the newest with
 * the prototype's four turns, one ended, the oldest crisis-flagged. No tutor turn ever runs: the
 * typing shot types into the composer, presses Send, and the browser holds
 * `POST /api/tutor/messages` unanswered (`holdRequest`) while the page shows the student's
 * bubble, LISA's typing indicator and Send's pending state; the harness server refuses that
 * route anyway. New session creates nothing (QA 2026-10-07 item 9). Under 13 is not
 * captured: both harness personas are 13 or older (the age state is covered by
 * chat.ui56.test.tsx).
 */
import type { PageGroup } from "./types";

const CONVERSATION = "/chat?conversationId={paid.lisaConversationId}";

const TUTOR_BUBBLE = {
  desktop: '[data-testid="tutor-bubble"]',
  mobile: '[data-testid="tutor-bubble"]',
} as const;

const LOCKED = {
  desktop: '[data-testid="lisa-locked"]',
  mobile: '[data-testid="lisa-locked"]',
} as const;

const COMPOSER = 'textarea[aria-label="Message"]';

export const UI_56: PageGroup = {
  id: "UI-56",
  title:
    "UI-56 LISA (/chat): paid conversation, typing, New session; free locked card and Unlock LISA; light and dark, 1440 and 390",
  seed: "lisa-history",
  shots: [
    {
      id: "paid-conversation",
      title:
        'LISA, paid: the conversation in the 760px column (You / LISA labels), the composer and the disclaimer; panel: New session, "Your sessions" (Today / date), the open one current',
      persona: "paid",
      route: CONVERSATION,
      waitFor: TUTOR_BUBBLE,
      prototype: {
        kind: "screen",
        file: "Lisa.dc.html",
        plan: "paid",
        note: "LISA, plan = paid",
      },
    },
    {
      id: "paid-conversation-full",
      title:
        "LISA, paid, full page (on a phone the right panel stacks under the composer)",
      persona: "paid",
      route: CONVERSATION,
      waitFor: TUTOR_BUBBLE,
      fullPage: true,
      prototype: {
        kind: "screen",
        file: "Lisa.dc.html",
        plan: "paid",
        note: "LISA, plan = paid (the canvas is a fixed 1440x900)",
      },
    },
    {
      id: "paid-typing",
      title:
        "Click path (paid): type a message and press Send; the student's bubble shows at once, then LISA's typing bubble (three dots, still under reduced motion), and Send reads 'Sending…', disabled and busy, from the click (QA 2026-10-07 item 5). The request is held in the browser, so no turn runs",
      persona: "paid",
      route: CONVERSATION,
      waitFor: TUTOR_BUBBLE,
      holdRequest: { method: "POST", path: "/api/tutor/messages" },
      steps: [
        {
          fill: { desktop: COMPOSER, mobile: COMPOSER },
          value: "So the slope is -3/2?",
        },
        {
          click: {
            desktop: 'button[aria-label="Send message"]',
            mobile: 'button[aria-label="Send message"]',
          },
        },
      ],
      expectVisible: 'button[aria-label="Send message"][data-pending="true"]',
      prototype: {
        kind: "screen",
        file: "Lisa.dc.html",
        plan: "paid",
        note: "LISA, plan = paid (the canvas's typing state needs a typed draft; its steps are clicks only, so it is shown idle)",
      },
    },
    {
      id: "paid-new-session",
      title:
        'Click path (paid): New session opens an empty column under "New session" with the short prompt (QA 2026-10-07 items 9 and 15: nothing is created until the first message, so the history does not gain a blank session)',
      persona: "paid",
      route: CONVERSATION,
      waitFor: TUTOR_BUBBLE,
      steps: [
        {
          click: {
            desktop: '[data-testid="lisa-new-session"]',
            mobile: '[data-testid="lisa-new-session"]',
          },
        },
      ],
      expectGone: '[data-testid="tutor-bubble"]',
      expectVisible: '[data-testid="lisa-empty-prompt"]',
      prototype: {
        kind: "screen",
        file: "Lisa.dc.html",
        plan: "paid",
        steps: ['button:has-text("New session")'],
        state: "new-session",
        note: "LISA, plan = paid, New session clicked (the canvas does not clear its column)",
      },
    },
    {
      id: "paid-pick-session",
      title:
        'QA 2026-10-07 item 15 and titles: from the empty column, pick "Slope from standard form" in the history. On a phone (the history under the composer) the conversation and its composer come into view; at 1440 the column shows its last turn and the list keeps the pick in view. The history shows the crisis-flagged session as "Conversation", never its first message',
      persona: "paid",
      route: "/chat",
      waitFor: {
        desktop: '[data-testid="lisa-empty-prompt"]',
        mobile: '[data-testid="lisa-empty-prompt"]',
      },
      steps: [
        {
          click: {
            desktop:
              '[data-testid="lisa-history-item"]:has-text("Slope from standard form")',
            mobile:
              '[data-testid="lisa-history-item"]:has-text("Slope from standard form")',
          },
        },
      ],
      expectVisible: '[data-testid="tutor-bubble"]',
      prototype: {
        kind: "none",
        reason:
          "Not prototyped: Lisa.dc.html is a fixed 1440x900 canvas with no phone layout and no crisis-flagged history row (QA 2026-10-07 items 15 and 1).",
      },
    },
    {
      id: "free",
      title:
        'LISA, free: the locked card (shipped headline "A Tutor That Knows The SAT And Knows You", the prototype body, Unlock LISA); the right panel empty; no tutor request',
      persona: "free",
      route: "/chat",
      waitFor: LOCKED,
      prototype: {
        kind: "screen",
        file: "Lisa.dc.html",
        plan: "free",
        note: "LISA, plan = free",
      },
    },
    {
      id: "free-unlock",
      title:
        "Click path (free): Unlock LISA opens the upgrade modal for tutor_access (See plans, Not now)",
      persona: "free",
      route: "/chat",
      waitFor: LOCKED,
      steps: [
        {
          click: {
            desktop: '[data-testid="lisa-unlock"]',
            mobile: '[data-testid="lisa-unlock"]',
          },
        },
      ],
      expectVisible: '[data-testid="upgrade-modal"]',
      prototype: {
        kind: "screen",
        file: "Lisa.dc.html",
        plan: "free",
        steps: ['button[aria-label="LISA, included with a paid plan"]'],
        state: "modal",
        note: "LISA, plan = free, the locked LISA rail item clicked (the canvas's modal; its Unlock LISA is a plain link)",
      },
    },
  ],
};
