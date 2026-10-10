import { SOCIAL_PROFILE_URLS } from "./social-profiles";
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
  description:
    "Digital SAT prep with SAT-style practice, tutor guidance, and progress tracking.",
  // The official profiles (owner brief 2026-10-10): the same constant the footer's icon row reads.
  sameAs: [...SOCIAL_PROFILE_URLS],
};

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Lyceon",
  url: BASE_URL,
  description:
    "Study smarter with SAT-style practice, full-length exams, and tutor guidance.",
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

export function createFaqJsonLd(
  faqs: readonly { question: string; answer: string }[],
) {
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

/**
 * Article markup for a blog post or a content page.
 *
 * @spec [owner decision 6 on SEO Wave 3 Step 0, 2026-10-05: 'Blog byline: "Lyceon Team" as
 *       JSON-LD Organization'] | @implemented [2026-10-05] | plain English: the byline is the team,
 * not a person, so the author is an Organization of that name (it was a Person named "Lyceon
 * Team", which describes no real person). The publisher stays the Lyceon Organization.
 */
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
      "@type": "Organization",
      name: article.author,
      url: BASE_URL,
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

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q3; owner Step 0 confirmation 2026-10-05 ("Quiz
 *   JSON-LD on archive pages only")] | @implemented [2026-10-05] | plain English: schema.org Quiz
 * markup for one past Question of the Day — the question, its choices, the accepted answer and
 * the explanation, which are exactly what the archive page shows (structured data = visible
 * content, as for the FAQ). Never used for today's question: its answer is not public.
 * A multiple-choice question names each choice as a suggestedAnswer; a student-produced-response
 * question carries only the accepted answer.
 */
export function createQuizJsonLd(quiz: {
  name: string;
  url: string;
  about: string;
  datePublished: string;
  question: {
    text: string;
    choices: readonly string[];
    acceptedAnswer: { text: string; position?: number };
    explanation: string;
  };
}) {
  const multipleChoice = quiz.question.choices.length > 0;
  return {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: quiz.name,
    url: quiz.url,
    datePublished: quiz.datePublished,
    about: { "@type": "Thing", name: quiz.about },
    educationalAlignment: {
      "@type": "AlignmentObject",
      alignmentType: "educationalSubject",
      targetName: quiz.about,
    },
    hasPart: [
      {
        "@type": "Question",
        ...(multipleChoice ? { eduQuestionType: "Multiple choice" } : {}),
        text: quiz.question.text,
        ...(multipleChoice
          ? {
              suggestedAnswer: quiz.question.choices.map((text, index) => ({
                "@type": "Answer",
                position: index,
                text,
              })),
            }
          : {}),
        acceptedAnswer: {
          "@type": "Answer",
          ...(quiz.question.acceptedAnswer.position === undefined
            ? {}
            : { position: quiz.question.acceptedAnswer.position }),
          text: quiz.question.acceptedAnswer.text,
          answerExplanation: {
            "@type": "Comment",
            text: quiz.question.explanation,
          },
        },
      },
    ],
  };
}
