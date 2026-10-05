/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1, F2, F4, F7] | @implemented [2026-10-03]
 *
 * plain English: asserts on the HTML the build actually emits — the real renderer over the real
 * registry, content and template (tests/lib/prerendered-site.ts) — that every public page carries
 * its own title, description, self-canonical, Open Graph tags, valid JSON-LD and its body text;
 * that the FAQ structured data is exactly the FAQ a visitor reads; that the 404 page and the SPA
 * shell are noindex; and that the homepage hero is static. Replaces the tests that pinned the
 * deleted Express SSR path (tests/seo.ssr-coverage.test.ts, tests/seo.meta-canonicalization.test.ts,
 * tests/ci/legal-slug-reflection.contract.test.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PrerenderedSite } from "../client/src/prerender/entry-server";
import {
  DIGITAL_SAT_FAQS,
  DIGITAL_SAT_MATH_FAQS,
  DIGITAL_SAT_READING_WRITING_FAQS,
  HOME_FAQS,
  LEGAL_META,
  getPublicMeta,
  faqParagraphs,
  type FaqItem,
} from "../shared/seo/public-meta";
import { BASE_URL, LOGO_URL } from "../shared/seo/structured-data";
import { HEAD_END_MARKER, HEAD_START_MARKER } from "../shared/seo/head";
import { stripComments } from "./ci/lib/strip-comments";
import { BLOG_POSTS } from "../shared/content/blog";
import {
  REPO_ROOT,
  bodyText,
  getPrerenderedSite,
  jsonLdBlocks,
  loadRouteRegistry,
} from "./lib/prerendered-site";

/** Below this many words of body text a page is a shell, not a page. The smallest real page has ~190. */
const MIN_BODY_WORDS = 150;

let site: PrerenderedSite;
beforeAll(async () => {
  site = await getPrerenderedSite();
}, 60_000);

function count(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

function attr(html: string, pattern: RegExp): string | undefined {
  return pattern.exec(html)?.[1];
}

function page(path: string) {
  const found = site.pages.find((p) => p.path === path);
  if (!found) throw new Error(`no prerendered page for ${path}`);
  return found;
}

describe("every prerendered page carries its own head and body (F1)", () => {
  it("prerenders a non-trivial set: every prerendered registry row, all blog posts, all published legal documents", () => {
    // Presence before absence: the per-page assertions below are vacuous over an empty site.
    const paths = site.pages.map((p) => p.path);
    const staticRows = loadRouteRegistry().filter(
      (r) => r.prerender && !r.content_source,
    );
    expect(staticRows.length).toBeGreaterThan(5);
    for (const row of staticRows) expect(paths).toContain(row.path_pattern);
    expect(paths.filter((p) => p.startsWith("/blog/"))).toHaveLength(5);
    const manifests = readdirSync(resolve(REPO_ROOT, "legal"), {
      withFileTypes: true,
    }).filter(
      (e) =>
        e.isDirectory() &&
        existsSync(resolve(REPO_ROOT, "legal", e.name, "manifest.json")),
    );
    expect(paths.filter((p) => p.startsWith("/legal/"))).toHaveLength(
      manifests.length,
    );
  });

  it("each page has exactly one title, description and canonical, and the canonical is the page's own URL", () => {
    for (const p of site.pages) {
      const own = p.path === "/" ? `${BASE_URL}/` : `${BASE_URL}${p.path}`;
      expect(count(p.html, /<title>/g), p.path).toBe(1);
      expect(count(p.html, /<meta name="description"/g), p.path).toBe(1);
      expect(count(p.html, /<link rel="canonical"/g), p.path).toBe(1);
      expect(attr(p.html, /<link rel="canonical" href="([^"]+)"/), p.path).toBe(
        own,
      );
      expect(
        attr(p.html, /<meta property="og:url" content="([^"]+)"/),
        p.path,
      ).toBe(own);
      expect(p.html, p.path).not.toContain('name="robots"');
      expect(p.html, p.path).not.toContain('name="keywords"');
    }
  });

  it("titles are unique and come from shared/seo/public-meta.ts", () => {
    const titles = site.pages.map((p) =>
      attr(p.html, /<title>([^<]+)<\/title>/),
    );
    expect(new Set(titles).size).toBe(site.pages.length);
    for (const p of site.pages) {
      const meta = getPublicMeta(p.path);
      expect(meta, p.path).not.toBeNull();
      const title = attr(p.html, /<title>([^<]+)<\/title>/)
        ?.replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
      expect(title, p.path).toBe(meta?.title);
    }
  });

  it("each page carries Open Graph and Twitter card tags", () => {
    for (const p of site.pages) {
      for (const tag of [
        "og:title",
        "og:description",
        "og:image",
        "og:type",
        "og:site_name",
      ]) {
        expect(
          count(p.html, new RegExp(`<meta property="${tag}"`, "g")),
          `${p.path} ${tag}`,
        ).toBe(1);
      }
      for (const tag of [
        "twitter:card",
        "twitter:title",
        "twitter:description",
        "twitter:image",
      ]) {
        expect(
          count(p.html, new RegExp(`<meta name="${tag}"`, "g")),
          `${p.path} ${tag}`,
        ).toBe(1);
      }
    }
  });

  it("the body text is in the static HTML, not a loading fallback", () => {
    for (const p of site.pages) {
      const text = bodyText(p.html);
      expect(text.split(" ").length, p.path).toBeGreaterThanOrEqual(
        MIN_BODY_WORDS,
      );
      expect(p.html, p.path).not.toContain('data-testid="page-loader"');
      expect(p.html, p.path).not.toContain('data-testid="text-legal-loading"');
      expect(p.html, p.path).not.toContain('data-testid="card-legal-error"');
    }
  });

  it("each blog post's body is its own post", () => {
    const blog = site.pages.filter((p) => p.path.startsWith("/blog/"));
    for (const p of blog) {
      const meta = getPublicMeta(p.path);
      const heading = meta?.title.replace(/ \| Lyceon$/, "") ?? "";
      expect(heading.length, p.path).toBeGreaterThan(0);
      expect(bodyText(p.html), p.path).toContain(heading);
    }
  });

  it("each legal page renders its published document: title, version and first section", () => {
    for (const p of site.pages.filter((x) => x.path.startsWith("/legal/"))) {
      const slug = p.path.slice("/legal/".length);
      const manifest = JSON.parse(
        readFileSync(
          resolve(REPO_ROOT, "legal", slug, "manifest.json"),
          "utf8",
        ),
      ) as {
        title: string;
        current: string;
      };
      const markdown = readFileSync(
        resolve(REPO_ROOT, "legal", slug, manifest.current, "en.md"),
        "utf8",
      );
      const firstHeading = /^## (.+)$/m
        .exec(markdown)?.[1]
        ?.replace(/\*\*/g, "")
        .replace(/\\\./g, ".")
        .trim();
      expect(firstHeading, slug).toBeTruthy();
      const text = bodyText(p.html);
      expect(text, slug).toContain(manifest.title);
      expect(p.html, slug).toContain('data-testid="badge-legal-version"');
      expect(text, slug).toContain(firstHeading ?? "\u0000");
    }
  });
});

