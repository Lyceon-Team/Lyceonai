/**
 * QMH: the question header (domain, skill and difficulty pills) on the practice, review and
 * diagnostic runners, and its absence from the timed full-length module.
 *
 * @spec [owner brief "Question metadata header" (Karl, 2026-10-13) §1 ("Screenshots: light/dark,
 *        1440/390"); owner rulings (Karl) 2026-10-13 on #1225 (neutral pills; the skill a focus
 *        stop that shows its full text, with a focused-skill shot at 390); DESIGN.md §4 Question
 *        runner, §5 UI standards (screenshots light and dark, 1440 and 390)]
 *        | @implemented [2026-10-13]
 *
 * plain English: each runner shot starts its own session through the real create route (the
 * diagnostic through Home's real "Start diagnostic" click, as UI-50's click path does) and is
 * taken before any answer. The `mastery-skills` seed retags the harness bank with the canonical
 * skill names (content/canonical/taxonomy.json), so the header shows real skills, and the
 * practice shots ask for one long one ("Ratios, Rates, Proportional Relationships, and Units"),
 * which wraps to two lines at 390. The focused shot gives the skill pill keyboard focus (a
 * `focus` step, F-69) to show the focus ring. The timed module needs the exam seed, so it is its
 * own group (QMH-EXAM), shot light only (DESIGN.md §2).
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

/** The longest first skill in the taxonomy, so the phone header shows the skill on two lines. */
const LONG_SKILL = "Ratios, Rates, Proportional Relationships, and Units";
const PRACTICE: FreshSession = {
  engine: "practice",
  body: {
    sections: ["M"],
    domains: ["Problem Solving and Data Analysis"],
    skills: [LONG_SKILL],
    target_question_count: 3,
  },
  mcqFirst: true,
};
/** The student's own Reading and Writing misses (as UI-53's review shots). */
const REVIEW: FreshSession = {
  engine: "review",
  body: { mode: "filter", filters: { sections: ["RW"] }, target_count: 10 },
  mcqFirst: true,
};

const NO_PROTOTYPE =
  "No prototype draws the question header: it is the owner brief of 2026-10-13 (Runner.dc.html predates it); DESIGN.md §4 describes it.";

export const QMH: PageGroup = {
  id: "QMH",
  title:
    "Question header (domain, skill and difficulty pills): practice, review and diagnostic runners, light and dark, 1440 and 390, and the skill focused at 390",
  // Canonical skill names on the harness bank (the base bank has one placeholder skill).
  seed: "mastery-skills",
  shots: [
    {
      id: "practice",
      title:
        "Practice runner, before submitting: the header above the question (1440: one row; 390: domain + difficulty, then the skill on two lines)",
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
      id: "practice-skill-focused",
      title:
        "Practice runner, the skill pill focused (the header's one tab stop): its focus ring, and the full skill name on focus (the 390 shot is the one the ruling asks for)",
      persona: "paid",
      route: "/practice/session/{session}",
      freshSession: PRACTICE,
      localStorage: CLIENT,
      waitFor: RUNNER,
      steps: [
        {
          focus: {
            desktop: '[data-testid="question-meta-skill-pill"]',
            mobile: '[data-testid="question-meta-skill-pill"]',
          },
        },
      ],
      expectInViewport: HEADER,
      prototype: { kind: "none", reason: NO_PROTOTYPE },
    },
    {
      id: "review",
      title:
        "Review runner, before submitting: the same header (LISA beside the question at 1440, its question chip on the same pill)",
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
  ],
};

/** The timed module needs the exam seed (the paid student's in-progress test), as UI-54. */
export const QMH_EXAM: PageGroup = {
  id: "QMH-EXAM",
  title:
    "Question header: none on the timed full-length module (light only, 1440 and 390)",
  seed: "exam-history",
  shots: [
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
