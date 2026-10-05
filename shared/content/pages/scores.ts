/**
 * P3: "What is a good SAT score?" and the five score pages (1100–1500).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C2 (P3: "~7 pages max, 1100–1500, cited CB
 *       percentiles"); Doctrine rule 3; owner decisions on Wave 3 Step 0, 2026-10-05: decision 2
 *       ("All 5 score pages (1100–1500): approved"), "Copy: approved as drafted"]
 *       | @implemented [2026-10-05]
 *
 * plain English: every number on these pages is one the College Board publishes. The percentile
 * table is CB_PERCENTILES (both columns, as published); the mean is the class of 2026 figure from
 * the annual report; the benchmarks come from the Fall 2026 Understanding Scores guide. Nothing
 * says what a score "gets you into", and no acceptance rate is quoted.
 *
 * edge cases:
 *  - "Both section scores clear the benchmarks" is said only where it holds for EVERY split of
 *    the total: a section is at most 800, so a total of T leaves the other section at least
 *    T − 800, which clears Math's 530 only from 1330 up. Below that the page tells the reader to
 *    check their section scores instead. (`clearsBothBenchmarks`.)
 *  - The College Board's "good score" page rounds the mean ("around 1050") and the top 10%
 *    ("1350 or higher"); these pages never quote the rounded lines next to the table figures.
 *  - Sourcing note (2026-10-05): the approved draft said colleges publish a "middle 50%"; the
 *    College Board page cited for it speaks of the AVERAGE score of admitted students and points
 *    to BigFuture for it, so the copy says "average" and cites that page.
 */
import {
  CB_ANNUAL_REPORT_2026,
  CB_GOOD_SCORE,
  CB_PERCENTILES,
  CB_SCORES,
  CB_UNDERSTANDING_SCORES_PDF,
} from "../../seo/sources";
import type {
  ContentBlock,
  ContentPageInput,
} from "../../../packages/shared/src/seo-content-schema";

const APPROVED = { by: "Karl", date: "2026-10-05" } as const;
const DATES = { published: "2026-10-05", lastModified: "2026-10-05" } as const;

export const GOOD_SCORE_PATH = "/what-is-a-good-sat-score";

/** The class of 2026 mean total score (CB_ANNUAL_REPORT_2026, p. 8). */
const MEAN_2026 = 1045;
/** Math benchmark (CB_UNDERSTANDING_SCORES_PDF, p. 6); RW's is 480. */
const MATH_BENCHMARK = 530;
const SECTION_MAX = 800;

/** CB_PERCENTILES, total score table: [score, nationally representative, user group]. */
export const PERCENTILES: readonly (readonly [number, string, string])[] = [
  [1600, "99+", "99+"],
  [1500, "99", "97"],
  [1400, "97", "93"],
  [1300, "91", "85"],
  [1200, "81", "75"],
  [1100, "67", "62"],
  [1000, "48", "47"],
];

export const SCORE_PAGE_SCORES = [1100, 1200, 1300, 1400, 1500] as const;

