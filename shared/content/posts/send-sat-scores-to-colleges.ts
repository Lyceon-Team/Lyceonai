/**
 * Blog post: How to send SAT scores to colleges (batch 2026-W48, Monday 2026-11-23).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-18]
 *
 * plain English: the Monday after November 7 scores are released, how sending works: the four
 * free sends and their nine-day window, what later reports cost and how long they take, the
 * steps, choosing which test dates go, and timing against application deadlines. Superscoring
 * itself is the 2026-W47 post's, linked rather than repeated. Every fact is College Board's; no
 * Lyceon claim.
 */
import {
  CB_SAT_DATES,
  CB_SAT_STUDENT_GUIDE,
  CB_SCORE_RELEASE_DATES,
  CB_SENDING_WEEKEND_SCORES,
  CB_SUPERSCORE,
  CB_TEST_FEES,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "send-sat-scores-to-colleges",
  category: "Scores",
  tags: ["sat-scores", "college-admissions"],
  batch: "2026-W48",
  publishAt: "2026-11-23T07:00",
  targetKeyword: "send sat scores",
  page: {
    title: "How to Send SAT Scores to Colleges | Lyceon",
    description:
      "How to send SAT scores to colleges: what the four free score sends cover, and what later score reports cost and how long they take to arrive.",
    h1: "How to Send SAT Scores to Colleges",
    intro: [
      {
        type: "p",
        text: "Scores from the November 7 SAT were scheduled for release to students on Friday, November 20. If you're applying to college, the next step is getting them to the schools on your list. Colleges generally want scores sent directly by College Board, not a printout or a transcript that lists them.",
        sources: [CB_SCORE_RELEASE_DATES, CB_SENDING_WEEKEND_SCORES],
      },
    ],
    sections: [
      {
        heading: "Free score sends for each test",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Each time you register for a weekend SAT, you can send your scores to up to four colleges or scholarship programs for free. You can choose them as early as registration and as late as nine days after the test. Free reports include your scores from that test date only, unless you ask to add others.",
            sources: [CB_SAT_STUDENT_GUIDE, CB_SENDING_WEEKEND_SCORES],
          },
          {
            type: "p",
            text: "For the November 7 test, the nine days have passed. A new send now costs a fee unless you have a fee waiver. If you're registered for December 5, you can still pick your four free recipients now, or within nine days after you test.",
            sources: [CB_SAT_STUDENT_GUIDE, CB_SAT_DATES],
          },
        ],
      },
      {
        heading: "What later reports cost and how long they take",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "SAT score report fees",
            head: ["Option", "Fee", "Delivery"],
            rows: [
              [
                "Additional score report",
                "$15 per report",
                "Usually 5 to 10 business days from the order",
              ],
              [
                "Rush report",
                "$31, plus the $15 report fee",
                "1 to 4 business days (weekends and holidays don't count)",
              ],
            ],
            note: "Fees from College Board's test fees page, viewed November 18, 2026.",
            sources: [CB_TEST_FEES, CB_SENDING_WEEKEND_SCORES],
          },
          {
            type: "p",
            text: "Rush delivery only works for scores that have already been released. Once you place an order, it can't be canceled. If you're sending more than one test date to the same college, one report fee covers them.",
            sources: [CB_SENDING_WEEKEND_SCORES, CB_SAT_STUDENT_GUIDE],
          },
          {
            type: "p",
            text: "With a fee waiver, you can send as many score reports as you want for free. That includes a waiver you get after the test, if you're eligible for one.",
            sources: [CB_SENDING_WEEKEND_SCORES],
          },
        ],
      },
      {
        heading: "How to send your scores",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "Sign in to your College Board account and go to the Send SAT Scores page.",
              "Search for each college or scholarship program by name or code, add it, and select Continue. College codes are listed on BigFuture.",
              "For each one, choose whether to send all your scores or only some.",
              "Review your order and check out.",
            ],
            sources: [CB_SENDING_WEEKEND_SCORES],
          },
          {
            type: "p",
            text: "Some college and university systems share scores across their campuses. College Board still says to send your scores to each school you apply to, and to ask the admissions office if you're not sure whether a school is part of a system.",
            sources: [CB_SAT_STUDENT_GUIDE],
          },
        ],
      },
      {
        heading: "Choosing which scores go",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "If you've taken the SAT more than once, Score Choice lets you pick which test dates each college receives on a paid send. Each test date goes as a whole: you can't send your Math score from one day and your Reading and Writing score from another. Without Score Choice, College Board sends your scores from your most recent six test dates.",
            sources: [CB_SAT_STUDENT_GUIDE, CB_SENDING_WEEKEND_SCORES],
          },
          {
            type: "p",
            text: "Some colleges and scholarship programs want every score you have. As you choose, the ordering page shows each school's policy, so you can send what it asks for. A college that uses superscoring combines your best section scores from the reports it receives.",
            sources: [
              CB_SENDING_WEEKEND_SCORES,
              CB_SAT_STUDENT_GUIDE,
              CB_SUPERSCORE,
            ],
          },
        ],
      },
      {
        heading: "Sending before a deadline",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Each college sets its own application deadlines, so check its admissions website. Standard reports are usually sent within 10 business days of your order. Weekends and holidays don't count, so that can run past two weeks on the calendar, and each college then takes its own time to process what arrives. Order well before a deadline, and keep rush delivery for when time is short.",
            sources: [CB_SAT_STUDENT_GUIDE, CB_SENDING_WEEKEND_SCORES],
          },
          {
            type: "p",
            text: "If you're testing on December 5, those scores are scheduled for release to students on December 18. Free sends you choose as part of your registration are typically sent a couple of weeks after test day.",
            sources: [CB_SCORE_RELEASE_DATES, CB_SENDING_WEEKEND_SCORES],
          },
          {
            type: "links",
            items: [
              {
                label: "What's an SAT superscore?",
                href: "/blog/sat-superscore",
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
        question: "Can I send my SAT scores to colleges myself?",
        answer:
          "Generally, no. Colleges usually require scores sent directly by College Board and won't accept printouts, copies of your score report or a transcript that includes your scores.",
        sources: [CB_SENDING_WEEKEND_SCORES],
      },
      {
        question: "How long do SAT scores take to reach colleges?",
        answer:
          "Standard reports are usually sent within 5 to 10 business days of your order. Rush reports are sent within 1 to 4 business days (weekends and holidays don't count). Free sends you chose when you registered are typically sent a couple of weeks after test day.",
        sources: [CB_SENDING_WEEKEND_SCORES],
      },
      {
        question: "Can I change my free score recipients?",
        answer:
          "Yes, until nine days after the test. After that, the free sends can't be changed. Any new report is a new order, with a fee unless you have a fee waiver.",
        sources: [CB_SAT_STUDENT_GUIDE],
      },
    ],
  },
};

export default post;
