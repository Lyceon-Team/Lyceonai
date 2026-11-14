/**
 * Blog post: The SAT score report, explained (batch 2026-W47, Wednesday 2026-11-18).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-11]
 *
 * plain English: two days before Nov 7 scores arrive, a walk through the report itself: where it
 * is, what is on page one (score range, percentile, average), the Knowledge and Skills bars for
 * the eight content domains, the extra insights online, and the "Score Sends Held" notice. The
 * scale, percentile tables and benchmarks are /blog/digital-sat-scoring-explained's; this post
 * links there instead of repeating them (plan note, R7). Every fact is College Board's; no
 * Lyceon claim.
 */
import {
  CB_CONTENT_DOMAINS,
  CB_GETTING_WEEKEND_SCORES,
  CB_SCORE_RELEASE_DATES,
  CB_UNDERSTANDING_SCORES_PDF,
  CB_WHAT_SCORES_MEAN,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-score-report-explained",
  category: "Scores",
  tags: ["sat-scores", "sat-scoring"],
  batch: "2026-W47",
  publishAt: "2026-11-18T07:00",
  targetKeyword: "sat score report",
  page: {
    title: "The SAT Score Report, Explained | Lyceon",
    description:
      "Your SAT score report shows more than a total. Read your score range and percentile, the Knowledge and Skills bars by domain, and the extra details online.",
    h1: "The SAT Score Report, Explained",
    intro: [
      {
        type: "p",
        text: "Scores from the November 7 SAT are scheduled for release to students on Friday, November 20. Schools get them in College Board's score reporting portal on Monday, November 23. Beyond the total, the report shows how your score compares with other test takers and which content areas went well.",
        sources: [CB_SCORE_RELEASE_DATES, CB_WHAT_SCORES_MEAN],
      },
    ],
    sections: [
      {
        heading: "Where to find it",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "If you're 13 or older, sign in to your College Board account at studentscores.collegeboard.org. You can see your scores there and download the score report PDF. Your school can also see the PDF, so you can go through it with a counselor.",
            sources: [CB_GETTING_WEEKEND_SCORES, CB_UNDERSTANDING_SCORES_PDF],
          },
        ],
      },
      {
        heading: "Your three scores",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "The report gives a total score and a score for each section, Reading and Writing and Math. Next to each one you'll see:",
            sources: [CB_UNDERSTANDING_SCORES_PDF],
          },
          {
            type: "ul",
            items: [
              "A score range. It shows how much your score would likely vary if you took the test again on another day under the same conditions.",
              "Your percentile: the share of a comparison group of test takers who scored at or below you. If you're in the 70th percentile, 70% of that group scored at or below your score.",
              "The average score of all SAT test takers over the last three years.",
            ],
            sources: [CB_UNDERSTANDING_SCORES_PDF, CB_WHAT_SCORES_MEAN],
          },
          {
            type: "p",
            text: "College Board says your ability is better represented by the score range than by one number. For the scale itself, the percentile tables and the benchmarks, see [how digital SAT scores work](/blog/digital-sat-scoring-explained).",
            sources: [CB_UNDERSTANDING_SCORES_PDF],
          },
        ],
      },
      {
        heading: "The Knowledge and Skills section",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "This part shows how you did in each of the eight content domains on the SAT, four per section. For each domain you'll see roughly how many questions it had and what share of the section that is. A domain with 12 to 14 questions makes up about 26% of Reading and Writing.",
            sources: [CB_UNDERSTANDING_SCORES_PDF, CB_WHAT_SCORES_MEAN],
          },
          {
            type: "table",
            caption: "The eight SAT content domains",
            head: ["Reading and Writing", "Math"],
            rows: [
              ["Information and Ideas", "Algebra"],
              ["Craft and Structure", "Advanced Math"],
              ["Expression of Ideas", "Problem-Solving and Data Analysis"],
              ["Standard English Conventions", "Geometry and Trigonometry"],
            ],
            sources: [CB_CONTENT_DOMAINS],
          },
          {
            type: "p",
            text: "Each domain has a bar. The filled part shows your level in that domain, not a score, and the performance range under it shows the band you scored in.",
            sources: [CB_UNDERSTANDING_SCORES_PDF],
          },
        ],
      },
      {
        heading: "More details online",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Signed in to your account, you can see more than the PDF shows:",
            sources: [CB_UNDERSTANDING_SCORES_PDF],
          },
          {
            type: "ul",
            items: [
              "Percentiles for your country and for all test takers, plus your state if you test in the U.S. or a U.S. territory.",
              "Your scores next to the average for your school, district and state, where these apply.",
              "Whether you met College Board's college and career readiness benchmark in each section.",
              "Your performance in each domain across seven score bands, with example questions from the band above yours.",
            ],
            sources: [CB_UNDERSTANDING_SCORES_PDF, CB_GETTING_WEEKEND_SCORES],
          },
        ],
      },
      {
        heading: "If it says Score Sends Held",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "This notice at the top means College Board couldn't confirm it had a complete set of your answers when the test was scored. Your scores won't go to colleges or scholarship programs unless you ask College Board to send them.",
            sources: [CB_UNDERSTANDING_SCORES_PDF],
          },
        ],
      },
      {
        heading: "Turning the report into a plan",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board suggests using the Knowledge and Skills section to find the domains to focus on. The domains with the shortest bars are the natural place to start.",
            sources: [CB_WHAT_SCORES_MEAN],
          },
          {
            type: "links",
            items: [
              {
                label: "SAT practice questions by domain",
                href: "/sat-practice-questions",
              },
              {
                label: "What's a good SAT score?",
                href: "/what-is-a-good-sat-score",
              },
            ],
          },
          { type: "cta" },
        ],
      },
    ],
    faq: [
      {
        question: "Does the bar for a domain show my score in that domain?",
        answer:
          "No. College Board says the filled part of each bar shows your level in that domain, not your actual score.",
        sources: [CB_UNDERSTANDING_SCORES_PDF],
      },
      {
        question: "What's the difference between my score and my score range?",
        answer:
          "Your score is the result of this test. The range shows how much it would likely vary if you took the test again on another day under the same conditions.",
        sources: [CB_UNDERSTANDING_SCORES_PDF],
      },
    ],
  },
};

export default post;
