import type { Source } from "./sources";

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1 — "FAQ schema = visible FAQ"] |
 * @implemented [2026-10-03] | plain English: each FAQ list below is the ONE copy of that FAQ.
 * The page renders it and the FAQPage JSON-LD is built from it, so what search engines quote
 * is exactly what a visitor reads. Before this, the homepage JSON-LD carried four questions
 * the page never showed, and the Digital SAT page rendered a free-tier answer that the
 * metadata had already corrected (owner ruling 2026-09-03, see "What is free vs paid?").
 *
 * An answer may hold several paragraphs, separated by a blank line ("\n\n"): the page renders
 * one <p> per paragraph (`faqParagraphs`), and the JSON-LD joins them with a space.
 *
 * F1 carried the copy over unchanged except for the Digital SAT free-tier answer, which had
 * drifted from the 2026-09-03 owner ruling; the copy was then rewritten under F6 (below).
 */
/*
 * F6 (2026-10-03, owner-approved copy, Public Disclosure Doctrine §0): every answer below was
 * rewritten to industry-standard wording. Paid features say so; nothing describes how
 * practice is selected or how the tutor works; every statement about the SAT names its
 * College Board source in `sources`, which the page renders under the answer (the JSON-LD
 * carries the answer text only). The approved claim inventory is
 * `docs/compliance/claim-inventory.md`; `tests/ci/public-copy-claims.contract.test.ts` keeps
 * the removed phrasings out.
 */
export type FaqItem = {
  question: string;
  answer: string;
  sources?: readonly Source[];
};

export function faqParagraphs(answer: string): string[] {
  return answer.split("\n\n");
}

export const HOME_FAQS: readonly FaqItem[] = [
  {
    question: "What does the AI tutor do?",
    answer:
      "On paid plans, the AI tutor answers questions about SAT practice problems with step-by-step explanations.",
  },
  {
    question: "Do I need to add a credit card to start?",
    answer: "No. The free tier is available without entering card details.",
  },
  {
    question: "What can parents and guardians see?",
    answer:
      "Parents and guardians can link to a student's account and see a read-only progress summary while the student is on a paid plan.",
  },
  {
    question: "Do you include full-length practice tests and daily practice?",
    answer:
      "Yes. Daily practice is free. Full-length timed practice tests are on paid plans.",
  },
];

/**
 * @spec [owner brief "Build: /parent page + card-first parent onboarding" (Karl, 2026-11-22),
 *       FAQ "Questions parents ask"; owner ruling 2026-11-22 (2) card first, charged when the
 *       teen joins; (3) Karl approves every claim on the page; claim inventory P-rows] |
 * @implemented [2026-11-22] | plain English: the six parent questions on `/parent`, verbatim
 * from the approved prototype. The page renders this array and `PUBLIC_META["/parent"]` builds
 * its FAQPage JSON-LD from it, the way `HOME_FAQS` works. "When am I charged?" describes the
 * card-first flow the guardian app enforces (Part 2 of the same brief), so the answer and the
 * product say the same thing.
 */
export const PARENT_FAQS: readonly FaqItem[] = [
  {
    question: "Do I need my teen’s email?",
    answer: "No. You can copy the invite link and text it to them instead.",
  },
  {
    question: "When am I charged?",
    answer:
      "Only when your teen joins. You add your card before sending the invite, and it’s charged the moment they accept. If they never join, you’re never charged.",
  },
  {
    question: "Can I cancel?",
    answer: "Yes, any time from your billing page.",
  },
  {
    question: "What can I see, and what stays private?",
    answer:
      "You see their projected and target scores, mastery by area, study calendar and practice test results. Their individual answers and AI tutor conversations stay private to them.",
  },
  {
    question: "My teen already uses Lyceon. Does that work?",
    answer:
      "Yes. They accept your invite from their existing account and keep all their progress.",
  },
  {
    question: "Does Lyceon guarantee a score?",
    answer: "No. We show where your teen stands and exactly what to work on.",
  },
];
