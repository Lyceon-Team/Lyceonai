import { BLOG_POSTS } from "../content/blog";
import { CONTENT_PAGES } from "../content/pages";
import { plainText } from "./content-gate";
import { HOME_FAQS } from "./faqs";
import { formatQotdDate, qotdTopic } from "./qotd-labels";
import type { ContentPage } from "../../packages/shared/src/seo-content-schema";
import type { QotdArchiveResponse } from "../../packages/shared/src/qotd-schema";
import {
  BASE_URL,
  DEFAULT_OG_IMAGE,
  createArticleJsonLd,
  createQuizJsonLd,
  createBreadcrumbJsonLd,
  createFaqJsonLd,
  organizationJsonLd,
  websiteJsonLd,
} from "./structured-data";

// Re-exported from their light modules (split out 2026-10-05 so client pages import them without
// pulling every page's metadata into their bundle).
export { HOME_FAQS, faqParagraphs, type FaqItem } from "./faqs";
export { formatQotdDate, qotdTopic } from "./qotd-labels";

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
  // SCL-221 (2026-10-07): the Cookie Policy and the AI Content Disclosure. Descriptions are
  // each document's own manifest description, unchanged.
  "cookie-policy": {
    title: "Cookie Policy",
    description:
      "The cookies and similar technologies LYCEON uses, why, and how to control them.",
    canonical: `${BASE_URL}/legal/cookie-policy`,
    ogImage: DEFAULT_OG_IMAGE,
  },
  "ai-content-disclosure": {
    title: "AI Content Disclosure",
    description:
      "Where LYCEON uses AI, its limitations, and how to report a problem.",
    canonical: `${BASE_URL}/legal/ai-content-disclosure`,
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
  "/sat-question-of-the-day": {
    title: "SAT Question of the Day – Free Daily SAT Practice | Lyceon",
    description:
      "Answer a free SAT practice question every day, no account needed, and see the answer with a worked explanation. Past questions stay in the archive.",
    canonical: `${BASE_URL}/sat-question-of-the-day`,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        {
          name: "SAT Question of the Day",
          url: `${BASE_URL}/sat-question-of-the-day`,
        },
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

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 C1 ("prerendered, in the route registry and
 *       sitemap, with JSON-LD (Article, FAQPage, BreadcrumbList)"); owner decision 6, 2026-10-05
 *       (author "Lyceon Team" as an Organization)] | @implemented [2026-10-05]
 *
 * plain English: each content page's head comes from the same object the page renders
 * (shared/content/pages): its title, description and self-canonical; a BreadcrumbList that
 * follows the page's `parent` chain from Home; an Article dated by `published` and
 * `lastModified`; and, where the page has an FAQ, the FAQPage built from exactly that FAQ.
 */
function contentBreadcrumb(page: ContentPage): { name: string; url: string }[] {
  const trail: { name: string; url: string }[] = [];
  let current: ContentPage | undefined = page;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.path))
      throw new Error(`content page ${current.path}: parent chain loops`);
    seen.add(current.path);
    trail.unshift({ name: current.crumb, url: `${BASE_URL}${current.path}` });
    const parentPath: string | undefined = current.parent;
    if (parentPath === undefined) break;
    current = CONTENT_PAGES.find((p) => p.path === parentPath);
    if (!current)
      throw new Error(`content page ${page.path}: parent ${parentPath} is not a content page`);
  }
  return [{ name: "Home", url: BASE_URL }, ...trail];
}

export function contentPageMeta(page: ContentPage): PublicMeta {
  const canonical = `${BASE_URL}${page.path}`;
  return {
    title: page.title,
    description: page.description,
    canonical,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      createBreadcrumbJsonLd(contentBreadcrumb(page)),
      createArticleJsonLd({
        title: page.h1,
        description: page.description,
        url: canonical,
        image: DEFAULT_OG_IMAGE,
        datePublished: page.published,
        dateModified: page.lastModified,
        author: "Lyceon Team",
      }),
      ...(page.faq.length > 0
        ? [
            createFaqJsonLd(
              page.faq.map((item) => ({
                question: item.question,
                answer: plainText(item.answer),
              })),
            ),
          ]
        : []),
    ],
  };
}

