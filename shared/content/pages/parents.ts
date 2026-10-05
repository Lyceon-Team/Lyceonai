/**
 * P6: the three parent pages: SAT tutor cost, Lyceon vs a private SAT tutor, and whether SAT
 * tutoring is worth it.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C2 (P6: "tutor costs must be cited; the
 *       comparison states only what is true of Lyceon"); Doctrine rules 3, 5; owner decisions on
 *       Wave 3 Step 0, 2026-10-05: decision 4 (/lyceon-vs-sat-tutor: live Stripe price; "clean
 *       and respectful toward tutors. Never negative about them"; a feature-by-feature table with
 *       the nine named rows; "Varies by tutor" where the tutor side varies; "When a tutor makes
 *       more sense" stays), decision 5 (/is-sat-tutoring-worth-it approved in writing; the
 *       opening states the evidence as a range; ends with the standard CTA)]
 *       | @implemented [2026-10-05]
 *
 * plain English: every tutor-side figure is a published rate with its source and the date it was
 * viewed (Care.com and The Princeton Review; Kaplan, Wyzant, Thumbtack and BLS could not be read,
 * so none of their figures appear). Lyceon's price is never written here: the comparison table's
 * cost cell is `{ livePrice: true }`, which renders the Stripe price at runtime the way the
 * homepage pricing card does, or no number at all. The research page quotes each study with its
 * own limits and makes no Lyceon outcome claim.
 */
import {
  ACT_R1743_2019,
  BRIGGS_2009,
  CARE_TUTOR_COST,
  CB_KHAN,
  CB_PRACTICE,
  CB_PRACTICE_TEST_STUDY_2025,
  TPR_TUTORING,
} from "../../seo/sources";
import type { ContentPageInput } from "../../../packages/shared/src/seo-content-schema";

const APPROVED = { by: "Karl", date: "2026-10-05" } as const;
const DATES = { published: "2026-10-05", lastModified: "2026-10-05" } as const;

export const TUTOR_COST_PATH = "/sat-tutor-cost";
export const VS_TUTOR_PATH = "/lyceon-vs-sat-tutor";
export const TUTORING_WORTH_IT_PATH = "/is-sat-tutoring-worth-it";

const PARENT_LINKS = [
  { label: "How much does an SAT tutor cost?", href: TUTOR_COST_PATH },
  { label: "Lyceon or a private SAT tutor?", href: VS_TUTOR_PATH },
  { label: "Is SAT tutoring worth it?", href: TUTORING_WORTH_IT_PATH },
] as const;

function parentLinksExcept(path: string): { label: string; href: string }[] {
  return PARENT_LINKS.filter((l) => l.href !== path).map((l) => ({ ...l }));
}

