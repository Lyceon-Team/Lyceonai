/**
 * Blog post: Last-minute SAT prep (batch 2026-W45, Wednesday 2026-11-04).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-10-11]
 *
 * plain English: what to do in the three days before the Nov 7 test: exam setup, the Bluebook
 * test preview, the built-in calculator, one timed practice test, the timing, and the morning.
 * Every fact is College Board's; no Lyceon claim.
 */
import {
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_CALCULATOR,
  CB_DEVICE_READINESS,
  CB_PRACTICE,
  CB_SAT_DATES,
  CB_STRUCTURE,
  CB_WHAT_TO_BRING,
  CB_WHAT_TO_EXPECT,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "last-minute-sat-prep",
  category: "Test Day",
  tags: ["sat-test-day", "sat-prep"],
  batch: "2026-W45",
  publishAt: "2026-11-04T07:00",
  targetKeyword: "last minute sat prep",
  page: {
    title: "Last-Minute SAT Prep: The Final Three Days | Lyceon",
    description:
      "Three days before the SAT, get Bluebook ready and plan the morning. Then take one last look at how the test works, using College Board's own tools.",
    h1: "Last-Minute SAT Prep: What to Do in the Final Three Days",
    intro: [
      {
        type: "p",
        text: "The SAT is on Saturday, November 7. With three days left, get Bluebook ready and plan the morning. Then take one last look at how the test works.",
        sources: [CB_SAT_DATES],
      },
    ],
    sections: [
      {
        heading: "Set up Bluebook now",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Exam setup opens 1 to 5 days before the test. Do it today, on the device you'll bring. Bluebook downloads your test and creates your admission ticket, and doing it early leaves time to sort out a device problem before Saturday.",
            sources: [CB_DEVICE_READINESS],
          },
        ],
      },
      {
        heading: "Try the test preview",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Bluebook has a test preview with sample questions. Use it to learn the tools you'll have on Saturday.",
            sources: [CB_PRACTICE, CB_WHAT_TO_EXPECT],
          },
          {
            type: "ul",
            items: [
              "A reference sheet and a calculator on math questions",
              "Highlighting and notes on reading and writing questions",
              "Crossing out an answer choice you've ruled out",
              "Marking a question to come back to later",
            ],
            sources: [CB_WHAT_TO_EXPECT],
          },
        ],
      },
      {
        heading: "Get comfortable with the calculator",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "A graphing calculator is built into Bluebook, and you can use a calculator on every Math question. If you plan to use the built-in one, try it on a few practice questions this week so Saturday isn't your first time.",
            sources: [CB_CALCULATOR],
          },
        ],
      },
      {
        heading: "One timed practice test, if you have the time",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "The full-length practice tests in Bluebook are timed like the real test and scored. If you haven't taken one yet, one this week shows you the pacing you'll face.",
            sources: [CB_BLUEBOOK_PRACTICE_TESTS],
          },
        ],
      },
      {
        heading: "Know the timing",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Reading and Writing is 64 minutes, in two 32-minute modules. Math is 70 minutes, in two 35-minute modules. Within a module you can move between questions and change answers. Once you move on to the next module, you can't go back.",
            sources: [CB_STRUCTURE, CB_WHAT_TO_EXPECT],
          },
        ],
      },
      {
        heading: "Friday night",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Pack your charged device and a charger, your admission ticket, a physical photo ID, pencils, and a snack for the break. Then look up your center's arrival time on your admission ticket. Most centers close their doors at 8 AM, and no one is admitted once testing has started.",
            sources: [CB_WHAT_TO_BRING, CB_WHAT_TO_EXPECT],
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
            ],
          },
          { type: "cta" },
        ],
      },
    ],
    faq: [
      {
        question: "Can I go back to a module after I finish it?",
        answer:
          "No. You can move between questions and change answers while a module is open, but once you move on to the next module you can't return.",
        sources: [CB_WHAT_TO_EXPECT],
      },
    ],
  },
};

export default post;
