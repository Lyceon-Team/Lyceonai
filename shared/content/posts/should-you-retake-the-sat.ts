/**
 * Blog post: Should you retake the SAT? (batch 2026-W46, Wednesday 2026-11-11).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-04]
 *
 * plain English: how to decide about the Dec 5 test using the dates College Board publishes: the
 * deadlines, the fees, the score range, and the days left between score release and test day.
 * Every fact is College Board's; no Lyceon claim.
 */
import {
  CB_FEE_WAIVER_BENEFITS,
  CB_GOOD_SCORE,
  CB_SAT_DATES,
  CB_SCORE_RELEASE_DATES,
  CB_STUDY_PLAN,
  CB_TEST_FEES,
  CB_UNDERSTANDING_SCORES_PDF,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "should-you-retake-the-sat",
  category: "Scores",
  tags: ["sat-scores", "sat-registration"],
  batch: "2026-W46",
  publishAt: "2026-11-11T07:00",
  targetKeyword: "should i retake the sat",
  page: {
    title: "Should You Retake the SAT? Deciding on Dec 5 | Lyceon",
    description:
      "Deciding whether to sit the December 5 SAT? The deadlines, fees and score range to weigh, and how many days you'd have to prepare once scores are out.",
    h1: "Should You Retake the SAT?",
    intro: [
      {
        type: "p",
        text: "College Board lists retaking the SAT as one of the next steps once you have your scores. If you tested on November 7, the next test is December 5. The dates decide how much room you have.",
        sources: [CB_UNDERSTANDING_SCORES_PDF, CB_SAT_DATES],
      },
    ],
    sections: [
      {
        heading: "The dates that matter",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "Dates for the December 5 SAT",
            head: ["What", "Date"],
            rows: [
              ["November 7 scores released to students", "Friday, November 20"],
              ["Registration deadline for December 5", "Friday, November 20"],
              [
                "Late registration and changes deadline",
                "Tuesday, November 24",
              ],
              ["December 5 SAT", "Saturday, December 5"],
              ["December 5 scores released to students", "Friday, December 18"],
            ],
            note: "College Board's deadlines expire at 11:59 PM ET.",
            sources: [CB_SAT_DATES, CB_SCORE_RELEASE_DATES],
          },
          {
            type: "p",
            text: "Your November 7 score arrives on the same day as the regular registration deadline, so you can look at it before you decide. After that you have until November 24 to register late, which costs an extra $38.",
            sources: [CB_SAT_DATES, CB_SCORE_RELEASE_DATES, CB_TEST_FEES],
          },
        ],
      },
      {
        heading: "Count the days",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "From November 20 to December 5 is 15 days. College Board recommends taking a practice test at least two weeks before test day if you can, so that you have time afterward to work on what you missed. Fifteen days leaves room for the work between tests, but not much for a long study plan.",
            sources: [CB_STUDY_PLAN],
          },
          {
            type: "p",
            text: "If you skip December, the next confirmed dates are March 6 and May 1, 2027.",
            sources: [CB_SAT_DATES],
          },
        ],
      },
      {
        heading: "Read the score range first",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Your report shows a score range as well as your score. College Board says a student's ability is better represented by score ranges than by points, because the range shows how much your scores would likely vary on a different test day under identical conditions. A small change between two tests can be that normal variation.",
            sources: [CB_UNDERSTANDING_SCORES_PDF],
          },
        ],
      },
      {
        heading: "Questions to ask",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "Is your score where the colleges on your list expect it to be? College Board puts it this way: a good SAT score is one that helps you get admitted to a college you want to go to.",
              "Do you know what to work on? Your score report and Bluebook practice scores show how you did in each content area, which tells you where the next weeks should go.",
              "Can you afford it? Registration is $68, and a fee waiver covers two free SAT tests.",
            ],
            sources: [
              CB_GOOD_SCORE,
              CB_STUDY_PLAN,
              CB_TEST_FEES,
              CB_FEE_WAIVER_BENEFITS,
            ],
          },
          {
            type: "p",
            text: "College Board also notes that your SAT score is only one piece of the puzzle, along with your grades, application essay and extracurricular activities.",
            sources: [CB_GOOD_SCORE],
          },
          {
            type: "links",
            items: [
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
        question: "Can I change my SAT date after I register?",
        answer:
          "College Board says that to change the test date, you must cancel and register for a new test. Canceling by the change deadline costs $34, and it's free with a fee waiver.",
        sources: [CB_TEST_FEES],
      },
    ],
  },
};

export default post;
