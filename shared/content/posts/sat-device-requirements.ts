/**
 * Blog post: SAT device requirements (batch 2026-W44, Friday 2026-10-30).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A, §4, §5, §8; content/batches/2026-10-plan/PLAN.md]
 *       | @implemented [2026-10-21]
 *
 * plain English: which devices work for the digital SAT, how to check yours, and what to do
 * if it won't, eight days before the Nov 7 test. A College Board loan request for Nov 7 is
 * already past its 30-day lead time, so the lending section is for later test dates. Every fact
 * is College Board's; no Lyceon claim.
 */
import {
  CB_BLUEBOOK_APPROVED_DEVICES,
  CB_BLUEBOOK_SAT_WEEKEND,
  CB_DEVICE_LENDING,
  CB_DEVICE_READINESS,
  CB_SAT_DATES,
} from "../../seo/sources";
import type { ScheduledPostSpec } from "./types";

const post: ScheduledPostSpec = {
  slug: "sat-device-requirements",
  category: "Test Day",
  tags: ["sat-test-day", "bluebook"],
  batch: "2026-W44",
  publishAt: "2026-10-30T07:00",
  targetKeyword: "sat device requirements",
  page: {
    title: "SAT Device Requirements: Will Your Device Work? | Lyceon",
    description:
      "Which devices work for the digital SAT, how to check yours a week before test day, and where to borrow one if yours won't run Bluebook.",
    h1: "SAT Device Requirements: Will Your Device Work?",
    intro: [
      {
        type: "p",
        text: "The SAT is on Saturday, November 7, eight days away. You take it in the Bluebook app on a device, so a device problem is better found today than on test morning. Here is what works, how to check yours, and what to do if it doesn't.",
        sources: [CB_SAT_DATES, CB_BLUEBOOK_APPROVED_DEVICES],
      },
    ],
    sections: [
      {
        heading: "Which devices work",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Bluebook runs on a Windows or Mac device, an iPad, or a school-managed Chromebook. It doesn't run on a personal Chromebook or a mobile phone.",
            sources: [CB_BLUEBOOK_APPROVED_DEVICES, CB_DEVICE_LENDING],
          },
          {
            type: "p",
            text: "Your device also has to connect to the Wi-Fi network at your test center and hold a charge for 3 to 4 hours. Bring a charger or portable charger, because you may not have an outlet.",
            sources: [CB_BLUEBOOK_APPROVED_DEVICES, CB_BLUEBOOK_SAT_WEEKEND],
          },
        ],
      },
      {
        heading: "Check yours now",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Compare your device with College Board's approved devices page, which lists the minimum system version for each kind of device. Windows laptops, Macs and school-managed Chromebooks each need at least 1 GB of free space. An iPad needs 250 MB.",
            sources: [CB_BLUEBOOK_APPROVED_DEVICES],
          },
          {
            type: "p",
            text: "If you use a Mac or an iPad, don't install the fall system upgrade before the test. College Board says Apple usually releases those in early fall and advises waiting until the test is over.",
            sources: [CB_BLUEBOOK_APPROVED_DEVICES],
          },
          {
            type: "p",
            text: "On a laptop, external keyboards aren't permitted. On an iPad, they're allowed for the SAT.",
            sources: [CB_BLUEBOOK_APPROVED_DEVICES],
          },
        ],
      },
      {
        heading: "What happens in the days before",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Five days before test day, which is Monday, November 2 for this test, you complete exam setup in Bluebook and get your admission ticket. The setup can be done any time in the five days before. On test morning, you run a final device check.",
            sources: [CB_BLUEBOOK_SAT_WEEKEND, CB_DEVICE_READINESS],
          },
          {
            type: "p",
            text: "If you're using your own, a school's or a friend's device, it needs Bluebook installed and exam setup finished when you arrive. Fix any problem before Monday, so setup doesn't turn up a surprise. If you're borrowing a device from College Board, you pick it up at the test center and complete exam setup there, so arrive 30 minutes before the standard check-in time.",
            sources: [CB_BLUEBOOK_SAT_WEEKEND, CB_DEVICE_LENDING],
          },
        ],
      },
      {
        heading: "If your device won't work",
        level: 2,
        blocks: [
          {
            type: "p",
            text: "Ask to borrow an approved device from your school, a family member or a friend. College Board says to try that first. You can practice on any device that can download Bluebook, including a school computer lab.",
            sources: [CB_DEVICE_LENDING],
          },
          {
            type: "p",
            text: "College Board also lends devices, but a request has to be in at least 30 days before test day, after you register. That window has passed for November 7. If you miss it, College Board says you can register for a later date or borrow a device locally. For Saturday, December 5, a request would be due by November 5.",
            sources: [CB_DEVICE_LENDING, CB_SAT_DATES],
          },
          {
            type: "p",
            text: "A request isn't a promise of a loan. College Board also says the app works the same on every approved device, and its studies found that device type and age don't change scores.",
            sources: [CB_DEVICE_LENDING],
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
        question: "Can I use my phone for the digital SAT?",
        answer:
          "No. College Board says Bluebook can't run on a mobile phone or a personal Chromebook. It runs on Windows, Mac, iPad or a school-managed Chromebook.",
        sources: [CB_BLUEBOOK_APPROVED_DEVICES],
      },
      {
        question: "Can I use a school Chromebook for the SAT?",
        answer:
          "Yes, if it's school-managed. A personal Chromebook doesn't work.",
        sources: [CB_BLUEBOOK_APPROVED_DEVICES],
      },
    ],
  },
};

export default post;
