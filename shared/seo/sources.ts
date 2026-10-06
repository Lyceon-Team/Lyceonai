/**
 * External sources for the general facts stated on public pages.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 rule 3 ("General facts cite real sources"),
 *       §5 F6] | @implemented [2026-10-03] | plain English: every statement about the SAT that
 * a public page makes is backed by one of these pages, and the page shows the link next to
 * the statement. Each entry was fetched on 2026-10-03 and its text read for the exact facts
 * the copy states (recorded in `docs/compliance/claim-inventory.md`). The FAQPage JSON-LD
 * carries the answer text only, so a source never changes what search engines quote.
 * Studying facts that are not about the SAT cite research instead (CEPEDA_2006).
 *
 * SEO Wave 3 (2026-10-05): the sources below CEPEDA_2006 were fetched on 2026-10-05 and each
 * quoted line found on the page itself; the quotes are in the claim inventory's Sources table,
 * which the publish gate (shared/seo/content-gate.ts) requires every cited URL to appear in.
 * Retail prices change: TPR_TUTORING and CARE_TUTOR_COST are shown "as viewed" with that date.
 */
import type { ContentSource } from "../../packages/shared/src/seo-content-schema";

/** One shape for a cited source, inferred from the content schema (Coding Standards §7.2). */
export type Source = Readonly<ContentSource>;

/** Section timing, question counts, the two modules per section and how the second adapts. */
export const CB_STRUCTURE: Source = {
  label: "College Board: SAT structure",
  url: "https://satsuite.collegeboard.org/sat/whats-on-the-test/structure",
};

/** The four Math content domains. */
export const CB_MATH: Source = {
  label: "College Board: the Math section",
  url: "https://satsuite.collegeboard.org/sat/whats-on-the-test/math",
};

/** Passage length (25–150 words), one question per passage, the four Reading and Writing domains. */
export const CB_READING_WRITING: Source = {
  label: "College Board: the Reading and Writing section",
  url: "https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing",
};

/** Calculator use throughout the Math section; the Desmos calculator built into Bluebook. */
export const CB_CALCULATOR: Source = {
  label: "College Board: calculator policy",
  url: "https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy",
};

/** Total score 400–1600; section scores 200–800. */
export const CB_SCORES: Source = {
  label: "College Board: understanding SAT scores",
  url: "https://satsuite.collegeboard.org/sat/scores/understanding-scores",
};

/** Spacing effect: spread-out practice is retained better than massed practice. */
export const CEPEDA_2006: Source = {
  label:
    "Cepeda, Pashler, Vul, Wixted & Rohrer (2006), Distributed practice in verbal recall tasks: A review and quantitative synthesis, Psychological Bulletin 132(3), 354–380",
  url: "https://doi.org/10.1037/0033-2909.132.3.354",
};

/** The College Board's one-line description of each of the eight content domains (four per section). */
export const CB_CONTENT_DOMAINS: Source = {
  label: "College Board: what are content domains?",
  url: "https://satsuite.collegeboard.org/practice/content-domains",
};

/** Questions per Math domain: Algebra 13–15, Advanced Math 13–15, PSDA 5–7, Geometry and Trigonometry 5–7. */
export const CB_MATH_OVERVIEW: Source = {
  label: "College Board: the Math section overview",
  url: "https://satsuite.collegeboard.org/sat/whats-on-the-test/math/overview",
};

/** "Take a free, full-length practice test on Bluebook, or try a few sample questions in the test preview." */
export const CB_PRACTICE: Source = {
  label: "College Board: SAT practice and preparation",
  url: "https://satsuite.collegeboard.org/practice",
};

/** Khan Academy's free SAT course, developed in partnership with the College Board. */
export const CB_KHAN: Source = {
  label: "College Board: Official Digital SAT Prep on Khan Academy",
  url: "https://satsuite.collegeboard.org/practice/khan-academy",
};

/** Total-score percentiles (nationally representative and user group); what a percentile means. */
export const CB_PERCENTILES: Source = {
  label: "College Board: understanding SAT scores (percentiles)",
  url: "https://research.collegeboard.org/reports/sat-suite/understanding-scores/sat",
};

/** "a good SAT score is one that helps you get admitted to a college you want to go to!" */
export const CB_GOOD_SCORE: Source = {
  label: "College Board: what is a good SAT score?",
  url: "https://satsuite.collegeboard.org/scores/what-scores-mean/what-is-good-score",
};

/** Class of 2026: mean 1045 (RW 528, Math 517); 42% met both benchmarks. */
export const CB_ANNUAL_REPORT_2026: Source = {
  label: "College Board: 2026 SAT Suite of Assessments Annual Report (total group)",
  url: "https://reports.collegeboard.org/media/pdf/2026-total-group-sat-suite-of-assessments-annual-report-ada.pdf",
};

/** Benchmarks RW 480, Math 530; "75% likelihood of achieving a C or higher…". */
export const CB_UNDERSTANDING_SCORES_PDF: Source = {
  label: "College Board: Understanding Scores (Fall 2026, students and families)",
  url: "https://satsuite.collegeboard.org/media/pdf/sat-understanding-scores.pdf",
};

/** Students who took 1, 2, 3+ Bluebook practice tests scored about 25, 45 and 60 points higher; "Estimates are not causal". */
export const CB_PRACTICE_TEST_STUDY_2025: Source = {
  label:
    "College Board Research (May 2025): Examining the Relationship Between Digital SAT Practice in Bluebook and SAT Performance",
  url: "https://research.collegeboard.org/media/pdf/DigitalSATPracticeTests_052025.pdf",
};

/** "Test prep tutors $100/hr", average posted starting rates as of September 22, 2025. */
export const CARE_TUTOR_COST: Source = {
  label: "Care.com: How much does a tutor cost? (viewed October 5, 2026)",
  url: "https://www.care.com/c/how-much-does-a-tutor-cost/",
};

/** SAT Targeted Tutoring, 10 hours, $2,000; SAT Comprehensive Tutoring, 18 hours, $3,150. */
export const TPR_TUTORING: Source = {
  label: "The Princeton Review: SAT tutoring (viewed October 5, 2026)",
  url: "https://www.princetonreview.com/college/sat-tutoring-course",
};

/** Average coaching gains "more in the neighborhood of 30 points"; math 10–20, reading 5–10. */
export const BRIGGS_2009: Source = {
  label:
    "Briggs, D. C. (2009), Preparation for College Admission Exams, National Association for College Admission Counseling (ERIC ED505529)",
  url: "https://files.eric.ed.gov/fulltext/ED505529.pdf",
};

/** ACT: test prep improved retest scores; hours with a private tutor the one activity linked to extra gains. */
export const ACT_R1743_2019: Source = {
  label:
    "Moore, Sanchez & San Pedro (2019), College Entrance Exams: How Does Test Preparation Affect Retest Scores?, ACT Research Report 2019-2",
  url: "https://www.act.org/content/dam/act/unsecured/documents/R1743-test-prep-retest-scores-2019-07.pdf",
};

/** Bluebook full-length practice tests: "timed like a real test"; "Full-length practice tests are scored". */
export const CB_BLUEBOOK_PRACTICE_TESTS: Source = {
  label: "College Board: full-length digital practice tests on Bluebook",
  url: "https://satsuite.collegeboard.org/practice/practice-tests/bluebook",
};

/** "The practice tests use the same multistage adaptive model" as the SAT. */
export const CB_BLUEBOOK_HOW_TO: Source = {
  label: "College Board: how to use Bluebook practice tests",
  url: "https://satsuite.collegeboard.org/practice/bluebook",
};
