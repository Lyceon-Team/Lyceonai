import { BLOG_POSTS } from "../content/blog";
import {
  CB_CALCULATOR,
  CB_MATH,
  CB_READING_WRITING,
  CB_STRUCTURE,
  type Source,
} from "./sources";
import {
  BASE_URL,
  DEFAULT_OG_IMAGE,
  createArticleJsonLd,
  createBreadcrumbJsonLd,
  createFaqJsonLd,
  organizationJsonLd,
  websiteJsonLd,
} from "./structured-data";

export interface PublicMeta {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
  jsonLd?: Record<string, unknown>[];
}

/**
 * Head for the static 404 page (F2). No canonical: a not-found response names no URL as
 * its own, and `noindex` keeps it out of every index whatever the status code says.
 */
export const NOT_FOUND_META = {
  title: "Page not found | Lyceon",
  description: "The page you were looking for does not exist.",
} as const;

export interface LegalMeta {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
}

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
export type FaqItem = { question: string; answer: string; sources?: readonly Source[] };

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
    answer: "Yes. Daily practice is free. Full-length timed practice tests are on paid plans.",
  },
];

export const DIGITAL_SAT_FAQS: readonly FaqItem[] = [
  {
    question: "What is the Digital SAT?",
    answer:
      "The Digital SAT has two sections, Reading and Writing, and Math, and takes 2 hours and 14 minutes. Each section has two modules; the second module is easier or harder depending on how you did on the first.",
    sources: [CB_STRUCTURE],
  },
  {
    question: "How is the Digital SAT different from the paper SAT?",
    answer: "It is shorter, it is taken on a computer, and each section adapts at the module level.",
    sources: [CB_STRUCTURE],
  },
  {
    question: "Does Lyceon include full-length practice tests?",
    answer: "Yes, on paid plans. Daily practice and review are free.",
  },
  {
    question: "Can I track my progress?",
    answer: "Yes. You can see your progress by section, with skill-level detail on paid plans.",
  },
  {
    /*
      CORRECTED 2026-09-03 (owner ruling), REWORDED 2026-10-03 (F6, owner-approved). The
      2026-09-03 ruling replaced "Free includes daily limits (10 practice questions and 5 tutor
      messages)", which understated the practice allowance by a factor of four and advertised a
      PREMIUM feature as free (`server/routes/tutor-runtime.ts` denies every non-entitled profile
      with `entitlement_required`). F6 then named review (free for every tier, SCL-110), dropped
      "expanded guardian visibility" (a guardian sees nothing unless the student is on a paid
      plan) and names the free tier's score a "diagnostic score estimate" (wording confirmed by
      Karl, 2026-10-03).

      THIS COPY IS THE ONE SEARCH ENGINES QUOTE: it feeds the FAQ structured data. The number
      must match the free card in `home.tsx` (`FREE_DAILY_PRACTICE_QUESTIONS`, from
      `practice_runtime_config.daily_quota_free` per Doc 02B "Quota Contract");
      `tests/ci/homepage-pricing.contract.test.ts` fails if they drift apart.
    */
    question: "What is free vs paid?",
    answer:
      "Free includes 40 practice questions per day, a worked explanation after every question, review of your past answers, and a full diagnostic test and your diagnostic score estimate. The AI tutor, full-length practice tests, skill-level progress, the study plan and the parent/guardian progress view are on paid plans.",
  },
];

export const DIGITAL_SAT_MATH_FAQS: readonly FaqItem[] = [
  {
    question: "What math topics are on the Digital SAT?",
    answer:
      "The Digital SAT Math section covers Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry.",
    sources: [CB_MATH],
  },
  {
    question: "Can I use a calculator on SAT Math?",
    answer:
      "Yes. You can use a calculator at any point in the Math section, and a Desmos calculator is built into Bluebook, the College Board's testing app.\n\nLyceon practice includes a built-in Desmos calculator on every Math question.",
    sources: [CB_CALCULATOR],
  },
  {
    question: "How many math questions are on the Digital SAT?",
    answer: "The Math section has 44 questions in two equal-length modules, with 70 minutes in total.",
    sources: [CB_STRUCTURE],
  },
  {
    question: "What are common SAT Math mistakes?",
    answer:
      "Common slips include solving for the wrong expression, sign errors, rushing word-problem setup, and skipping answer checks.",
  },
  {
    question: "How does Lyceon support math review?",
    answer:
      "Every practice question comes with a worked explanation. On paid plans, the AI tutor can walk through a problem step by step.",
  },
];

