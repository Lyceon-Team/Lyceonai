/**
 * Blog post: How long is the SAT? (batch 2026-W45, Friday 2026-11-06).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-10-11]
 *
 * plain English: the timing of the test, the break and a Saturday schedule, the day before the
 * Nov 7 test. Every fact is College Board's; no Lyceon claim.
 */
import {
  CB_SCORE_RELEASE_DATES,
  CB_STRUCTURE,
  CB_WHAT_TO_EXPECT,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "how-long-is-the-sat",
  category: "Test Day",
  tags: ["sat-test-day", "sat-basics"],
  batch: "2026-W45",
  publishAt: "2026-11-06T07:00",
  targetKeyword: "how long is the sat",
  page: {
    title: "How Long Is the SAT? Timing and Breaks | Lyceon",
    description:
      "The SAT is 2 hours and 14 minutes of testing plus a 10-minute break. How the time splits by section and module, and what a Saturday test day looks like.",
    h1: "How Long Is the SAT?",
    intro: [
      {
        type: "p",
        text: "The SAT is 2 hours and 14 minutes of testing, with a 10-minute break between its two sections. With check-in, most students testing with standard time are done before noon.",
        sources: [CB_STRUCTURE, CB_WHAT_TO_EXPECT],
      },
    ],
    sections: [
      {
        heading: "Time by section",
        level: 2,
        blocks: [
          {
            type: "table",
            caption: "SAT timing",
            head: ["Section", "Time", "Questions"],
            rows: [
              [
                "Reading and Writing",
                "64 minutes (two 32-minute modules)",
                "54",
              ],
              ["Math", "70 minutes (two 35-minute modules)", "44"],
              ["Total", "2 hours 14 minutes", "98"],
            ],
            sources: [CB_STRUCTURE],
          },
        ],
      },
      {
        heading: "Modules",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Each section is split into two modules of the same length. The first module has a mix of easy, medium and hard questions. Depending on how you do on it, the second module is either more or less difficult.",
            sources: [CB_STRUCTURE],
          },
          {
            type: "p",
            text: "Each module has its own timer. You can move between questions and change answers within a module, but once you move on to the next one you can't go back.",
            sources: [CB_WHAT_TO_EXPECT],
          },
        ],
      },
      {
        heading: "The break",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "There is one 10-minute break, between Reading and Writing and Math. You can take an extra break if you need one, but you lose testing time. Keep your ID with you: it's checked each time you come back into the room.",
            sources: [CB_WHAT_TO_EXPECT],
          },
        ],
      },
      {
        heading: "A typical Saturday",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "7:45 AM: check-in",
              "8:00 AM: doors close",
              "8:15 to 8:30 AM: testing starts",
              "10:45 to 11:00 AM: testing with standard time ends",
            ],
            sources: [CB_WHAT_TO_EXPECT],
          },
          {
            type: "p",
            text: "Your admission ticket shows your own center's arrival time, which can differ from this schedule. If College Board is lending you a device, arrive 30 minutes early to sign in and set it up.",
            sources: [CB_WHAT_TO_EXPECT],
          },
        ],
      },
      {
        heading: "After the test",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Your answers are submitted when the test ends. Scores from the November 7 test are released to students on November 20.",
            sources: [CB_WHAT_TO_EXPECT, CB_SCORE_RELEASE_DATES],
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
        question: "How long is the SAT with extended time?",
        answer:
          "It depends on the accommodation you're approved for. On College Board's sample Saturday schedule, testing with time and one-half ends around noon to 12:15 PM, and double time around 1 to 1:15 PM.",
        sources: [CB_WHAT_TO_EXPECT],
      },
    ],
  },
};

export default post;
