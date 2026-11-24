/**
 * Blog post: What is an SAT superscore? (batch 2026-W47, Friday 2026-11-20).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-11]
 *
 * plain English: on the day Nov 7 scores are released, what superscoring is, a worked example,
 * the other score-use policies colleges have, and how sending by test date fits with it. How to
 * send scores step by step is the 2026-W48 post's, so this one stays on superscoring. Every fact
 * is College Board's; no Lyceon claim.
 */
import {
  CB_SAT_DATES,
  CB_SCORE_RELEASE_DATES,
  CB_SENDING_WEEKEND_SCORES,
  CB_SUPERSCORE,
  CB_WHICH_SCORES_COLLEGES_USE,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-superscore",
  category: "Scores",
  tags: ["sat-scores", "college-admissions"],
  batch: "2026-W47",
  publishAt: "2026-11-20T07:00",
  targetKeyword: "sat superscore",
  page: {
    title: "What's an SAT Superscore? | Lyceon",
    description:
      "An SAT superscore combines your best section scores from different test dates. How colleges use it, and what it means for sending scores and retakes.",
    h1: "What's an SAT Superscore?",
    intro: [
      {
        type: "p",
        text: "A superscore combines your best Reading and Writing score and your best Math score, even if they come from different test dates. College Board says most colleges look at your best section scores this way, but each college sets its own policy.",
        sources: [CB_SUPERSCORE, CB_WHICH_SCORES_COLLEGES_USE],
      },
    ],
    sections: [
      {
        heading: "A worked example",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "Two SAT attempts and the superscore",
            head: ["Test", "Reading and Writing", "Math", "Total"],
            rows: [
              ["First test", "600", "620", "1220"],
              ["Second test", "680", "610", "1290"],
              ["Superscore", "680", "620", "1300"],
            ],
            note: "Illustrative scores. The superscore takes the higher section score from each test.",
            sources: [CB_SUPERSCORE],
          },
          {
            type: "p",
            text: "Reading and Writing went up 80 points on the second test, and Math went down 10. A college that uses superscoring would take the Math score from the first test and the Reading and Writing score from the second, for 1300. That's higher than either test's total.",
            sources: [CB_SUPERSCORE],
          },
        ],
      },
      {
        heading: "Other ways colleges use scores",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "Single highest test date: the college uses your best total from one test, whether or not it's your most recent.",
              "All scores required: you send every SAT you've taken. College Board notes these colleges still consider your highest section scores and can see how you improved.",
              "Test-optional: sending scores is your choice, and a test-optional college can still have its own superscoring policy.",
            ],
            sources: [CB_SUPERSCORE],
          },
          {
            type: "p",
            text: "Each college's policy is usually on its admissions website, in the application requirements. Some departments within a college have their own.",
            sources: [CB_SUPERSCORE],
          },
        ],
      },
      {
        heading: "How sending scores fits in",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "You send scores by test date, and a whole SAT is sent each time. You can't send your Math score from one day and your Reading and Writing score from another. The college builds the superscore from the full reports it receives.",
            sources: [CB_SENDING_WEEKEND_SCORES, CB_SUPERSCORE],
          },
          {
            type: "p",
            text: "Score Choice lets you pick which test dates go to each college. Many colleges that superscore encourage you to send all your scores, and some require it. When you send scores, College Board shows you the policy of each college you pick.",
            sources: [CB_SUPERSCORE, CB_SENDING_WEEKEND_SCORES],
          },
        ],
      },
      {
        heading: "What it means for a retake",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "At a college that uses superscoring, a second test can only add to your best section scores, and College Board says colleges don't look unfavorably on retaking.",
            sources: [CB_SUPERSCORE],
          },
          {
            type: "p",
            text: "November 7 scores are scheduled for release to students today, November 20. Today is also the regular registration deadline for the December 5 SAT, which closes at 11:59 PM Eastern time. The late deadline is Tuesday, November 24.",
            sources: [CB_SCORE_RELEASE_DATES, CB_SAT_DATES],
          },
          {
            type: "links",
            items: [
              {
                label: "Should you retake the SAT?",
                href: "/blog/should-you-retake-the-sat",
              },
              {
                label: "What's a good SAT score?",
                href: "/what-is-a-good-sat-score",
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
        question: "Does College Board send my superscore to colleges?",
        answer:
          "No. You send full scores by test date. A college that uses superscoring combines your best section scores from the reports it receives.",
        sources: [CB_SENDING_WEEKEND_SCORES, CB_SUPERSCORE],
      },
      {
        question: "Do all colleges superscore the SAT?",
        answer:
          "No. College Board says most colleges consider your best section scores across test dates, but policies differ. Some use your single highest test date, and some require all scores. Check each college's admissions website.",
        sources: [CB_WHICH_SCORES_COLLEGES_USE, CB_SUPERSCORE],
      },
    ],
  },
};

export default post;
