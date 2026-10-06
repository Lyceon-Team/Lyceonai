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