describe("structured data (F1)", () => {
  it("every JSON-LD block parses and names a schema.org type", () => {
    let blocks = 0;
    for (const p of site.pages) {
      for (const block of jsonLdBlocks(p.html)) {
        blocks += 1;
        expect(block["@context"], p.path).toBe("https://schema.org");
        expect(typeof block["@type"], p.path).toBe("string");
      }
    }
    expect(blocks).toBeGreaterThan(10);
  });

  it("the Organization logo is a file the site ships", () => {
    const logos = site.pages.flatMap((p) =>
      jsonLdBlocks(p.html).flatMap((b) => {
        if (b["@type"] === "Organization") return [b.logo];
        const publisher = b.publisher as
          | { logo?: { url?: unknown } }
          | undefined;
        return publisher?.logo ? [publisher.logo.url] : [];
      }),
    );
    expect(logos.length).toBeGreaterThan(0);
    for (const logo of logos) expect(logo).toBe(LOGO_URL);
    expect(
      existsSync(
        resolve(
          REPO_ROOT,
          "client/public",
          LOGO_URL.slice(`${BASE_URL}/`.length),
        ),
      ),
    ).toBe(true);
  });

  it("no page declares a SearchAction (the site has no search page)", () => {
    for (const p of site.pages)
      expect(p.html, p.path).not.toContain("SearchAction");
  });

  const FAQ_PAGES: [string, readonly FaqItem[]][] = [
    ["/", HOME_FAQS],
    ["/digital-sat", DIGITAL_SAT_FAQS],
    ["/digital-sat/math", DIGITAL_SAT_MATH_FAQS],
    ["/digital-sat/reading-writing", DIGITAL_SAT_READING_WRITING_FAQS],
  ];

  it.each(FAQ_PAGES)(
    "%s: the FAQPage JSON-LD is exactly the FAQ the page renders",
    (path, faqs) => {
      const html = page(path).html;
      const faqBlocks = jsonLdBlocks(html).filter(
        (b) => b["@type"] === "FAQPage",
      );
      expect(faqBlocks).toHaveLength(1);
      const entities = (faqBlocks[0]?.mainEntity ?? []) as {
        name: string;
        acceptedAnswer: { text: string };
      }[];
      expect(entities.length).toBe(faqs.length);
      expect(entities.length).toBeGreaterThan(0);

      const text = bodyText(html);
      entities.forEach((entity, i) => {
        const faq = faqs[i];
        expect(entity.name).toBe(faq?.question);
        expect(entity.acceptedAnswer.text).toBe(
          faqParagraphs(faq?.answer ?? "").join(" "),
        );
        // Visible: the question and every paragraph of its answer are in the page text.
        expect(text).toContain(entity.name);
        for (const paragraph of faqParagraphs(faq?.answer ?? ""))
          expect(text).toContain(paragraph);
      });
    },
  );

  it("the homepage renders exactly the shared FAQ questions, no more", () => {
    const html = page("/").html;
    const faqSection = html.slice(html.indexOf('id="faq"'));
    expect(count(faqSection, /<summary/g)).toBe(HOME_FAQS.length);
  });

  it("JSON-LD cannot close its own script tag", () => {
    for (const p of site.pages) {
      for (const m of p.html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      )) {
        expect(m[1], p.path).not.toMatch(/<\/?script/i);
      }
    }
  });
});

