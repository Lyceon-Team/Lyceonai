/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1, F2, F3; owner ruling 2026-10-03 (approach A:
 *   Vite SSR build + prerender script, no new dependencies)]
 * @implemented [2026-10-03]
 *
 * plain English: the build-time renderer for the public site. It renders the REAL app — the same
 * `<App />` the browser mounts, the same route table, the same page components — once per
 * prerendered route, and returns static HTML with that page's own head (from shared/seo), plus the
 * 404 page and sitemap.xml. `scripts/build/prerender.mjs` writes the result into dist/public.
 *
 * expected outcome: a crawler that runs no JavaScript gets each public page's own title,
 * self-canonical, Open Graph tags, JSON-LD and body text, instead of one empty shell for every URL.
 *
 * trade-offs:
 *  - The browser still mounts with `createRoot`, which replaces this markup with an identical
 *    client render. Hydration (`hydrateRoot`) would avoid the re-render but needs the server and
 *    client trees to agree exactly (lazy routes, auth state); it is a performance follow-up (F8),
 *    not a correctness need.
 *  - `renderToPipeableStream` + `onAllReady` waits for the lazy page chunks, so the output is the
 *    page, never the Suspense "Loading..." fallback.
 *  - Effects never run on the server, so the auth provider's CSRF warm-up and profile fetch never
 *    fire: every page renders in its signed-out state, which is what a crawler sees anyway.
 *  - Legal pages read their documents with `fetch("/legal/...")`. Those queries are loaded before
 *    the render through the same query options the pages use, with `fetch` answered from `legal/`
 *    (`legalFetch`). Any other fetch during prerender throws.
 *
 * edge cases:
 *  - A render error anywhere (including inside a Suspense boundary, which React would otherwise
 *    recover from on the client) fails the build.
 *  - A route with no metadata in shared/seo/public-meta.ts fails the build.
 *  - Only published legal documents are prerendered; an unpublished one would 404.
 */
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { Router as WouterRouter } from "wouter";
import App from "@/App";
import { queryClient } from "@/lib/queryClient";
import {
  legalDocumentQueryOptions,
  legalIndexQueryOptions,
  loadLegalDocument,
  loadLegalSlugs,
} from "@/lib/legal-content";
import { BLOG_POSTS } from "@shared/content/blog";
import { getPublicMeta } from "@shared/seo/public-meta";
import { BASE_URL } from "@shared/seo/structured-data";
import {
  renderNotFoundHead,
  renderPageHead,
  withBody,
  withHead,
} from "@shared/seo/head";
import {
  buildSitemapXml,
  expandPrerenderPages,
  parseRouteRegistry,
  type PrerenderContent,
  type PrerenderPage,
} from "@shared/seo/route-registry";
import { legalFetch } from "../../../vite-plugin-legal-content";

/** The path rendered for the 404 page. Matches no route, so the app's catch-all renders. */
export const NOT_FOUND_RENDER_PATH = "/__lyceon-not-found__";

export type PrerenderedPage = PrerenderPage & {
  /** Output file relative to dist/public, e.g. `blog/index.html`. */
  file: string;
  html: string;
};

export type PrerenderedSite = {
  pages: PrerenderedPage[];
  /** dist/public/404.html */
  notFoundHtml: string;
  /** dist/public/app.html — the SPA shell for every route that is not prerendered. */
  shellHtml: string;
  sitemapXml: string;
};

export function outputFileFor(urlPath: string): string {
  return urlPath === "/" ? "index.html" : `${urlPath.slice(1)}/index.html`;
}

/** Renders `<App />` at `urlPath` to HTML, waiting for every lazy page. Rejects on any render error. */
export function renderAppHtml(urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errors: unknown[] = [];
    const sink = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        callback();
      },
    });
    sink.on("finish", () => {
      if (errors.length > 0) {
        reject(
          new Error(`prerender ${urlPath}: ${errors.map(String).join("; ")}`),
        );
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    const stream = renderToPipeableStream(
      <WouterRouter ssrPath={urlPath}>
        <App />
      </WouterRouter>,
      {
        onAllReady() {
          stream.pipe(sink);
        },
        onShellError(error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        onError(error: unknown) {
          errors.push(error);
        },
      },
    );
  });
}

/** Loads what a page's queries need, through the queries the page itself runs. */
async function loadPageQueries(urlPath: string): Promise<void> {
  queryClient.clear();
  if (urlPath === "/legal") {
    await queryClient.fetchQuery(legalIndexQueryOptions());
    return;
  }
  const legal = /^\/legal\/([^/]+)$/.exec(urlPath);
  if (legal?.[1]) {
    await queryClient.fetchQuery(legalDocumentQueryOptions(legal[1]));
  }
}

/** Published legal documents with their effective dates, read through the page's own loader. */
async function loadPublishedLegal(): Promise<PrerenderContent["legal"]> {
  const documents = await Promise.all(
    (await loadLegalSlugs()).map((slug) => loadLegalDocument(slug)),
  );
  const published: { slug: string; effectiveDate: string }[] = [];
  for (const doc of documents) {
    if (doc.state === "error")
      throw new Error(`legal/${doc.slug} could not be read: ${doc.reason}`);
    if (doc.state === "published")
      published.push({ slug: doc.slug, effectiveDate: doc.effectiveDate });
  }
  return published;
}

export async function prerenderSite(options: {
  repoRoot: string;
  template: string;
}): Promise<PrerenderedSite> {
  const registry = parseRouteRegistry(
    fs.readFileSync(
      path.join(options.repoRoot, "infra/route-surface-classification.yaml"),
      "utf8",
    ),
  );

  const realFetch = globalThis.fetch;
  globalThis.fetch = legalFetch(path.join(options.repoRoot, "legal"));
  try {
    const content: PrerenderContent = {
      blog: BLOG_POSTS.map((post) => ({ slug: post.slug, date: post.date })),
      legal: await loadPublishedLegal(),
    };
    const pages: PrerenderedPage[] = [];
    for (const page of expandPrerenderPages(registry, content)) {
      const meta = getPublicMeta(page.path);
      if (!meta)
        throw new Error(
          `prerender: ${page.path} has no entry in shared/seo/public-meta.ts`,
        );
      await loadPageQueries(page.path);
      const body = await renderAppHtml(page.path);
      pages.push({
        ...page,
        file: outputFileFor(page.path),
        html: withBody(withHead(options.template, renderPageHead(meta)), body),
      });
    }

    queryClient.clear();
    const notFoundBody = await renderAppHtml(NOT_FOUND_RENDER_PATH);
    return {
      pages,
      notFoundHtml: withBody(
        withHead(options.template, renderNotFoundHead()),
        notFoundBody,
      ),
      shellHtml: options.template,
      sitemapXml: buildSitemapXml(pages, BASE_URL),
    };
  } finally {
    globalThis.fetch = realFetch;
    queryClient.clear();
  }
}
