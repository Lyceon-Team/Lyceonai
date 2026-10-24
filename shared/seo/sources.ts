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
import {
  SAT_DATES_SOURCE_URL,
  SAT_SCORE_RELEASE_SOURCE_URL,
} from "../sat-test-dates";

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
  label:
    "College Board: 2026 SAT Suite of Assessments Annual Report (total group)",
  url: "https://reports.collegeboard.org/media/pdf/2026-total-group-sat-suite-of-assessments-annual-report-ada.pdf",
};

/** Benchmarks RW 480, Math 530; "75% likelihood of achieving a C or higher…". */
export const CB_UNDERSTANDING_SCORES_PDF: Source = {
  label:
    "College Board: Understanding Scores (Fall 2026, students and families)",
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

// Content pipeline, batch 2026-W45 (Doc 10B; read 2026-10-11). Each page was fetched on
// 2026-10-11 and the quoted text found on it; the quotes are in the claim inventory's
// "Content pipeline sources" table.

/** The test-day checklist: device with Bluebook, admission ticket, physical photo ID, pencils or pens, login, calculator; the "Nice to Have" list. */
export const CB_WHAT_TO_BRING: Source = {
  label: "College Board: what to bring on SAT test day",
  url: "https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-bring",
};

/** Physical, unexpired photo ID; full legal name matching the admission ticket; acceptable and unacceptable IDs. */
export const CB_ID_REQUIREMENTS: Source = {
  label: "College Board: SAT ID requirements",
  url: "https://satsuite.collegeboard.org/sat/what-to-bring-do/id-requirements",
};

/** The Saturday schedule (doors 7:45–8 a.m., testing 8:15–8:30, standard time ends 10:45–11); the 10-minute break; modules; tools. */
export const CB_WHAT_TO_EXPECT: Source = {
  label: "College Board: what to expect on SAT test day",
  url: "https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect",
};

/** Phones, smartwatches, earbuds and separate timers are not allowed during the test or breaks. */
export const CB_PROHIBITED_DEVICES: Source = {
  label: "College Board: prohibited devices",
  url: "https://satsuite.collegeboard.org/sat/what-to-bring-do/prohibited-devices",
};

/** Bluebook devices; exam setup 1–5 days before; the test-day morning check. */
export const CB_DEVICE_READINESS: Source = {
  label: "College Board: SAT device readiness",
  url: "https://satsuite.collegeboard.org/sat/device-readiness",
};

/** SAT test dates and registration deadlines (the same page shared/sat-test-dates.ts reads). */
export const CB_SAT_DATES: Source = {
  label: "College Board: SAT dates and deadlines",
  url: SAT_DATES_SOURCE_URL,
};

/** Student score release dates (the same page shared/sat-test-dates.ts reads). */
export const CB_SCORE_RELEASE_DATES: Source = {
  label: "College Board: SAT score release dates",
  url: SAT_SCORE_RELEASE_SOURCE_URL,
};

// Content pipeline, batch 2026-W43 (Doc 10B; read 2026-10-15). Each page was fetched on
// 2026-10-15 and the quoted text found on it; the quotes are in the claim inventory's
// "Content pipeline sources (batch 2026-W43)" table.

/** Registering online: about 30 minutes, register yourself, account, photo, test date and center. */
export const CB_REGISTERING: Source = {
  label: "College Board: registering for the SAT",
  url: "https://satsuite.collegeboard.org/sat/registration/online-registration/registering",
};

/** "Before you register, make sure you have a photo and form of payment." */
export const CB_REGISTRATION: Source = {
  label: "College Board: SAT registration",
  url: "https://satsuite.collegeboard.org/sat/registration",
};

/** The registration photo: head-on, only you, face and eyes visible, no filters; a photo that fails means no testing. */
export const CB_PHOTO_REQUIREMENTS: Source = {
  label: "College Board: SAT photo requirements",
  url: "https://satsuite.collegeboard.org/sat/registration/online-registration/photo-requirements",
};

/** The $68 registration fee and the change, cancel and late registration fees (through June 2027). */
export const CB_TEST_FEES: Source = {
  label: "College Board: SAT test fees",
  url: "https://satsuite.collegeboard.org/sat/registration/fees-refunds/test-fees",
};

/** Changing a registration: test center through the account, a new date means cancel and re-register, photo until 5 days before. */
export const CB_CHANGE_REGISTRATION: Source = {
  label: "College Board: changing your SAT registration",
  url: "https://satsuite.collegeboard.org/sat/registration/change-cancel/changing-registration-info",
};

/** Getting a fee waiver: counselor code or a direct request, once per lifetime, 1–2 weeks before the deadline. */
export const CB_FEE_WAIVERS: Source = {
  label: "College Board: SAT fee waivers",
  url: "https://satsuite.collegeboard.org/sat/registration/fee-waivers",
};

/** Who is eligible: low-income 11th and 12th graders, and the six descriptions. */
export const CB_FEE_WAIVER_ELIGIBILITY: Source = {
  label: "College Board: SAT fee waiver eligibility",
  url: "https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-eligibility",
};

/** What a fee waiver covers: two free tests, unlimited score reports, application fee waivers, no late or cancel fees. */
export const CB_FEE_WAIVER_BENEFITS: Source = {
  label: "College Board: SAT fee waiver benefits",
  url: "https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-benefits",
};

/** Using a fee waiver: the request form or a code; codes for 2026–27 start with FW26 and expire in August. */
export const CB_GETTING_FEE_WAIVER_BENEFITS: Source = {
  label: "College Board: getting SAT fee waiver benefits",
  url: "https://satsuite.collegeboard.org/sat/registration/fee-waivers/getting-fee-waiver-benefits",
};

/** College Board's study-plan guidance: practice test at least two weeks before test day; spacing tests; study activities. */
export const CB_STUDY_PLAN: Source = {
  label: "College Board: build your SAT study plan",
  url: "https://satsuite.collegeboard.org/practice/build-your-study-plan",
};

/** The Student Question Bank: filter by test, domain, skill and difficulty. */
export const CB_QUESTION_BANK: Source = {
  label: "College Board: how to use the Student Question Bank",
  url: "https://satsuite.collegeboard.org/practice/student-question-bank",
};

// Content pipeline sources (batch 2026-W44). Each page was fetched on 2026-10-21 and the quoted
// text found on it; the quotes are in the claim inventory's "Content pipeline sources (batch
// 2026-W44)" table.

/** Reading and Writing and Math content domains, skills and testing points, with the Standard English Conventions skill list. */
export const CB_ASSESSMENT_FRAMEWORK: Source = {
  label: "College Board: Assessment Framework for the Digital SAT Suite",
  url: "https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf",
};

/** The Math module directions and the reference sheet as Bluebook displays them. */
export const CB_BLUEBOOK_TEST_DIRECTIONS: Source = {
  label: "College Board: Bluebook test directions (Math reference sheet)",
  url: "https://satsuite.collegeboard.org/media/pdf/english-sat-test-directions-bb.pdf",
};

/** The Bluebook testing tools, including the Math reference sheet. */
export const CB_BLUEBOOK_TOOLS: Source = {
  label: "College Board: Bluebook testing tools",
  url: "https://bluebook.collegeboard.org/students/tools",
};

/** Approved devices: Windows, Mac, iPad, school-managed Chromebook; no personal Chromebook or phone; space, battery, keyboards. */
export const CB_BLUEBOOK_APPROVED_DEVICES: Source = {
  label: "College Board: Bluebook approved devices",
  url: "https://bluebook.collegeboard.org/students/prepare-your-device/approved-devices",
};

/** SAT Weekend: the timeline before test day (exam setup 5 days before) and what to bring. */
export const CB_BLUEBOOK_SAT_WEEKEND: Source = {
  label: "College Board: Bluebook for SAT Weekend",
  url: "https://bluebook.collegeboard.org/students/sat-weekend",
};

/** Device lending: when to request, who is eligible, what is lent, no score difference by device. */
export const CB_DEVICE_LENDING: Source = {
  label: "College Board: SAT device lending",
  url: "https://satsuite.collegeboard.org/sat/device-lending",
};