describe("metadata coverage", () => {
  it("every document in legal/ has metadata (the three missing ones included)", () => {
    const slugs = readdirSync(resolve(REPO_ROOT, "legal"), {
      withFileTypes: true,
    })
      .filter(
        (e) =>
          e.isDirectory() &&
          existsSync(resolve(REPO_ROOT, "legal", e.name, "manifest.json")),
      )
      .map((e) => e.name)
      .sort();
    expect(slugs).toEqual(
      expect.arrayContaining([
        "billing-terms",
        "refund-policy",
        "subscription-auto-renewal-notice",
      ]),
    );
    expect(Object.keys(LEGAL_META).sort()).toEqual(slugs);
  });

  it("getPublicMeta resolves own keys only (no Object.prototype members)", () => {
    expect(getPublicMeta("/trust")).not.toBeNull();
    for (const member of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(getPublicMeta(member)).toBeNull();
    }
  });
});

describe("404 page and SPA shell (F2)", () => {
  it("404.html is noindex, names no canonical, and renders the not-found page", () => {
    expect(site.notFoundHtml).toContain(
      '<meta name="robots" content="noindex" />',
    );
    expect(site.notFoundHtml).not.toContain('rel="canonical"');
    expect(site.notFoundHtml).toContain(
      "<title>Page not found | Lyceon</title>",
    );
    expect(bodyText(site.notFoundHtml)).toContain("Page not found");
    expect(site.notFoundHtml).toMatch(
      /<a[^>]*href="\/"[^>]*>Go to the homepage<\/a>/,
    );
  });

  it("the SPA shell (app.html) is noindex with no canonical, and keeps the head markers the build replaces", () => {
    expect(site.shellHtml).toContain(
      '<meta name="robots" content="noindex" />',
    );
    expect(site.shellHtml).not.toContain('rel="canonical"');
    expect(site.shellHtml).toContain(HEAD_START_MARKER);
    expect(site.shellHtml).toContain(HEAD_END_MARKER);
    expect(site.shellHtml).toContain('<div id="root"></div>');
  });
});

describe("homepage hero is static (F7, taken into this change)", () => {
  it("the prerendered homepage shows the headline, not a loading placeholder", () => {
    const text = bodyText(page("/").html);
    expect(text).toContain("Digital SAT prep, one step at a time");
    expect(text).not.toContain("Loading...");
  });

  it("home.tsx has no random variant and writes no storage", () => {
    // Code only: the file's own comment explains what was removed.
    const source = stripComments(
      readFileSync(resolve(REPO_ROOT, "client/src/pages/home.tsx"), "utf8"),
    );
    expect(source).toContain("Digital SAT prep, one step at a time");
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toContain("landing_hero_variant");
  });
});

describe("link text names its destination (SEO follow-up 2026-10-05, Lighthouse link-text)", () => {
  /** Every <a> in the page body, with its text as a screen reader and Lighthouse read it. */
  function anchors(html: string): { href: string; text: string }[] {
    const start = html.indexOf('<div id="root">');
    return [...html.slice(start).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(
      (m) => ({
        href: m[1]?.match(/href="([^"]*)"/)?.[1] ?? "",
        text: (m[2] ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&#x27;|&#39;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim(),
      }),
    );
  }

  it('each /blog post card\'s link reads "Read more about <post title>"', () => {
    const links = anchors(page("/blog").html);
    // Presence first: one card link per post, each naming that post's title.
    const posts = BLOG_POSTS.map((post) => post.slug);
    expect(posts.length).toBeGreaterThan(0);
    for (const post of BLOG_POSTS) {
      const card = links.filter(
        (l) =>
          l.href === `/blog/${post.slug}` && l.text.startsWith("Read more"),
      );
      expect(
        card.map((l) => l.text),
        post.slug,
      ).toEqual([`Read more about ${post.title}`]);
    }
  });

  it("no public page has a link whose whole text is generic", () => {
    const GENERIC = /^(read more|more|click here|here|learn more)$/i;
    const offenders = site.pages.flatMap((p) =>
      anchors(p.html)
        .filter((l) => GENERIC.test(l.text))
        .map((l) => `${p.path} → ${l.href}: "${l.text}"`),
    );
    expect(offenders).toEqual([]);
  });
});
