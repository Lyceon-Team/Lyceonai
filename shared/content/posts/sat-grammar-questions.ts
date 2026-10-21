/**
 * Blog post: SAT grammar questions (batch 2026-W44, Monday 2026-10-26).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-10-plan/PLAN.md]
 *       | @implemented [2026-10-21]
 *
 * plain English: what the grammar questions on the Reading and Writing section test, taken from
 * College Board's own skill list (Standard English Conventions), with original example sentences
 * written for this post, 12 days before the Nov 7 test. Every SAT fact is College Board's; no
 * Lyceon claim.
 */
import {
  CB_ASSESSMENT_FRAMEWORK,
  CB_BLUEBOOK_PRACTICE_TESTS,
  CB_QUESTION_BANK,
  CB_SAT_DATES,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-grammar-questions",
  category: "Reading and Writing",
  tags: ["sat-grammar", "reading-and-writing"],
  batch: "2026-W44",
  publishAt: "2026-10-26T07:00",
  targetKeyword: "sat grammar questions",
  page: {
    title: "SAT Grammar Questions: What They Test | Lyceon",
    description:
      "The grammar questions on the SAT Reading and Writing section test two things: sentence boundaries and word forms. Here's each skill, with examples.",
    h1: "SAT Grammar Questions: What They Test",
    intro: [
      {
        type: "p",
        text: "The SAT is on Saturday, November 7, twelve days from now. The grammar questions are a good place to spend a few of those days, because the list of skills they test is short and College Board publishes it. Here is the list, with an example of each.",
        sources: [CB_SAT_DATES, CB_ASSESSMENT_FRAMEWORK],
      },
    ],
    sections: [
      {
        heading: "What counts as a grammar question",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board calls this group Standard English Conventions. It's one of the four content areas in the Reading and Writing section, and it makes up about 26% of the scored questions (11 to 15 questions).",
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
          {
            type: "p",
            text: "The questions are short. You edit a sentence or two so that it follows the conventions of Standard English. They come in two kinds, Boundaries and Form, Structure, and Sense.",
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
        ],
      },
      {
        heading: "Boundaries",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Boundaries questions ask whether the sentence is complete and whether the punctuation joins or separates its parts the right way. College Board lists end punctuation, semicolons and colons, and commas, dashes and parentheses that set off extra information. It also lists times when no punctuation is needed at all.",
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
          {
            type: "p",
            text: "Try this one. Which choice is correct? \"The lab opened late (blank) the results were due the next morning.\" A semicolon works, because each side could be a complete sentence on its own. A comma alone doesn't, because it can't join two complete sentences.",
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
          {
            type: "p",
            text: "Here is one where the answer is no punctuation: \"The student who finished first handed in the test.\" The words \"who finished first\" are needed to say which student, so commas would be wrong.",
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
        ],
      },
      {
        heading: "Form, Structure, and Sense",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "These questions ask which form of a word fits the sentence. College Board's list has six skills:",
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
          {
            type: "ul",
            items: [
              "Subject-verb agreement. \"The box of old photographs is on the shelf.\" The subject is \"box,\" not \"photographs.\"",
              "Pronoun-antecedent agreement. \"The team checked its time.\" One team, so \"its.\"",
              "Verb finiteness. A sentence needs a main verb. \"The committee meeting on Tuesday\" isn't a sentence. \"The committee meets on Tuesday\" is.",
              "Verb tense and aspect. \"By the time the bell rang, she had finished.\" The earlier action takes \"had finished.\"",
              "Subject-modifier placement. \"Walking to school, Maya saw a fox.\" The opening phrase has to describe the word that comes right after the comma.",
              "Genitives and plurals. This covers choices like its and it's, their, they're and there, and your and you're, plus singular and plural possessives.",
            ],
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
          {
            type: "p",
            text: "College Board says the aim is clear writing in real contexts, not correctness for its own sake. Read the whole sentence before you choose, and ask what it's trying to say.",
            sources: [CB_ASSESSMENT_FRAMEWORK],
          },
        ],
      },
      {
        heading: "How to practice before November 7",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "The Student Question Bank lets you filter by test, domain, skill and difficulty. Choose Reading and Writing, then Standard English Conventions, and work one skill at a time. When you miss a question, note which skill it tested before you move on.",
            sources: [CB_QUESTION_BANK],
          },
          {
            type: "p",
            text: "The Bluebook practice tests are scored and let you review each question, so you can see which skill cost you points.",
            sources: [CB_BLUEBOOK_PRACTICE_TESTS],
          },
          {
            type: "links",
            items: [
              {
                label: "SAT Reading and Writing practice questions",
                href: "/sat-practice-questions/reading-and-writing",
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
        question: "How many grammar questions are on the SAT?",
        answer:
          "Standard English Conventions is about 26% of the scored questions in the Reading and Writing section, which College Board puts at 11 to 15 questions.",
        sources: [CB_ASSESSMENT_FRAMEWORK],
      },
      {
        question: "Do I need to memorize grammar terms for the SAT?",
        answer:
          "The questions ask you to choose the best version of a sentence, not to name a rule. The skill names above are College Board's own labels, which help when you review a missed question.",
        sources: [CB_ASSESSMENT_FRAMEWORK],
      },
    ],
  },
};

export default post;
