/**
 * SEO Wave 3: the content pages build, crawl and publish only as the brief allows.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 (Public Disclosure Doctrine); §5 C1, C2, C3
 *       ("CI fails on an unapproved or unsourced page. Plant a defect to prove it."); owner
 *       decisions on Wave 3 Step 0, 2026-10-05 (1: domain pages only, up to 2 past QOTD
 *       questions; 3: the /digital-sat 301s; 4: the live price)] | @implemented [2026-10-05]
 *
 * plain English: three things, all on what the build emits (tests/lib/prerendered-site.ts runs the
 * real prerender, publish gate included):
 *   1. The crawl check, per page: a unique title, a self-canonical, Article and BreadcrumbList
 *      JSON-LD (FAQPage exactly when the page has an FAQ), its own body text, one <h1>, and a
 *      registry row and sitemap entry dated as the page is.
 *   2. The publish gate passes on the real pages, and FAILS on each planted defect: an unsourced
 *      block, an unapproved page, an approval older than the last edit, an unknown claim row, a
 *      source missing from the claim inventory, a banned phrase, an outcome claim, an over-long
 *      title, a link to a 301, two <h1>s and a skipped heading level. Every plant starts from a
 *      real page that passes (presence before absence), so a gate that passed everything could
 *      not pass here.
 *   3. The behaviour the owner ruled on: the /digital-sat pages 301 and leave the sitemap; a
 *      domain page shows only past days from its own domain, never today's, and marks no answer;
 *      the comparison page carries no price in its HTML.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertContentPagesPublishable,
  type PrerenderedSite,
} from "../../client/src/prerender/entry-server";
import { CONTENT_PAGES } from "../../shared/content/pages";
import { BLOG_PAGES, BLOG_POSTS } from "../../shared/content/blog";
import { CONTENT_PAGE_PATHS } from "../../shared/content/pages/paths";
import {
  DOMAINS,
  domainPath,
} from "../../shared/content/pages/practice-questions";
import type { ContentPage } from "../../packages/shared/src/seo-content-schema";
import { BASE_URL } from "../../shared/seo/structured-data";
import { START_DIAGNOSTIC_HREF } from "../../client/src/lib/marketing-links";
import type { VercelRoute } from "../../shared/seo/route-registry";
import {
  REPO_ROOT,
  bodyText,
  getPrerenderedSite,
  jsonLdBlocks,
  loadRouteRegistry,
} from "../lib/prerendered-site";
import { QOTD_FIXTURE_TODAY, qotdArchiveRow } from "../lib/qotd-fixture";

const registry = loadRouteRegistry();
const inventory = readFileSync(
  resolve(REPO_ROOT, "docs/compliance/claim-inventory.md"),
  "utf8",
);

let site: PrerenderedSite;
beforeAll(async () => {
  site = await getPrerenderedSite();
}, 60_000);

function built(path: string): { path: string; html: string } {
  const page = site.pages.find((p) => p.path === path);
  if (!page) throw new Error(`no prerendered page for ${path}`);
  return page;
}

function article(html: string): string {
  const start = html.indexOf("<article data-content-page");
  const end = html.indexOf("</article>", start);
  return start === -1 || end === -1 ? "" : html.slice(start, end);
}

function clone(page: ContentPage): ContentPage {
  return structuredClone(page);
}

function realPage(path: string): ContentPage {
  const page = CONTENT_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`no content page ${path}`);
  return page;
}

/** Runs the gate exactly as the build does, with one page swapped for `planted`. */
function gate(planted: ContentPage, html?: string): () => void {
  return () =>
    assertContentPagesPublishable(
      [planted],
      site.pages.map((p) =>
        p.path === planted.path && html !== undefined ? { ...p, html } : p,
      ),
      registry,
      inventory,
    );
}