const tutorCost: ContentPageInput = {
  path: TUTOR_COST_PATH,
  title: "How Much Does an SAT Tutor Cost? | Lyceon",
  description:
    "What SAT tutoring costs per hour and per package, from published rates, plus questions to ask before you pay for a tutor.",
  h1: "How much does an SAT tutor cost?",
  crumb: "SAT tutor cost",
  intro: [
    {
      type: "p",
      text: "It varies more than most parents expect. Hourly rates depend on the tutor's experience, where you live, and whether you hire one person or go through a company.",
      sources: [CARE_TUTOR_COST],
    },
  ],
  sections: [
    {
      heading: "Published rates",
      level: 2,
      blocks: [
        {
          type: "table",
          caption: "Published SAT tutoring rates",
          head: ["Provider", "What it is", "Price"],
          rows: [
            [
              "Care.com",
              "Average posted starting rate for test prep tutors, as of September 22, 2025",
              "$100 an hour",
            ],
            [
              "The Princeton Review",
              "SAT Targeted Tutoring, 10 hours",
              "$2,000",
            ],
            [
              "The Princeton Review",
              "SAT Comprehensive Tutoring, 18 hours",
              "$3,150",
            ],
          ],
          note: "Prices as viewed on October 5, 2026. Retail prices change, so check the provider's own page before you buy.",
          sources: [CARE_TUTOR_COST, TPR_TUTORING],
        },
      ],
    },
    {
      heading: "What to ask before you pay",
      level: 2,
      blocks: [
        {
          type: "ul",
          items: [
            "How many hours does the package include, and what happens to unused hours?",
            "Does the tutor work from official College Board practice tests?",
            "How will you see progress between sessions?",
            "Is there a refund policy, and what does it require?",
          ],
          claims: ["W12"],
        },
      ],
    },
    {
      heading: "Lower-cost options",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "The College Board's practice tests in Bluebook and Khan Academy's SAT course are free.",
          sources: [CB_PRACTICE, CB_KHAN],
        },
        {
          type: "p",
          text: "Lyceon is a monthly subscription for daily practice, full-length tests, a study plan and an AI tutor. [See Lyceon's price](/#pricing).",
          claims: ["W2", "W7"],
        },
        { type: "links", items: parentLinksExcept(TUTOR_COST_PATH) },
        { type: "cta" },
      ],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

const VARIES = "Varies by tutor";

const vsTutor: ContentPageInput = {
  path: VS_TUTOR_PATH,
  title: "Lyceon vs a Private SAT Tutor | Lyceon",
  description:
    "How a private SAT tutor and Lyceon differ in cost, schedule and the kind of help you get, so you can pick what fits your student.",
  h1: "Lyceon or a private SAT tutor?",
  crumb: "Lyceon or a private SAT tutor?",
  intro: [
    {
      type: "p",
      text: "They do different jobs, and some families use both. Here is what each one is.",
      claims: ["W10"],
    },
  ],
  sections: [
    {
      heading: "Feature by feature",
      level: 2,
      blocks: [
        {
          type: "table",
          caption: "A private SAT tutor and Lyceon, feature by feature",
          head: ["Feature", "Private SAT tutor", "Lyceon"],
          rows: [
            [
              "Cost",
              "Varies by tutor. Published rates include $100 an hour (Care.com's average posted starting rate for test prep tutors) and $2,000 for 10 hours (The Princeton Review).",
              { livePrice: true },
            ],
            [
              "Schedule",
              "Sessions you book with the tutor",
              "Practice any time",
            ],
            [
              "Who decides what to work on",
              VARIES,
              "Your student, with a study plan based on their results (Pro)",
            ],
            [
              "Explanations after every question",
              VARIES,
              "Yes, a worked explanation after every question",
            ],
            [
              "Full-length practice tests with score reports",
              VARIES,
              "Yes, on Pro, with a score report after each",
            ],
            ["AI tutor", "No, the tutor is a person", "Yes, on Pro"],
            [
              "Study plan",
              VARIES,
              "Yes, on Pro, built around your student's weak areas",
            ],
            [
              "Progress view for parents",
              VARIES,
              "Yes, on Pro, a read-only view for a linked parent",
            ],
            [
              "In-person accountability",
              "Yes, a person working with your student",
              "No",
            ],
          ],
          note: "Tutor rates as viewed on October 5, 2026.",
          sources: [CARE_TUTOR_COST, TPR_TUTORING],
          claims: ["W7", "W8", "W9"],
        },
      ],
    },
    {
      heading: "When a tutor makes more sense",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "If your student needs someone to sit with them, keep them accountable in person, or work on test anxiety, a good tutor does that and software doesn't.",
          claims: ["W10"],
        },
      ],
    },
    {
      heading: "When Lyceon makes more sense",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "If your student studies better on their own schedule, or you want daily practice between tutor sessions, Lyceon covers that for a monthly price.",
          claims: ["W10"],
        },
        { type: "links", items: parentLinksExcept(VS_TUTOR_PATH) },
        { type: "cta" },
      ],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

const worthIt: ContentPageInput = {
  path: TUTORING_WORTH_IT_PATH,
  title: "Is SAT Tutoring Worth It? What Research Shows | Lyceon",
  description:
    "What studies have found about SAT coaching and score gains, what that means for your budget, and free official practice to try first.",
  h1: "Is SAT tutoring worth it?",
  crumb: "Is SAT tutoring worth it?",
  intro: [
    {
      type: "p",
      text: "Studies of SAT prep find average gains from about 30 points (coaching, in older studies) up to about 60 points (students who took three or more official practice tests, in a 2025 College Board study, which notes this is a link, not proof of cause).",
      sources: [BRIGGS_2009, CB_PRACTICE_TEST_STUDY_2025],
      claims: ["W11"],
    },
  ],
  sections: [
    {
      heading: "What the research says",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "A 2009 review for NACAC by Derek Briggs found that average gains from coaching were \"more in the neighborhood of 30 points,\" not the 100 or more often claimed. It found larger effects in math than in reading. Those studies are of the older SAT, and few cover tests after 2000.",
          sources: [BRIGGS_2009],
        },
        {
          type: "p",
          text: "Briggs also notes that if a college decides between similar applicants on small score differences, a small gain can still matter.",
          sources: [BRIGGS_2009],
        },
        {
          type: "p",
          text: "A 2019 ACT study found that test prep improved students' retest scores, and that hours with a private tutor were the one prep activity linked to extra gains. That study was of the ACT, not the SAT.",
          sources: [ACT_R1743_2019],
        },
      ],
    },
    {
      heading: "What to try first",
      level: 2,
      blocks: [
        {
          type: "p",
          text: "Take a free official practice test in Bluebook so you know where you start. Then decide whether the gap you want to close is worth a tutor's fee, or whether steady practice gets you there.",
          sources: [CB_PRACTICE],
          claims: ["W12"],
        },
        { type: "links", items: parentLinksExcept(TUTORING_WORTH_IT_PATH) },
        { type: "cta" },
      ],
    },
  ],
  ...DATES,
  approved: APPROVED,
};

export const PARENT_PAGES: readonly ContentPageInput[] = [
  tutorCost,
  vsTutor,
  worthIt,
];
