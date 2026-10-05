/**
 * P5 (free SAT practice test), P7 (online SAT prep) and P8 (how to study for the SAT).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C2 (P5: "do not host official tests"; P7;
 *       P8); Doctrine rules 2, 3, 5; owner decisions on Wave 3 Step 0, 2026-10-05: "Copy: approved
 *       as drafted", the /free-sat-practice-test addition ("Lyceon Pro also includes full-length
 *       practice tests with a score report after each."), and "confirm the 'adaptive and scored
 *       like the real test' source before build; if it can't be confirmed, drop 'adaptive'"]
 *       | @implemented [2026-10-05]
 *
 * plain English: P5 sends a reader to the College Board's free official tests first and offers
 * Lyceon's diagnostic only as a shorter check, never as a full-length or official test. "Timed,
 * adaptive and scored" was confirmed on the College Board's own pages on 2026-10-05
 * (CB_BLUEBOOK_PRACTICE_TESTS: "timed like a real test", "Full-length practice tests are scored";
 * CB_BLUEBOOK_HOW_TO: "the same multistage adaptive model"), so "adaptive" stays. P7 is the
 * former /digital-sat page's job (it 301s here) and keeps that page's approved FAQ. P8 links the
 * five blog posts.
 *
 * The College Board practice-test study is quoted with its own caveat ("Estimates are not
 * causal"), and the sentence is an approved outcome phrase (shared/seo/banned-phrases.ts,
 * claim inventory W18).
 */
import {
  CB_BLUEBOOK_HOW_TO,
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_CALCULATOR,
  CB_CONTENT_DOMAINS,
  CB_PRACTICE,
  CB_PRACTICE_TEST_STUDY_2025,
  CB_READING_WRITING,
  CB_STRUCTURE,
  CEPEDA_2006,
} from "../../seo/sources";
import type {
  ContentFaqItem,
  ContentPageInput,
} from "../../../packages/shared/src/seo-content-schema";
import { BLOG_POSTS } from "../blog";
import {
  MATH_PATH,
  PRACTICE_HUB_PATH,
  READING_WRITING_PATH,
} from "./practice-questions";

const APPROVED = { by: "Karl", date: "2026-10-05" } as const;
const DATES = { published: "2026-10-05", lastModified: "2026-10-05" } as const;

export const FREE_PRACTICE_TEST_PATH = "/free-sat-practice-test";
export const ONLINE_SAT_PREP_PATH = "/online-sat-prep";
export const HOW_TO_STUDY_PATH = "/how-to-study-for-the-sat";