describe("content pages: presence (C1, C2)", () => {
  it("builds all 23 approved pages, and the router's path list is exactly theirs", () => {
    expect(CONTENT_PAGES).toHaveLength(23);
    expect([...CONTENT_PAGE_PATHS].sort()).toEqual(
      CONTENT_PAGES.map((p) => p.path).sort(),
    );
    for (const page of CONTENT_PAGES) {
      expect(page.approved, page.path).toEqual({
        by: "Karl",
        date: "2026-10-05",
      });
      built(page.path);
    }
  });

  it("each page has a registry row (prerendered, indexable) dated as the page is, and a sitemap entry", () => {
    for (const page of CONTENT_PAGES) {
      const row = registry.find((r) => r.path_pattern === page.path);
      expect(row, page.path).toBeDefined();
      expect(row?.prerender, page.path).toBe(true);
      expect(row?.indexable, page.path).toBe(true);
      expect(row?.last_modified, page.path).toBe(page.lastModified);
      expect(site.sitemapXml, page.path).toContain(
        `<loc>${BASE_URL}${page.path}</loc>\n    <lastmod>${page.lastModified}</lastmod>`,
      );
    }
  });

  it("there are eight domain pages, one per College Board domain, and no skill pages (decision 1)", () => {
    const domainPages = CONTENT_PAGES.filter(
      (p) => p.path.split("/").length === 4,
    );
    expect(domainPages.map((p) => p.path).sort()).toEqual(
      DOMAINS.map(domainPath).sort(),
    );
    expect(domainPages).toHaveLength(8);
  });
});

describe("crawl check, per page (acceptance)", () => {
  it("titles are unique across the whole site", () => {
    const titles = site.pages.map(
      (p) => /<title>([^<]+)<\/title>/.exec(p.html)?.[1],
    );
    expect(new Set(titles).size).toBe(site.pages.length);
  });

  it.each(CONTENT_PAGES.map((p) => [p.path, p] as const))(
    "%s: self-canonical, its own title, JSON-LD, one H1 and its body text",
    (path, page) => {
      const html = built(path).html;
      expect(html).toContain(
        `<link rel="canonical" href="${BASE_URL}${path}" />`,
      );
      expect(html).toContain(
        `<title>${page.title.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}</title>`,
      );
      const types = jsonLdBlocks(html).map((b) => b["@type"]);
      expect(types).toContain("Article");
      expect(types).toContain("BreadcrumbList");
      expect(types.includes("FAQPage")).toBe(page.faq.length > 0);
      const articleLd = jsonLdBlocks(html).find(
        (b) => b["@type"] === "Article",
      );
      expect(articleLd?.author).toEqual({
        "@type": "Organization",
        name: "Lyceon Team",
        url: BASE_URL,
      });
      expect(articleLd?.dateModified).toBe(page.lastModified);
      expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
      const text = bodyText(article(html));
      expect(text).toContain(page.h1);
      // The page's own words, not the nav and footer around it.
      expect(text.split(" ").length).toBeGreaterThanOrEqual(60);
    },
  );

  it("the breadcrumb JSON-LD follows the parent chain from Home", () => {
    const html = built("/sat-practice-questions/math/algebra").html;
    const crumbs = jsonLdBlocks(html).find(
      (b) => b["@type"] === "BreadcrumbList",
    );
    const items = (crumbs?.itemListElement ?? []) as {
      name: string;
      item: string;
    }[];
    expect(items.map((i) => i.name)).toEqual([
      "Home",
      "SAT practice questions",
      "Math",
      "Algebra",
    ]);
    expect(items.at(-1)?.item).toBe(
      `${BASE_URL}/sat-practice-questions/math/algebra`,
    );
  });
});