/** "93" -> "93rd". Only a last digit of 1, 2 or 3 (outside 11–13) takes st/nd/rd. */
function ordinal(n: string): string {
  const v = Number(n);
  if (!Number.isInteger(v))
    throw new Error(`scores: ${n} is not a whole percentile`);
  const tens = v % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][v % 10] ?? "th"}`;
}

function percentilesOf(score: number): { nr: string; user: string } {
  const row = PERCENTILES.find(([s]) => s === score);
  if (!row)
    throw new Error(`scores: no College Board percentile row for ${score}`);
  return { nr: row[1], user: row[2] };
}

/** True when every split of `total` into two sections clears both benchmarks. */
function clearsBothBenchmarks(total: number): boolean {
  return total - SECTION_MAX >= MATH_BENCHMARK;
}

/** The plain answer that opens each score page. */
const VERDICT: Record<(typeof SCORE_PAGE_SCORES)[number], string> = {
  1100: "It's above the national average.",
  1200: "It's well above the national average.",
  1300: "Yes, by national measures.",
  1400: "Yes, by any national measure.",
  1500: "Yes. It's near the top of the scale.",
};

const percentileTable: ContentBlock = {
  type: "table",
  caption: "SAT percentiles by total score",
  head: [
    "Total score",
    "Nationally representative percentile",
    "User group percentile",
  ],
  rows: PERCENTILES.map(([score, nr, user]) => [String(score), nr, user]),
  note: "User group percentiles cover students who graduated in the past three school years. Source viewed October 5, 2026.",
  sources: [CB_PERCENTILES],
};

function scorePage(
  score: (typeof SCORE_PAGE_SCORES)[number],
): ContentPageInput {
  const { nr, user } = percentilesOf(score);
  const index = SCORE_PAGE_SCORES.indexOf(score);
  const lower = SCORE_PAGE_SCORES[index - 1];
  const higher = SCORE_PAGE_SCORES[index + 1];
  const neighbours = [lower, higher].flatMap((s) =>
    s === undefined
      ? []
      : [
          {
            label: `Is ${s} a good SAT score? (${ordinal(percentilesOf(s).nr)} / ${ordinal(percentilesOf(s).user)})`,
            href: `${GOOD_SCORE_PATH}/${s}`,
          },
        ],
  );
  return {
    path: `${GOOD_SCORE_PATH}/${score}`,
    title: `Is ${score} a Good SAT Score? | Lyceon`,
    description: `A ${score} SAT score is at the ${ordinal(nr)} national percentile and the ${ordinal(user)} among test takers, per the College Board. Here is what that means for college lists.`,
    h1: `Is ${score} a good SAT score?`,
    crumb: String(score),
    parent: GOOD_SCORE_PATH,
    intro: [
      {
        type: "p",
        text: `${VERDICT[score]} On the College Board's percentile table a ${score} sits at the ${ordinal(nr)} nationally representative percentile and the ${ordinal(user)} user percentile. That means ${user}% of recent test takers scored ${score} or lower.`,
        sources: [CB_PERCENTILES],
        claims: ["W14"],
      },
    ],
    sections: [
      {
        heading: "How it compares",
        level: 2,
        blocks: [
          {
            type: "p",
            text: `It is ${score - MEAN_2026} points above the class of 2026 mean of ${MEAN_2026}.`,
            sources: [CB_ANNUAL_REPORT_2026],
          },
          clearsBothBenchmarks(score)
            ? {
                type: "p",
                text: `It is well above both section benchmarks (480 for Reading and Writing, 530 for Math): even the lowest possible section score in a ${score} total clears them.`,
                sources: [CB_UNDERSTANDING_SCORES_PDF, CB_SCORES],
              }
            : {
                type: "p",
                text: `The College Board's benchmarks are set per section (480 for Reading and Writing, 530 for Math), so check your two section scores to see whether a ${score} total meets both.`,
                sources: [CB_UNDERSTANDING_SCORES_PDF],
              },
        ],
      },
      {
        heading: "Is it good for your colleges?",
        level: 2,
        blocks: [
          {
            type: "p",
            text: `That depends on the schools on your list. Each school has its own score expectations. At schools where admitted students average ${score} or less, you're at or above the typical score. At more selective schools, a ${score} can be below average.`,
            sources: [CB_GOOD_SCORE],
            claims: ["W14"],
          },
          {
            type: "p",
            text: "Your score is one part of your application. Your grades, your essay and your activities count too.",
            sources: [CB_GOOD_SCORE],
          },
        ],
      },
      {
        heading: "Nearby scores",
        level: 2,
        blocks: [
          {
            type: "links",
            items: [
              ...neighbours,
              { label: "What is a good SAT score?", href: GOOD_SCORE_PATH },
            ],
          },
          {
            type: "p",
            text: "Not sure where you stand? Lyceon's free diagnostic shows your strengths by section.",
            claims: ["W4"],
          },
          { type: "cta" },
        ],
      },
    ],
    ...DATES,
    approved: APPROVED,
  };
}

const goodScore: ContentPageInput = {
  path: GOOD_SCORE_PATH,
  title: "What Is a Good SAT Score? | Lyceon",
  description:
    "What counts as a good SAT score, with the College Board's percentiles for 1000 to 1600, the average score, and the benchmarks for each section.",
  h1: "What is a good SAT score?",
  crumb: "What is a good SAT score?",
  intro: [
    {
      type: "p",
      text: "The College Board's own answer is the right one to start with: a good SAT score is one that helps you get into a college you want to go to. Each school has its own expectations, so the useful number is the score at the schools on your list.",
      sources: [CB_GOOD_SCORE],
      claims: ["W14"],
    },
    {
      type: "p",
      text: "If you want a general picture, percentiles tell you how a score compares with other test takers. A percentile is the share of students who scored at or below you.",
      sources: [CB_PERCENTILES],
    },
  ],
  sections: [
    {
      heading: "SAT percentiles by total score",
      level: 2,
      blocks: [percentileTable],
    },
    {
      heading: "The average SAT score",
      level: 2,
      blocks: [
        {
          type: "p",
          text: `The mean total score for the class of 2026 was ${MEAN_2026}: 528 in Reading and Writing and 517 in Math.`,
          sources: [CB_ANNUAL_REPORT_2026],
        },
      ],
    },
    {
      heading: "The College Board benchmarks",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "The College Board sets a benchmark of 480 for Reading and Writing and 530 for Math. Students at or above them have a 75% likelihood of earning a C or better in a related first-semester college course. 42% of the class of 2026 met both.",
          sources: [CB_UNDERSTANDING_SCORES_PDF, CB_ANNUAL_REPORT_2026],
        },
      ],
    },
    {
      heading: "Score by score",
      level: 2,
      blocks: [
        {
          type: "links",
          items: SCORE_PAGE_SCORES.map((s) => ({
            label: `Is ${s} a good SAT score?`,
            href: `${GOOD_SCORE_PATH}/${s}`,
          })),
        },
        { type: "cta" },
      ],
    },
  ],
  faq: [
    {
      question: "What is a perfect SAT score?",
      answer: "1600: 800 in each section.",
      sources: [CB_SCORES],
    },
    {
      question: "How do I find the scores my colleges expect?",
      answer:
        "Look up the average SAT score of admitted first-year students at each school on your list. The College Board's BigFuture lists it for thousands of colleges.",
      sources: [CB_GOOD_SCORE],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

export const SCORE_PAGES: readonly ContentPageInput[] = [
  goodScore,
  ...SCORE_PAGE_SCORES.map(scorePage),
];
