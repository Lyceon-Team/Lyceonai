/**
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       items 1-3 and its tests "each .md matches its HTML page's text" and "llms.txt lists every
 *       public route"] | @implemented [2026-11-28]
 *
 * plain English: asserts on what the build emits (tests/lib/prerendered-site.ts, the real renderer):
 *   * every indexable page has a Markdown copy, and every copy belongs to an indexable page;
 *   * each copy carries exactly the words of its page's <main>, in order. The page side is read
 *     with jsdom, a different parser from the one the build uses, so a parser bug cannot agree
 *     with itself;
 *   * each indexable page links its copy (rel="alternate" type="text/markdown"), absolute;
 *   * llms.txt lists every copy once, with the page's own title and description, and every
 *     indexable registry route (each content-sourced route through at least one URL).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import type { PrerenderedSite } from "../../client/src/prerender/entry-server";
import { BASE_URL } from "../../shared/seo/structured-data";
import { routePatternToVercelSource } from "../../shared/seo/route-registry";
import { twinPathFor } from "../../shared/seo/markdown-twin";
import { getPrerenderedSite, loadRouteRegistry } from "../lib/prerendered-site";

let site: PrerenderedSite;
beforeAll(async () => {
  site = await getPrerenderedSite();
}, 120_000);

/**
 * Elements whose start and end separate words for a reader: the standard HTML block boxes, plus
 * links and buttons, which the pages draw as separate controls even when no space sits between
 * them in the markup.
 */
const BOUNDARY = new Set([
  "a",
  "button",
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);
const NOT_TEXT = new Set(["script", "style", "svg", "noscript", "template"]);

/** The page's <main> as a reader sees it, maths read as its TeX source (jsdom). */
function pageText(html: string): string {
  const doc = new JSDOM(html).window.document;
  const mains = doc.querySelectorAll("main");
  expect(mains.length).toBe(1);
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (NOT_TEXT.has(tag)) return "";
    if (el.classList.contains("katex")) {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]');
      return ` ${tex?.textContent ?? ""} `;
    }
    const inner = Array.from(el.childNodes).map(walk).join("");
    return BOUNDARY.has(tag) ? ` ${inner} ` : inner;
  };
  return walk(mains[0] as Element);
}

/**
 * The copy's text: list markers, link targets and image markers removed (the page's text has
 * none of them; an ordered list's numbers are drawn by CSS).
 */
function markdownText(md: string): string {
  return md
    .replace(/^\s*(?:\d+\.|-) /gm, "")
    .replace(/!\[(?:\\.|[^\]\\])*\]/g, " ")
    .replace(/\]\((?:[^()\s]|\([^()\s]*\))*\)/g, "]");
}

function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

describe("Markdown copies", () => {
  it("exist for every indexable page and no other", () => {
    const indexable = site.pages.filter((p) => p.indexable).map((p) => p.path);
    expect(indexable.length).toBeGreaterThan(20);
    expect(site.markdownTwins.map((t) => t.path)).toEqual(indexable);
    for (const p of ["/", "/parent", "/online-sat-prep", "/blog"])
      expect(indexable).toContain(p);
    expect(site.markdownTwins.some((t) => t.path.startsWith("/blog/"))).toBe(
      true,
    );
    expect(
      site.markdownTwins.some((t) =>
        t.path.startsWith("/sat-question-of-the-day/"),
      ),
    ).toBe(true);
    // /start is prerendered but noindex: no copy, no link.
    expect(site.markdownTwins.some((t) => t.path === "/start")).toBe(false);
  });

  it("each .md matches its HTML page's text, word for word", () => {
    for (const twin of site.markdownTwins) {
      const page = site.pages.find((p) => p.path === twin.path);
      expect(page, twin.path).toBeDefined();
      const expected = words(pageText(page?.html ?? ""));
      // Presence before equality: a page with no text would match an empty copy.
      expect(expected.length, `${twin.path} has text`).toBeGreaterThan(20);
      expect(words(markdownText(twin.markdown)), twin.path).toEqual(expected);
    }
  });

  it("is real Markdown: the page's h1 is the copy's first heading", () => {
    for (const twin of site.markdownTwins) {
      const page = site.pages.find((p) => p.path === twin.path);
      const h1 = new JSDOM(page?.html ?? "").window.document.querySelector(
        "main h1",
      );
      if (!h1) continue;
      const firstHeading = /^# (.+)$/m.exec(twin.markdown)?.[1] ?? "";
      expect(words(markdownText(firstHeading)), twin.path).toEqual(
        words(h1.textContent ?? ""),
      );
    }
  });

  it("each indexable page links its copy from its head, absolute", () => {
    for (const page of site.pages) {
      const link = `<link rel="alternate" type="text/markdown" href="${BASE_URL}${twinPathFor(page.path)}" />`;
      if (page.indexable) expect(page.html, page.path).toContain(link);
      else expect(page.html, page.path).not.toContain('type="text/markdown"');
    }
    expect(site.notFoundHtml).not.toContain('type="text/markdown"');
  });
});

describe("llms.txt", () => {
  const entries = (): { title: string; url: string; description: string }[] =>
    [...site.llmsTxt.matchAll(/^- \[(.+)\]\((\S+)\): (.+)$/gm)].map((m) => ({
      title: m[1] ?? "",
      url: m[2] ?? "",
      description: m[3] ?? "",
    }));

  it("lists every Markdown copy once, with its page's own title and description", () => {
    expect(site.llmsTxt.startsWith("# Lyceon\n\n> ")).toBe(true);
    const listed = entries();
    expect(listed.map((e) => e.url).sort()).toEqual(
      site.markdownTwins.map((t) => `${BASE_URL}${twinPathFor(t.path)}`).sort(),
    );
    for (const entry of listed) {
      const twin = site.markdownTwins.find(
        (t) => `${BASE_URL}${twinPathFor(t.path)}` === entry.url,
      );
      const html = site.pages.find((p) => p.path === twin?.path)?.html ?? "";
      const doc = new JSDOM(html).window.document;
      expect(entry.title).toBe(doc.title);
      expect(entry.description).toBe(
        doc.querySelector('meta[name="description"]')?.getAttribute("content"),
      );
    }
  });

  it("lists every public route in the registry", () => {
    const listedPaths = entries().map((e) => {
      const path = e.url.slice(BASE_URL.length);
      return path === "/index.md" ? "/" : path.slice(0, -".md".length);
    });
    const indexableRows = loadRouteRegistry().filter((r) => r.indexable);
    expect(indexableRows.length).toBeGreaterThan(20);
    for (const row of indexableRows) {
      const re = new RegExp(routePatternToVercelSource(row.path_pattern));
      expect(
        listedPaths.some((p) => re.test(p)),
        `${row.path_pattern} is listed in llms.txt`,
      ).toBe(true);
    }
  });
});
