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

export interface LegalMeta {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
}

const homeFaqs = [
  {
    question: "Is this just ChatGPT with a different logo?",
    answer:
      "No. The tutor is grounded in SAT-style questions and explanations. It retrieves specific problems and walks you through them step by step instead of giving generic answers.",
  },
  {
    question: "Do I need a credit card to start?",
    answer: "No. You can start a free SAT practice session without entering any payment details.",
  },
  {
    question: "Can parents and tutors see progress?",
    answer:
      "Yes. You can share a read-only dashboard view with parents, tutors, or counselors to show progress and remaining weak spots.",
  },
  {
    question: "Does this replace full-length practice tests?",
    answer:
      "No. Full-length tests are still essential. Tutor guidance makes your practice between those tests more targeted and efficient.",
  },
];

const digitalSatFaqs = [
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
    question: "What is free vs paid?",
    answer:
      "Free includes daily limits (10 practice questions and 5 tutor messages). Paid plans remove those limits and expand guardian visibility features.",
  },
];

const digitalSatMathFaqs = [
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

const digitalSatReadingFaqs = [
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
    canonical: BASE_URL,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      organizationJsonLd,
      websiteJsonLd,
      createFaqJsonLd(homeFaqs),
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
      createFaqJsonLd(digitalSatFaqs),
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
      createFaqJsonLd(digitalSatMathFaqs),
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
      createFaqJsonLd(digitalSatReadingFaqs),
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
  "/tutor": {
    title: "Tutor Safety & Privacy | Lyceon",
    description: "Lyceon's tutor boundaries, privacy posture, and learning pedagogy for SAT-aligned study.",
    canonical: `${BASE_URL}/tutor`,
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
  return PUBLIC_META[path] || null;
}
