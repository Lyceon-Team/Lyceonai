import { BLOG_POSTS } from "../content/blog";
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
 * Copy is carried over unchanged from what the pages rendered on 2026-10-03; claim
 * corrections are F6, not this change.
 */
export type FaqItem = { question: string; answer: string };

export function faqParagraphs(answer: string): string[] {
  return answer.split("\n\n");
}

export const HOME_FAQS: readonly FaqItem[] = [
  {
    question: "How is tutor chat different from a generic chatbot?",
    answer:
      "Tutor chat is built around SAT-style practice context, not open-ended generic chat.\n\nExplanations focus on reasoning steps, common errors, and what to do next.",
  },
  {
    question: "Do I need to add a credit card to start?",
    answer: "No. The free tier is available without entering card details.",
  },
  {
    question: "What can guardians see?",
    answer:
      "Guardians can link student accounts and view progress summaries. Student summary and calendar views are entitlement-gated for paid guardian access.",
  },
  {
    question: "Do you include full-length exams and daily practice?",
    answer:
      "Yes. Lyceon supports both: daily adaptive practice and full-length timed SAT exams.\n\nUse daily sessions to improve weak areas, then validate progress with full-length exam runs.",
  },
];

export const DIGITAL_SAT_FAQS: readonly FaqItem[] = [
  {
    question: "What is the Digital SAT?",
    answer:
      "The Digital SAT is the computer-adaptive SAT format. It is about 2 hours long with two sections: Reading and Writing, and Math.",
  },
  {
    question: "How is the Digital SAT different from the paper SAT?",
    answer:
      "It is shorter, adaptive by module, calculator-allowed across all Math questions, and built for digital delivery.",
  },
  {
    question: "Does Lyceon include full-length exams?",
    answer:
      "Yes. Lyceon includes full-length timed SAT exam sessions alongside daily adaptive practice and review.",
  },
  {
    question: "How does progress tracking work in Lyceon?",
    answer:
      "Lyceon tracks skill and domain performance so students can see weak areas, improving areas, and progress over time.",
  },
  {
    question: "How does Lisa work?",
    answer:
      "Lisa provides step-by-step guidance tied to SAT-style question context. Lisa is designed to support reasoning and review, not to bypass learning.",
  },
  {
    /*
      CORRECTED 2026-09-03 (owner ruling). The previous answer read "Free
      includes daily limits (10 practice questions and 5 tutor messages)" — the
      exact two claims corrected in `client/src/pages/home.tsx` in #713, left
      behind here. It understated the practice allowance by a factor of four and
      advertised a PREMIUM feature as free: `server/routes/tutor-runtime.ts:190`
      denies every non-entitled profile with `entitlement_required`, so free
      gets zero tutor messages, not five.

      THIS COPY IS THE ONE SEARCH ENGINES QUOTE. It feeds the FAQ structured
      data, so a wrong claim here outlives a wrong claim on the page itself.
      Fixing the page and leaving this is how the divergence survived the first
      pass; the two must be changed together.

      The numbers must match the free card in `home.tsx`
      (`FREE_DAILY_PRACTICE_QUESTIONS`, currently 40, from
      `practice_runtime_config.daily_quota_free` per Doc 02B "Quota Contract").
      `client/src/pages/home.seo-parity.test.ts` fails if they drift apart.
    */
    question: "What is free vs paid?",
    answer:
      "Free includes 40 practice questions per day, a worked explanation after every question you answer, and the full diagnostic test with your overall score estimate. The interactive tutor, full-length SAT exams, the complete mastery breakdown and the study calendar are on paid plans, along with expanded guardian visibility.",
  },
];

export const DIGITAL_SAT_MATH_FAQS: readonly FaqItem[] = [
  {
    question: "What math topics are on the Digital SAT?",
    answer:
      "The Digital SAT Math section covers Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry/Trigonometry.",
  },
  {
    question: "Can I use a calculator on SAT Math?",
    answer:
      "Yes. The Digital SAT allows calculator use for the entire Math section, including Bluebook Desmos support.",
  },
  {
    question: "How many math questions are on the Digital SAT?",
    answer: "There are 44 total Math questions split into two 22-question modules, with 70 minutes total.",
  },
  {
    question: "What are common SAT Math mistakes?",
    answer:
      "Common misses include solving for the wrong expression, sign errors, rushing word-problem setup, and skipping answer checks.",
  },
  {
    question: "How does Lyceon support math review?",
    answer:
      "Lyceon provides adaptive practice plus step-by-step tutor guidance so students can identify patterns and correct repeat mistakes.",
  },
];

export const DIGITAL_SAT_READING_WRITING_FAQS: readonly FaqItem[] = [
  {
    question: "What is tested on SAT Reading and Writing?",
    answer:
      "The section covers Craft and Structure, Information and Ideas, Standard English Conventions, and Expression of Ideas.",
  },
  {
    question: "How is Digital SAT Reading different from the paper test?",
    answer:
      "The Digital SAT uses shorter passages with one question per passage, creating faster transitions between topics.",
  },
  {
    question: "How many Reading and Writing questions are on the Digital SAT?",
    answer: "There are 54 total questions split into two 27-question modules with 64 minutes total.",
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
    title: "Lyceon | Study Smarter, Score Higher",
    description:
      "Digital SAT prep with adaptive practice, full-length exams, progress tracking, tutor guidance, and guardian visibility.",
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
    title: "Digital SAT Practice – Study Smarter, Score Higher | Lyceon",
    description:
      "Master the Digital SAT with adaptive SAT-style practice, full-length exam readiness, and tutor explanations.",
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
      "Master Digital SAT Math with adaptive practice, step-by-step review, and focused error correction.",
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
      "Master SAT Reading and Writing with adaptive practice, grammar review, and evidence-based reasoning strategies.",
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
      "Expert SAT prep tips, study strategies, and guides for the Digital SAT. Learn how to improve your score with actionable advice.",
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
  "/trust/evidence": {
    title: "Trust Evidence | Lyceon",
    description:
      "Public technical evidence for Lyceon security and privacy controls, including auth enforcement, RLS usage, and logging safeguards.",
    canonical: `${BASE_URL}/trust/evidence`,
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
