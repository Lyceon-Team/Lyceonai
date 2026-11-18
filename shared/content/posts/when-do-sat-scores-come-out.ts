/**
 * Blog post: When do SAT scores come out? (batch 2026-W46, Monday 2026-11-09).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-04]
 *
 * plain English: the release date for the Nov 7 test (Nov 20), the usual wait, the dates for the
 * next tests and where to sign in. Every fact is College Board's; no Lyceon claim.
 */
import {
  CB_GETTING_WEEKEND_SCORES,
  CB_SAT_DATES,
  CB_SCORE_RELEASE_DATES,
  CB_WHAT_SCORES_MEAN,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "when-do-sat-scores-come-out",
  category: "Scores",
  tags: ["sat-scores", "sat-basics"],
  batch: "2026-W46",
  publishAt: "2026-11-09T07:00",
  targetKeyword: "when do sat scores come out",
  page: {
    title: "When Do SAT Scores Come Out? Nov 2026 Dates | Lyceon",
    description:
      "Scores from the November 7 SAT are released to students on November 20. The release dates for the next tests, and how to find your score report online.",
    h1: "When Do SAT Scores Come Out?",
    intro: [
      {
        type: "p",
        text: "Scores from the November 7 SAT are released to students on Friday, November 20, 2026. College Board says most scores from weekend tests are released 2 to 4 weeks after test day.",
        sources: [CB_SCORE_RELEASE_DATES],
      },
    ],
    sections: [
      {
        heading: "Release dates for the next tests",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "SAT weekend test dates and student score release dates",
            head: ["Test date", "Scores released to students"],
            rows: [
              ["November 7, 2026", "November 20, 2026"],
              ["December 5, 2026", "December 18, 2026"],
              ["March 6, 2027", "March 19, 2027"],
              ["May 1, 2027", "May 14, 2027"],
              ["June 5, 2027", "June 21, 2027"],
            ],
            sources: [CB_SCORE_RELEASE_DATES],
          },
          {
            type: "p",
            text: "These are the SAT weekend dates. Tests taken through a school have their own release dates, so check with your school.",
            sources: [CB_SCORE_RELEASE_DATES],
          },
        ],
      },
      {
        heading: "How to see your score",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Sign in to your College Board account at studentscores.collegeboard.org. Your most recent score is shown at the top of the page, and you can download your score report as a PDF. Select See Score Details for more, including how you did against College Board's college and career readiness benchmarks and in each content area.",
            sources: [CB_GETTING_WEEKEND_SCORES],
          },
          {
            type: "p",
            text: "Use the account you registered with. If you can't find your score, College Board suggests checking whether you have a second account, and its Find Your Scores tool lets you check your details and search with your registration number.",
            sources: [CB_GETTING_WEEKEND_SCORES],
          },
        ],
      },
      {
        heading: "What you'll see",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "The report shows a total score from 400 to 1600 and two section scores from 200 to 800, each with a score range. It also has a Knowledge and Skills section that shows how you did in each of the eight content areas, four in Reading and Writing and four in Math.",
            sources: [CB_WHAT_SCORES_MEAN],
          },
        ],
      },
      {
        heading: "Planning around the date",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "If you're thinking about the December 5 test, the registration deadline is November 20, the same day the November 7 scores are released. The late registration deadline is November 24.",
            sources: [CB_SAT_DATES, CB_SCORE_RELEASE_DATES],
          },
          {
            type: "links",
            items: [
              {
                label: "What's a good SAT score?",
                href: "/what-is-a-good-sat-score",
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
        question: "Do SAT scores come out on the same day for everyone?",
        answer:
          "Everyone who took the same weekend test gets the same student release date. The date depends on the test: the November 7 test is released November 20 and the December 5 test December 18.",
        sources: [CB_SCORE_RELEASE_DATES],
      },
    ],
  },
};

export default post;
