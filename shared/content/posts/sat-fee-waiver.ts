/**
 * Blog post: SAT fee waivers (batch 2026-W43, Wednesday 2026-10-21).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-10-plan/PLAN.md]
 *       | @implemented [2026-10-15]
 *
 * plain English: who qualifies for an SAT fee waiver, what it covers, how to get one and use it,
 * and what to do two days before the Nov 7 test's regular deadline. Every fact is College
 * Board's; no Lyceon claim.
 */
import {
  CB_FEE_WAIVER_BENEFITS,
  CB_FEE_WAIVER_ELIGIBILITY,
  CB_FEE_WAIVERS,
  CB_GETTING_FEE_WAIVER_BENEFITS,
  CB_REGISTERING,
  CB_SAT_DATES,
  CB_TEST_FEES,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-fee-waiver",
  category: "Registration",
  tags: ["sat-registration", "fee-waivers"],
  batch: "2026-W43",
  publishAt: "2026-10-21T07:00",
  targetKeyword: "sat fee waiver",
  page: {
    title: "SAT Fee Waivers: Who Qualifies and How to Apply | Lyceon",
    description:
      "An SAT fee waiver gives eligible students two free SAT tests and more. See who qualifies and how to get a waiver before the November 7 deadline.",
    h1: "SAT Fee Waivers: Who Qualifies and How to Apply",
    intro: [
      {
        type: "p",
        text: "If you qualify for a fee waiver, you can take the SAT for free instead of paying the $68 registration fee. The waiver also covers several things beyond the test, listed below.",
        sources: [CB_FEE_WAIVERS, CB_TEST_FEES],
      },
    ],
    sections: [
      {
        heading: "Who qualifies",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Fee waivers are for low-income 11th- and 12th-grade students in the U.S. or U.S. territories, and for U.S. citizens living abroad. You're eligible if at least one of these applies to you:",
            sources: [CB_FEE_WAIVER_ELIGIBILITY],
          },
          {
            type: "ul",
            items: [
              "You're enrolled in, or eligible for, the National School Lunch Program.",
              "Your family's income is within the USDA Food and Nutrition Service income guidelines.",
              "You're in a program that helps students from low-income families, such as Upward Bound.",
              "Your family receives public assistance.",
              "You're unhoused, or you live in federally subsidized public housing or a foster home.",
              "You're a ward of the state or an orphan.",
            ],
            sources: [CB_FEE_WAIVER_ELIGIBILITY],
          },
        ],
      },
      {
        heading: "Fee waiver benefits",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "Two free SAT tests",
              "Free score reports to send to as many colleges as you choose",
              "Waived application fees at participating colleges, for seniors who have taken the SAT",
              "Free CSS Profile applications for financial aid at participating schools",
              "No late registration fees for your free tests",
              "No cancellation fees",
            ],
            sources: [CB_FEE_WAIVER_BENEFITS],
          },
        ],
      },
      {
        heading: "Getting one",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Ask your school counselor for a fee waiver code, or request a fee waiver directly from College Board. A direct request needs an adult who can confirm you're eligible, so let that adult know an email may come and ask them to answer it quickly.",
            sources: [CB_FEE_WAIVERS],
          },
          {
            type: "p",
            text: "If you're schooled at home, you can request one directly from College Board. You can use one fee waiver in your lifetime, and it gives you the two free tests.",
            sources: [CB_FEE_WAIVERS, CB_FEE_WAIVER_BENEFITS],
          },
          {
            type: "p",
            text: "Only request a waiver if you meet the criteria. College Board can ban an account that gives false information and cancel that student's registration or scores.",
            sources: [CB_FEE_WAIVERS],
          },
        ],
      },
      {
        heading: "Using it when you register",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "When you register online, enter your 12-digit code on the payment page. If your request to College Board was approved, your benefits are already in your account. Codes for the 2026 to 2027 school year start with FW26, and codes expire each August.",
            sources: [CB_REGISTERING, CB_GETTING_FEE_WAIVER_BENEFITS],
          },
        ],
      },
      {
        heading: "Timing for November 7",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "College Board asks students to send a direct request at least 1 to 2 weeks before the registration deadline. For the November 7 test, the regular deadline is Friday, October 23, so a direct request made now is later than College Board advises.",
            sources: [CB_FEE_WAIVERS, CB_SAT_DATES],
          },
          {
            type: "p",
            text: "If you're eligible, talk to your counselor about a code this week. Late registration for November 7 runs until October 27, and a fee waiver removes the late fee. Otherwise, the December 5 test has a registration deadline of November 20.",
            sources: [CB_SAT_DATES, CB_FEE_WAIVER_BENEFITS],
          },
          {
            type: "links",
            items: [
              {
                label: "Free SAT practice test",
                href: "/free-sat-practice-test",
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
        question: "Can I get more than one SAT fee waiver?",
        answer:
          "No. You can use one fee waiver in your lifetime, either as a code or as benefits granted directly by College Board. That one waiver gives you two free SAT tests.",
        sources: [CB_FEE_WAIVERS, CB_FEE_WAIVER_BENEFITS],
      },
      {
        question: "Can a 10th grader get an SAT fee waiver?",
        answer:
          "College Board offers SAT fee waivers to eligible 11th- and 12th-grade students.",
        sources: [CB_FEE_WAIVER_ELIGIBILITY],
      },
    ],
  },
};

export default post;
