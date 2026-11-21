/**
 * Blog post: Desmos on the SAT (batch 2026-W48, Friday 2026-11-27).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-18]
 *
 * plain English: eight days before the December 5 test, how the Desmos calculator built into
 * Bluebook works: graphing and scientific modes, how the test version differs from desmos.com,
 * points of interest with two worked examples (our own, not SAT questions; recomputed), when to
 * skip the calculator, and how to practice. SAT facts are College Board's, Desmos facts are
 * Desmos's; the one Lyceon line is the approved W13 calculator claim, verbatim.
 */
import {
  CB_BLUEBOOK_TOOLS,
  CB_CALCULATOR,
  CB_SAT_DATES,
  CB_SAT_STUDENT_GUIDE,
  DESMOS_POINTS_OF_INTEREST,
  DESMOS_TESTING_CALCULATORS,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "desmos-on-the-sat",
  category: "Math",
  tags: ["sat-math", "bluebook"],
  batch: "2026-W48",
  publishAt: "2026-11-27T07:00",
  targetKeyword: "desmos sat",
  page: {
    title: "Desmos on the SAT: Using the Built-In Calculator | Lyceon",
    description:
      "Bluebook's built-in Desmos calculator works on every SAT Math question. See how it differs from the free website version and how to practice before test day.",
    h1: "Desmos on the SAT: Using the Built-In Calculator",
    intro: [
      {
        type: "p",
        text: "You can use a calculator on every SAT Math question, and Bluebook has a Desmos calculator built in. With the December 5 test eight days away, here's what it does, how it differs from the free Desmos website, and how to get comfortable with it before test day.",
        sources: [CB_CALCULATOR, CB_SAT_DATES],
      },
    ],
    sections: [
      {
        heading: "Graphing or scientific",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "The built-in calculator has two modes, graphing and scientific, and you can switch between them at any point in the Math section. It's available for the whole Math section, and you can drag it anywhere on the screen so it doesn't cover the question.",
            sources: [CB_CALCULATOR, CB_SAT_STUDENT_GUIDE, CB_BLUEBOOK_TOOLS],
          },
          {
            type: "p",
            text: "You can't use a calculator during Reading and Writing, and a handheld one has to stay under your desk for those modules.",
            sources: [CB_CALCULATOR],
          },
        ],
      },
      {
        heading: "How it differs from the website version",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Desmos says the calculators on the test may differ from the free ones on its website. The scientific calculator is the same. In the graphing calculator, images, folders and notes are turned off, and Log mode turns on by itself when you run an exponential, logarithmic or power regression.",
            sources: [DESMOS_TESTING_CALCULATORS],
          },
          {
            type: "p",
            text: "To practice with the exact testing versions, Desmos has a Testing page with the calculators set up the same way.",
            sources: [DESMOS_TESTING_CALCULATORS],
          },
        ],
      },
      {
        heading: "Points of interest",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Click a curve, or its equation, and Desmos marks its points of interest: maximums, minimums, intercepts and the places where two graphs cross.",
            sources: [DESMOS_POINTS_OF_INTEREST],
          },
          {
            type: "p",
            text: "To check a solution, graph each side of an equation as its own line. For 2x + 3 = 7 − x, enter y = 2x + 3 and y = 7 − x. They cross where x is about 1.333, which matches solving by hand: 3x = 4, so x = 4/3. For y = x² − 6x + 5, clicking the curve shows x-intercepts at 1 and 5 and a minimum at (3, −4). These are made-up examples, not SAT questions.",
            sources: [DESMOS_POINTS_OF_INTEREST],
          },
        ],
      },
      {
        heading: "When to skip the calculator",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board notes that some Math questions are better done without a calculator, even though you're allowed to use one. It suggests getting your thoughts down on the scratch paper you're given before you use it.",
            sources: [CB_CALCULATOR],
          },
        ],
      },
      {
        heading: "Your own calculator or Desmos?",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board encourages you to use the calculator you know best. You can bring your own approved handheld calculator instead, as long as it doesn't have computer algebra system (CAS) features. Don't bring one that's new to you.",
            sources: [CB_CALCULATOR],
          },
          {
            type: "p",
            text: "If your own calculator fails during the test and you have no backup, you can keep going with the built-in Desmos calculator.",
            sources: [CB_CALCULATOR],
          },
        ],
      },
      {
        heading: "Practice before December 5",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "To learn the built-in calculator, College Board suggests trying the Math section of the test preview in Bluebook or a Bluebook practice test. You can also use the free calculators on the Desmos website. Using it on real practice questions this week means test day isn't your first time.",
            sources: [CB_CALCULATOR, CB_SAT_STUDENT_GUIDE],
          },
          {
            type: "p",
            text: "Lyceon practice includes a built-in Desmos calculator on every Math question.",
            claims: ["W13"],
          },
          {
            type: "links",
            items: [
              {
                label: "SAT practice questions",
                href: "/sat-practice-questions",
              },
              {
                label: "Free SAT practice test",
                href: "/free-sat-practice-test",
              },
              { label: "SAT math formulas", href: "/blog/sat-math-formulas" },
            ],
          },
          { type: "cta" },
        ],
      },
    ],
    faq: [
      {
        question: "Can you use Desmos on the Reading and Writing section?",
        answer:
          "No. The built-in Desmos calculator is available for the Math section. During Reading and Writing, a handheld calculator has to stay under your desk.",
        sources: [CB_SAT_STUDENT_GUIDE, CB_CALCULATOR],
      },
      {
        question: "Is the Desmos on the SAT the same as the Desmos website?",
        answer:
          "Mostly. The scientific calculator is the same. The graphing calculator on the test has images, folders and notes turned off and turns on Log mode by itself for some regressions. Desmos's Testing page has the test versions for practice.",
        sources: [DESMOS_TESTING_CALCULATORS],
      },
    ],
  },
};

export default post;
