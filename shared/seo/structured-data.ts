export const BASE_URL = "https://lyceon.ai";
export const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image.jpg`;
/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1] | @implemented [2026-10-03] |
 * plain English: the logo Organization and Article markup point at. It named `/logo.png`,
 * a file that never existed; `client/public/lyceon-logo.png` is the logo the site ships.
 * `tests/seo.prerender-output.test.ts` asserts the file behind this URL exists.
 */
export const LOGO_URL = `${BASE_URL}/lyceon-logo.png`;

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Lyceon",
  url: BASE_URL,
  logo: LOGO_URL,
  description: "Digital SAT prep with SAT-style practice, tutor guidance, and progress tracking.",
  sameAs: [],
};

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Lyceon",
  url: BASE_URL,
  description: "Study smarter with SAT-style practice, full-length exams, and tutor guidance.",
  // No SearchAction (F1): the site has no search results page for it to point at.
};

export function createBreadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function createFaqJsonLd(faqs: readonly { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        // Paragraphs are separated by a blank line in the shared FAQ copy (public-meta.ts).
        text: faq.answer.split("\n\n").join(" "),
      },
    })),
  };
}

export function createArticleJsonLd(article: {
  title: string;
  description: string;
  url: string;
  image: string;
  datePublished: string;
  dateModified?: string;
  author: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    url: article.url,
    image: article.image,
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    author: {
      "@type": "Person",
      name: article.author,
    },
    publisher: {
      "@type": "Organization",
      name: "Lyceon",
      logo: {
        "@type": "ImageObject",
        url: LOGO_URL,
      },
    },
  };
}
