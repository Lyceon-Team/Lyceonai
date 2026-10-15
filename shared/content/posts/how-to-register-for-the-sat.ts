/**
 * Blog post: How to register for the SAT (batch 2026-W43, Monday 2026-10-19).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-10-plan/PLAN.md]
 *       | @implemented [2026-10-15]
 *
 * plain English: the registration steps, four days before the Nov 7 test's regular deadline: what
 * you need, the photo rules, the fees, late registration and changes. Every fact is College
 * Board's (sources in shared/seo/sources.ts, quotes in the claim inventory); no Lyceon claim.
 */
import {
  CB_CHANGE_REGISTRATION,
  CB_FEE_WAIVERS,
  CB_PHOTO_REQUIREMENTS,
  CB_REGISTERING,
  CB_REGISTRATION,
  CB_SAT_DATES,
  CB_TEST_FEES,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "how-to-register-for-the-sat",
  category: "Registration",
  tags: ["sat-registration", "sat-dates"],
  batch: "2026-W43",
  publishAt: "2026-10-19T07:00",
  targetKeyword: "how to register for the sat",
  page: {
    title: "How to Register for the SAT, Step by Step | Lyceon",
    description:
      "How to register for the SAT before the November 7 deadline. Covers the photo rules and fees, plus what to do if you miss the regular deadline.",
    h1: "How to Register for the SAT",
    intro: [
      {
        type: "p",
        text: "Registration for the Saturday, November 7 SAT closes on Friday, October 23. Late registration runs until Tuesday, October 27, for an extra fee. Here is how to register, step by step.",
        sources: [CB_SAT_DATES, CB_TEST_FEES],
      },
    ],
    sections: [
      {
        heading: "Before you start",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Have a photo of yourself and a way to pay ready before you begin. You also need a free College Board account. If you qualify for a fee waiver, have your fee waiver code too.",
            sources: [CB_REGISTRATION, CB_REGISTERING],
          },
          {
            type: "p",
            text: "You have to register yourself. A parent or counselor can't do it for you. Registration takes about 30 minutes, and you can start it, stop, and come back to finish later.",
            sources: [CB_REGISTERING],
          },
        ],
      },
      {
        heading: "The steps",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "Sign in to your College Board account, or create one.",
              "Enter your information.",
              "Choose your test date and test center. Look at more than one center, since not every center has seats. You'll see which ones do as you register.",
              "Upload your photo.",
              "Pay the fee, or enter your fee waiver code.",
            ],
            sources: [CB_REGISTERING],
          },
          {
            type: "p",
            text: "If you're schooled at home, enter 970000 as your high school code.",
            sources: [CB_REGISTERING],
          },
        ],
      },
      {
        heading: "Get the photo right",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Staff compare your photo with your ID on test day, and if the photo doesn't meet the requirements, you won't be allowed to test. A message saying your upload worked only means the file type and size are right.",
            sources: [CB_PHOTO_REQUIREMENTS],
          },
          {
            type: "ul",
            items: [
              "Face the camera directly, with your head and shoulders in view.",
              "Be the only person in the photo.",
              "Show your whole face and both eyes, with no sunglasses.",
              "No hat, unless you wear it for religious reasons.",
              "No filters or edits.",
            ],
            sources: [CB_PHOTO_REQUIREMENTS],
          },
        ],
      },
      {
        heading: "What it costs",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "SAT fees for U.S. test takers",
            head: ["Item", "Fee"],
            rows: [
              ["Registration", "$68"],
              ["Late registration", "$38 more"],
              ["Change of test center", "$34"],
              ["Cancel by the change deadline", "$34"],
              ["Cancel after the change deadline", "$44"],
            ],
            sources: [CB_TEST_FEES],
          },
          {
            type: "p",
            text: "Eligible students can take the SAT for free with a fee waiver, which also covers late registration.",
            sources: [CB_TEST_FEES, CB_FEE_WAIVERS],
          },
        ],
      },
      {
        heading: "If you miss October 23",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "You can still register for November 7 until October 27, for the $38 late registration fee. After that, the next test is Saturday, December 5. Its registration deadline is Friday, November 20.",
            sources: [CB_SAT_DATES, CB_TEST_FEES],
          },
        ],
      },
      {
        heading: "Changing your registration",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "You can change your test center in your College Board account, for a fee. To change the test date, you cancel and register for a new test. You can change your photo until 5 days before the test.",
            sources: [CB_CHANGE_REGISTRATION, CB_TEST_FEES],
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
        question: "Can my parent register me for the SAT?",
        answer:
          "No. College Board says you need to register for yourself. A parent or counselor can't do it for you.",
        sources: [CB_REGISTERING],
      },
      {
        question: "How much does the SAT cost?",
        answer:
          "Registration is $68 in the U.S. Late registration costs $38 more. Eligible students can take it for free with a fee waiver.",
        sources: [CB_TEST_FEES],
      },
    ],
  },
};

export default post;