export const DIGITAL_SAT_READING_WRITING_FAQS: readonly FaqItem[] = [
  {
    question: "What is tested on SAT Reading and Writing?",
    answer:
      "The section covers Craft and Structure, Information and Ideas, Standard English Conventions, and Expression of Ideas.",
    sources: [CB_READING_WRITING],
  },
  {
    question: "How is Digital SAT Reading different from the paper test?",
    answer: "Each Reading and Writing question has its own short passage of 25 to 150 words.",
    sources: [CB_READING_WRITING],
  },
  {
    question: "How many Reading and Writing questions are on the Digital SAT?",
    answer:
      "The Reading and Writing section has 54 questions in two equal-length modules, with 64 minutes in total.",
    sources: [CB_STRUCTURE],
  },
  {
    question: "What vocabulary should I study for the SAT?",
    answer: "Focus on academic vocabulary in context and how meaning changes with passage usage.",
  },
  {
    question: "How can I improve SAT Reading speed?",
    answer:
      "Practice evidence-based elimination, transition-word awareness, and short-passage pacing drills.",
  },
];

export const LEGAL_META: Record<string, LegalMeta> = {
  "privacy-policy": {
    title: "Privacy Policy",
    description: "How Lyceon collects, uses, stores, shares, and protects your information.",
    canonical: `${BASE_URL}/legal/privacy-policy`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "student-terms": {
    title: "Student Terms of Use",
    description: "The terms that govern your access to and use of the Lyceon platform.",
    canonical: `${BASE_URL}/legal/student-terms`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "honor-code": {
    title: "Honor Code",
    description: "Our commitment to honest learning and academic integrity at Lyceon.",
    canonical: `${BASE_URL}/legal/honor-code`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "community-guidelines": {
    title: "Community Guidelines",
    description: "How users are expected to behave when using Lyceon.",
    canonical: `${BASE_URL}/legal/community-guidelines`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "parent-guardian-terms": {
    title: "Parent / Guardian Terms",
    description: "Terms for parents and guardians whose children use Lyceon.",
    canonical: `${BASE_URL}/legal/parent-guardian-terms`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "trust-and-safety": {
    title: "Trust & Safety",
    description: "How Lyceon approaches trust, safety, and responsible technology in learning.",
    canonical: `${BASE_URL}/legal/trust-and-safety`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  // F1 (2026-10-03): the three documents published in `legal/` that had no metadata.
  // Descriptions are each document's own manifest description, unchanged.
  // `tests/seo.prerender-output.test.ts` fails if a `legal/` manifest has no entry here.
  "billing-terms": {
    title: "Billing Terms",
    description:
      "What you agree to at checkout: what you are buying, the price and Billing Period, who may subscribe, and how to cancel.",
    canonical: `${BASE_URL}/legal/billing-terms`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "refund-policy": {
    title: "Refund Policy",
    description:
      "Refund windows for first charges and for renewals, how to request one, and what happens after.",
    canonical: `${BASE_URL}/legal/refund-policy`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "subscription-auto-renewal-notice": {
    title: "Subscription and Auto-Renewal Notice",
    description:
      "How automatic renewal works, the reminders we send before each charge, price changes, and how to cancel.",
    canonical: `${BASE_URL}/legal/subscription-auto-renewal-notice`,
    ogImage: DEFAULT_OG_IMAGE,
  },
};

const blogPosts = BLOG_POSTS.map((post) => ({
  ...post,
  canonical: `${BASE_URL}/blog/${post.slug}`,
}));

export const PUBLIC_META: Record<string, PublicMeta> = {
  "/": {
    title: "Lyceon | SAT Prep",
    description:
      "Digital SAT practice with worked explanations and progress tracking. Full-length practice tests, an AI tutor and a study plan on paid plans.",
    // The root URL with its slash: the exact URL the sitemap lists and the browser requests.
    canonical: `${BASE_URL}/`,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      organizationJsonLd,
      websiteJsonLd,
      createFaqJsonLd(HOME_FAQS),
    ],
  },
  "/digital-sat": {
    title: "Digital SAT Prep | Lyceon",
    description:
      "Prepare for the Digital SAT: how the test is structured, what each section covers, and SAT-style practice.",
    canonical: `${BASE_URL}/digital-sat`,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      organizationJsonLd,
      websiteJsonLd,
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        { name: "Digital SAT", url: `${BASE_URL}/digital-sat` },
      ]),
      createFaqJsonLd(DIGITAL_SAT_FAQS),
    ],
  },
  "/digital-sat/math": {
    title: "Digital SAT Math Prep - Algebra, Geometry & Data Analysis | Lyceon",
    description:
      "Prepare for Digital SAT Math: the four content areas, common mistakes, and practice with worked explanations.",
    canonical: `${BASE_URL}/digital-sat/math`,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        { name: "Digital SAT", url: `${BASE_URL}/digital-sat` },
        { name: "Math", url: `${BASE_URL}/digital-sat/math` },
      ]),
      createFaqJsonLd(DIGITAL_SAT_MATH_FAQS),
    ],
  },
  "/digital-sat/reading-writing": {
    title: "Digital SAT Reading & Writing Prep - Vocabulary, Grammar & Comprehension | Lyceon",
    description:
      "Prepare for Digital SAT Reading and Writing: the four content areas, grammar rules, and practice with worked explanations.",
    canonical: `${BASE_URL}/digital-sat/reading-writing`,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        { name: "Digital SAT", url: `${BASE_URL}/digital-sat` },
        { name: "Reading & Writing", url: `${BASE_URL}/digital-sat/reading-writing` },
      ]),
      createFaqJsonLd(DIGITAL_SAT_READING_WRITING_FAQS),
    ],
  },
  "/blog": {
    title: "SAT Prep Blog - Tips, Strategies & Study Guides",
    description:
      "SAT study tips and guides for the Digital SAT.",
    canonical: `${BASE_URL}/blog`,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      organizationJsonLd,
      websiteJsonLd,
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        { name: "Blog", url: `${BASE_URL}/blog` },
      ]),
    ],
  },
  "/trust": {
    title: "Trust & Safety Hub | Lyceon",
    description:
      "Lyceon's Trust & Safety Hub: privacy protections, data security practices, and academic integrity policies.",
    canonical: `${BASE_URL}/trust`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "/legal": {
    title: "Legal & Trust | Lyceon",
    description:
      "Lyceon's legal policies, terms of use, privacy policy, and trust & safety information.",
    canonical: `${BASE_URL}/legal`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "/legal/privacy-policy": {
    title: "Privacy Policy | Lyceon",
    description: LEGAL_META["privacy-policy"].description,
    canonical: LEGAL_META["privacy-policy"].canonical,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "/legal/student-terms": {
    title: "Terms of Use | Lyceon",
    description: LEGAL_META["student-terms"].description,
    canonical: LEGAL_META["student-terms"].canonical,
    ogImage: DEFAULT_OG_IMAGE,
  },
};

// Every other published legal document gets the head the removed Express fallback gave it
// (`${title} | Lyceon`, its own description, self-canonical). The two above keep their
// existing titles.
for (const [slug, meta] of Object.entries(LEGAL_META)) {
  const path = `/legal/${slug}`;
  if (PUBLIC_META[path]) continue;
  PUBLIC_META[path] = {
    title: `${meta.title} | Lyceon`,
    description: meta.description,
    canonical: meta.canonical,
    ogImage: DEFAULT_OG_IMAGE,
  };
}

for (const post of blogPosts) {
  PUBLIC_META[`/blog/${post.slug}`] = {
    title: `${post.title} | Lyceon`,
    description: post.description,
    canonical: post.canonical,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        { name: "Blog", url: `${BASE_URL}/blog` },
        { name: post.title, url: post.canonical },
      ]),
      createArticleJsonLd({
        title: post.title,
        description: post.description,
        url: post.canonical,
        image: DEFAULT_OG_IMAGE,
        datePublished: post.date,
        author: post.author,
      }),
    ],
  };
}

export function getPublicMeta(path: string): PublicMeta | null {
  // Own keys only: a bare index would resolve `constructor` & co. from Object.prototype.
  return Object.prototype.hasOwnProperty.call(PUBLIC_META, path) ? (PUBLIC_META[path] ?? null) : null;
}
