/**
 * Blog post: SAT test strategies (batch 2026-W48, Wednesday 2026-11-25).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-18]
 *
 * plain English: ten days before the December 5 test, how to pace each module (average time per
 * question, recomputed from College Board's timing), using the Bluebook tools to skip and come
 * back, why to answer every question, and a few habits per section. The final-days checklist is
 * last-minute-sat-prep's and the overall timing is how-long-is-the-sat's; both are linked, not
 * repeated. Every fact is College Board's; no Lyceon claim.
 */
import {
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_CALCULATOR,
  CB_READING_WRITING,
  CB_SAT_DATES,
  CB_SAT_STUDENT_GUIDE,
  CB_STRUCTURE,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-test-strategies",
  category: "Test day",
  tags: ["sat-strategy", "test-day"],
  batch: "2026-W48",
  publishAt: "2026-11-25T07:00",
  targetKeyword: "sat test strategies",
  page: {
    title: "SAT Test Strategies: Pacing and Habits | Lyceon",
    description:
      "SAT test strategies for both sections: the average time per question in each module, and how Bluebook's tools help you skip hard questions and finish.",
    h1: "SAT Test Strategies: Pacing and Habits",
    intro: [
      {
        type: "p",
        text: "The December 5 SAT is 10 days away. That's enough time to decide how you'll move through the test and practice it once. Here's how to pace each module and use the tools Bluebook gives you.",
        sources: [CB_SAT_DATES],
      },
    ],
    sections: [
      {
        heading: "Know your time per question",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "Average time per question in each module",
            head: [
              "Section",
              "Module length",
              "Questions per module",
              "Average per question",
            ],
            rows: [
              ["Reading and Writing", "32 minutes", "27", "About 71 seconds"],
              ["Math", "35 minutes", "22", "About 95 seconds"],
            ],
            note: "Reading and Writing has 54 questions in two 32-minute modules. Math has 44 questions in two 35-minute modules. The averages divide each module's time by its questions.",
            sources: [CB_STRUCTURE],
          },
          {
            type: "p",
            text: "Use these averages as a check partway through a module. Halfway through a module's time, you want to be about halfway through its questions. If you're well behind, speed up on the next few rather than rushing the end.",
            sources: [CB_STRUCTURE],
          },
          {
            type: "p",
            text: "The timer in Bluebook counts down each module. You can hide it if it makes you anxious. When 5 minutes remain, you get an alert and the timer stays on screen.",
            sources: [CB_SAT_STUDENT_GUIDE],
          },
        ],
      },
      {
        heading: "Skip, mark and come back",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Don't let one hard question eat the time you need for several easier ones. Use Mark for Review to flag it and move on. You can return to any question within the module you're in.",
            sources: [CB_SAT_STUDENT_GUIDE],
          },
          {
            type: "p",
            text: "The question menu shows which questions you skipped or marked, and you can jump straight to any of them. Leave a minute or two at the end of each module for that pass.",
            sources: [CB_SAT_STUDENT_GUIDE],
          },
        ],
      },
      {
        heading: "Answer every question",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board says that for most students it's better to guess than leave a question blank, especially if you can rule out one or two wrong answers first. Use the option eliminator to cross out choices you're sure are wrong, then pick from what's left. Mark the question if you want another look.",
            sources: [CB_SAT_STUDENT_GUIDE],
          },
          {
            type: "p",
            text: "Before time runs out in a module, check the question menu for anything still blank.",
            sources: [CB_SAT_STUDENT_GUIDE],
          },
        ],
      },
      {
        heading: "Reading and Writing habits",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "Each passage is short and has one question, so read the question first and then read the passage for what it asks.",
              "Questions testing similar skills are grouped together and arranged from easiest to hardest. A slow question near the end of a group is a good one to mark and come back to.",
              "Use Highlights & Notes to mark the line an answer depends on. It works on any question outside Math.",
            ],
            sources: [CB_READING_WRITING, CB_SAT_STUDENT_GUIDE],
          },
        ],
      },
      {
        heading: "Math habits",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "You can use a calculator on every Math question, but College Board notes that some are better done without one. Get your thinking down on scratch paper first.",
              "The reference sheet lists common formulas. Know what's on it before test day so you can use it without searching.",
              "Some questions ask you to enter an answer rather than choose one. Check that your answer is what the question asks for, such as the value of x or of 2x.",
            ],
            sources: [CB_CALCULATOR, CB_SAT_STUDENT_GUIDE, CB_STRUCTURE],
          },
        ],
      },
      {
        heading: "Practice the habits once before December 5",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "A full-length practice test in Bluebook is timed like the real test and scored. If you take one in the next few days, use it to rehearse the plan. Check your pace at the halfway point and leave time at the end of each module for marked questions.",
            sources: [CB_BLUEBOOK_PRACTICE_TESTS],
          },
          {
            type: "links",
            items: [
              {
                label: "Last-minute SAT prep",
                href: "/blog/last-minute-sat-prep",
              },
              {
                label: "How long is the SAT?",
                href: "/blog/how-long-is-the-sat",
              },
              {
                label: "Free SAT practice test",
                href: "/free-sat-practice-test",
              },
              {
                label: "SAT practice questions",
                href: "/sat-practice-questions",
              },
            ],
          },
          { type: "cta" },
        ],
      },
    ],
    faq: [
      {
        question: "Should you guess on the SAT?",
        answer:
          "College Board says that for most students it's better to guess than leave a question blank, especially if you can eliminate one or two wrong answers first.",
        sources: [CB_SAT_STUDENT_GUIDE],
      },
      {
        question: "Can you go back to earlier questions on the SAT?",
        answer:
          "Yes, within the module you're in. Mark for Review flags a question, and the question menu lets you jump to any question in the module, including ones you skipped.",
        sources: [CB_SAT_STUDENT_GUIDE],
      },
    ],
  },
};

export default post;