for (const page of CONTENT_PAGES) {
  if (PUBLIC_META[page.path])
    throw new Error(`content page ${page.path} collides with a static meta entry`);
  PUBLIC_META[page.path] = contentPageMeta(page);
}

// C4 (2026-10-05): each post's head comes from its content page: its own title, the original
// publish date and the rewrite date, and the "Lyceon Team" Organization byline (decision 6).
for (const post of blogPosts) {
  const page = post.page;
  PUBLIC_META[page.path] = {
    title: page.title,
    description: page.description,
    canonical: post.canonical,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        { name: "Blog", url: `${BASE_URL}/blog` },
        { name: page.h1, url: post.canonical },
      ]),
      createArticleJsonLd({
        title: page.h1,
        description: page.description,
        url: post.canonical,
        image: DEFAULT_OG_IMAGE,
        datePublished: page.published,
        dateModified: page.lastModified,
        author: post.author,
      }),
    ],
  };
}

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q3; owner Step 0 confirmation 2026-10-05]
 * | @implemented [2026-10-05] | plain English: the head of one archive day — its own title,
 * description and canonical, a BreadcrumbList, and Quiz markup built from the same payload the
 * page renders. Doctrine §0.2: the copy names the date and the SAT section/domain only — nothing
 * about how a day's question is chosen.
 */
export function qotdArchiveMeta(day: QotdArchiveResponse): PublicMeta {
  const url = `${BASE_URL}/sat-question-of-the-day/${day.qotd_date}`;
  const label = formatQotdDate(day.qotd_date);
  const topic = qotdTopic(day);
  const q = day.question;
  const position = q.options.findIndex((o) => o.id === q.correct_option_id);
  const acceptedText =
    position >= 0
      ? (q.options[position]?.text ?? "")
      : (q.correct_answer ?? "");
  return {
    title: `SAT Question of the Day for ${label} (${topic}) | Lyceon`,
    description: `An SAT ${topic} practice question from ${label}, with the correct answer and a worked explanation.`,
    canonical: url,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      createBreadcrumbJsonLd([
        { name: "Home", url: BASE_URL },
        {
          name: "SAT Question of the Day",
          url: `${BASE_URL}/sat-question-of-the-day`,
        },
        { name: label, url },
      ]),
      createQuizJsonLd({
        name: `SAT Question of the Day for ${label}`,
        url,
        about: `SAT ${topic}`,
        datePublished: day.qotd_date,
        question: {
          text: [q.passage, q.stem]
            .filter((t): t is string => !!t)
            .join("\n\n"),
          choices: q.options.map((o) => o.text),
          acceptedAnswer:
            position >= 0
              ? { text: acceptedText, position }
              : { text: acceptedText },
          explanation: q.explanation,
        },
      }),
    ],
  };
}

/**
 * The head for any prerendered path: the static table, then an archive day from the build's
 * archive content. Null when neither knows the path (the prerender fails the build on null).
 */
export function resolvePublicMeta(
  path: string,
  qotdArchive: readonly QotdArchiveResponse[],
): PublicMeta | null {
  const fixed = getPublicMeta(path);
  if (fixed) return fixed;
  const day = /^\/sat-question-of-the-day\/(\d{4}-\d{2}-\d{2})$/.exec(
    path,
  )?.[1];
  const entry = day ? qotdArchive.find((d) => d.qotd_date === day) : undefined;
  return entry ? qotdArchiveMeta(entry) : null;
}

export function getPublicMeta(path: string): PublicMeta | null {
  // Own keys only: a bare index would resolve `constructor` & co. from Object.prototype.
  return Object.prototype.hasOwnProperty.call(PUBLIC_META, path) ? (PUBLIC_META[path] ?? null) : null;
}
