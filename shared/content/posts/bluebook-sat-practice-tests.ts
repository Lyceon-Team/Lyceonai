/**
 * Blog post: Bluebook SAT practice tests (batch 2026-W46, Friday 2026-11-13).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-04]
 *
 * plain English: how to use College Board's full-length practice tests well, with three weeks to
 * the Dec 5 test: the preview, the timing, My Practice, review, pausing and spacing. Every fact
 * is College Board's; no Lyceon claim.
 */
import {
  CB_BLUEBOOK_HOW_TO,
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_QUESTION_BANK,
  CB_SAT_DATES,
  CB_STUDY_PLAN,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "bluebook-sat-practice-tests",
  category: "Practice",
  tags: ["sat-practice", "bluebook"],
  batch: "2026-W46",
  publishAt: "2026-11-13T07:00",
  targetKeyword: "bluebook sat practice",
  page: {
    title: "Bluebook SAT Practice Tests: How to Use Them | Lyceon",
    description:
      "How to get the most from College Board's free full-length practice tests in Bluebook: the preview, timing, reviewing misses and spacing tests before December 5.",
    h1: "Bluebook SAT Practice Tests: How to Use Them",
    intro: [
      {
        type: "p",
        text: "College Board's full-length practice tests in its Bluebook app are free, timed like the actual SAT and scored. The December 5 SAT is three weeks away, which is enough time to take one, learn from it and practice what it showed.",
        sources: [CB_BLUEBOOK_PRACTICE_TESTS, CB_SAT_DATES],
      },
    ],
    sections: [
      {
        heading: "Preview or full-length test",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Bluebook has two kinds of practice. The test preview is a short set of questions for trying the tools. It's untimed, and you won't get scores or feedback on your answers. A full-length practice test is scored and timed like the SAT, except that you can move from one section to the next before time runs out.",
            sources: [CB_BLUEBOOK_PRACTICE_TESTS],
          },
        ],
      },
      {
        heading: "Take it like test day",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board suggests sitting at a table or desk with as few distractions as you can manage, rather than on the couch or in bed. It recommends taking at least one practice test in one sitting, as you will on test day.",
            sources: [CB_BLUEBOOK_HOW_TO],
          },
          {
            type: "p",
            text: "The practice tests use the same multistage adaptive model as the SAT: the second module of each section is slightly easier or harder depending on the first. That makes them a fair way to practice your pacing.",
            sources: [CB_BLUEBOOK_HOW_TO],
          },
          {
            type: "p",
            text: "If you can't finish in one sitting, you can pause and come back on another day. Unfinished practice tests are stored in Bluebook for up to 90 days.",
            sources: [CB_STUDY_PLAN],
          },
        ],
      },
      {
        heading: "Use the results",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Your scores appear in My Practice. Select Score Details to see every question with the answer you submitted and the correct one. Select Review next to a question to read its explanation. College Board suggests keeping track of the questions you missed and looking for patterns in the content and skills involved.",
            sources: [CB_BLUEBOOK_HOW_TO],
          },
          {
            type: "p",
            text: "From there, Get Tailored Practice builds a set of questions around the skills you need to strengthen. You can also filter College Board's Student Question Bank by test, domain, skill and difficulty.",
            sources: [CB_BLUEBOOK_HOW_TO, CB_QUESTION_BANK],
          },
        ],
      },
      {
        heading: "How many tests before December 5",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board recommends taking a practice test at least two weeks before test day if possible, and spacing practice tests at least two weeks apart if your schedule allows. For December 5, two weeks before is November 21. A test this weekend puts the next one two weeks later, on November 28, inside the last week. So one full-length test now, then reviewing and practicing the skills it flagged, is the realistic plan.",
            sources: [CB_STUDY_PLAN, CB_SAT_DATES],
          },
          {
            type: "links",
            items: [
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
        question:
          "Do Bluebook practice tests have the same format as the real SAT?",
        answer:
          "Yes, in the ways that matter for pacing: the practice tests are timed like the SAT and use the same multistage adaptive model, with a second module that's slightly easier or harder than the first.",
        sources: [CB_BLUEBOOK_PRACTICE_TESTS, CB_BLUEBOOK_HOW_TO],
      },
    ],
  },
};

export default post;
