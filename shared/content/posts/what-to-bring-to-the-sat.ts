/**
 * Blog post: What to bring to the SAT (batch 2026-W45, Monday 2026-11-02).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-11-plan/PLAN.md]
 *       | @implemented [2026-10-11]
 *
 * plain English: the test-day checklist, five days before the Nov 7 test. Every fact is College
 * Board's (sources in shared/seo/sources.ts, quotes in the claim inventory); no Lyceon claim.
 */
import {
  CB_CALCULATOR,
  CB_DEVICE_READINESS,
  CB_ID_REQUIREMENTS,
  CB_PROHIBITED_DEVICES,
  CB_SAT_DATES,
  CB_WHAT_TO_BRING,
  CB_WHAT_TO_EXPECT,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "what-to-bring-to-the-sat",
  category: "Test Day",
  tags: ["sat-test-day", "checklist"],
  batch: "2026-W45",
  publishAt: "2026-11-02T07:00",
  targetKeyword: "what to bring to the sat",
  page: {
    title: "What to Bring to the SAT: Test Day Checklist | Lyceon",
    description:
      "The SAT test day checklist, from College Board's rules. What to pack, which kinds of ID are accepted, what to leave at home, and when to arrive.",
    h1: "What to Bring to the SAT",
    intro: [
      {
        type: "p",
        text: "The next SAT is on Saturday, November 7. Pack the night before, using this list. It follows College Board's own test-day rules.",
        sources: [CB_SAT_DATES, CB_WHAT_TO_BRING],
      },
    ],
    sections: [
      {
        heading: "Bring these",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "Your testing device, fully charged, with Bluebook installed and exam setup done",
              "Your admission ticket from Bluebook. College Board prefers a printed copy.",
              "A physical photo ID. A picture of it on your phone is refused.",
              "Pencils or pens for scratch work",
              "Your College Board username and password",
              "A calculator, if you want your own. Bluebook also has one built in.",
            ],
            sources: [CB_WHAT_TO_BRING],
          },
        ],
      },
      {
        heading: "Check your ID before you leave",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Most students bring an original, unexpired photo ID issued by the government or by the school they attend now. A school ID from last school year still works through the end of December. The name on your ID has to match the name on your admission ticket exactly, so a nickname on one and your full name on the other won't work.",
            sources: [CB_ID_REQUIREMENTS],
          },
          {
            type: "p",
            text: "No school photo ID? At U.S. test centers, students under 21 can use an SAT Student ID Form instead. The school you attend prepares it, or a notary does if you're schooled at home. If you'll be 21 or older on test day, only a government-issued photo ID is accepted. Testing outside the U.S. has its own rules, so check College Board's ID requirements for the country where you're testing.",
            sources: [CB_ID_REQUIREMENTS],
          },
          {
            type: "p",
            text: "These are refused as ID:",
            sources: [CB_ID_REQUIREMENTS],
          },
          {
            type: "ul",
            items: [
              "Credit or debit cards",
              "Birth certificates",
              "Social Security cards",
              "Temporary IDs",
              "Any ID shown on a screen",
            ],
            sources: [CB_ID_REQUIREMENTS],
          },
          {
            type: "p",
            text: "Keep your ID with you all day, breaks included.",
            sources: [CB_ID_REQUIREMENTS],
          },
        ],
      },
      {
        heading: "Optional items",
        level: 2,
        blocks: [
          {
            type: "ul",
            items: [
              "A watch with no alarm",
              "A charging cable or portable charger",
              "A bag or backpack",
              "A drink and a snack for the break",
              "A backup testing device, if you have one",
            ],
            sources: [CB_WHAT_TO_BRING],
          },
        ],
      },
      {
        heading: "Phones and other devices",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Unless College Board has approved an accommodation for you, phones, smartwatches, fitness trackers, earbuds and separate timers aren't allowed during the test or the break. A plain digital or analog watch is fine. If a phone makes a noise or you're seen with it, you can be dismissed and your scores canceled.",
            sources: [CB_PROHIBITED_DEVICES],
          },
        ],
      },
      {
        heading: "Do exam setup before Saturday",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Exam setup opens 1 to 5 days before the test. Do it on the device you'll bring. Bluebook downloads your test and creates your admission ticket. On Saturday morning, close and reopen Bluebook to check for messages and changes to your test center.",
            sources: [CB_DEVICE_READINESS],
          },
        ],
      },
      {
        heading: "Arrive on time",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Most test centers open at 7:45 AM and close their doors at 8 AM. Check your admission ticket for your own center's time. No one is admitted once testing has started.",
            sources: [CB_WHAT_TO_EXPECT],
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
        question: "Can I show my ID on my phone?",
        answer:
          "No. College Board accepts only an original, physical ID. Digital IDs and anything shown on a device are refused.",
        sources: [CB_ID_REQUIREMENTS],
      },
      {
        question: "Do I need to bring a calculator?",
        answer:
          "No. Bluebook has a calculator built in for the Math section. You may also bring an acceptable calculator of your own.",
        sources: [CB_WHAT_TO_BRING, CB_CALCULATOR],
      },
    ],
  },
};

export default post;
