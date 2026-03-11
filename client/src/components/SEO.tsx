import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  canonical?: string;
  ogType?: 'website' | 'article';
  ogImage?: string;
  article?: {
    publishedTime?: string;
    modifiedTime?: string;
    author?: string;
    tags?: string[];
  };
  noindex?: boolean;
}

const BASE_URL = 'https://lyceon.ai';
const DEFAULT_IMAGE = `${BASE_URL}/og-image.png`;
const SITE_NAME = 'Lyceon';

export function SEO({
  title,
  description,
  canonical,
  ogType = 'website',
  ogImage = DEFAULT_IMAGE,
  article,
  noindex = false,
}: SEOProps) {
  const fullTitle = title.includes('Lyceon') ? title : `${title} | Lyceon`;
  const canonicalUrl = canonical || (typeof window !== 'undefined' ? window.location.href : BASE_URL);

  useEffect(() => {
    document.title = fullTitle;

    const setMeta = (name: string, content: string) => {
      let element = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement;
      if (!element) {
        element = document.createElement('meta');
        element.name = name;
        document.head.appendChild(element);
      }
      element.content = content;
    };

    const setProperty = (property: string, content: string) => {
      let element = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute('property', property);
        document.head.appendChild(element);
      }
      element.content = content;
    };

    const setLink = (rel: string, href: string) => {
      let element = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement;
      if (!element) {
        element = document.createElement('link');
        element.rel = rel;
        document.head.appendChild(element);
      }
      element.href = href;
    };

    setMeta('description', description);
    setLink('canonical', canonicalUrl);

    if (noindex) {
      setMeta('robots', 'noindex, nofollow');
    } else {
      setMeta('robots', 'index, follow');
    }

    setProperty('og:title', fullTitle);
    setProperty('og:description', description);
    setProperty('og:type', ogType);
    setProperty('og:url', canonicalUrl);
    setProperty('og:image', ogImage);
    setProperty('og:site_name', SITE_NAME);

    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', fullTitle);
    setMeta('twitter:description', description);
    setMeta('twitter:image', ogImage);

    if (article) {
      if (article.publishedTime) {
        setProperty('article:published_time', article.publishedTime);
      }
      if (article.modifiedTime) {
        setProperty('article:modified_time', article.modifiedTime);
      }
      if (article.author) {
        setProperty('article:author', article.author);
      }
      if (article.tags) {
        article.tags.forEach((tag, i) => {
          setProperty(`article:tag`, tag);
        });
      }
    }
  }, [fullTitle, description, canonicalUrl, ogType, ogImage, article, noindex]);

  return null;
}

interface JsonLdProps {
  data: Record<string, unknown>;
  id?: string;
}

let jsonLdCounter = 0;

export function JsonLd({ data, id }: JsonLdProps) {
  useEffect(() => {
    const uniqueId = id || `jsonld-${data['@type']}-${++jsonLdCounter}-${Date.now()}`;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(data);
    script.id = uniqueId;
    script.dataset.jsonld = 'true';
    
    document.head.appendChild(script);

    return () => {
      const el = document.getElementById(uniqueId);
      if (el) el.remove();
    };
  }, [data, id]);

  return null;
}

export const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Lyceon',
  url: BASE_URL,
  logo: `${BASE_URL}/logo.png`,
  description: 'Digital SAT prep platform with adaptive practice, tutor guidance, and mastery tracking.',
  sameAs: [],
};

export const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Lyceon',
  url: BASE_URL,
  description: 'Study Smarter, Score Higher with adaptive Digital SAT practice, full-length exams, and progress tracking.',
  potentialAction: {
    '@type': 'SearchAction',
    target: `${BASE_URL}/blog?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
};

export function createBreadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function createFaqJsonLd(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
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
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    url: article.url,
    image: article.image,
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    author: {
      '@type': 'Person',
      name: article.author,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Lyceon',
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/logo.png`,
      },
    },
  };
}
