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
 *  - Question of the Day archive pages (2026-10-05, plan Q3): the past days are read once, before
 *    `fetch` is stubbed, by qotd-archive-source.ts (or passed in by a test), and each day's
 *    payload is put in the query cache under the key the page itself queries, as the legal
 *    pages are. A day that is not strictly before the build's own America/Chicago date is
 *    dropped here as well, whatever the source says, so no build can emit an answer early.
 *  - Content pages (SEO Wave 3, 2026-10-05): a page that shows past Questions of the Day gets the
 *    archive list and exactly the days `qotdSampleDates` picks put in the cache, the same pure
 *    choice the page makes in the browser. After every page is rendered, the publish gate
 *    (shared/seo/content-gate.ts) checks each content page's data and its rendered HTML, and any
 *    problem fails the build: an unapproved or unsourced page cannot deploy (plan row C3). The
 *    five blog posts are content pages too since the C4 rewrite and are gated the same way.
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
import { BLOG_PAGES, BLOG_POSTS } from "@shared/content/blog";
import { resolvePublicMeta } from "@shared/seo/public-meta";
import { toArchiveIndex } from "@shared/qotd/projection";
import { qotdToday } from "../../../server/services/qotd/qotd-service";
import {
  qotdArchiveDayQueryOptions,
  qotdArchiveIndexQueryOptions,
} from "@/lib/qotd";
import type { QotdArchiveResponse } from "../../../packages/shared/src/qotd-schema";
import {
  loadQotdArchiveForBuild,
  type QotdArchiveSource,
} from "./qotd-archive-source";
import { BASE_URL } from "@shared/seo/structured-data";
import {
  renderNotFoundHead,
  renderPageHead,
  withBody,
  withHead,
} from "@shared/seo/head";
import {
  QOTD_HUB_PATH,
  buildSitemapXml,
  expandPrerenderPages,
  parseRouteRegistry,
  type PrerenderContent,
  type PrerenderPage,
  type RouteRegistryRow,
} from "@shared/seo/route-registry";
import { legalFetch } from "../../../vite-plugin-legal-content";
import { CONTENT_PAGES, contentPageAt } from "@shared/content/pages";
import { qotdSampleDates } from "@shared/content/qotd-samples";
import type { ContentPage } from "../../../packages/shared/src/seo-content-schema";
import {
  claimIdsIn,
  contentPageProblems,
  renderedPageProblems,
  type GateContext,
} from "@shared/seo/content-gate";

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
  /** Where the Question of the Day archive came from, and the days built from it. */
  qotdArchive: {
    source: QotdArchiveSource["source"];
    days: QotdArchiveResponse[];
  };
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
async function loadPageQueries(
  urlPath: string,
  qotdDays: readonly QotdArchiveResponse[],
): Promise<void> {
  queryClient.clear();
  if (urlPath === QOTD_HUB_PATH) {
    queryClient.setQueryData(
      qotdArchiveIndexQueryOptions().queryKey,
      toArchiveIndex(
        qotdDays.map((d) => ({
          qotd_date: d.qotd_date,
          section_code: d.question.section_code,
          domain: d.question.domain,
        })),
      ),
    );
    return;
  }
  if (urlPath.startsWith(`${QOTD_HUB_PATH}/`)) {
    const date = urlPath.slice(QOTD_HUB_PATH.length + 1);
    const day = qotdDays.find((d) => d.qotd_date === date);
    if (!day) throw new Error(`prerender: no archive payload for ${urlPath}`);
    queryClient.setQueryData(qotdArchiveDayQueryOptions(date).queryKey, day);
    return;
  }
  const content = contentPageAt(urlPath);
  if (content) {
    const blocks = [
      ...content.intro,
      ...content.sections.flatMap((section) => section.blocks),
    ];
    const samples = blocks.flatMap((b) => (b.type === "qotd" ? [b] : []));
    if (samples.length > 0) {
      const index = toArchiveIndex(
        qotdDays.map((d) => ({
          qotd_date: d.qotd_date,
          section_code: d.question.section_code,
          domain: d.question.domain,
        })),
      );
      queryClient.setQueryData(qotdArchiveIndexQueryOptions().queryKey, index);
      for (const block of samples) {
        for (const date of qotdSampleDates(index.days, block.filter, block.limit)) {
          const day = qotdDays.find((d) => d.qotd_date === date);
          if (!day) throw new Error(`prerender: no archive payload for ${date}`);
          queryClient.setQueryData(qotdArchiveDayQueryOptions(date).queryKey, day);
        }
      }
    }
    return;
  }
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

/**
 * The publish gate over the built site (plan row C3). A link resolves when it names a page this
 * build produced or a registry route the SPA answers (`/login`, …); a redirect row does not
 * count, so a link left pointing at a 301 fails here. Throws with every problem at once.
 */
export function assertContentPagesPublishable(
  contentPages: readonly ContentPage[],
  pages: readonly { path: string; html: string }[],
  registry: readonly RouteRegistryRow[],
  claimInventory: string,
): void {
  const served = new Set<string>([
    ...pages.map((p) => p.path),
    ...registry
      .filter((r) => !r.redirect_to && !r.path_pattern.includes(":"))
      .map((r) => r.path_pattern),
  ]);
  const ctx: GateContext = {
    resolves: (p) => served.has(p),
    claimIds: claimIdsIn(claimInventory),
    claimInventory,
  };
  const problems: string[] = [];
  for (const content of contentPages) {
    problems.push(...contentPageProblems(content, ctx));
    const built = pages.find((p) => p.path === content.path);
    if (!built) {
      problems.push(`${content.path}: no prerendered page (is it in the registry?)`);
      continue;
    }
    problems.push(...renderedPageProblems(content.path, built.html, ctx));
  }
  if (problems.length > 0) {
    throw new Error(
      `content publish gate failed (shared/seo/content-gate.ts):\n  ${problems.join("\n  ")}`,
    );
  }
}

export async function prerenderSite(options: {
  repoRoot: string;
  template: string;
  /** Tests pass the archive in; the build reads it from the database. */
  qotdArchive?: readonly QotdArchiveResponse[];
  now?: Date;
}): Promise<PrerenderedSite> {
  const registry = parseRouteRegistry(
    fs.readFileSync(
      path.join(options.repoRoot, "infra/route-surface-classification.yaml"),
      "utf8",
    ),
  );

  // Read with the real fetch, before it is stubbed for the legal loader.
  const loaded: QotdArchiveSource = options.qotdArchive
    ? { source: "fixture", days: [...options.qotdArchive] }
    : await loadQotdArchiveForBuild(process.env, globalThis.fetch);
  // The one canonical QOTD day helper (America/Chicago), shared with the API.
  const today = qotdToday(options.now);
  const qotdDays = loaded.days.filter((d) => d.qotd_date < today);

  const realFetch = globalThis.fetch;
  globalThis.fetch = legalFetch(path.join(options.repoRoot, "legal"));
  try {
    const content: PrerenderContent = {
      blog: BLOG_POSTS.map((post) => ({ slug: post.slug, date: post.date })),
      legal: await loadPublishedLegal(),
      qotd: qotdDays.map((d) => ({ date: d.qotd_date })),
    };
    const pages: PrerenderedPage[] = [];
    for (const page of expandPrerenderPages(registry, content)) {
      const meta = resolvePublicMeta(page.path, qotdDays);
      if (!meta)
        throw new Error(
          `prerender: ${page.path} has no entry in shared/seo/public-meta.ts`,
        );
      await loadPageQueries(page.path, qotdDays);
      const body = await renderAppHtml(page.path);
      pages.push({
        ...page,
        file: outputFileFor(page.path),
        html: withBody(withHead(options.template, renderPageHead(meta)), body),
      });
    }

    assertContentPagesPublishable(
      [...CONTENT_PAGES, ...BLOG_PAGES],
      pages,
      registry,
      fs.readFileSync(
        path.join(options.repoRoot, "docs/compliance/claim-inventory.md"),
        "utf8",
      ),
    );

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
      qotdArchive: { source: loaded.source, days: qotdDays },
    };
  } finally {
    globalThis.fetch = realFetch;
    queryClient.clear();
  }
}