describe("the C4 blog rewrites (approved by Karl 2026-10-05)", () => {
  it("all five posts are approved content pages at their old URLs, dated at the rewrite", () => {
    expect(BLOG_PAGES.map((p) => p.path).sort()).toEqual([
      "/blog/common-sat-math-algebra-mistakes",
      "/blog/digital-sat-scoring-explained",
      "/blog/is-digital-sat-harder",
      "/blog/quick-sat-study-routine",
      "/blog/sat-question-bank-practice",
    ]);
    for (const page of BLOG_PAGES) {
      expect(page.approved, page.path).toEqual({
        by: "Karl",
        date: "2026-10-05",
      });
      expect(page.lastModified, page.path).toBe("2026-10-05");
      expect(page.published < page.lastModified, page.path).toBe(true);
    }
  });

  it.each(BLOG_POSTS.map((p) => [p.page.path, p] as const))(
    "%s: one H1, the byline and rewrite date shown, the standard CTA last, Organization author",
    (path, post) => {
      const html = built(path).html;
      expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
      const body = article(html);
      expect(bodyText(body)).toContain("Lyceon Team");
      expect(bodyText(body)).toContain("Updated October 5, 2026");
      // The standard CTA ends the post: it is the article's last link.
      const links = [...body.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(
        (m) => m[1],
      );
      // The one shared CTA target (marketing-links.ts; entry-aware auth brief, Karl
      // 2026-10-10: the Sign Up tab, returning to the diagnostic), as the HTML escapes it.
      expect(links.at(-1)?.replaceAll("&amp;", "&")).toBe(
        START_DIAGNOSTIC_HREF,
      );
      expect(body).toContain('data-testid="button-content-start-diagnostic"');
      const ld = jsonLdBlocks(html).find((b) => b["@type"] === "Article");
      expect(ld?.author).toEqual({
        "@type": "Organization",
        name: "Lyceon Team",
        url: BASE_URL,
      });
      expect(ld?.datePublished).toBe(post.page.published);
      expect(ld?.dateModified).toBe("2026-10-05");
      expect(site.sitemapXml).toContain(
        `<loc>${BASE_URL}${path}</loc>\n    <lastmod>2026-10-05</lastmod>`,
      );
      // "Practise at the right level" implied adaptive practice (R15): gone.
      expect(bodyText(html)).not.toMatch(/practi[cs]e at the right level/i);
    },
  );
});

describe("the publish gate (C3)", () => {
  it("passes on every real page (the build ran it: presence before the plants)", () => {
    expect(() =>
      assertContentPagesPublishable(
        CONTENT_PAGES,
        site.pages,
        registry,
        inventory,
      ),
    ).not.toThrow();
  });

  const BASE = "/what-is-a-good-sat-score/1400";

  it("the page the plants start from passes on its own", () => {
    expect(gate(clone(realPage(BASE)))).not.toThrow();
  });

  it("FAILS on a planted unsourced claim", () => {
    const page = clone(realPage(BASE));
    const block = page.intro[0];
    if (block?.type !== "p")
      throw new Error("expected a paragraph to plant on");
    page.intro[0] = { type: "p", text: block.text };
    expect(gate(page)).toThrow(
      /intro\[0\] \(p\) states something with no source and no claim-inventory row/,
    );
  });

  it("FAILS on a planted unapproved page", () => {
    const page = clone(realPage(BASE));
    delete page.approved;
    expect(gate(page)).toThrow(/not approved/);
  });

  it("FAILS when the page changed after Karl approved it", () => {
    const page = clone(realPage(BASE));
    page.lastModified = "2026-10-06";
    expect(gate(page)).toThrow(/the current text is not approved/);
  });

  it("FAILS on a claim row the inventory does not have", () => {
    const page = clone(realPage(BASE));
    const block = page.intro[0];
    if (block?.type !== "p") throw new Error("expected a paragraph");
    page.intro[0] = { ...block, claims: ["W999"] };
    expect(gate(page)).toThrow(
      /cites claim W999, which is not in the claim inventory/,
    );
  });

  it("FAILS on a source the claim inventory does not record", () => {
    const page = clone(realPage(BASE));
    const block = page.intro[0];
    if (block?.type !== "p") throw new Error("expected a paragraph");
    page.intro[0] = {
      ...block,
      sources: [{ label: "Somewhere", url: "https://example.com/unrecorded" }],
    };
    expect(gate(page)).toThrow(
      /which the claim inventory's Sources table does not record/,
    );
  });

  it("FAILS on a banned phrase and on an unapproved outcome claim", () => {
    const banned = clone(realPage(BASE));
    banned.h1 = "Master the SAT";
    expect(gate(banned)).toThrow(/banned phrase/);
    const outcome = clone(realPage(BASE));
    outcome.sections[0]?.blocks.push({
      type: "p",
      text: "Students who use Lyceon score higher.",
      claims: ["W14"],
    });
    expect(gate(outcome)).toThrow(/unapproved outcome claim/);
  });

  it("FAILS on meta outside the limits", () => {
    const page = clone(realPage(BASE));
    page.title = `${page.title} and a great deal more words than fit`;
    page.description = "Too short.";
    expect(gate(page)).toThrow(/title is \d+ characters/);
    expect(gate(page)).toThrow(/description is 10 characters/);
  });

  it("FAILS on an internal link to a 301 (links must point at the page, not the redirect)", () => {
    const page = clone(realPage(BASE));
    page.sections[0]?.blocks.push({
      type: "links",
      items: [{ label: "Old page", href: "/digital-sat/math" }],
    });
    expect(gate(page)).toThrow(
      /internal link \/digital-sat\/math does not resolve/,
    );
  });

  it("FAILS on two <h1>s and on a skipped heading level in the rendered page", () => {
    const page = clone(realPage(BASE));
    const html = built(BASE).html;
    const twoH1 = html.replace("<h2", '<h1 class="x">Another</h1><h2');
    expect(gate(page, twoH1)).toThrow(/has 2 <h1> elements/);
    const skipped = html.replace("<h2", "<h4>Skipped</h4><h2");
    expect(gate(page, skipped)).toThrow(/heading order skips from h1 to h4/);
  });
});

describe("owner rulings, on the built site", () => {
  it("the three /digital-sat pages 301 to their content pages and leave the sitemap (decision 3)", () => {
    const vercel = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "vercel.json"), "utf8"),
    ) as { routes: VercelRoute[] };
    const redirects: [string, string][] = [
      ["^/digital-sat/?$", "/online-sat-prep"],
      ["^/digital-sat/math/?$", "/sat-practice-questions/math"],
      [
        "^/digital-sat/reading-writing/?$",
        "/sat-practice-questions/reading-and-writing",
      ],
    ];
    for (const [src, location] of redirects) {
      const route = vercel.routes.find((r) => r.src === src);
      expect(route?.status, src).toBe(301);
      expect(route?.headers?.Location, src).toBe(location);
    }
    // (The blog post /blog/is-digital-sat-harder keeps its URL; only the three pages leave.)
    expect(site.sitemapXml).not.toMatch(
      /<loc>[^<]*\.ai\/digital-sat(\/[a-z-]+)?<\/loc>/,
    );
    expect(site.sitemapXml).toContain("/blog/is-digital-sat-harder</loc>");
    for (const p of site.pages)
      expect(p.html, p.path).not.toMatch(/href="\/digital-sat(\/[a-z-]+)?"/);
  });

  it("a domain page shows its own past day, with no answer marked, and links to that day's page (decision 1)", () => {
    const html = article(built("/sat-practice-questions/math/algebra").html);
    const algebraDay = qotdArchiveRow("2026-10-02");
    expect(algebraDay.domain).toBe("Algebra");
    // Presence: the past Algebra question is on the page, with its link.
    expect([...html.matchAll(/data-testid="qotd-sample"/g)]).toHaveLength(1);
    expect(html).toContain('href="/sat-question-of-the-day/2026-10-02"');
    // Absence: no other domain's day, and nothing marks the answer.
    expect(html).not.toContain("/sat-question-of-the-day/2026-10-04");
    expect(html).not.toContain("Correct answer");
    expect(html).not.toContain(algebraDay.explanation.slice(0, 40));
  });

  it("today's question is on no content page (the fixture's today is Geometry and Trigonometry)", () => {
    expect(QOTD_FIXTURE_TODAY).toBe("2026-10-05");
    const geometry = article(
      built("/sat-practice-questions/math/geometry-and-trigonometry").html,
    );
    expect(geometry).toContain('data-testid="qotd-sample-empty"');
    for (const page of CONTENT_PAGES) {
      expect(built(page.path).html, page.path).not.toContain(
        `/sat-question-of-the-day/${QOTD_FIXTURE_TODAY}`,
      );
    }
  });

  it("a section page shows its newest two past days from that section", () => {
    const math = article(built("/sat-practice-questions/math").html);
    expect([...math.matchAll(/data-testid="qotd-sample"/g)]).toHaveLength(2);
    expect(math.indexOf("/sat-question-of-the-day/2026-10-04")).toBeLessThan(
      math.indexOf("/sat-question-of-the-day/2026-10-02"),
    );
    expect(math).not.toContain("/sat-question-of-the-day/2026-10-03");
  });

  it("the comparison page carries no price in its HTML: the cost cell is the live price (decision 4)", () => {
    const html = article(built("/lyceon-vs-sat-tutor").html);
    expect(html).toContain('data-testid="live-price"');
    const cell =
      /data-testid="live-price">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? "";
    expect(cell).toContain("Monthly subscription for Pro");
    expect(cell).not.toMatch(/\$\d/);
    // The tutor side's figures are there, with their sources.
    expect(html).toContain("$100 an hour");
    expect(html).toContain("Varies by tutor");
  });
});
