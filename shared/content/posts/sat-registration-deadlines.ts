/**
 * Blog post: SAT registration deadlines (batch 2026-W47, Monday 2026-11-16).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-11-11]
 *
 * plain English: four days before the Dec 5 test's regular deadline: every confirmed 2026-27
 * deadline, and what each one still lets you do (register, register late, change or cancel,
 * waitlist, photo and name changes). The registration steps themselves are the 2026-W43 post's;
 * this one links to it. Every fact is College Board's; no Lyceon claim.
 */
import {
  CB_CANCEL_REGISTRATION,
  CB_CHANGE_REGISTRATION,
  CB_SAT_DATES,
  CB_TEST_FEES,
  CB_WAITLIST,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-registration-deadlines",
  category: "Registration",
  tags: ["sat-registration", "sat-dates"],
  batch: "2026-W47",
  publishAt: "2026-11-16T07:00",
  targetKeyword: "sat registration deadline",
  page: {
    title: "SAT Registration Deadlines for 2026-27 | Lyceon",
    description:
      "Every SAT registration deadline for the 2026-27 tests, and what you can still do after each one: register late, change, cancel or join the waitlist.",
    h1: "SAT Registration Deadlines",
    intro: [
      {
        type: "p",
        text: "The registration deadline for the Saturday, December 5 SAT is Friday, November 20. The late registration deadline is Tuesday, November 24. Each SAT has these two deadlines, and a few smaller ones after them.",
        sources: [CB_SAT_DATES],
      },
    ],
    sections: [
      {
        heading: "Deadlines for every confirmed test",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "SAT weekend registration deadlines, 2026-27",
            head: [
              "Test date",
              "Registration deadline",
              "Late registration deadline",
            ],
            rows: [
              ["December 5, 2026", "November 20, 2026", "November 24, 2026"],
              ["March 6, 2027", "February 19, 2027", "February 23, 2027"],
              ["May 1, 2027", "April 16, 2027", "April 20, 2027"],
              ["June 5, 2027", "May 21, 2027", "May 25, 2027"],
            ],
            note: "Deadlines expire at 11:59 PM Eastern time.",
            sources: [CB_SAT_DATES],
          },
          {
            type: "p",
            text: "College Board also lists anticipated test dates for 2027-28, starting August 28, 2027, but no deadlines for them yet.",
            sources: [CB_SAT_DATES],
          },
        ],
      },
      {
        heading: "Before the registration deadline",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Registering by the regular deadline costs $68. Eligible students can register for free with a fee waiver. If you need to borrow a testing device from College Board, register and request it at least 30 days before test day. That's earlier than the registration deadline.",
            sources: [CB_TEST_FEES, CB_SAT_DATES],
          },
          {
            type: "links",
            items: [
              {
                label: "How to register for the SAT, step by step",
                href: "/blog/how-to-register-for-the-sat",
              },
            ],
          },
        ],
      },
      {
        heading: "Between the two deadlines",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "The late registration deadline is also the deadline for changes and for regular cancellation. Until then you can still:",
            sources: [CB_SAT_DATES],
          },
          {
            type: "ul",
            items: [
              "Register late, for an extra $38. A fee waiver covers this fee too.",
              "Change your test center in your College Board account, for $34.",
              "Cancel. Your registration fee is refunded, minus a $34 cancellation fee.",
              "Move to a different test date. To do that, you cancel and register for the new test.",
            ],
            sources: [
              CB_TEST_FEES,
              CB_CHANGE_REGISTRATION,
              CB_CANCEL_REGISTRATION,
            ],
          },
        ],
      },
      {
        heading: "After the late deadline",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "You can no longer register normally or change your test center. These deadlines come later, close to test day:",
            sources: [CB_SAT_DATES, CB_CANCEL_REGISTRATION],
          },
          {
            type: "table",
            caption: "Deadlines after the late registration deadline",
            head: ["Change", "Deadline"],
            rows: [
              [
                "Name, date of birth or gender (through SAT support)",
                "6 PM Eastern on the Monday before the test",
              ],
              ["Photo", "5 days before the test"],
              [
                "Cancellation: your fee is refunded minus a $44 cancellation fee",
                "11:59 PM Eastern on the Thursday before the test",
              ],
            ],
            sources: [CB_CHANGE_REGISTRATION, CB_CANCEL_REGISTRATION],
          },
        ],
      },
      {
        heading: "No seats near you?",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "If no test center has seats within your search distance when you register, you can join the waitlist. Students in the U.S. and most U.S. territories can join. To join, you pay the registration fee up front. The waitlist itself doesn't cost extra. You also set how far you'd be willing to travel, up to 25 miles.",
            sources: [CB_WAITLIST, CB_TEST_FEES],
          },
          {
            type: "p",
            text: "College Board places you in an open seat as one comes up, until 3 days before test day. If no seat opens by then, College Board refunds your registration fee. Late fees aren't refunded.",
            sources: [CB_WAITLIST],
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
        question: "What time is the SAT registration deadline?",
        answer:
          "SAT weekend deadlines expire at 11:59 PM Eastern time on the date listed.",
        sources: [CB_SAT_DATES],
      },
      {
        question: "Does a fee waiver cover late registration?",
        answer:
          "Yes. Late registration is free with a fee waiver, and so is canceling. If you cancel, your unused fee waiver benefits are returned to you.",
        sources: [CB_TEST_FEES],
      },
    ],
  },
};

export default post;