const freePracticeTest: ContentPageInput = {
  path: FREE_PRACTICE_TEST_PATH,
  title: "Free SAT Practice Test Options | Lyceon",
  description:
    "Where to take a free full-length SAT practice test from the College Board, and a free Lyceon diagnostic to see your strengths by section.",
  h1: "Free SAT practice tests",
  crumb: "Free SAT practice tests",
  intro: [
    {
      type: "p",
      text: "The best free full-length practice test is the official one. The College Board offers free full-length practice tests in Bluebook, the same app you use on test day. They are timed, adaptive and scored like the real test. If you only take one practice test, take one of those.",
      sources: [
        CB_PRACTICE,
        CB_BLUEBOOK_PRACTICE_TESTS,
        CB_BLUEBOOK_HOW_TO,
        CB_CALCULATOR,
      ],
    },
    {
      type: "p",
      text: "Free official practice also helps. In a College Board study, students who took one, two, or three or more Bluebook practice tests scored about 25, 45 and 60 points higher than similar students who took none. The College Board notes this shows a link, not proof that the tests caused the gains.",
      sources: [CB_PRACTICE_TEST_STUDY_2025],
      claims: ["W18"],
    },
  ],
  sections: [
    {
      heading: "A shorter check with Lyceon",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Lyceon's free diagnostic is not a full-length test and not an official one. It covers both sections and every content area. When you finish, you see where you are strong and where to start. It's free, with no credit card.",
          claims: ["W4"],
        },
        {
          type: "p",
          text: "Lyceon Pro also includes full-length practice tests with a score report after each.",
          claims: ["W3"],
        },
        { type: "cta" },
      ],
    },
    {
      heading: "More free SAT practice",
      level: 2,
      blocks: [
        {
          type: "links",
          items: [
            {
              label: "SAT practice questions by topic",
              href: PRACTICE_HUB_PATH,
            },
            {
              label: "Today's SAT Question of the Day",
              href: "/sat-question-of-the-day",
            },
            { label: "How to study for the SAT", href: HOW_TO_STUDY_PATH },
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: "Is the Lyceon diagnostic an official SAT practice test?",
      answer:
        "No. Official practice tests come only from the College Board, in Bluebook.",
      sources: [CB_PRACTICE],
      claims: ["W4"],
    },
    {
      question: "Does Lyceon have full-length practice tests?",
      answer:
        "Yes, on the paid plan. They follow the structure of the digital SAT. They are written by Lyceon, not the College Board.",
      claims: ["W3"],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

/*
 * The /digital-sat FAQ, moved here unchanged with the page (owner decision 3, 2026-10-05). It is
 * the copy search engines quote, so its free-tier answer is pinned to the homepage's free card by
 * tests/ci/homepage-pricing.contract.test.ts ("What is free vs paid?", 40 practice questions,
 * "your diagnostic score estimate").
 */
export const ONLINE_SAT_PREP_FAQS: readonly ContentFaqItem[] = [
  {
    question: "What is the Digital SAT?",
    answer:
      "The Digital SAT has two sections, Reading and Writing, and Math, and takes 2 hours and 14 minutes. Each section has two modules; the second module is easier or harder depending on how you did on the first.",
    sources: [CB_STRUCTURE],
  },
  {
    question: "How is the Digital SAT different from the paper SAT?",
    answer:
      "It is shorter, it is taken on a computer, and each section adapts at the module level.",
    sources: [CB_STRUCTURE],
  },
  {
    question: "Does Lyceon include full-length practice tests?",
    answer: "Yes, on paid plans. Daily practice and review are free.",
    claims: ["W2"],
  },
  {
    question: "Can I track my progress?",
    answer:
      "Yes. You can see your progress by section, with skill-level detail on paid plans.",
    claims: ["W2"],
  },
  {
    question: "What is free vs paid?",
    answer:
      "Free includes 40 practice questions per day, a worked explanation after every question, review of your past answers, and a full diagnostic test and your diagnostic score estimate. The AI tutor, full-length practice tests, skill-level progress, the study plan and the parent/guardian progress view are on paid plans.",
    claims: ["W1", "W2"],
  },
];

const onlineSatPrep: ContentPageInput = {
  path: ONLINE_SAT_PREP_PATH,
  title: "Online SAT Prep You Can Do Every Day | Lyceon",
  description:
    "Online SAT prep with daily practice, explanations after every question, full-length practice tests and a study plan. Start free.",
  h1: "Online SAT prep",
  crumb: "Online SAT prep",
  intro: [
    {
      type: "p",
      text: "Lyceon is SAT prep you do online, on your own schedule. It's not a class with set times. You practice when you can, and the work is tracked for you.",
      claims: ["W17"],
    },
  ],
  sections: [
    {
      heading: "Free",
      level: 2,
      blocks: [
        {
          type: "ul",
          items: [
            "40 practice questions a day",
            "A worked explanation after every question",
            "A full diagnostic test",
          ],
          claims: ["W1"],
        },
      ],
    },
    {
      heading: "Pro",
      level: 2,
      blocks: [
        {
          type: "ul",
          items: [
            "No daily limit on practice",
            "Full-length practice tests",
            "A study plan built around your weak areas",
            "An AI tutor for step-by-step help",
            "A read-only progress view for a linked parent",
          ],
          claims: ["W2"],
        },
        { type: "cta" },
      ],
    },
    {
      heading: "How the digital SAT works",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "The digital SAT has two sections, Reading and Writing, and Math, and takes 2 hours and 14 minutes. Each section has two modules, and the second module is easier or harder depending on how you did on the first.",
          sources: [CB_STRUCTURE],
        },
        {
          type: "links",
          items: [
            { label: "SAT Math practice questions", href: MATH_PATH },
            {
              label: "SAT Reading and Writing practice questions",
              href: READING_WRITING_PATH,
            },
            { label: "Free SAT practice tests", href: FREE_PRACTICE_TEST_PATH },
          ],
        },
      ],
    },
  ],
  faq: [...ONLINE_SAT_PREP_FAQS],
  ...DATES,
  approved: APPROVED,
};

const howToStudy: ContentPageInput = {
  path: HOW_TO_STUDY_PATH,
  title: "How to Study for the SAT: A Plain Guide | Lyceon",
  description:
    "How to study for the digital SAT, from your first practice test to test week, using free official practice and short daily sessions.",
  h1: "How to study for the SAT",
  crumb: "How to study for the SAT",
  sections: [
    {
      heading: "Start with a practice test",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Take a full-length practice test in Bluebook before you plan anything. Your score report shows which content areas cost you points.",
          sources: [CB_BLUEBOOK_PRACTICE_TESTS, CB_CONTENT_DOMAINS],
          claims: ["W12"],
        },
      ],
    },
    {
      heading: "Study the areas, not the whole test",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Each section has four content areas. Spend most of your time on the two or three where you missed the most.",
          sources: [CB_CONTENT_DOMAINS],
          claims: ["W12"],
        },
      ],
    },
    {
      heading: "Short sessions, spread out",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Research on learning finds that practice spread over days is remembered better than the same practice crammed into one sitting. Twenty minutes a day beats three hours on Sunday.",
          sources: [CEPEDA_2006],
          claims: ["W12"],
        },
      ],
    },
    {
      heading: "Review every miss",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Read the explanation for every question you get wrong, and for any you guessed right.",
          claims: ["W12"],
        },
      ],
    },
    {
      heading: "Practice in the real format",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "The test is on a computer, with short Reading and Writing passages and a calculator allowed throughout Math. Practice that way so test day feels familiar.",
          sources: [CB_STRUCTURE, CB_READING_WRITING, CB_CALCULATOR],
          claims: ["W12"],
        },
      ],
    },
    {
      heading: "Guides",
      level: 2,
      blocks: [
        {
          type: "links",
          items: [
            ...BLOG_POSTS.map((post) => ({
              label: post.title,
              href: `/blog/${post.slug}`,
            })),
            {
              label: "SAT practice questions by topic",
              href: PRACTICE_HUB_PATH,
            },
            { label: "Free SAT practice tests", href: FREE_PRACTICE_TEST_PATH },
          ],
        },
        { type: "cta" },
      ],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

export const GUIDE_PAGES: readonly ContentPageInput[] = [
  freePracticeTest,
  onlineSatPrep,
  howToStudy,
];
