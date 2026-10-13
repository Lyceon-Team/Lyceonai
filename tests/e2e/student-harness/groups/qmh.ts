/**
 * QMH: the question header (domain · skill · difficulty) on the practice, review and diagnostic
 * runners, and its absence from the timed full-length module.
 *
 * @spec [owner brief "Question metadata header" (Karl, 2026-10-13) §1 ("Screenshots: light/dark,
 *        1440/390"); DESIGN.md §5 UI standards (screenshots light and dark, 1440 and 390)]
 *        | @implemented [2026-10-13]
 *
 * plain English: each runner shot starts its own session through the real create route (the
 * diagnostic through Home's real "Start diagnostic" click, as UI-50's click path does) and is
 * taken before any answer, so the header is shown on the pre-submit screen. At 1440 the header is
 * one row; at 390 it is domain · difficulty with the skill on a second row. The capture fails
 * unless the header is wholly in the viewport. The timed module is shot light only (DESIGN.md §2)
 * to show it carries no header.
 */
import { SEED_CLIENT_INSTANCE } from "../seed";
import type { FreshSession, PageGroup } from "./types";

const HEADER = '[data-testid="question-meta"]';
const RUNNER = {
  desktop: '[data-testid="runner-choice"]',
  mobile: '[data-testid="runner-choice"]',
} as const;
const CLIENT = { lyceon_client_instance_id: SEED_CLIENT_INSTANCE } as const;
const FITS = {
  topBar: '[data-testid="focus-shell-header"]',
  unscrolled: "main#main",
} as const;

/** Math, so the header sits under a bar with Calculator and Reference. */
const PRACTICE: FreshSession = {
  engine: "practice",
  body: { sections: ["M"], target_question_count: 10 },
  mcqFirst: true,
};
/** The student's own Reading and Writing misses (as UI-53's review shots). */
const REVIEW: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["RW"] }, target_count: 10 },
  mcqFirst: true,
};

const NO_PROTOTYPE =
  "No prototype draws the question header: it is the owner brief of 2026-10-13 (Runner.dc.html predates it).";

export const QMH: PageGroup = {
  id: "QMH",
  title:
    "Question header (domain · skill · difficulty): practice, review and diagnostic runners, light and dark, 1440 and 390; none on the timed module",
  // The paid student's in-progress full-length test, for the timed-module shot (as UI-54).
  seed: "exam-history",
  shots: [
    {
      id: "practice",
      title:
        "Practice runner, before submitting: the header above the question (1440: one row; 390: domain · difficulty, then the skill)",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      expectInViewport: HEADER,
      expectFitsViewport: FITS,
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "review",
      title:
        "Review runner, before submitting: the same header (LISA beside the question at 1440)",
      persona: "paid",
      route: "/review/session/{session}",
      freshSession: REVIEW,
      localStorage: CLIENT,
      waitFor: RUNNER,
      expectInViewport: HEADER,
      expectFitsViewport: FITS,
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "diagnostic",
      title:
        "Diagnostic runner (reached by Home's 'Start diagnostic'), before submitting: the same header",
      persona: "free",
      route: "/dashboard",
      // One client instance for all four captures: the first click starts the diagnostic and
      // binds it; the later ones resume it from the same instance instead of a session conflict.
      localStorage: CLIENT,
      waitFor: {
        desktop: '[data-testid="home-start-diagnostic"]',
        mobile: '[data-testid="home-start-diagnostic"]',
      },
      steps: [
        {
          click: {
            desktop: '[data-testid="home-start-diagnostic"]',
            mobile: '[data-testid="home-start-diagnostic"]',
          },
        },
      ],
      expectPath: "^/practice/session/[0-9a-f-]{36}$",
      expectInViewport: HEADER,
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "timed-module",
      title:
        "The timed module (Reading and Writing Module 2): no question header, Bluebook layout kept, light only",
      persona: "paid",
      route: "/tests/{paid.inProgressExamSessionId}/RW/2",
      waitFor: {
        desktop: '[data-testid="exam-module"] [data-testid="exam-choice"]',
        mobile: '[data-testid="exam-module"] [data-testid="exam-choice"]',
      },
      themes: ["light"],
      expectFitsViewport: FITS,
      prototype: {
        kind: "none",
        reason:
          "No prototype draws the timed module: DESIGN.md §2 keeps its Bluebook layout, light only. Shown for the header's absence.",
      },
    },
  ],
};
