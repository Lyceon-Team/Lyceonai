/**
 * Blog post: How to study for the SAT in 2 weeks (batch 2026-W43, Friday 2026-10-23).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-10-plan/PLAN.md]
 *       | @implemented [2026-10-15]
 *
 * plain English: a plan for the 15 days before the Nov 7 test, built on College Board's own
 * study-plan guidance (one full practice test at least two weeks out, then targeted practice),
 * ending where the Nov 4 final-days post begins. Every fact is College Board's; no Lyceon claim.
 */
import {
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_KHAN,
  CB_QUESTION_BANK,
  CB_SAT_DATES,
  CB_STRUCTURE,
  CB_STUDY_PLAN,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "two-week-sat-study-plan",
  category: "Study Plans",
  tags: ["sat-prep", "study-plan"],
  batch: "2026-W43",
  publishAt: "2026-10-23T07:00",
  targetKeyword: "how to study for the sat in 2 weeks",
  page: {
    title: "How to Study for the SAT in 2 Weeks | Lyceon",
    description:
      "With two weeks left before the SAT, take one full practice test now and spend the rest of the time on the skills it shows you need to work on.",
    h1: "How to Study for the SAT in 2 Weeks",
    intro: [
      {
        type: "p",
        text: "The SAT is on Saturday, November 7, about two weeks away. That's enough time for one full practice test and focused work on what it shows you. Here's a plan, using free official practice.",
        sources: [CB_SAT_DATES, CB_STUDY_PLAN],
      },
    ],
    sections: [
      {
        heading: "This weekend, take one full practice test",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board recommends a full-length practice test at least two weeks before test day, if possible, so you can use the remaining time to sharpen your skills. With 15 days to go, take one of the Bluebook practice tests this weekend. They're timed like the real test and they're scored.",
            sources: [CB_STUDY_PLAN, CB_BLUEBOOK_PRACTICE_TESTS],
          },
          {
            type: "p",
            text: "If you can't do it in one sitting, you can pause the test and finish it another day.",
            sources: [CB_STUDY_PLAN],
          },
        ],
      },
      {
        heading: "Find your weak spots",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Check your score in My Practice, where you can see how you did in each content area and review the questions. Pick the two or three areas where you lost the most points. Those are what the rest of the plan is for.",
            sources: [CB_BLUEBOOK_PRACTICE_TESTS, CB_STUDY_PLAN],
          },
          {
            type: "p",
            text: "For each question you missed, work out why. Did you misread the question or fall for an answer that was close? Or is it a skill you haven't learned yet? Write it down so you can spot patterns.",
            sources: [CB_STUDY_PLAN],
          },
        ],
      },
      {
        heading: "Practice those skills on days 3 to 10",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Spend each day on one of your weak areas, using free official practice:",
            sources: [CB_STUDY_PLAN],
          },
          {
            type: "ul",
            items: [
              "The Student Question Bank. Filter by test, domain, skill and difficulty to build a short quiz on exactly what you need.",
              "Official SAT Prep on Khan Academy. Its lessons, videos and practice cover every skill at three levels, and it has a walk-through of each Bluebook practice test.",
            ],
            sources: [CB_QUESTION_BANK, CB_KHAN],
          },
          {
            type: "p",
            text: "Short sessions count. College Board lists a question bank review as a quick activity of 15 minutes or less, and a Khan Academy review as one of 15 minutes to an hour.",
            sources: [CB_STUDY_PLAN],
          },
        ],
      },
      {
        heading: "Keep the format in your head",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Reading and Writing is 64 minutes, in two 32-minute modules. Math is 70 minutes, in two 35-minute modules. As you practice, time some question sets so the pace feels familiar.",
            sources: [CB_STRUCTURE],
          },
        ],
      },
      {
        heading: "One test is enough",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board recommends spacing full practice tests at least two weeks apart when your schedule allows. With two weeks left, one full test now and focused practice afterward makes the better use of your time.",
            sources: [CB_STUDY_PLAN],
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
        question: "Is two weeks enough to study for the SAT?",
        answer:
          "It's enough for a practice test and targeted work on the skills it shows you need. College Board recommends a full practice test at least two weeks before test day, so you can use the time left to work on those skills.",
        sources: [CB_STUDY_PLAN],
      },
    ],
  },
};

export default post;
